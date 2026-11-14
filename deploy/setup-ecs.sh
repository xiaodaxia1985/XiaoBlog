#!/usr/bin/env bash
# =============================================================================
# XiaoBlog ECS 一键后端部署脚本（薄 API + PostgreSQL + nginx 反代 + systemd）
#
# 适用：阿里云 Ubuntu 22.04/24.04 ECS，以 root 执行：
#   sudo bash deploy/setup-ecs.sh
#
# 幂等：可重复运行。已存在的库/角色/服务/配置不会被重复创建；密钥仅在首次生成，
#       已存在的 .env 不被覆盖（加 --regen-secrets 可重生成密钥，需手动同步）。
#
# 前置：仓库已位于 $REPO_DIR（CI 的 /opt/XiaoBlog/deploy.sh 负责拉代码；本脚本只装后端）。
# =============================================================================
set -euo pipefail

# ----------------------------- 可调配置（按实际改） -----------------------------
REPO_DIR="/opt/XiaoBlog"
SITE_DOMAIN="xiaomaker.top"          # 上线域名；未备案/未切 DNS 前仅作占位
PUBLIC_HOST="39.96.115.35"           # 联调期 ECS 公网 IP

NODE_MAJOR="22"
API_PORT="8787"

DB_NAME_API="xb_api"
DB_USER_API="xb_api"

BUILD_FRONTEND="1"                   # 1=在仓库目录重新构建 dist 与 slugs.json；0=沿用现有 dist
# ------------------------------------------------------------------------------

API_ENV="$REPO_DIR/server/.env"
SVC_USER="xb"
NGINX_SITE="xiaoblog.conf"

regen_secrets=0
[ "${1:-}" = "--regen-secrets" ] && regen_secrets=1

c_info() { printf "\033[1;32m[setup]\033[0m %s\n" "$*"; }
c_warn() { printf "\033[1;33m[setup]\033[0m %s\n" "$*" >&2; }
die() { printf "\033[1;31m[setup] 失败:\033[0m %s\n" "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 执行：sudo bash deploy/setup-ecs.sh"
[ -d "$REPO_DIR" ] || die "仓库目录不存在：$REPO_DIR（先由 CI/deploy.sh 拉代码到该路径）"

# ----------------------------- 1. 系统依赖 -----------------------------
c_info "1/8 安装系统依赖（postgresql / nginx / node $NODE_MAJOR / curl / unzip）"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl wget gnupg ca-certificates lsb-release unzip \
    postgresql postgresql-contrib nginx >/dev/null

# Node 22（NodeSource）
if ! command -v node >/dev/null || [ "$(node -v | cut -d v -f2 | cut -d . -f1)" -lt "$NODE_MAJOR" ]; then
    c_info "  配置 NodeSource Node $NODE_MAJOR 源"
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y -qq nodejs >/dev/null
fi
node -v && npm -v

# 专用非登录系统用户
if ! id "$SVC_USER" >/dev/null 2>&1; then
    c_info "  创建系统用户 $SVC_USER"
    useradd --system --no-create-home --shell /usr/sbin/nologin "$SVC_USER"
fi

# ----------------------------- 2. PostgreSQL 建库建角色 -----------------------------
c_info "2/8 准备 PostgreSQL 数据库与角色"
systemctl enable --now postgresql

api_pw_file="/opt/.xb-api-pw"
if [ ! -f "$api_pw_file" ] || [ "$regen_secrets" = 1 ]; then
    openssl rand -hex 24 > "$api_pw_file"; chmod 600 "$api_pw_file"
fi
API_PW="$(cat "$api_pw_file")"

psql_as_postgres() { sudo -u postgres psql -v ON_ERROR_STOP=1 -q "$@"; }

# 角色（带密码）与数据库，幂等创建
psql_as_postgres <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER_API}') THEN
    CREATE ROLE ${DB_USER_API} LOGIN PASSWORD '${API_PW}';
  ELSE
    ALTER ROLE ${DB_USER_API} LOGIN PASSWORD '${API_PW}';
  END IF;
END
\$\$;
SQL

psql_as_postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME_API'" | grep -q 1 \
    || psql_as_postgres -c "CREATE DATABASE $DB_NAME_API OWNER $DB_USER_API"

# ----------------------------- 3. 薄 API 环境与依赖 -----------------------------
c_info "3/8 写入薄 API 环境变量并安装依赖"
if [ ! -f "$API_ENV" ] || [ "$regen_secrets" = 1 ]; then
    visitor_salt="$(openssl rand -hex 32)"
    cat > "$API_ENV" <<EOF
DATABASE_URL=postgres://${DB_USER_API}:${API_PW}@127.0.0.1:5432/${DB_NAME_API}
SITE_URL=http://${PUBLIC_HOST}
VISITOR_SALT=${visitor_salt}
SLUG_WHITELIST_FILE=../public/data/slugs.json
PORT=${API_PORT}
RATE_LIMIT_MAX=30
RATE_LIMIT_WINDOW=1 minute
EOF
    chmod 600 "$API_ENV"
fi
chown "$SVC_USER:$SVC_USER" "$API_ENV"

cd "$REPO_DIR/server"
npm ci --omit=dev --no-audit --no-fund

# ----------------------------- 4. 前端构建（dist + slugs.json） -----------------------------
if [ "$BUILD_FRONTEND" = "1" ]; then
    c_info "4/8 构建静态产物（含 public/data/slugs.json 白名单）"
    cd "$REPO_DIR"
    npm ci --no-audit --no-fund
    npm run build
else
    c_info "4/8 跳过前端构建（BUILD_FRONTEND=0），沿用现有 dist"
fi
[ -f "$REPO_DIR/public/data/slugs.json" ] || die "缺少 public/data/slugs.json，请先在仓库目录跑 npm run build"

# ----------------------------- 5. systemd 单元 -----------------------------
c_info "5/8 安装并启用 systemd 服务"
cp "$REPO_DIR/deploy/systemd/xb-api.service" /etc/systemd/system/xb-api.service
systemctl daemon-reload
systemctl enable --now xb-api

# ----------------------------- 6. nginx 反代 -----------------------------
c_info "6/8 写入 nginx 站点配置并 reload"
sed -e "s|__REPO_DIR__|$REPO_DIR|g" \
    -e "s|__SITE_HOST__|$SITE_DOMAIN $PUBLIC_HOST|g" \
    -e "s|__API_PORT__|$API_PORT|g" \
    "$REPO_DIR/deploy/nginx/$NGINX_SITE" > "/etc/nginx/sites-available/$NGINX_SITE"
ln -sfn "/etc/nginx/sites-available/$NGINX_SITE" "/etc/nginx/sites-enabled/$NGINX_SITE"
# 去掉默认站点对 80 端口的抢占
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# ----------------------------- 7. 防火墙 -----------------------------
c_info "7/8 配置防火墙（OpenSSH / 80 / 443）"
if command -v ufw >/dev/null 2>&1; then
    ufw allow OpenSSH || true
    ufw allow 80/tcp || true
    ufw allow 443/tcp || true
    ufw --force enable || true
fi

# ----------------------------- 8. 健康检查 -----------------------------
c_info "8/8 健康检查"
first_slug="$(node -e "const s=require('$REPO_DIR/public/data/slugs.json');process.stdout.write(s[0]||'')")"
sleep 2
systemctl is-active --quiet xb-api || die "xb-api 未运行，查看 journalctl -u xb-api -n 50"

if [ -n "$first_slug" ]; then
    api_code="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${API_PORT}/api/stats/${first_slug}")"
    c_info "  薄 API /api/stats/${first_slug} → HTTP ${api_code}"
else
    c_warn "  slugs.json 为空，跳过 API 文章统计探测"
fi

# ----------------------------- 收尾提示 -----------------------------
c_info "部署完成"
cat <<EOF

────────────────────────────────────────────────────────────
服务状态：
  systemctl status xb-api nginx postgresql
  日志：journalctl -u xb-api -f

本机回环：
  薄 API   http://127.0.0.1:${API_PORT}/api/stats/<slug>

对外（IP 联调期）：
  站点     http://${PUBLIC_HOST}/
  薄 API   http://${PUBLIC_HOST}/api/

前端构建环境变量（仓库 .env，需与上面对外地址一致）：
  PUBLIC_API_BASE=http://${PUBLIC_HOST}

上线切域名后要改：
  1. server/.env 的 SITE_URL → https://${SITE_DOMAIN}
  2. 前端 .env 的 PUBLIC_API_BASE 重建产物
  3. nginx 加 443/TLS
详见 docs/后端部署手册_ECS.md
────────────────────────────────────────────────────────────
EOF

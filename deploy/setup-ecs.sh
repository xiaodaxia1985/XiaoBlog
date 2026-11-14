#!/usr/bin/env bash
# =============================================================================
# XiaoBlog ECS 一键后端部署脚本（薄 API + PostgreSQL + nginx 反代 + systemd）
#
# 适用：
#   - Debian/Ubuntu 22.04/24.04（apt / ufw / sites-enabled）
#   - RHEL 系：Alibaba Cloud Linux 3 / CentOS / RHEL / Rocky / AlmaLinux（dnf / firewalld / conf.d）
# 以 root 执行：
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

# 私有页 /d/ Basic Auth
DASH_USER="xb-admin"
HTPASSWD_FILE="/etc/nginx/.xb-htpasswd"
DASH_PW_FILE="/opt/.xb-dashboard-pw"

# swap 大小（2G 内存机型补 1G 交换空间防 OOM）；设为空则不创建。
SWAP_SIZE="1G"

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

# ----------------------------- 识别发行版 -----------------------------
. /etc/os-release 2>/dev/null || true
case "${ID:-}" in
  ubuntu|debian)            DISTRO=debian ;;
  alinux|centos|rhel|rocky|almalinux|ol|anolis) DISTRO=rhel ;;
  *)
    # 兜底：有 apt 判 Debian，否则按 RHEL 系处理
    if command -v apt-get >/dev/null 2>&1; then DISTRO=debian; else DISTRO=rhel; fi
    ;;
esac
c_info "识别发行版：${PRETTY_NAME:-$ID}（按 $DISTRO 系处理）"

# ----------------------------- 1. 系统依赖 -----------------------------
c_info "1/8 安装系统依赖（postgresql / nginx / node $NODE_MAJOR / curl / unzip）"
if [ "$DISTRO" = debian ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl wget gnupg ca-certificates lsb-release unzip \
      postgresql postgresql-contrib nginx >/dev/null
else
  dnf install -y -q curl wget ca-certificates unzip openssl \
      postgresql-server postgresql-contrib nginx
fi

# Node $NODE_MAJOR（NodeSource；Debian 走 deb，RHEL 走 rpm）
need_node=0
if ! command -v node >/dev/null 2>&1; then
  need_node=1
else
  cur_major="$(node -v | cut -d v -f2 | cut -d . -f1)"
  [ "$cur_major" -lt "$NODE_MAJOR" ] 2>/dev/null && need_node=1
fi
if [ "$need_node" = 1 ]; then
  c_info "  配置 NodeSource Node $NODE_MAJOR 源并安装"
  if [ "$DISTRO" = debian ]; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - || true
    apt-get install -y -qq nodejs >/dev/null || true
  else
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash - || true
    dnf install -y -q nodejs || true
  fi
fi
if command -v node >/dev/null 2>&1; then
  node -v && npm -v
  cur_major="$(node -v | cut -d v -f2 | cut -d . -f1)"
  if [ "$cur_major" -lt "$NODE_MAJOR" ] 2>/dev/null; then
    c_warn "  当前 Node 主版本 $cur_major 低于 $NODE_MAJOR；NodeSource 源若未识别本发行版，可按手册用 nvm 或官方二进制手动升级"
  fi
else
  die "未安装 Node.js，请按手册手动安装 Node $NODE_MAJOR 后重跑"
fi

# 专用非登录系统用户
if ! id "$SVC_USER" >/dev/null 2>&1; then
  c_info "  创建系统用户 $SVC_USER"
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SVC_USER"
fi

# swap：内存偏小时补交换空间防 OOM；已存在则跳过，幂等。
if [ -n "$SWAP_SIZE" ] && [ ! -f /swapfile ]; then
  c_info "  创建 $SWAP_SIZE swapfile"
  fallocate -l "$SWAP_SIZE" /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=1024
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -qE '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
else
  c_info "  swapfile 已存在或未配置 SWAP_SIZE，跳过"
fi

# ----------------------------- 2. PostgreSQL 建库建角色 -----------------------------
c_info "2/8 准备 PostgreSQL 数据库与角色"
if [ "$DISTRO" = rhel ]; then
  # RHEL 系首次需要初始化数据簇；已初始化则跳过。
  if [ ! -f /var/lib/pgsql/data/PG_VERSION ]; then
    c_info "  初始化 PostgreSQL 数据簇"
    postgresql-setup --initdb
  fi
fi
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

# RHEL 系（ALinux3 PG13 默认 ident 认证 + md5 口令加密）：把本机 TCP 口令登录对齐
# scram-sha-256，避免应用用密码连 127.0.0.1 被拒。改前备份 pg_hba，重载后重存角色口令。
if [ "$DISTRO" = rhel ]; then
  PG_HBA="$(psql_as_postgres -tAc 'SHOW hba_file' | tr -d '[:space:]')"
  PG_CONF="$(psql_as_postgres -tAc 'SHOW config_file' | tr -d '[:space:]')"
  if [ -f "$PG_HBA" ]; then
    cp -a "$PG_HBA" "$PG_HBA.bak.$(date +%s)"
    awk -v OFS=' ' '/^host/ && ($4=="127.0.0.1/32" || $4=="::1/128") { $5="scram-sha-256" } { print }' \
      "$PG_HBA" > "$PG_HBA.tmp" && mv "$PG_HBA.tmp" "$PG_HBA"
  fi
  if [ -f "$PG_CONF" ]; then
    if grep -qE '^[[:space:]]*#?[[:space:]]*password_encryption' "$PG_CONF"; then
      sed -i -E 's/^[[:space:]]*#?[[:space:]]*password_encryption[[:space:]]*=.*/password_encryption = scram-sha-256/' "$PG_CONF"
    else
      echo "password_encryption = scram-sha-256" >> "$PG_CONF"
    fi
  fi
  systemctl reload postgresql
  psql_as_postgres -c "ALTER ROLE ${DB_USER_API} LOGIN PASSWORD '${API_PW}'"
fi

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

# 静态产物与 node_modules 需让 nginx / xb 用户可读可执行
chmod -R a+rX "$REPO_DIR/dist" "$REPO_DIR/server/node_modules" 2>/dev/null || true

# ----------------------------- 5. systemd 单元 -----------------------------
c_info "5/8 安装并启用 systemd 服务"
cp "$REPO_DIR/deploy/systemd/xb-api.service" /etc/systemd/system/xb-api.service
cp "$REPO_DIR/deploy/systemd/xb-backup.service" /etc/systemd/system/xb-backup.service
cp "$REPO_DIR/deploy/systemd/xb-backup.timer" /etc/systemd/system/xb-backup.timer
systemctl daemon-reload
# restart 而非 enable --now：对已在运行的服务，--now 不会重载新代码/新环境，必须重启才生效。
systemctl enable xb-api
systemctl restart xb-api
systemctl enable --now xb-backup.timer

# ----------------------------- 6. nginx 反代 -----------------------------
c_info "6/8 写入 nginx 站点配置并 reload"

# 私有页 /d/ Basic Auth 凭据（首次生成；--regen-secrets 可重置）。
# apr1 哈希由 nginx auth_basic 识别；明文密码仅存 root 可读文件，便于找回，不进仓库。
if [ ! -f "$HTPASSWD_FILE" ] || [ "$regen_secrets" = 1 ]; then
  dash_pw="$(openssl rand -hex 16)"
  openssl passwd -apr1 "$dash_pw" | awk -v u="$DASH_USER" '{print u":"$0}' > "$HTPASSWD_FILE"
  # htpasswd 需让 nginx worker 可读：640 + 属主组为 web 用户；明文密码文件仍 600 root。
  chmod 640 "$HTPASSWD_FILE"
  if [ "$DISTRO" = debian ]; then chown root:www-data "$HTPASSWD_FILE" 2>/dev/null || true; else chown root:nginx "$HTPASSWD_FILE" 2>/dev/null || true; fi
  printf '%s %s\n' "$DASH_USER" "$dash_pw" > "$DASH_PW_FILE"
  chmod 600 "$DASH_PW_FILE"
  c_info "  生成私有页 Basic Auth 凭据（明文存于 $DASH_PW_FILE，600）"
fi

if [ "$DISTRO" = debian ]; then
    sed -e "s|__REPO_DIR__|$REPO_DIR|g" \
        -e "s|__SITE_HOST__|$SITE_DOMAIN $PUBLIC_HOST|g" \
        -e "s|__API_PORT__|$API_PORT|g" \
        "$REPO_DIR/deploy/nginx/$NGINX_SITE" > "/etc/nginx/sites-available/$NGINX_SITE"
    ln -sfn "/etc/nginx/sites-available/$NGINX_SITE" "/etc/nginx/sites-enabled/$NGINX_SITE"
    # 去掉默认站点对 80 端口的抢占
    rm -f /etc/nginx/sites-enabled/default
else
    sed -e "s|__REPO_DIR__|$REPO_DIR|g" \
        -e "s|__SITE_HOST__|$SITE_DOMAIN $PUBLIC_HOST|g" \
        -e "s|__API_PORT__|$API_PORT|g" \
        "$REPO_DIR/deploy/nginx/$NGINX_SITE" > "/etc/nginx/conf.d/$NGINX_SITE"
    # RHEL 系默认示例站点若存在则移除，避免抢占 80
    rm -f /etc/nginx/conf.d/default.conf
fi
nginx -t
systemctl reload nginx

# ----------------------------- 7. 防火墙 -----------------------------
c_info "7/8 配置防火墙（SSH / 80 / 443）"
if [ "$DISTRO" = debian ]; then
    if command -v ufw >/dev/null 2>&1; then
        ufw allow OpenSSH || true
        ufw allow 80/tcp || true
        ufw allow 443/tcp || true
        ufw --force enable || true
    fi
else
    systemctl enable --now firewalld || true
    firewall-cmd --permanent --add-service=ssh || true
    firewall-cmd --permanent --add-service=http || true
    firewall-cmd --permanent --add-service=https || true
    firewall-cmd --reload || true
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

私有页 /d/ Basic Auth：
  账号 $DASH_USER，明文密码见 ${DASH_PW_FILE}（600，仅 root 可读）；
  改密码：sudo bash deploy/setup-ecs.sh --regen-secrets（会同时重生成 API 密钥，需同步 .env）。

备份：
  每日 03:17 由 xb-backup.timer 触发 deploy/backup.sh，留存 7 天；
  手动跑：sudo bash deploy/backup.sh；查看：systemctl list-timers xb-backup.timer

上线切域名后要改：
  1. server/.env 的 SITE_URL → https://${SITE_DOMAIN}
  2. 前端 .env 的 PUBLIC_API_BASE 重建产物
  3. nginx 加 443/TLS
详见 docs/后端部署手册_ECS.md
────────────────────────────────────────────────────────────
EOF

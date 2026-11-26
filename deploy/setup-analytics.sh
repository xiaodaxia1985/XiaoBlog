#!/usr/bin/env bash
# =============================================================================
# XiaoBlog 数据统计后端一键装机（PostgreSQL + 只读 API + nginx 反代 + 定时任务）
# 适用：Alibaba Cloud Linux 3.2104 U13.4 (OpenAnolis Edition) / RHEL 8 系
#       （也兼容 Debian/Ubuntu）。ECS 已有 PostgreSQL，本脚本幂等补齐其余部分。
# 以 root 执行：sudo bash deploy/setup-analytics.sh
#
# AL3 针对性处理：
#   - os-release 用 ID/ID_LIKE 双重识别 alinux/anolis/openanolis → RHEL 系
#   - 不依赖 sudo 包：切用户一律用 runuser（util-linux 自带）
#   - postgresql-setup 同时兼容 "--initdb" 与 "initdb" 两种写法
#   - certbot 依赖 EPEL，RHEL 分支先启用 epel-release
#   - systemd ExecStart 的 node 路径用 command -v 动态取，不写死 /usr/bin/node
# =============================================================================
set -euo pipefail

REPO_DIR="/opt/XiaoBlog"
API_USER="deployer"
SITE_DOMAIN="xiaomaker.top"
PUBLIC_HOST="39.96.115.35"
NGINX_CONF="/etc/nginx/conf.d/xiaoblog-analytics-api.conf"
API_SERVICE="/etc/systemd/system/xb-analytics-api.service"
INGEST_SERVICE="/etc/systemd/system/xb-analytics-ingest.service"
INGEST_TIMER="/etc/systemd/system/xb-analytics-ingest.timer"
DB_NAME="xiaoblog"
DB_USER="xb"
DB_PASSWORD_FILE="/opt/.xb-analytics-db-pw"
ENV_FILE="$REPO_DIR/server/.env"

. /etc/os-release 2>/dev/null || true
case "${ID:-}" in
  ubuntu|debian) DISTRO=debian ;;
  alinux|anolis|openanolis|centos|rhel|rocky|almalinux|ol) DISTRO=rhel ;;
  *)
    # AL3 OpenAnolis 某些版本 ID=alinux 但 ID_LIKE 才是可靠信号，用 ID_LIKE 兜底
    case " ${ID_LIKE:-} " in
      *rhel*|*fedora*|*centos*|*anolis*) DISTRO=rhel ;;
      *) if command -v apt-get >/dev/null 2>&1; then DISTRO=debian; else DISTRO=rhel; fi ;;
    esac ;;
esac
info() { printf '\033[1;32m[analytics]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[analytics]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[analytics] 失败:\033[0m %s\n' "$*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "请用 root 执行"
[ -d "$REPO_DIR/server" ] || die "缺少 $REPO_DIR/server，请先 git pull 部署代码"
info "发行版：${PRETTY_NAME:-${ID:-unknown}}（ID=${ID:-?}，ID_LIKE=${ID_LIKE:-?}，按 $DISTRO 系处理）"

# ----------------------------- 1. PostgreSQL -----------------------------
info "1/6 PostgreSQL 检查与初始化"
if command -v psql >/dev/null 2>&1; then
  info "  psql 已安装：$(psql --version)"
else
  info "  安装 postgresql-server"
  if [ "$DISTRO" = debian ]; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq && apt-get install -y -qq postgresql postgresql-client >/dev/null
  else
    dnf install -y -q postgresql-server postgresql-contrib
    # AL3/Anolis：两种 initdb 写法都试；已初始化时会提示已存在，忽略即可
    postgresql-setup --initdb 2>/dev/null || postgresql-setup initdb 2>/dev/null || true
  fi
fi
systemctl enable --now postgresql

# 生成或读取数据库密码（只存 ECS 本机 600 文件，不进仓库）
if [ ! -s "$DB_PASSWORD_FILE" ]; then
  DB_PW="$(openssl rand -hex 24)"
  printf '%s' "$DB_PW" > "$DB_PASSWORD_FILE"
  chmod 600 "$DB_PASSWORD_FILE"
  chown root:root "$DB_PASSWORD_FILE"
  info "  已生成数据库密码：$DB_PASSWORD_FILE（600）"
else
  DB_PW="$(cat "$DB_PASSWORD_FILE")"
fi

# 用 postgres 系统用户幂等建库/建角色（runuser 不依赖 sudo 包）
if ! runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  runuser -u postgres -- psql -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PW';"
else
  runuser -u postgres -- psql -c "ALTER ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PW';"
fi
if ! runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
  runuser -u postgres -- createdb -O "$DB_USER" "$DB_NAME"
fi
DATABASE_URL="postgresql://$DB_USER:$DB_PW@127.0.0.1:5432/$DB_NAME"

# 建表：Analytics 专用前向迁移（0001 的点赞/阅读表与本任务无关，不建）
runuser -u postgres -- psql -d "$DB_NAME" -f "$REPO_DIR/server/migrations/0002_analytics.sql"

# 写 API 运行环境文件（600，属主 API 用户）
printf 'DATABASE_URL=%s\nPORT=8787\n' "$DATABASE_URL" > "$ENV_FILE"
chmod 600 "$ENV_FILE"

# ----------------------------- 2. Node 依赖 -----------------------------
info "2/6 安装 server 依赖（fastify / pg）"
cd "$REPO_DIR/server"
npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

# ----------------------------- 3. API 用户与目录权限 -----------------------------
info "3/6 创建服务用户并修正权限"
if ! id -u "$API_USER" >/dev/null 2>&1; then
  useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin "$API_USER"
fi
chown -R "$API_USER":"$API_USER" "$REPO_DIR/server"
chmod 600 "$ENV_FILE"
chown "$API_USER":"$API_USER" "$ENV_FILE"
chmod -R a+rX "$REPO_DIR/dist" 2>/dev/null || true

NODE_BIN="$(command -v node || printf '/usr/bin/node')"
info "  node 路径：$NODE_BIN（$(node -v)）"

# ----------------------------- 4. systemd API 服务 -----------------------------
info "4/6 写入 systemd 服务与定时器"
cat > "$API_SERVICE" <<EOF
[Unit]
Description=XiaoBlog analytics readonly API
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=$API_USER
Group=$API_USER
WorkingDirectory=$REPO_DIR/server
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN $REPO_DIR/server/api.mjs
Restart=on-failure
RestartSec=3
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

# 入库 service：把 public/data/analytics.json upsert 到 PG
cat > "$INGEST_SERVICE" <<EOF
[Unit]
Description=Ingest analytics.json into PostgreSQL
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=oneshot
User=$API_USER
Group=$API_USER
WorkingDirectory=$REPO_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN $REPO_DIR/server/ingest-analytics.mjs
StandardOutput=journal
StandardError=journal
EOF

# 每天 00:10（Asia/Shanghai）入库；抓取与入库由 deploy.sh 里的链完成，此为兜底定时
cat > "$INGEST_TIMER" <<EOF
[Unit]
Description=Daily analytics ingest at 00:10 CST

[Timer]
OnCalendar=*-*-* 00:10:00
Timezone=Asia/Shanghai
Persistent=true
Unit=xb-analytics-ingest.service

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now xb-analytics-api.service
systemctl enable --now xb-analytics-ingest.timer

# ----------------------------- 5. nginx 反代 -----------------------------
info "5/6 配置 nginx /api/ 反代"
# /api/ 反代已并入站点模板 deploy/nginx/xiaoblog.conf，由 setup-ecs.sh 统一渲染；
# 这里只保留片段文件作说明，不再单独放进 /etc/nginx/conf.d/（裸 location 在 server 块外会 nginx -t 失败）。
rm -f "$NGINX_CONF"
if command -v nginx >/dev/null 2>&1; then
  nginx -t && systemctl reload nginx
else
  warn "nginx 未安装，跳过；setup-ecs.sh 会安装"
fi

# ----------------------------- 6. 首次入库 + 健康检查 -----------------------------
info "6/6 首次入库与健康检查"
if [ -f "$REPO_DIR/public/data/analytics.json" ]; then
  runuser -u "$API_USER" -- env DATABASE_URL="$DATABASE_URL" node "$REPO_DIR/server/ingest-analytics.mjs" || warn "首次入库失败，检查 journalctl -u xb-analytics-ingest"
else
  warn "public/data/analytics.json 不存在，跳过首次入库"
fi
systemctl status xb-analytics-api.service --no-pager -l || true
curl -fsS http://127.0.0.1:8787/api/health || true

info "部署完成"
cat <<EOF
数据库：$DATABASE_URL（密码在 $DB_PASSWORD_FILE，600）
API：   http://127.0.0.1:8787/api/health
对外：  https://$SITE_DOMAIN/api/analytics/latest
定时任务：
  - 服务端入库兜底：systemctl list-timers xb-analytics-ingest.timer（每日 00:10 CST）
  - 本地四平台抓取 + git push：Windows 任务计划程序 DailyAnalyticsCollect（每日 09:00）
    （用 Task Scheduler 注册 run-collect.ps1 + collect-analytics.mjs + git push，见 README）
日志：  journalctl -u xb-analytics-api -f
EOF

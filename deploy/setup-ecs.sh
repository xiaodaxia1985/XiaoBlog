#!/usr/bin/env bash
# =============================================================================
# XiaoBlog ECS 一键装机脚本（静态站点 + nginx + 私有页 Basic Auth）
#
# 适用：
#   - Debian/Ubuntu 22.04/24.04（apt / ufw / sites-enabled）
#   - RHEL 系：Alibaba Cloud Linux 3 / CentOS / RHEL / Rocky / AlmaLinux（dnf / firewalld / conf.d）
# 以 root 执行：
#   sudo bash deploy/setup-ecs.sh
#
# 幂等：可重复运行。已存在的配置与凭据不会被重复创建；--regen-secrets 只重置私有页密码。
# 前置：仓库已位于 $REPO_DIR（CI 的 /opt/XiaoBlog/deploy.sh 负责拉代码）。
#
# 注：2026-11-20 起站点不再有点赞/阅读量，薄 API、PostgreSQL 与数据库备份已从仓库移除。
# =============================================================================
set -euo pipefail

# ----------------------------- 可调配置（按实际改） -----------------------------
REPO_DIR="/opt/XiaoBlog"
SITE_DOMAIN="xiaomaker.top"          # 上线域名
PUBLIC_HOST="39.96.115.35"           # ECS 公网 IP

NODE_MAJOR="22"

# 私有页 /d/ Basic Auth
DASH_USER="xb-admin"
HTPASSWD_FILE="/etc/nginx/.xb-htpasswd"
DASH_PW_FILE="/opt/.xb-dashboard-pw"

# swap 大小（2G 内存机型补 1G 交换空间防 OOM）；设为空则不创建。
SWAP_SIZE="1G"

BUILD_FRONTEND="1"                   # 1=在仓库目录重新构建 dist；0=沿用现有 dist
# ------------------------------------------------------------------------------

# CI/部署所用的非 root 用户（deploy.sh 以该用户 SSH 进入并执行 sudo）
DEPLOY_USER="deployer"
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
    if command -v apt-get >/dev/null 2>&1; then DISTRO=debian; else DISTRO=rhel; fi
    ;;
esac
c_info "识别发行版：${PRETTY_NAME:-$ID}（按 $DISTRO 系处理）"

# ----------------------------- 1. 系统依赖 -----------------------------
c_info "1/7 安装系统依赖（nginx / node $NODE_MAJOR / curl / unzip）"
if [ "$DISTRO" = debian ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl wget gnupg ca-certificates lsb-release unzip nginx >/dev/null
else
  dnf install -y -q curl wget ca-certificates unzip openssl nginx
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
else
  die "未安装 Node.js，请按手册手动安装 Node $NODE_MAJOR 后重跑"
fi

# swap：内存偏小时补交换空间；已存在则跳过，幂等。
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

# ----------------------------- 2. 前端构建 -----------------------------
if [ "$BUILD_FRONTEND" = "1" ]; then
    c_info "2/7 构建静态产物"
    cd "$REPO_DIR"
    npm ci --no-audit --no-fund
    npm run build
else
    c_info "2/7 跳过前端构建（BUILD_FRONTEND=0），沿用现有 dist"
fi
[ -d "$REPO_DIR/dist" ] || die "缺少 dist/，请先在仓库目录跑 npm run build"

# 静态产物需让 nginx 可读可执行
chmod -R a+rX "$REPO_DIR/dist" 2>/dev/null || true

# ----------------------------- 3. CI 部署用户 sudo 白名单 -----------------------------
# deploy.sh 以该用户非交互 SSH 进入，无法输入 sudo 密码；只放行 reload nginx。
SYSTEMCTL_BIN="$(command -v systemctl)"
cat > /etc/sudoers.d/xb-deployer <<EOF
$DEPLOY_USER ALL=(root) NOPASSWD: $SYSTEMCTL_BIN reload nginx
EOF
chmod 440 /etc/sudoers.d/xb-deployer
visudo -c -f /etc/sudoers.d/xb-deployer

# ----------------------------- 4. nginx 站点配置 -----------------------------
c_info "4/7 写入 nginx 站点配置并 reload"

# 私有页 /d/ Basic Auth 凭据（首次生成；--regen-secrets 可重置）。
if [ ! -f "$HTPASSWD_FILE" ] || [ "$regen_secrets" = 1 ]; then
  dash_pw="$(openssl rand -hex 16)"
  openssl passwd -apr1 "$dash_pw" | awk -v u="$DASH_USER" '{print u":"$0}' > "$HTPASSWD_FILE"
  chmod 640 "$HTPASSWD_FILE"
  if [ "$DISTRO" = debian ]; then chown root:www-data "$HTPASSWD_FILE" 2>/dev/null || true; else chown root:nginx "$HTPASSWD_FILE" 2>/dev/null || true; fi
  printf '%s %s\n' "$DASH_USER" "$dash_pw" > "$DASH_PW_FILE"
  chmod 600 "$DASH_PW_FILE"
  c_info "  生成私有页 Basic Auth 凭据（明文存于 $DASH_PW_FILE，600）"
fi

if [ "$DISTRO" = debian ]; then
    sed -e "s|__REPO_DIR__|$REPO_DIR|g" \
        -e "s|__SITE_HOST__|$SITE_DOMAIN $PUBLIC_HOST|g" \
        "$REPO_DIR/deploy/nginx/$NGINX_SITE" > "/etc/nginx/sites-available/$NGINX_SITE"
    ln -sfn "/etc/nginx/sites-available/$NGINX_SITE" "/etc/nginx/sites-enabled/$NGINX_SITE"
    rm -f /etc/nginx/sites-enabled/default
else
    sed -e "s|__REPO_DIR__|$REPO_DIR|g" \
        -e "s|__SITE_HOST__|$SITE_DOMAIN $PUBLIC_HOST|g" \
        "$REPO_DIR/deploy/nginx/$NGINX_SITE" > "/etc/nginx/conf.d/$NGINX_SITE"
    rm -f /etc/nginx/conf.d/default.conf
fi
nginx -t
systemctl reload nginx

# ----------------------------- 5. 防火墙 -----------------------------
c_info "5/7 配置防火墙（SSH / 80 / 443）"
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

# ----------------------------- 6. TLS -----------------------------
c_info "6/7 TLS 证书（已存在则跳过签发）"
if ! command -v certbot >/dev/null 2>&1; then
  if [ "$DISTRO" = debian ]; then
    apt-get install -y -qq certbot python3-certbot-nginx >/dev/null || true
  else
    dnf install -y -q certbot python3-certbot-nginx >/dev/null || true
  fi
fi
if [ ! -d "/etc/letsencrypt/live/$SITE_DOMAIN" ]; then
  c_warn "  未找到 /etc/letsencrypt/live/$SITE_DOMAIN，请手动签发："
  c_warn "  certbot --nginx -d $SITE_DOMAIN -d www.$SITE_DOMAIN --non-interactive --agree-tos -m <邮箱>"
else
  c_info "  证书已存在，跳过"
fi

# ----------------------------- 7. 健康检查 -----------------------------
c_info "7/7 健康检查"
sleep 1
home_code="$(curl -sSk -o /dev/null -w '%{http_code}' "https://$SITE_DOMAIN/" || true)"
c_info "  https://$SITE_DOMAIN/ → HTTP ${home_code:-失败}"

# ----------------------------- 收尾提示 -----------------------------
c_info "部署完成"
cat <<EOF

────────────────────────────────────────────────────────────
服务状态：
  systemctl status nginx
  日志：journalctl -u nginx -n 50

对外：
  站点     https://${SITE_DOMAIN}/

私有页 /d/ Basic Auth：
  账号 $DASH_USER，明文密码见 ${DASH_PW_FILE}（600，仅 root 可读）；
  改密码：sudo bash deploy/setup-ecs.sh --regen-secrets

站点为纯静态托管，单纯靠 git → CI → deploy.sh 部署，无后端服务与数据库。
────────────────────────────────────────────────────────────
EOF

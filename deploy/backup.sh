#!/usr/bin/env bash
# =============================================================================
# XiaoBlog 数据库与密钥备份（由 systemd timer 每日触发，也可手动 root 执行）
#
# 备份内容：
#   - PostgreSQL 库 xb_api（pg_dump 压缩）
#   - server/.env（环境变量与盐值，600 权限）
# 静态产物 dist/ 可由仓库重新构建，不纳入备份。
#
# 幂等：可重复执行；旧备份按 RETENTION_DAYS 轮转删除。
# =============================================================================
set -euo pipefail

DB_NAME="${DB_NAME_API:-xb_api}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/xb}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
ENV_FILE="/opt/XiaoBlog/server/.env"

TS="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# 1. 数据库备份：以 postgres 系统用户走本机 peer 认证，不经过 TCP 口令。
echo "[backup] dumping $DB_NAME -> $BACKUP_DIR/xb_api-$TS.sql.gz"
sudo -u postgres pg_dump "$DB_NAME" | gzip > "$BACKUP_DIR/xb_api-$TS.sql.gz"

# 2. 环境变量/盐值一并备份（含 DATABASE_URL、VISITOR_SALT），便于整机重建。
if [ -f "$ENV_FILE" ]; then
  cp -a "$ENV_FILE" "$BACKUP_DIR/server.env.$TS"
fi

chmod 600 "$BACKUP_DIR"/* 2>/dev/null || true

# 3. 轮转：删除超过保留天数的库备份与环境备份。
find "$BACKUP_DIR" -name 'xb_api-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name 'server.env.*'      -mtime +"$RETENTION_DAYS" -delete

echo "[backup] done. retained in $BACKUP_DIR (>$RETENTION_DAYS days pruned)"

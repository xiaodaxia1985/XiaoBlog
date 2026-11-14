#!/bin/bash
set -euo pipefail
cd /opt/XiaoBlog

# 记录更新前的 commit，用于后续检测变更范围
PREV_HEAD=$(git rev-parse HEAD)

git pull origin main

# 前端构建
npm ci --production=false
npm run build

# 若 server/ 有变更则重装依赖并重启薄 API
if git diff --name-only "$PREV_HEAD" HEAD | grep -q '^server/'; then
  echo "[deploy] server/ 有变更，重装后端依赖并重启 xb-api"
  cd /opt/XiaoBlog/server
  npm ci --omit=dev --no-audit --no-fund
  sudo systemctl restart xb-api
  cd /opt/XiaoBlog
else
  echo "[deploy] server/ 无变更，跳过 xb-api 重启"
fi

sudo systemctl reload nginx
echo "Deploy completed at $(date)"

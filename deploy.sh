#!/bin/bash
set -euo pipefail
cd /opt/XiaoBlog

# ⚠️ 关键保障：确保项目目录属主为 deployer
# root 执行 setup-ecs.sh 或手动 npm 后属主会变 root，导致 CI EACCES 失败
# 每次部署开头和结尾都修正，双重保险
chown -R deployer:deployer /opt/XiaoBlog 2>/dev/null || true

# 记录更新前的 commit，用于后续检测变更范围
PREV_HEAD=$(git rev-parse HEAD)

# deployer 用户使用 GitHub deploy key 拉取代码
GIT_SSH_COMMAND="ssh -i /home/deployer/.ssh/github_deploy_key_pem -o IdentitiesOnly=yes -o StrictHostKeyChecking=no" \
  git pull origin main

# 前端构建
npm ci --production=false
npm run build

# server/ 有变更才重装后端依赖；但无论是否变更都重启一次 xb-api。
# 不能用「git diff 含 server/」决定是否重启：若上次部署在重启前失败、源码已被 pull 更新，
# 重跑时 diff 为空会跳过重启，导致磁盘是新源码、进程仍跑旧代码。
if git diff --name-only "$PREV_HEAD" HEAD | grep -q '^server/'; then
  echo "[deploy] server/ 有变更，重装后端依赖"
  (cd /opt/XiaoBlog/server && npm ci --omit=dev --no-audit --no-fund)
else
  echo "[deploy] server/ 无变更，跳过后端依赖重装"
fi

echo "[deploy] 重启 xb-api"
sudo systemctl restart xb-api

sudo systemctl reload nginx

# ⚠️ 再次确保属主正确（npm ci/build 可能以当前用户创建新文件）
chown -R deployer:deployer /opt/XiaoBlog 2>/dev/null || true

echo "Deploy completed at $(date)"

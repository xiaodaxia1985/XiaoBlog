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

sudo systemctl reload nginx

# ⚠️ 再次确保属主正确（npm ci/build 可能以当前用户创建新文件）
chown -R deployer:deployer /opt/XiaoBlog 2>/dev/null || true

echo "Deploy completed at $(date)"

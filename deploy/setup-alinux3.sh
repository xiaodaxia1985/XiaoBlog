#!/usr/bin/env bash
# =============================================================================
# 兼容入口：Alibaba Cloud Linux 3 / RHEL 系的后端部署逻辑已并入 setup-ecs.sh
# （脚本自动识别 Debian/RHEL，RHEL 分支覆盖 ALinux3/CentOS/Rocky/AlmaLinux）。
# 本脚本保留为旧调用路径的兼容转发，实际安装逻辑以 setup-ecs.sh 为准。
#
# 用法（root）：
#   sudo bash deploy/setup-alinux3.sh
#   sudo bash deploy/setup-alinux3.sh --regen-secrets
# =============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/setup-ecs.sh" "$@"

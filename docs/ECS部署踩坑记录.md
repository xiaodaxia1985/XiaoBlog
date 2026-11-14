# ECS 部署踩坑记录（Alibaba Cloud Linux 3）

> 适用环境：Alibaba Cloud Linux 3.2104 LTS 64-bit + GitHub Actions CI/CD
> 最后更新：2026-11-14

## 1. 部署脚本不适配 RHEL 系

**现象**：原版 `deploy/setup-ecs.sh` 基于 Ubuntu 编写，在 Alibaba Cloud Linux 3 上执行第一步 `apt-get update` 即失败。

**根因**：脚本使用 apt-get、NodeSource deb 源、ufw、/etc/nginx/sites-available 等 Ubuntu 专属组件。

**修复**：生成适配版 `deploy/setup-alinux3.sh`，关键替换：

| 组件 | Ubuntu | Alibaba Cloud Linux 3 |
|---|---|---|
| 包管理器 | apt-get | dnf |
| Node.js | NodeSource deb | NodeSource RPM |
| PostgreSQL | postgresql (apt) | postgresql-server + postgresql-setup --initdb |
| nginx 配置 | /etc/nginx/sites-available/ + symlink | /etc/nginx/conf.d/ |
| 防火墙 | ufw | firewalld (firewall-cmd) |

## 2. PostgreSQL 认证失败（错误码 28000）

**现象**：xb-api 启动后反复崩溃，日志报 `FATAL: Ident authentication failed for user "xb_api"`。

**根因**：Alibaba Cloud Linux 3 的 PostgreSQL 13 默认 `pg_hba.conf` 中 127.0.0.1 使用 `ident` 认证，且 `password_encryption=md5`。薄 API 通过 TCP + 密码连接被拒绝。

**修复**：
```bash
# 1. 修改 pg_hba.conf：ident → scram-sha-256
sed -i 's/^host\s\+all\s\+all\s\+127\.0\.0\.1\/32\s\+ident$/host    all             all             127.0.0.1\/32            scram-sha-256/' /var/lib/pgsql/data/pg_hba.conf
systemctl reload postgresql

# 2. 重设角色密码（确保与 password_encryption 兼容）
sudo -u postgres psql -c "SET password_encryption = 'scram-sha-256'; ALTER ROLE xb_api PASSWORD '<密码>';"
```

> ⚠️ 若重新执行 setup-alinux3.sh，需在脚本中加入上述 pg_hba.conf 适配逻辑，否则仍会复现。

## 3. CI Deploy 失败：SSH Key 权限问题

**现象**：GitHub Actions 报 `Warning: Identity file /root/.ssh/github_deploy_key_pem not accessible: Permission denied`，Deploy to ECS 持续 failure。

**根因**：
- CI 通过 `ECS_SSH_KEY` secret 以 `deployer` 用户 SSH 登录服务器 ✅
- `deploy.sh` 中 `git pull` 依赖 `/root/.ssh/github_deploy_key_pem`（GitHub deploy key）❌
- `deployer` 无权读取 `/root/.ssh/` 目录，导致 git pull 失败
- 这是**鸡生蛋问题**：deploy.sh 自身有 bug → CI 无法通过执行它来更新它自己

**修复**：
```bash
# 1. 将 GitHub deploy key 私钥复制到 deployer 可访问的位置
cp /root/.ssh/github_deploy_key_pem /home/deployer/.ssh/github_deploy_key_pem
chown deployer:deployer /home/deployer/.ssh/github_deploy_key_pem
chmod 600 /home/deployer/.ssh/github_deploy_key_pem

# 2. deploy.sh 中显式指定密钥路径
GIT_SSH_COMMAND="ssh -i /home/deployer/.ssh/github_deploy_key_pem -o IdentitiesOnly=yes -o StrictHostKeyChecking=no" \
  git pull origin main

# 3. 首次修复需手动在服务器上拉取最新代码（绕过 CI 鸡生蛋问题）
```

## 4. 后端不会自动重启

**现象**：代码更新涉及 server/ 目录时，CI 部署后 xb-api 未重启，新代码不生效。

**根因**：原版 deploy.sh 只做了 git pull + npm build + nginx reload，缺少后端重启步骤。

**修复**：在 deploy.sh 中加入变更检测逻辑：
```bash
PREV_HEAD=$(git rev-parse HEAD)
git pull origin main
# ... 前端构建 ...
if git diff --name-only "$PREV_HEAD" HEAD | grep -q '^server/'; then
  cd /opt/XiaoBlog/server
  npm ci --omit=dev --no-audit --no-fund
  sudo systemctl restart xb-api
  cd /opt/XiaoBlog
fi
```

## 5. 关键文件清单

| 文件 | 用途 |
|---|---|
| `/opt/XiaoBlog/deploy/setup-alinux3.sh` | Alibaba Cloud Linux 3 一键部署脚本 |
| `/opt/XiaoBlog/deploy.sh` | CI 调用的增量部署脚本 |
| `/home/deployer/.ssh/github_deploy_key_pem` | deployer 用户的 GitHub deploy key |
| `/var/lib/pgsql/data/pg_hba.conf` | PostgreSQL 认证配置（已改为 scram-sha-256） |
| `/etc/nginx/conf.d/xiaoblog.conf` | nginx 站点配置（静态 + /api/ 反代） |
| `/etc/systemd/system/xb-api.service` | 薄 API systemd 服务单元 |

## 6. deployer 用户文件权限不足（EACCES）

**现象**：CI 以 deployer 身份执行 deploy.sh 时，`npm ci` 报错 `EACCES: permission denied, unlink '/opt/XiaoBlog/node_modules/.astro/data-store.json'`。

**根因**：之前手动以 root 身份执行过 `npm ci` / `npm run build`，导致 `/opt/XiaoBlog/node_modules/` 及 `dist/` 等目录属主为 root，deployer 无权写入。

**修复**：
```bash
chown -R deployer:deployer /opt/XiaoBlog
```

> ⚠️ **重要原则**：所有构建和部署操作应统一以 deployer 身份执行，避免 root 与 deployer 混用导致权限混乱。若不慎以 root 执行了 npm 命令，需立即 chown 修复。

## 7. CI Deploy 成功验证（2026-11-14）

修复第 3、5、6 条问题后，commit `d6e4fa0` 触发的 GitHub Actions **Build site** 和 **Deploy to ECS** 均成功通过，CI/CD 链路完全打通。

---

## 📋 运维规范（必读）

### 会话结束前必做
每次对话完成前，**必须**将本次出现的错误、排查过程、修复方案追加到本文档（`docs/ECS部署踩坑记录.md`）。新会话开始时先执行：
```bash
cat /opt/XiaoBlog/README.md        # 找到运维文档入口
cat /opt/XiaoBlog/docs/ECS部署踩坑记录.md  # 恢复历史上下文
```

### 用户与权限规范
| 操作 | 执行用户 | 说明 |
|---|---|---|
| git pull / npm ci / npm run build | deployer | CI 和本地手动操作统一用 deployer |
| systemctl restart/reload | deployer + sudo | deployer 已配置免密 sudo |
| 系统级安装（dnf/pg_hba） | root | 仅在初始化或修复系统组件时使用 |

> ⚠️ **严禁以 root 执行 npm 命令**，否则 node_modules 属主变为 root，CI 必然 EACCES 失败。若误操作，立即 `chown -R deployer:deployer /opt/XiaoBlog`。

### SSH Key 清单
| 密钥文件 | 属主 | 用途 |
|---|---|---|
| `/root/.ssh/github_deploy_key_pem` | root | 手动 root 操作时拉代码（备用） |
| `/home/deployer/.ssh/github_deploy_key_pem` | deployer | CI 及日常 git 操作（主力） |
| `/home/deployer/.ssh/id_ed25519` | deployer | CI SSH 登录 ECS 的密钥（ECS_SSH_KEY secret） |

### CI 部署流程（deploy.sh）
```
git pull → npm ci → npm run build → [server/变更?] → npm ci + restart xb-api → reload nginx
```
- server/ 无变更时跳过重启，避免不必要的服务中断
- deploy.sh 自身有 bug 时存在鸡生蛋问题，需手动在服务器上修复后再推送

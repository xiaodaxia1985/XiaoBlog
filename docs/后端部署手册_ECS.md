# 后端部署手册（阿里云 ECS · 一键脚本）

本手册对应 B5 薄 API（点赞/踩/阅读量）的自托管部署。
静态站 `dist/` 仍是纯静态产物，不携带数据库与密钥；动态能力由同机一个 Node 服务 + 本机 PostgreSQL 提供。

> 部署方式：**不在本地连 ECS**。把代码推到仓库后，在 ECS 上执行 `deploy/setup-ecs.sh` 一个脚本即可装好 PostgreSQL、薄 API、nginx 反代与 systemd 托管。
> 脚本自动识别发行版：Debian/Ubuntu（apt / ufw / sites-enabled）与 RHEL 系（Alibaba Cloud Linux 3、CentOS、RHEL、Rocky、AlmaLinux；dnf / firewalld / conf.d）两套分支都支持。

## 1. 架构与拓扑

```
                         阿里云 ECS  39.96.115.35 (Alibaba Cloud Linux 3 / Ubuntu)
  浏览器 ──80/443──▶ nginx
                        ├─ /            → /opt/XiaoBlog/dist（Astro 静态产物）
                        └─ /api/        → 127.0.0.1:8787  薄 API（Fastify）

  PostgreSQL 127.0.0.1:5432
        └─ 库 xb_api    角色 xb_api    薄 API：votes / article_stats / view_dedup
```

- 薄 API 只监听 `127.0.0.1`，对外一律走 nginx，不直接暴露 8787。
- 本站不部署评论服务端；文章页不挂评论区。

## 2. 目录与端口清单

| 项 | 值 / 路径 | 说明 |
| --- | --- | --- |
| 仓库目录 | `/opt/XiaoBlog` | CI 的 `/opt/XiaoBlog/deploy.sh` 负责拉代码；本脚本不替代它 |
| 静态产物 | `/opt/XiaoBlog/dist` | `npm run build` 产出 |
| 薄 API 目录 | `/opt/XiaoBlog/server` | Fastify + Drizzle，`npm start` 启动 |
| 薄 API 回环端口 | `8787` | 仅本机 |
| 服务运行用户 | `xb` | 非登录系统用户 |
| 薄 API 环境文件 | `/opt/XiaoBlog/server/.env` | 权限 600，属主 `xb` |
| 部署模板 | `deploy/systemd/`、`deploy/nginx/`、`deploy/env.api.example` | 随仓库下发 |

## 3. 前置条件

- ECS：Ubuntu 22.04/24.04 或 RHEL 系（Alibaba Cloud Linux 3 / CentOS / RHEL / Rocky / AlmaLinux），2C2G 及以上；阿里云安全组已放行 `22 / 80 / 443`。
- 仓库已在 `/opt/XiaoBlog`（首次可手动 `git clone` 到该路径，之后由 CI 更新）。
- Node 22 由脚本通过 NodeSource 安装；本机构建验证用 Node 22.23。若 NodeSource 不识别 ALinux3，脚本会保留现有 Node 并告警，可改用 nvm（`nvm install 22`）或官方 Linux 二进制手动装 22 后重跑脚本。
- **备案口径（D13）**：大陆地域 ECS 未完成 ICP 备案前，不要把 DNS A 记录切到本 ECS；联调先用公网 IP，上线再切域名。
- 前端 `.env`（仓库根，不入库）在构建前填好对外地址，产物才会指向后端：

```bash
PUBLIC_API_BASE=http://39.96.115.35
```

## 4. 一键部署

```bash
cd /opt/XiaoBlog
# 1. 按实际改脚本顶部配置（域名 / IP / 端口 / 库名）
vi deploy/setup-ecs.sh

# 2. 执行（root）
sudo bash deploy/setup-ecs.sh
```

脚本步骤（幂等，可重复运行）：

1. 按发行版安装系统依赖：PostgreSQL、nginx、Node 22、`curl`、`unzip` 等。
2. 创建系统用户 `xb`；初始化 PG，幂等创建角色与库，密码用 `openssl rand -hex 24` 生成并落盘到 600 权限文件。
3. 写薄 API `.env`（连接串、`SITE_URL`、访客盐、白名单路径、端口、限流），`npm ci --omit=dev` 装依赖。
4. （`BUILD_FRONTEND=1`）在仓库目录 `npm ci && npm run build`，产出 `dist/` 与 `public/data/slugs.json` 白名单。
5. 安装 `xb-api.service`，`daemon-reload` 并 `enable --now`。
6. 模板化生成 nginx 站点配置（静态 + `/api/` 反代），`nginx -t` 后 reload。
7. 配置防火墙放行 SSH / 80 / 443。
8. 健康检查：服务 `active`，探测薄 API 首个 slug 统计接口。

发行版差异（脚本自动处理，无需手动选）：

| 环节 | Debian / Ubuntu | RHEL 系（ALinux3 等） |
| --- | --- | --- |
| 包管理器 | `apt-get` | `dnf` |
| PostgreSQL 包 | `postgresql` / `postgresql-contrib` | `postgresql-server` / `postgresql-contrib`，首次 `postgresql-setup --initdb` 初始化数据簇 |
| PG 本机认证 | 默认口令登录即可 | 默认 ident + md5；脚本自动把 `127.0.0.1/32`、`::1/128` 对齐 `scram-sha-256`，设 `password_encryption=scram-sha-256` 并重存角色口令（改前备份 `pg_hba.conf`） |
| Node 22 | NodeSource deb 源 | NodeSource rpm 源 |
| 防火墙 | `ufw` | `firewalld`（`firewall-cmd`） |
| nginx 站点 | `sites-available/` + `sites-enabled/` 软链 | `/etc/nginx/conf.d/xiaoblog.conf` |

> 重生成密钥：`sudo bash deploy/setup-ecs.sh --regen-secrets`。已存在的环境文件默认不覆盖，避免误改在跑配置。

### 迁移说明

薄 API 服务启动时自动跑 forward-only 迁移（`server/src/db/migrate.ts`），无需手动执行；迁移记录在 `schema_migrations`，重复运行不重放。

## 5. 环境变量（薄 API `server/.env`）

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 是 | `postgres://xb_api:<密码>@127.0.0.1:5432/xb_api` |
| `SITE_URL` | 是 | 站点对外原始地址，Origin/Referer 同源校验用。联调 `http://39.96.115.35`，上线 `https://xiaomaker.top` |
| `VISITOR_SALT` | 是 | 访客哈希盐，≥8 位；脚本生成 32 字节十六进制 |
| `SLUG_WHITELIST_FILE` | 否 | 白名单清单路径，默认 `../public/data/slugs.json`（相对 `server/`） |
| `PORT` | 否 | 默认 `8787` |
| `RATE_LIMIT_MAX` | 否 | 单访客每分钟上限，默认 `30` |
| `RATE_LIMIT_WINDOW` | 否 | 限流窗口，默认 `1 minute` |

## 6. 数据模型（库 `xb_api`）

- `votes(slug, voter_hash)` 唯一；改票更新原行，不重复计票。
- `article_stats`：物化计数（views / likes / dislikes），点赞数以 `votes` 为事实源回填。
- `view_dedup(slug, visitor_hash, viewed_date)` 复合主键，当日去重。
- 预留 `subscribers / contact_messages / assets / audit_events`，需要时以追加迁移落地。

访客只存不可逆哈希；凭证只在服务端环境变量，不进前端产物。

## 7. 上线后验证清单

脚本跑完后逐项核对：

```bash
# 服务状态
systemctl status xb-api nginx postgresql

# 薄 API 本机探测（替换成 slugs.json 里的真实 slug）
curl -i http://127.0.0.1:8787/api/stats/<slug>

# 对外站点与 API
curl -i http://39.96.115.35/api/stats/<slug>
curl -i http://39.96.115.35/
```

浏览器侧：

1. 打开任一已发布文章，阅读数加载、点赞/点踩可点、再点同项取消；刷新后状态保留。
2. 控制台无报错；API 不可达时前端静默降级（按钮隐藏、计数保留）。

## 8. 从 IP 联调切到域名 / TLS

备案与 DNS 就绪后：

1. 薄 API：改 `server/.env` 的 `SITE_URL=https://xiaomaker.top`，`systemctl restart xb-api`。
2. 前端：仓库 `.env` 的 `PUBLIC_API_BASE=https://xiaomaker.top`，重新 `npm run build` 出产物。
3. nginx：主站加 443 与证书（fullchain / privkey）。
4. HSTS 下沉到 nginx；停用 EdgeOne Pages 兜底后再切 DNS A 记录。

## 9. 备份、回滚与运维

### 9.1 自动备份（systemd timer）

一键脚本已安装 `xb-backup.timer`，每日 **03:17** 执行 `deploy/backup.sh`：

- 备份目录：`/var/backups/xb/`（700，仅 root 可读，不在 Web 目录下）。
- 内容：`pg_dump` 压缩的 `xb_api` 库 + `server/.env`（盐值与库连接串）。
- 轮转：保留最近 **7 天**（`RETENTION_DAYS` 可调），超期自动删除。
- 静态产物 `dist/` 可由仓库重新构建，不纳入备份。

```bash
systemctl list-timers xb-backup.timer     # 查看下次触发时间
sudo bash deploy/backup.sh                 # 手动跑一次
journalctl -u xb-backup -n 50              # 备份日志
ls -lh /var/backups/xb/                    # 查看备份文件
```

### 9.2 恢复演练（建议每月一次）

> 恢复前先停写接口、确认目标库为空或可覆盖。

```bash
# 1. 解压并恢复到库（角色 xb_api 需已存在）
gunzip -c /var/backups/xb/xb_api-YYYYMMDD-HHMMSS.sql.gz \
  | sudo -u postgres psql -d xb_api

# 2. 校验：文章数 / 投票 / 阅读计数
sudo -u postgres psql -d xb_api -c "SELECT count(*) FROM article_stats;"
sudo -u postgres psql -d xb_api -c "SELECT count(*) FROM votes;"

# 3. 环境变量如需整机重建：备份的 server.env.<TS> 拷回 /opt/XiaoBlog/server/.env 并 chmod 600、chown xb
```

### 9.3 内存 / swap / 监控

- 一键脚本在内存偏小时创建 `/swapfile`（默认 1G，写入 `/etc/fstab` 持久化），防 Node/PG OOM。
- 常用查看：

```bash
free -h                       # 内存与 swap 占用
swapon --show                 # 当前交换空间
df -h /                       # 磁盘（备份目录在 /var 下，注意余量）
systemctl status xb-api       # 服务状态
journalctl -u xb-api -n 50 -f # 薄 API 日志
```

### 9.4 常用命令

```bash
systemctl restart xb-api             # 改环境变量后重启
nginx -t && systemctl reload nginx   # 改 nginx 后校验重载
```

### 9.5 回滚

- 前端：CI 回退到上一个 release 重新构建 `dist/` 即可，静态产物无状态。
- 后端：薄 API 迁移 forward-only，不做反向回滚；必要时按 9.2 从 `pg_dump` 恢复 `xb_api` 库。

## 9b. 私有页 `/d/` 访问保护

私有页（`/d/k8x3`）含 GitHub token 输入框，仅靠 `noindex` 无法挡住直链。nginx 对 `/d/` 加了 **HTTP Basic Auth**：

- 凭据文件：`/etc/nginx/.xb-htpasswd`（apr1 哈希，600，不进仓库）。
- 账号 `xb-admin`，随机明文密码存于 `/opt/.xb-dashboard-pw`（600，仅 root 可读）。
- 查看密码：`sudo cat /opt/.xb-dashboard-pw`。
- 重置密码：`sudo bash deploy/setup-ecs.sh --regen-secrets`（注意：该参数会同时重生成 API 密钥与访客盐，需同步 `server/.env`；只想改私有页密码时，可单独用 `openssl passwd -apr1` 重写 htpasswd 行）。

> 安全提示：Basic Auth 在 **HTTP** 下凭据仅 base64、并非加密；IP 联调期风险有限，**务必在 TLS（443）上线后**再对外暴露该页。页面 `<meta robots>` 仍保留 noindex。

## 10. 故障排查

| 现象 | 排查 |
| --- | --- |
| 投票按钮不显示、计数为 0 | 前端 `PUBLIC_API_BASE` 是否配置；`/api/stats/<slug>` 是否 200；`public/data/slugs.json` 是否含该 slug；`journalctl -u xb-api` |
| 写入接口 403 `origin_forbidden` | `server/.env` 的 `SITE_URL` 与浏览器实际 Origin 协议+主机不一致 |
| 写入接口 404 `not_found` | slug 不在白名单（草稿未发布，或构建后未重出 `slugs.json`） |
| 502 / 504 | 上游 Node 服务未起或崩溃；先 `systemctl status` 看服务，再查日志 |
| PG 起不来 / `psql: command not found` | RHEL 系装的是 `postgresql-server`；首次需 `postgresql-setup --initdb`（脚本已处理）；`systemctl status postgresql` 看日志 |
| 应用连 PG 报 `Peer authentication failed` / `password authentication failed` | RHEL 系默认 ident 认证 + md5；脚本已自动改 `scram-sha-256`。若仍报错：核对 `pg_hba.conf` 本机 host 行方法为 `scram-sha-256`、`postgresql.conf` 的 `password_encryption=scram-sha-256`，`systemctl reload postgresql` 后重设角色口令 |
| 对外 80/443 不通 | 先查阿里云安全组是否放行；本机再查防火墙：Ubuntu `ufw status`，RHEL 系 `firewall-cmd --list-services` |
| Node 版本偏低 | 脚本经 NodeSource 升到 22；若源未识别，手动核对 `node -v` 后按 NodeSource 文档重装 |
| 响应无 `x-ratelimit-*` 头、连发不 429 | 运行中的 `xb-api` 是旧进程、未加载限流代码：`sudo systemctl restart xb-api` 后复测。阈值默认 30 次/分钟，按访客 Cookie + IP 计 |

## 11. 遗留与未决

- **限流线上复测**：限流代码与配置本地复现通过（30/分钟，第 31 次 429，带 `x-ratelimit-*` 头）。线上首轮探测未生效，判定为 `xb-api` 运行旧进程；重启服务后需用同一 Cookie 连发 >30 次 `POST /api/view/<slug>` 复测 429。
- **备份 / 私有页保护待落地**：`deploy/backup.sh` + `xb-backup.timer`、`/d/` Basic Auth、swap 已写入仓库脚本与 nginx 模板；在 ECS 重跑一次 `sudo bash deploy/setup-ecs.sh` 后生效（幂等，不覆盖已存在 `.env`）。
- **在线联调**：B5 投票/去重/Origin 全链路已在真实 PG 环境实测通过；限流待进程重启后复测（见上）。
- **字体子集**：已按站点实际用字重切 Noto Sans SC / Inter 可变 woff2，覆盖已发布、草稿与模板用字；新增生僻字后在本地重跑 `python scripts/subset-fonts.py`（源字体在 `.cache/fonts-src/`，不入库）。

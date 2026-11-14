# 后端部署手册（阿里云 ECS · 一键脚本）

本手册对应 B5 薄 API（点赞/踩/阅读量）的自托管部署。
静态站 `dist/` 仍是纯静态产物，不携带数据库与密钥；动态能力由同机一个 Node 服务 + 本机 PostgreSQL 提供。

> 部署方式：**不在本地连 ECS**。把代码推到仓库后，在 ECS 上执行 `deploy/setup-ecs.sh` 一个脚本即可装好 PostgreSQL、薄 API、nginx 反代与 systemd 托管。

## 1. 架构与拓扑

```
                         阿里云 ECS  39.96.115.35 (Ubuntu)
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

- ECS：Ubuntu 22.04 / 24.04，2C2G 及以上；已开放安全组 `22 / 80 / 443`。
- 仓库已在 `/opt/XiaoBlog`（首次可手动 `git clone` 到该路径，之后由 CI 更新）。
- Node 22 由脚本通过 NodeSource 安装；本机构建验证用 Node 22.23。
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

1. 安装系统依赖：`postgresql`、`nginx`、`nodejs@22`、`curl`、`unzip` 等。
2. 创建系统用户 `xb`；初始化 PG，幂等创建角色与库，密码用 `openssl rand -hex 24` 生成并落盘到 600 权限文件。
3. 写薄 API `.env`（连接串、`SITE_URL`、访客盐、白名单路径、端口、限流），`npm ci --omit=dev` 装依赖。
4. （`BUILD_FRONTEND=1`）在仓库目录 `npm ci && npm run build`，产出 `dist/` 与 `public/data/slugs.json` 白名单。
5. 安装 `xb-api.service`，`daemon-reload` 并 `enable --now`。
6. 模板化生成 nginx 站点配置（静态 + `/api/` 反代），`nginx -t` 后 reload。
7. 配置 ufw（OpenSSH / 80 / 443）。
8. 健康检查：服务 `active`，探测薄 API 首个 slug 统计接口。

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

**备份（建议 cron 每日）**

```bash
pg_dump -U xb_api -h 127.0.0.1 xb_api | gzip > /backup/xb_api-$(date +%F).sql.gz
```

**常用命令**

```bash
systemctl restart xb-api             # 改环境变量后重启
journalctl -u xb-api -n 50 -f        # 薄 API 日志
nginx -t && systemctl reload nginx   # 改 nginx 后校验重载
```

**回滚**

- 前端：CI 回退到上一个 release 重新构建 `dist/` 即可，静态产物无状态。
- 后端：薄 API 迁移 forward-only，不做反向回滚；必要时从 `pg_dump` 恢复 `xb_api` 库。

## 10. 故障排查

| 现象 | 排查 |
| --- | --- |
| 投票按钮不显示、计数为 0 | 前端 `PUBLIC_API_BASE` 是否配置；`/api/stats/<slug>` 是否 200；`public/data/slugs.json` 是否含该 slug；`journalctl -u xb-api` |
| 写入接口 403 `origin_forbidden` | `server/.env` 的 `SITE_URL` 与浏览器实际 Origin 协议+主机不一致 |
| 写入接口 404 `not_found` | slug 不在白名单（草稿未发布，或构建后未重出 `slugs.json`） |
| 502 / 504 | 上游 Node 服务未起或崩溃；先 `systemctl status` 看服务，再查日志 |

## 11. 遗留与未决

- **在线联调**：本脚本在 ECS 落地后，B5 投票/去重/限流/Origin 全链路仍需在真实 PG + 服务端环境实测（先用 IP `39.96.115.35`，上线再切域名）。
- **字体子集**：已按站点实际用字重切 Noto Sans SC / Inter 可变 woff2，覆盖已发布、草稿与模板用字；新增生僻字后在本地重跑 `python scripts/subset-fonts.py`（源字体在 `.cache/fonts-src/`，不入库）。

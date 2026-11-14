# XiaoBlog 薄 API

静态站点保持纯静态，点赞 / 阅读量等动态能力由本服务在 ECS 提供；数据库凭证只在服务端环境变量，不进入前端产物。

## 目录

```
server/src/
  config/    环境变量校验（zod）
  db/        Drizzle schema、连接池、forward-only 迁移
  storage/   仓储层（隔离 SQL；路由层不直接写 SQL）
  services/  slug 白名单、访客哈希、Origin 校验
  routes/    统计查询、投票、阅读上报
```

## 数据模型

- `votes`：`(slug, voter_hash)` 唯一；改票更新原行，不重复计票。
- `article_stats`：物化计数（views / likes / dislikes），点赞数以 `votes` 为事实源回填。
- `view_dedup`：`(slug, visitor_hash, viewed_date)` 复合主键，当日去重。
- 预留：`subscribers`、`contact_messages`、`assets`、`audit_events`，需要时以追加迁移落地，不改业务调用层。

## 安全约束

- API 只接受白名单 slug（清单由前端构建产物 `public/data/slugs.json` 生成）。
- 浏览器请求校验 Origin/Referer 同源；按 Cookie + IP 限流。
- 访客只存不可逆哈希；不下发真实身份信息。
- 凭证只在服务端环境变量；前端不携带密钥。

## 本地 / 部署

```bash
cd server
npm install
cp .env.example .env   # 填入 ECS 实际值
npm run db:migrate
npm start
```

> ECS 一键部署（PostgreSQL、本服务、systemd、nginx 反代）由仓库根 `deploy/setup-ecs.sh` 完成，说明见 `docs/后端部署手册_ECS.md`。
> 数据库与在线联调依赖 ECS 备案 / DNS / 源站 TLS 就绪；在部署链路打通前，前端组件以降级方式渲染默认计数、隐藏操作按钮，不报错。

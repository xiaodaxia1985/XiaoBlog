# 个人商业创造者 · 站点

个人品牌站，不是通用博客模板。记录「个人商业创造」这场实践，同时承载三个方向的洞察内容：个人商业创造、AI 与产品创造、个人商业系统。线上地址 <https://xiaomaker.top/>。

## 技术栈

- **Astro 5.18**：静态生成，输出 `dist/`，路由为目录式（`/insight/<slug>/`）
- **内容**：Astro Content Collections（`glob` loader）+ Markdown，一篇文章一个 `.md`
- **样式**：手写 CSS；颜色、间距、字号、断点集中在 `public/css/tokens.css`，明暗双主题令牌在同一文件覆盖；每个页面是独立 `.astro`，样式内联
- **字体**：本地托管 `public/fonts/`（Inter + Noto Sans SC，2 个 woff2），`font-display: swap`，不引外部字体 CDN
- **检索**：Pagefind 预构建站内搜索，弹窗打开时才懒加载客户端 JS/CSS，不进首屏
- **图片**：构建脚本为正文图生成 AVIF/WebP 1x/2x 变体，remark 插件把裸 `<img>` 升级为 `<picture>`；另生成每篇 1200×630 OG 图与 RSS 缩略图
- **脚本**：少量原生 JS（`public/js/site-shell.js`：跳转进度、图片淡入、移动端导航、跳转链接；`public/js/practice-clock.js`：90 天日期与阶段状态；`public/js/dayplan.js`：私有清单）
- **后端（`server/`，独立目录，不进静态构建）**：Fastify + Drizzle ORM + PostgreSQL 的薄 API，承载点赞/踩与阅读量
- **无前端框架**：未接入 React/Vue/Svelte，也不使用 Tailwind

Node 要求：**20 LTS 及以上**；当前构建验证用 Node 22。

## 目录结构

```
site/XiaoBlog/
├─ src/
│  ├─ pages/                    路由，每页独立
│  │  ├─ index.astro            首页
│  │  ├─ insights.astro         洞察列表（分类 × 方向双维筛选）
│  │  ├─ insight/[slug].astro   文章详情（构建时静态生成）
│  │  ├─ insight/index.astro    旧 ?id= 链接跳转
│  │  ├─ topics/[slug].astro    三个方向专题页
│  │  ├─ 90-days.astro          90 天实践与四阶段
│  │  ├─ about.astro            关于页
│  │  ├─ projects.astro         旧项目列表链接兼容跳转
│  │  ├─ project.astro          旧项目链接兼容跳转
│  │  ├─ projects/[slug].astro  旧项目详情链接兼容跳转
│  │  ├─ sitemap.xml.ts        sitemap（只包含正式页面与已发布文章）
│  │  └─ 404.astro
│  ├─ content/insights/         一篇文章一个 .md，文件名即 slug
│  ├─ content.config.ts         content collection schema（frontmatter 校验）
│  ├─ lib/
│  │  ├─ insights.ts            摘要、阅读时长、日期、封面、排序等推导
│  │  ├─ taxonomy.ts            分类与方向唯一清单
│  │  └─ cover-palette.mjs      封面与观点卡的配色阶梯
│  ├─ data/
│  │  ├─ topics.mjs             三个专题页的定位、理论、方法、实践
│  │  ├─ stages.mjs             90 天四阶段与日期计算
│  │  ├─ projects.mjs           关于页的项目档案数据
│  │  └─ legacy-ids.mjs         旧文章 id → slug 映射
│  ├─ assets/covers/            生成的封面 `<slug>-1.webp` + 默认封面
│  └─ components/               Nav、Footer、SiteSearch、ArticleEngagement
├─ scripts/
│  ├─ generate-covers.mjs       封面生成（Edge 截图 + sharp 压缩）
│  ├─ cover-template.html       封面模板
│  ├─ gen-image-variants.mjs    正文图 AVIF/WebP 1x/2x 变体 + 清单
│  ├─ gen-og-thumb.mjs          每篇 OG 1200×630 + RSS 缩略图 + 清单
│  ├─ remark-responsive-images.mjs  remark 插件：裸 `<img>` 升级 `<picture>`
│  └─ check-content.mjs         构建期内容/资源/孤儿图校验
├─ server/                      薄 API（Fastify + Drizzle + PG），独立 npm 工程
├─ public/
│  ├─ css/tokens.css            设计令牌（明暗双主题）
│  ├─ fonts/                    本地字体
│  ├─ images/                   文章配图（变体/缩略图/OG 由脚本生成，已忽略）
│  └─ js/                       全站与页面小脚本
├─ docs/                        内容更新说明、品牌文档、执行计划
```

## 本地开发

```powershell
npm install
npm run dev        # http://localhost:4321/
npm run build      # 图片变体 → OG/缩略图 → slugs 白名单 → astro build → pagefind 索引
npm run preview    # 预览 dist/
npm run covers     # 重新生成文章封面
npm run check:content  # 内容/资源/孤儿图校验，错误退出码 1
```

构建链：`gen-image-variants` → `gen-og-thumb` → `gen-slugs` → `astro build` → `pagefind --site dist`；变体、缩略图、OG、slugs 白名单与清单均由脚本再生，不入库。封面脚本用系统 Microsoft Edge 无头截图、再用 `sharp` 压成 WebP；Edge 不在默认路径时用环境变量 `EDGE_PATH` 指定 `msedge.exe`。

### 前端公开环境变量

复制 `.env.example` 为 `.env`（不入库）。值会进静态产物，只放非敏感地址：

| 变量 | 作用 | 留空行为 |
| --- | --- | --- |
| `PUBLIC_API_BASE` | B5 薄 API 地址（点赞/踩、阅读量） | 前端降级：保留默认计数、隐藏投票按钮 |

`server/` 内的服务端凭证（数据库连接、访客哈希盐等）只存在 ECS 环境变量，样例见 `server/.env.example`，不进前端产物。

## 写文章

新建 `src/content/insights/<slug>.md`，slug 用英文小写与连字符；文件名即路由 `/insight/<slug>/`。

最少两行 frontmatter：

```md
---
title: "我为什么先做一件小事"
category: "90天实战"
---

正文第一段直接写，会自动成为列表摘要与详情页导语。
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | 是 | 标题 |
| `category` | 是 | `90天实战` / `产业数字化` / `AI 与产品` / `技术与管理`，写错构建报错 |
| `topic` | 否 | `个人商业创造` / `AI与产品创造` / `个人商业系统`，不写则不参与方向筛选与专题聚合 |
| `tagline` | 否 | 标题下一句副标题，不写不渲染 |
| `date` | 是 | `2026.11.12` 或 `2026-11-12`；用于确定发布日期和排序 |
| `draft` | 否 | `true` 为草稿，默认 `false` |
| `cover` | 否 | 一般不用写，自动按 slug 查找 |
| `excerpt` | 否 | 覆盖自动摘要 |
| `takeaways` | 否 | 核心观点数组，3–5 条 |
| `tags` | 否 | 文末标签，不写不渲染 |

**`takeaways` 与顶部观点卡、封面的关系**

- 所有条目进入标题下方的单卡手动切换区：一条观点一张卡，同一主色 `#D8F26B` 逐张提亮，文字统一深色
- **第 1 条同时决定封面主文案**：`npm run covers` 用它生成 `<slug>-1.webp`（1600×1000，WebP，≤120KB），作为列表缩略图与 `og:image`
- 不写 `takeaways` 时，顶部退回封面图；不写封面时用 `src/assets/covers/_default.svg`

**自动推导**（作者不手填）

| 内容 | 规则 |
| --- | --- |
| slug / 路由 | 由文件名生成，改名等于改地址 |
| 阅读时长 | 中文按字、英文按词，约 380 字/分钟，向上取整 |
| 摘要 | 正文第一个足够长的段落，截到 80–90 字并以句号收尾 |
| 日期 | 必填；由 frontmatter 确定 |
| 排序 | 按日期倒序；首页「最新洞察」取已发布的前三篇 |
| 上下篇 | 同 `category` 内按日期排序自动生成 |
| 草稿过滤 | `draft: true` 不进列表、首页、专题页、90 天记录与计数 |

**草稿与发布**

- 写稿加 `draft: true`：列表不出现，但 `/insight/<slug>/` 直链可预览，页面带「草稿 · 未发布」角标
- 发布：删掉 `draft` 或改 `false`，重新构建
- 草稿详情页带 `noindex,nofollow`，但直链仍可访问；不要当保密手段
- 删除文章：删 md 与同名封面，重新构建，旧地址返回 404

**封面生成步骤**：写好 md 和 `takeaways` → `npm run covers`（默认只处理已发布文章；`npm run covers -- <slug>` 生成单篇）。模板在 `scripts/cover-template.html`，重复运行会先删旧图。

## 页面结构

- `/` 首页：首屏、我在做什么、最新洞察、结尾关注引导
- `/insights/` 洞察列表：分类 × 方向两组筛选条，query 参数 `?category=`、`?topic=`，在静态页内过滤，计数实时
- `/topics/<slug>/` 三个专题页：`personal-business`、`ai-product`、`business-system`，每页「方向 / 理论 / 方法 / 实践 / 已发布 / 切换到其他方向」六块，文案在 `src/data/topics.mjs`
- `/90-days/` 90 天实践：四阶段目标、产出、状态与关联文章，数据在 `src/data/stages.mjs`
- `/about/` 关于页：01–05 编号时间线，简历与当前在做的事
- `/projects/`、`/projects/<slug>/` 与 `/project?id=N`：旧项目链接兼容跳转到关于页的代表成果
- `/sitemap.xml`：已发布文章、专题页与主要静态页的站点地图；`/robots.txt` 声明 sitemap
- `/insight/?id=N` 旧链接跳到新地址，映射在 `src/data/legacy-ids.mjs`

## 设计约定

- **颜色**：深色底 `#0C0C0C`，主色 `#D8F26B`；正文 `#D2D2CD`，标题 `#F5F5F4`。只用 `tokens.css` 变量，不散落魔法值
- **文章版式**：桌面左侧 sticky 目录 + 居中阅读栏；移动端折叠目录；阅读进度、字号调节、专注模式与返回顶部；正文使用 Astro 原生 Markdown 渲染，不自动拆段或改写作者结构
- **字号**：文章正文 17px / 1.82（≤720px 为 16px / 1.85）；H2 21px（手机 18px），H3 17px（手机 16.5px）；阅读工具支持 15–21px 调节
- **版心**：桌面 TOC 196px + 间距 48px + 正文 760px；≤1060px 改为顶部目录，≤720px 正文留白 20px
- **断点**：文章布局 1060px、移动正文 720px，全站令牌 768px
- **配图**：文章图片与图注必须落在正文栏内，左边缘与正文首字对齐，不越栏、不贴视口边缘；跨栏负边距图已废弃
- **图片**：正文配图放 `public/images/`，文件名小写连字符；变体/缩略图/OG 由构建脚本生成，不手工裁剪。封面放 `src/assets/covers/`

## 部署

静态产物始终是纯静态 `dist/`，不携带数据库与密钥。当前存在两条链路，最终迁回阿里云 ECS、停用 EdgeOne：

- **现网（兜底）**：EdgeOne Pages 连 GitHub 私有仓库 `xiaodaxia1985/XiaoBlog`，构建命令 `npm run build`、输出目录 `dist`，推 `main` 触发；加速区域选「全球可用区（不含中国大陆）」，避免境内备案门槛。`*.edgeone.app` 仅预览域名，不作长期地址。
- **目标（ECS 自托管）**：阿里云 ECS（`39.96.115.35`，Alibaba Cloud Linux 3 / Ubuntu + nginx）静态托管 `dist/`，同机跑 `server/` 薄 API 与 PostgreSQL。后端一键部署见 [docs/后端部署手册_ECS.md](docs/后端部署手册_ECS.md)，脚本与模板在 `deploy/`（`setup-ecs.sh` 装 PG/薄 API/nginx/systemd，幂等可重复执行）。CI（`.github/workflows/deploy.yml`）用 SSH 密钥登录执行 `/opt/XiaoBlog/deploy.sh`，密钥存 GitHub Secrets。
- **切换前置（未完成）**：源站 TLS、ICP 备案核实、DNS 由 CNAME 改 A 记录、HSTS 下沉 nginx、停用 EdgeOne Pages；备案未完成前不把 DNS 切到大陆地域 ECS。联调阶段可先用 ECS IP 直连，上线再切域名。

## 已知限制

- 旧项目链接会跳转到关于页的代表成果。
- B5 薄 API 尚未在线上联调：本机无 PostgreSQL，ECS 备案/TLS/DNS 未就绪；部署链路见 `docs/后端部署手册_ECS.md`，前端在 API 不可达时静默降级，不报错。
- 没有自动化测试，验证靠 `npm run build`、`npm run check:content` 与页面实测。
- 草稿不进列表但直链可访问，不能当保密手段。

## 仓库约定

- 验证产物（截图、长图、`.qa/`、`_verify/`、`preview-shots/`）不入库，放仓库外 `.qa/`
- 封面原图放 `covers-originals/`（已忽略）
- 公开披露边界：可写经本人确认可公开的聚合成果量级；不披露客户名、内部数据、未公开规划、同事姓名及可识别的内部系统架构。产品名、技术栈与组织信息逐项判断可识别性
- 写作细则见 [docs/内容更新说明.md](docs/内容更新说明.md)；部署配置以本 README 为准

## 🔧 运维文档
- [ECS 部署踩坑记录](docs/ECS部署踩坑记录.md) — Alibaba Cloud Linux 3 适配、PG 认证、CI SSH Key、后端自动重启等排查经验

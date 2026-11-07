# 个人商业创造者

个人品牌站 + 洞察内容站。品牌名「个人商业创造者」，记录产业数字化、AI 产品与个人商业实践。

## 技术栈

- **Astro 5.18**：静态站点生成，默认输出目录 `dist/`，路由为目录式（`/insight/<slug>/`）
- **样式**：手写 CSS，设计令牌集中在 `public/css/tokens.css`，页面内联 `<style>` 复用令牌
- **字体**：本地托管于 `public/fonts/`，不引入外部 CDN，避免国内加载失败
- **内容**：Astro Content Collections（`glob` loader）+ Markdown
- **部署**：Cloudflare Workers 静态资源（见下文）

Node.js 要求：**20 LTS 及以上**（Astro 5 最低 18.17）。

## 目录结构

```
src/
  pages/            页面与路由
    index.astro     首页
    insights.astro  洞察列表（分类 × 方向筛选）
    insight/
      index.astro   旧 ?id= 链接跳转
      [slug].astro  文章详情（静态生成）
    90-days.astro   90 天实践记录
    topics/         三个方向专题页（动态路由）
    about.astro     关于我
  content/
    insights/       一篇文章一个 .md 文件，文件名即 slug
  data/             专题、阶段、旧 id 映射等静态数据
  lib/              内容推导（摘要、阅读时长、封面）与分类清单
  assets/
    covers/         文章封面（webp/jpg/png，文件名 = slug）
public/
  css/tokens.css    设计令牌
  fonts/            本地字体
docs/
  内容更新说明.md     写作与发布流程
wrangler.jsonc      Cloudflare Workers 部署配置
```

## 本地开发

```powershell
npm install
npm run dev      # http://localhost:4321/
npm run build    # 构建到 dist/
npm run preview  # 预览构建产物
```

## 写一篇新文章

新建 `src/content/insights/<slug>.md`，frontmatter 写 `title` 和 `category` 两行，其余（日期、草稿、摘要、阅读时长、封面、上下篇）自动推导，正文用 Markdown 写完即可。

完整字段、封面命名与发布步骤见 [docs/内容更新说明.md](docs/内容更新说明.md)。

## 部署

Cloudflare 控制台的 `xiaoblog` 项目建在 **Workers & Pages → Workers**，因此需要仓库里有 `wrangler.jsonc`：

- Build command：`npm run build`
- Deploy command：`npx wrangler deploy`
- Root：`/`
- `wrangler.jsonc` 指定 `assets.directory: "./dist"`、`html_handling: "auto-trailing-slash"`、`not_found_handling: "404-page"`

另一种形态是 Cloudflare Pages：不需要 wrangler 配置，构建命令 `npm run build`、输出目录 `dist`，在项目设置里指定生产分支即可。当前采用 **Workers 静态资源模式**。

## 设计与代码约定

- 颜色、间距、字号只用 `public/css/tokens.css` 里的变量，不散落魔法值
- 不引入外部 CDN 字体、图标或 UI 库
- 文章封面放 `src/assets/covers/`，文件名与 md 文件同名，优先 WebP，单张 ≤150KB
- 公开页面不出现手机号、公司名、客户名、内部系统名与规模数字

## 已知限制

- 文章在构建时静态生成，发布需要重新构建
- 草稿（`draft: true`）不会进入任何列表、首页、专题页与计数，但详情页直链仍可访问，便于预览

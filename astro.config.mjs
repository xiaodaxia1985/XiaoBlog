import { defineConfig } from 'astro/config';
import { readFileSync } from 'node:fs';
import remarkResponsiveImages from './scripts/remark-responsive-images.mjs';

// 旧路径 301：数据源是 src/data/redirects.json（与 scripts/gen-redirects.mjs 同源）。
// 静态输出下 Astro 会为每条 from 产出 meta-refresh 页；线上真 301 由 nginx include 那份 conf 负责。
const redirectList = JSON.parse(
  readFileSync(new URL('./src/data/redirects.json', import.meta.url), 'utf8'),
);
const redirects = Object.fromEntries(
  redirectList.map((r) => [r.from, { status: r.code ?? 301, destination: r.to }]),
);

// 对外主域名：用于 canonical、Open Graph 与 sitemap。
export default defineConfig({
  site: 'https://xiaomaker.top',
  redirects,
  markdown: {
    remarkPlugins: [remarkResponsiveImages],
  },
});

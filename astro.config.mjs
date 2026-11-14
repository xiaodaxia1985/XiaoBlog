import { defineConfig } from 'astro/config';
import remarkResponsiveImages from './scripts/remark-responsive-images.mjs';

// 对外主域名：用于 canonical、Open Graph 与 sitemap。
export default defineConfig({
  site: 'https://xiaomaker.top',
  markdown: {
    remarkPlugins: [remarkResponsiveImages],
  },
});

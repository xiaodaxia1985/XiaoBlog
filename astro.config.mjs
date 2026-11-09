import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

// 对外主域名：用于 canonical、Open Graph 与 sitemap。
export default defineConfig({
  site: 'https://xiaomaker.top',
  integrations: [tailwind()],
});

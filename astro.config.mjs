import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

// https://astro.build/config
// 部署在 Cloudflare Pages 根域，站内资源使用根路径；域名在 Cloudflare 控制台配置。
export default defineConfig({
  integrations: [tailwind()],
});

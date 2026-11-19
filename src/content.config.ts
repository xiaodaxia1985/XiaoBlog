import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { CATEGORIES, TOPICS } from './lib/taxonomy';

// 一篇文章 = src/content/insights/<slug>.md，路由由文件名生成：/insight/<slug>/
const insights = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/insights' }),
  schema: z.object({
    title: z.string().min(1),
    tagline: z.string().optional(),
    category: z.enum(CATEGORIES),
    topic: z.union([z.enum(TOPICS), z.array(z.enum(TOPICS))]).optional(),
    date: z
      .string()
      .regex(/^\d{4}[.-]\d{1,2}[.-]\d{1,2}$/, 'date 用 2026.11.12 或 2026-11-12'),
    draft: z.boolean().default(false),
    cover: z.string().optional(),
    excerpt: z.string().optional(),
    takeaways: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    // 视频文章：有 videoId 即视为视频文章，详情页嵌入抖音官方播放器。
    // 扁平键而非嵌套对象，是为了兼容 scripts/check-content.mjs 的轻量 frontmatter 解析器。
    videoId: z.string().regex(/^\d{15,20}$/, 'videoId 应为抖音 video_id 数字串').optional(),
    videoRatio: z.enum(['9:16', '16:9', '1:1', '4:3', '3:4', 'auto']).default('auto'),
    videoUrl: z.string().optional(),
  }),
});

export const collections = { insights };

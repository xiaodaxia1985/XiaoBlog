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
  }),
});

export const collections = { insights };

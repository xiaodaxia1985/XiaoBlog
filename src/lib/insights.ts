import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';
import fs from 'node:fs';
import path from 'node:path';
import defaultCover from '../assets/covers/_default.svg';

// OG 1200×630 与 RSS 缩略图清单（构建前由 scripts/gen-og-thumb.mjs 生成）。
const ogManifest = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'og-manifest.json'), 'utf8')) as {
      default: string;
      og: Record<string, string>;
      thumb: Record<string, string>;
    };
  } catch {
    return { default: '', og: {}, thumb: {} };
  }
})();

type InsightEntry = CollectionEntry<'insights'>;

// 自动查找 src/assets/covers/<slug>.{webp,jpg,png}
const coverModules = import.meta.glob('../assets/covers/*.{webp,jpg,png}', {
  eager: true,
  import: 'default',
}) as Record<string, string | { src: string }>;

const assetUrl = (asset: string | { src: string }): string =>
  typeof asset === 'string' ? asset : asset.src;

const coversBySlug: Record<string, string> = Object.fromEntries(
  Object.entries(coverModules).map(([file, asset]) => [
    path.basename(file).replace(/\.(webp|jpg|png)$/i, ''),
    assetUrl(asset),
  ]),
);

export type Post = {
  slug: string;
  url: string;
  title: string;
  tagline: string;
  category: string;
  topic: string;
  topics: string[];
  date: string;
  sortKey: string;
  draft: boolean;
  readTime: string;
  excerpt: string;
  cover: string;
  ogImage: string;
  thumb: string;
  takeaways: string[];
  tags: string[];
};

function stripMarkdown(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^>\s*/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .trim();
}

function firstParagraph(body: string): string {
  for (const block of body.split(/\n\s*\n/)) {
    const text = block.trim();
    if (!text) continue;
    if (/^#{1,6}\s/.test(text)) continue;
    if (/^!\[/.test(text)) continue;
    if (/^>/.test(text)) continue;
    if (/^[-*+]\s/.test(text)) continue;
    if (/^\d+\.\s/.test(text)) continue;
    const plain = stripMarkdown(text).replace(/\s+/g, ' ').trim();
    if (plain.length < 12) continue;
    return plain;
  }
  return '';
}

/** 摘要：frontmatter 写了 excerpt 就用它，否则取正文第一个足够长的段落，截到 80–90 字并以句号收尾。 */
function deriveExcerpt(body: string, override?: string): string {
  if (override && override.trim()) return override.trim();
  const text = firstParagraph(body);
  if (!text) return '';
  if (text.length <= 90) return /[。！？]$/.test(text) ? text : `${text}。`;
  const cut = text.slice(0, 88).replace(/[，、；：,;:]$/, '');
  return `${cut}。`;
}

/** 阅读时长：中文按字、英文按词，约 380 字/分钟，向上取整。 */
function readingTime(body: string): string {
  const chinese = (body.match(/[\u3400-\u9fff]/g) || []).length;
  const words = (body.match(/[A-Za-z0-9]+(?:[.#][A-Za-z0-9]+)*/g) || []).length;
  const total = chinese + words;
  return `${Math.max(1, Math.ceil(total / 380))} 分钟`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function resolveDate(value: string): string {
  const parts = value.match(/\d+/g) || [];
  return `${parts[0]}.${pad(Number(parts[1]))}.${pad(Number(parts[2]))}`;
}

function resolveCover(slug: string, override?: string): string {
  if (override && override.trim()) {
    const value = override.trim();
    if (value.startsWith('/')) return value;
    return coversBySlug[value] ?? coversBySlug[value.replace(/\.(webp|jpg|png)$/i, '')] ?? value;
  }
  // 多张观点卡封面：第 1 张同时作为列表缩略图与 og:image。
  return coversBySlug[`${slug}-1`] ?? coversBySlug[slug] ?? assetUrl(defaultCover);
}

export function toPost(entry: InsightEntry): Post {
  const body: string = entry.body ?? '';
  const date = resolveDate(entry.data.date);
  const rawTopic = entry.data.topic;
  const topics = Array.isArray(rawTopic) ? rawTopic.filter(Boolean) : rawTopic ? [rawTopic] : [];
  const explicitCover: string | undefined = entry.data.cover;
  const cover = resolveCover(entry.id, explicitCover);
  // 未显式指定封面又回退到默认图的已发布文章，构建期告警，避免封面静默丢失（严格枚举校验在 B2 check-content 脚本）。
  if (!entry.data.draft && !explicitCover?.trim() && cover === assetUrl(defaultCover)) {
    console.warn(`[cover] 文章「${entry.data.title}」缺少封面，已回退默认图`);
  }
  return {
    slug: entry.id,
    url: `/insight/${entry.id}/`,
    title: entry.data.title,
    tagline: entry.data.tagline ?? '',
    category: entry.data.category,
    topic: topics[0] ?? '',
    topics,
    date,
    sortKey: date.replace(/[.-]/g, ''),
    draft: entry.data.draft === true,
    readTime: readingTime(body),
    excerpt: deriveExcerpt(body, entry.data.excerpt),
    cover,
    ogImage: ogManifest.og[entry.id] ?? ogManifest.default,
    thumb: ogManifest.thumb[entry.id] ?? '',
    takeaways: entry.data.takeaways ?? [],
    tags: entry.data.tags ?? [],
  };
}

/** 全部文章（含草稿），按日期倒序。 */
export async function getAllPosts(): Promise<Post[]> {
  const entries = await getCollection('insights');
  return entries
    .map(toPost)
    .sort((a, b) => (b.sortKey > a.sortKey ? 1 : b.sortKey < a.sortKey ? -1 : a.title.localeCompare(b.title)));
}

/** 已发布文章（草稿不出现在任何列表、首页、专题页与计数里）。 */
export async function getPublishedPosts(): Promise<Post[]> {
  return (await getAllPosts()).filter((post) => !post.draft);
}

/**
 * 相关阅读：同专题优先（+2），其次共享标签（每个 +1），同分按日期新到旧；排除自身。
 * 无匹配时返回空数组，调用方不渲染该区块。
 */
export function getRelatedPosts(post: Post, all: Post[], limit = 3): Post[] {
  const sharedTopics = (a: Post, b: Post) => a.topics.some((t) => b.topics.includes(t));
  const score = (p: Post): number => {
    let s = 0;
    if (sharedTopics(post, p)) s += 2;
    s += p.tags.filter((t) => post.tags.includes(t)).length;
    return s;
  };
  return all
    .filter((p) => p.slug !== post.slug)
    .map((p) => ({ p, s: score(p) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => (b.s - a.s) || b.p.sortKey.localeCompare(a.p.sortKey))
    .slice(0, limit)
    .map((x) => x.p);
}

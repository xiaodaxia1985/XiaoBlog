import { getCollection } from 'astro:content';
import path from 'node:path';
import defaultCover from '../assets/covers/_default.svg';

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
  date: string;
  sortKey: string;
  draft: boolean;
  readTime: string;
  excerpt: string;
  cover: string;
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
    const plain = stripMarkdown(text).replace(/\s+/g, '');
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

export function toPost(entry: any): Post {
  const body: string = entry.body ?? '';
  const date = resolveDate(entry.data.date);
  return {
    slug: entry.id,
    url: `/insight/${entry.id}/`,
    title: entry.data.title,
    tagline: entry.data.tagline ?? '',
    category: entry.data.category,
    topic: entry.data.topic ?? '',
    date,
    sortKey: date.replace(/[.-]/g, ''),
    draft: entry.data.draft === true,
    readTime: readingTime(body),
    excerpt: deriveExcerpt(body, entry.data.excerpt),
    cover: resolveCover(entry.id, entry.data.cover),
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

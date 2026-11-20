import { getPublishedPosts } from '../lib/insights';
import { topics } from '../data/topics.mjs';
import { SITE } from '../lib/site';

export async function GET({ site }) {
  const origin = (site ?? new URL(SITE.url)).toString().replace(/\/$/, '');
  const posts = await getPublishedPosts();
  // 静态页没有改稿时间，用构建当天；文章用发布日期，改稿后重新构建会刷新。
  const buildDate = new Date().toISOString().slice(0, 10);
  const entries = [
    { path: '/', lastmod: buildDate },
    { path: '/insights/', lastmod: buildDate },
    { path: '/about/', lastmod: buildDate },
    { path: '/90-days/', lastmod: buildDate },
    { path: '/privacy/', lastmod: buildDate },
    { path: '/rss.xml', lastmod: buildDate },
    ...topics.map((topic) => ({ path: `/topics/${topic.slug}/`, lastmod: buildDate })),
    ...posts.map((post) => ({ path: post.url, lastmod: post.date.replace(/\./g, '-') })),
  ];
  const seen = new Set<string>();
  const urls = entries
    .filter((entry) => (seen.has(entry.path) ? false : seen.add(entry.path)))
    .map((entry) => `<url><loc>${origin}${entry.path}</loc><lastmod>${entry.lastmod}</lastmod></url>`)
    .join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}

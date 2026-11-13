import { getPublishedPosts } from '../lib/insights';
import { topics } from '../data/topics.mjs';
import { SITE } from '../lib/site';

export async function GET({ site }) {
  const origin = (site ?? new URL(SITE.url)).toString().replace(/\/$/, '');
  const posts = await getPublishedPosts();
  const paths = [
    '/',
    '/insights/',
    '/about/',
    '/90-days/',
    ...topics.map((topic) => `/topics/${topic.slug}/`),
    ...posts.map((post) => post.url),
  ];
  const urls = [...new Set(paths)].map((path) => `<url><loc>${origin}${path}</loc></url>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}

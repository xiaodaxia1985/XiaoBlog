import { getPublishedPosts } from '../lib/insights';
import { projectEntries } from '../data/projects.mjs';
import { topics } from '../data/topics.mjs';

const site = 'https://xiaomaker.top';

export async function GET() {
  const posts = await getPublishedPosts();
  const paths = [
    '/',
    '/insights/',
    '/about/',
    '/projects/',
    '/90-days/',
    ...topics.map((topic) => `/topics/${topic.slug}/`),
    ...posts.map((post) => post.url),
    ...projectEntries.map((project) => `/projects/${project.slug}/`),
  ];
  const urls = [...new Set(paths)].map((path) => `  <url><loc>${site}${path}</loc></url>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}

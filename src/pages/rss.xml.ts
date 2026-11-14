import { getPublishedPosts } from '../lib/insights';
import { SITE } from '../lib/site';

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** 2026.11.08 / 2026-11-08 → RFC-822 时间（UTC）。 */
function toRfc822(date: string): string {
  const iso = date.replace(/\./g, '-');
  const d = new Date(`${iso}T00:00:00+08:00`);
  return Number.isNaN(d.getTime()) ? '' : d.toUTCString();
}

export async function GET({ site }) {
  const origin = (site ?? new URL(SITE.url)).toString().replace(/\/$/, '');
  const posts = await getPublishedPosts();

  const items = posts
    .map((post) => {
      const link = new URL(post.url, origin).toString();
      const cover = post.cover.startsWith('http') ? post.cover : new URL(post.cover, origin).toString();
      const pubDate = toRfc822(post.date);
      const ext = cover.split('.').pop()?.toLowerCase();
      const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'svg' ? 'image/svg+xml' : 'image/webp';
      const enclosure = `<enclosure url="${escapeXml(cover)}" type="${mime}"/>`;
      return [
        '<item>',
        `<title>${escapeXml(post.title)}</title>`,
        `<link>${escapeXml(link)}</link>`,
        `<guid isPermaLink="true">${escapeXml(link)}</guid>`,
        pubDate && `<pubDate>${pubDate}</pubDate>`,
        `<description>${escapeXml(post.excerpt)}</description>`,
        `<category>${escapeXml(post.category)}</category>`,
        enclosure,
        '</item>',
      ]
        .filter(Boolean)
        .join('');
    })
    .join('');

  const lastBuild = posts.length ? toRfc822(posts[0].date) : '';
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(SITE.title)}</title>
    <link>${escapeXml(origin)}</link>
    <description>${escapeXml(SITE.description)}</description>
    <language>zh-CN</language>
    ${lastBuild ? `<lastBuildDate>${lastBuild}</lastBuildDate>` : ''}
    <atom:link href="${escapeXml(new URL('/rss.xml', origin).toString())}" rel="self" type="application/rss+xml"/>
    ${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}

import { getPublishedPosts } from '../../lib/insights';

/** 已发布文章 slug 白名单，供薄 API 校验写入范围。草稿不进入清单。 */
export async function GET() {
  const posts = await getPublishedPosts();
  const slugs = posts.map((p) => p.slug);
  return new Response(JSON.stringify(slugs), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

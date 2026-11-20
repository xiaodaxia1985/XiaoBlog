// 结构化数据（schema.org JSON-LD）的唯一构建处。
// 全站实体（Person + WebSite）由 SiteHead 每页输出一次，文章页用 @id 引用；
// 文章 BlogPosting 与面包屑在各页按需输出。改这里，别在页面里手写 JSON。
import { SITE } from './site';

export const PERSON_ID = `${SITE.url}/#person`;
export const WEBSITE_ID = `${SITE.url}/#website`;

export type Crumb = { name: string; path: string };

/** 全站实体图：作者（Person）与站点（WebSite），供页面用 @id 引用。 */
export function siteGraph() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Person',
        '@id': PERSON_ID,
        name: SITE.name,
        url: `${SITE.url}/`,
        description: SITE.description,
        email: SITE.email,
        knowsAbout: ['产业数字化', 'AI 与产品', '个人成长体系', '技术与管理'],
      },
      {
        '@type': 'WebSite',
        '@id': WEBSITE_ID,
        url: `${SITE.url}/`,
        name: SITE.name,
        description: SITE.description,
        inLanguage: 'zh-CN',
        publisher: { '@id': PERSON_ID },
      },
    ],
  };
}

export function breadcrumbList(crumbs: Crumb[]) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: new URL(crumb.path, SITE.url).toString(),
    })),
  };
}

type ArticleVideo = {
  id: string;
  /** 原始分享链接（可空，为空时退回抖音标准播放页） */
  url?: string;
};

type ArticleInput = {
  url: string;
  title: string;
  description: string;
  date: string;
  image: string;
  cover?: string;
  category: string;
  tags?: string[];
  timeRequired?: string;
  crumbs: Crumb[];
  draft?: boolean;
  video?: ArticleVideo | null;
};

/** 文章页一次输出：BlogPosting + BreadcrumbList。 */
export function articleGraph({
  url,
  title,
  description,
  date,
  image,
  cover,
  category,
  tags = [],
  timeRequired,
  crumbs,
  draft = false,
  video = null,
}: ArticleInput) {
  const article: Record<string, unknown> = {
    '@type': 'BlogPosting',
    '@id': `${url}#article`,
    url,
    headline: title,
    description,
    datePublished: date,
    dateModified: date,
    author: { '@id': PERSON_ID },
    publisher: { '@id': PERSON_ID },
    mainEntityOfPage: { '@id': url },
    isPartOf: { '@id': WEBSITE_ID },
    image: cover ? [image, cover] : [image],
    inLanguage: 'zh-CN',
    articleSection: category,
  };
  if (tags.length > 0) article.keywords = tags.join(',');
  if (timeRequired) article.timeRequired = timeRequired;
  if (draft) article.creativeWorkStatus = 'Draft';

  const nodes: Record<string, unknown>[] = [article];

  // 视频文章：播放器来源是抖音官方，embedUrl 用它，url 站内文章通过 isPartOf 关联。
  if (video) {
    nodes.push({
      '@type': 'VideoObject',
      '@id': `${url}#video`,
      name: title,
      description,
      thumbnailUrl: [image],
      uploadDate: date,
      embedUrl: `https://open.douyin.com/player/video?vid=${video.id}`,
      url: video.url && video.url.length > 0 ? video.url : `https://www.douyin.com/video/${video.id}`,
      isPartOf: { '@id': `${url}#article` },
      inLanguage: 'zh-CN',
    });
  }

  nodes.push(breadcrumbList(crumbs));

  return {
    '@context': 'https://schema.org',
    '@graph': nodes,
  };
}

/** 列表页 / 专题页：面包屑。 */
export function pageGraph(crumbs: Crumb[]) {
  return {
    '@context': 'https://schema.org',
    '@graph': [breadcrumbList(crumbs)],
  };
}

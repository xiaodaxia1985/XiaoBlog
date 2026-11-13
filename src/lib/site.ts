// 站点单一数据源：品牌名、默认描述、联系方式。页面 SEO 与页脚/作者卡都从这里取，
// 不再在各页面硬编码。
export const SITE = {
  url: 'https://xiaomaker.top',
  name: '个人商业创造者',
  title: '个人商业创造者｜把能力变成自己的商业资产',
  description:
    '记录一个人如何借助 AI，把专业经验转化为产品、内容与可持续的商业资产。关注个人商业创造、AI 产品与个人商业系统。',
  email: 'cronaldo.yang@outlook.com',
  locale: 'zh_CN',
} as const;

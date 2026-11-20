// 站点单一数据源：品牌名、默认描述、联系方式。页面 SEO 与页脚/作者卡都从这里取，
// 不再在各页面硬编码。
export const SITE = {
  url: 'https://xiaomaker.top',
  name: '个人成长实践者',
  title: '个人成长实践者｜个人成长与技术实践记录',
  description:
    '记录个人借助 AI 学习与成长的实践过程，分享技术探索和经验心得。',
  email: 'cronaldo.yang@outlook.com',
  locale: 'zh_CN',
} as const;

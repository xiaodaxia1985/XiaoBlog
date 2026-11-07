// 分类与方向的唯一清单：content schema、列表页筛选、专题页都从这里取，避免多处硬编码。
export const CATEGORIES = ['90天实战', '产业数字化', 'AI 与产品', '技术与管理'] as const;
export const TOPICS = ['个人商业创造', 'AI与产品创造', '个人商业系统'] as const;

export type Category = (typeof CATEGORIES)[number];
export type Topic = (typeof TOPICS)[number];

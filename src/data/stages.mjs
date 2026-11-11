// 90 天创造者实践 · 四阶段
// 日期唯一来源：页面首屏由服务端生成，客户端在访问时按本地日期刷新进度。

export const stages = [
  {
    id: 1,
    name: '品牌与实践启动',
    startDate: '2026-11-08',
    endDate: '2026-11-21',
    days: 14,
    goal: '明确品牌表达，发布第一批内容，启动首个产品实验，获得 5 次有效用户反馈。',
    outputs: [
      '研究真实需求：目标用户问题清单与证据记录',
      '转化为产品：可演示的产品原型与购买方案',
      '借助 AI 创造：用 AI 完成设计、开发与内容生产',
      '建立品牌与内容：品牌表达 V1 与首批 6 篇公开内容'
    ],
    postIds: ['90-days-first-product', '18-years-without-my-own-business', 'deploy-static-site-without-server-or-icp', 'micro-innovation-better-world']
  },
  {
    id: 2,
    name: '产品验证与首次销售',
    startDate: '2026-11-22',
    endDate: '2026-12-07',
    days: 16,
    goal: '展示产品雏形，开放试用或预售，争取首批付费用户，以购买行为验证需求。',
    outputs: [
      '寻找用户与收入：用真实交易验证产品',
      '公开展示产品雏形，开放试用或预售',
      '争取 30 天内累计 1–3 位付费用户',
      '记录购买异议，形成需求验证结论'
    ],
    postIds: []
  },
  {
    id: 3,
    name: '交付与产品化',
    startDate: '2026-12-08',
    endDate: '2027-01-06',
    days: 30,
    goal: '完成首批交付，收集反馈，把重复流程沉淀为工具、标准化产品和转化路径。',
    outputs: [
      '沉淀为系统：把有效做法固化为流程',
      '完成首批交付，收集用户反馈',
      '把重复流程沉淀为工具与标准化产品',
      '跑通从产品到用户的转化路径'
    ],
    postIds: []
  },
  {
    id: 4,
    name: '收入与系统优化',
    startDate: '2027-01-07',
    endDate: '2027-02-05',
    days: 30,
    goal: '优化产品和定价，建立可重复销售、反馈与复购机制，评估软件化方向。',
    outputs: [
      '优化产品与定价',
      '建立可重复的销售机制',
      '建立反馈与复购机制',
      '评估软件化方向，争取 ¥4,000/月'
    ],
    postIds: []
  }
];

export const practiceStartDate = stages[0].startDate;
export const practiceEndDate = stages[stages.length - 1].endDate;

function localDateKey(date) {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

function dateOrdinal(date) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

function parseLocalDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatShort(value) {
  const date = parseLocalDate(value);
  return `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

export function getPracticeSnapshot(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = parseLocalDate(practiceStartDate);
  const end = parseLocalDate(practiceEndDate);
  const dayNumber = Math.max(0, Math.min(90, dateOrdinal(today) - dateOrdinal(start) + 1));
  const todayKey = localDateKey(today);
  const currentStageId = stages.find((stage) => {
    const from = localDateKey(parseLocalDate(stage.startDate));
    const to = localDateKey(parseLocalDate(stage.endDate));
    return todayKey >= from && todayKey <= to;
  })?.id ?? (todayKey < localDateKey(start) ? 1 : 4);

  return {
    dayNumber,
    currentStageId,
    period: `${practiceStartDate.replace(/-/g, '.')} — ${practiceEndDate.replace(/-/g, '.')}`,
    stages: stages.map((stage) => {
      const from = localDateKey(parseLocalDate(stage.startDate));
      const to = localDateKey(parseLocalDate(stage.endDate));
      const status = todayKey < from ? '未开始' : todayKey > to ? '已完成' : '当前';
      return {
        ...stage,
        status,
        range: { start: formatShort(stage.startDate), end: formatShort(stage.endDate) },
      };
    }),
  };
}

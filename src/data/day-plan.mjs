// 私有每日执行清单 · 数据源
// =====================================================
// 90 天 = 90 天，每天一份清单，由「星期 + 阶段 + 档位」推出来，不手写 90 份。
// 任务定义只写一次（TASK），每个日期只存任务 id，页面体积可控。
// 档位规则：周三、周五走 B 档（改周末预写稿），其余 A 档；C 档由人在页面上手动切换。
// =====================================================

import { stages } from './stages.mjs';

export const PRACTICE_START = '2026-11-08';
export const TOTAL_DAYS = 90;

const COLUMNS = {
  1: { col: '90天实战', note: '阶段进度、真实数据、决策与踩坑' },
  2: { col: '产业数字化', note: '18 年经验里可复用的判断：选型、降本、平台边界' },
  3: { col: 'AI 与产品', note: '工具与流程；可出海，首条第一句加英文' },
  4: { col: '技术与管理', note: '架构、团队、组织演进；可出海' },
  5: { col: '用户问题', note: '本周评论与私信里的高频问题' },
  6: { col: '本周精选', note: '本周挑一个判断重讲一遍' },
  0: { col: '周复盘', note: '数据、涨跌、下一步，写成一篇' },
};

export const TASK = {
  pick: { time: '10:15–10:35', label: '定选题', detail: '一句话主张 + 3 个支撑点 + 证据从哪来', kind: 'manual' },
  write: { time: '10:35–12:00', label: '写主文 800–2000 字', detail: '4–6 个 ##，同时写 takeaways 3–5 条', kind: 'manual' },
  revise: { time: '10:35–11:10', label: '改预写稿（B 档 35 分钟）', detail: '只做三件事：核对事实、换成这两天的真实数据、重写首句；不重写全文', kind: 'manual' },
  site: { time: '13:30–14:15', label: '站点上线', detail: '删 draft → covers → build → push，线上能打开', kind: 'site' },
  rewrite: { time: '14:15–15:00', label: '改写 content.json（只这一次）', detail: 'check.mjs 校验 0 错误，记下「将生成 N 张」', kind: 'manual' },
  cards: { time: '15:00–15:50', label: '小红书 3:4 卡片', detail: '10–16 张 + caption.md；先看 overview.jpg，标题 ≤20 字', kind: 'manual' },
  video: { time: '15:50–16:20', label: '抖音图文或口播', detail: '图文复用卡片；要视频就 50–80s 口播', kind: 'manual' },
  reply: { time: '16:20–17:30', label: '回评论与私信', detail: '≥5 条真实回复，约到 1 个访谈时间', kind: 'manual' },
  pubDouyin: { time: '19:30', label: '抖音发布', detail: '视频提前 30 分钟提交审核', kind: 'link', host: 'douyin.com' },
  pubWechat: { time: '20:00', label: '公众号群发', detail: '一天只有一次机会，20:00 前后最稳', kind: 'link', host: 'mp.weixin.qq.com' },
  pubXhs: { time: '20:20', label: '小红书发布', detail: '标签 5–8 个，正文 ≤1000 字', kind: 'link', host: 'xiaohongshu.com' },
  pubX: { time: '20:50', label: 'X thread', detail: '5–7 条；首条第一句加英文，末条放站点链接', kind: 'link', host: 'x.com' },
  log: { time: '21:00', label: '三行日志', detail: '日期 / 发布链接 / 卡点', kind: 'manual' },
  satWrite: { time: '09:30–11:00', label: '写「本周精选」', detail: '本周挑一个判断，换个角度重讲一遍', kind: 'manual' },
  satCards: { time: '11:00–12:00', label: '当天出稿：卡片 + 公众号', detail: '一套四渠道产物', kind: 'manual' },
  satPre: { time: '14:00–16:30', label: '预写下周 2 篇（周三、周五）', detail: '各 800 字左右，存 _work 标 draft: true', kind: 'manual' },
  satTopics: { time: '16:30–18:00', label: '选题会：下周 7 条', detail: '每条挂一个具体的人或数据', kind: 'manual' },
  satPub: { time: '20:00', label: '发布当天这篇', detail: '站点先上线，再分发', kind: 'site' },
  sunWrite: { time: '09:30–11:30', label: '写「周复盘」', detail: '数据、涨跌、下一步，写成一篇而不是一张表', kind: 'manual' },
  sunCards: { time: '11:30–13:00', label: '当天出稿并发布', detail: '顺手预写 1 篇应急稿', kind: 'site' },
  sunPlan: { time: '14:00–15:30', label: '数据表 + 下周排期', detail: '曝光、点击、涨粉、回复、付费意向', kind: 'manual' },
  cPost: { time: '任意', label: 'C 档：100–200 字短评上线', detail: '今天做了什么 + 一个判断，必须有链接', kind: 'site' },
  cX: { time: '任意', label: 'C 档：一条 X', detail: '同样的内容压成 3 条 thread', kind: 'link', host: 'x.com' },
};

const A_IDS = ['pick', 'write', 'site', 'rewrite', 'cards', 'video', 'reply', 'pubDouyin', 'pubWechat', 'pubXhs', 'pubX', 'log'];
const B_IDS = ['pick', 'revise', 'site', 'rewrite', 'cards', 'video', 'reply', 'pubDouyin', 'pubWechat', 'pubXhs', 'pubX', 'log'];
const SAT_IDS = ['satWrite', 'satCards', 'satPre', 'satTopics', 'satPub', 'log'];
const SUN_IDS = ['sunWrite', 'sunCards', 'sunPlan', 'log'];
const C_IDS = ['cPost', 'cX', 'log'];

function isoOf(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function stageOf(iso) {
  const hit = stages.find((s) => iso >= s.startDate && iso <= s.endDate);
  if (hit) return hit.id;
  return iso < stages[0].startDate ? stages[0].id : stages[stages.length - 1].id;
}

function tierOf(wd) {
  if (wd === 6) return 'A';
  if (wd === 0) return 'A';
  return wd === 3 || wd === 5 ? 'B' : 'A';
}

function idsOf(wd, tier) {
  if (tier === 'C') return C_IDS;
  if (wd === 6) return SAT_IDS;
  if (wd === 0) return SUN_IDS;
  return tier === 'B' ? B_IDS : A_IDS;
}

export function buildDays() {
  const [y, m, d] = PRACTICE_START.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const days = [];
  for (let i = 0; i < TOTAL_DAYS; i += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const iso = isoOf(date);
    const wd = date.getDay();
    const tier = tierOf(wd);
    const meta = COLUMNS[wd];
    days.push({
      date: iso,
      n: i + 1,
      wd,
      stage: stageOf(iso),
      tier,
      col: meta.col,
      note: meta.note,
      ids: idsOf(wd, tier),
      extra: tier === 'B' ? 'B 档：用周末预写的稿子，省下时间给产品与客户' : '',
    });
  }
  return days;
}

export const DAYS = buildDays();

export function getPlan() {
  return {
    start: PRACTICE_START,
    total: TOTAL_DAYS,
    tasks: TASK,
    days: DAYS,
    stages: stages.map((s) => ({ id: s.id, name: s.name, startDate: s.startDate, endDate: s.endDate })),
  };
}

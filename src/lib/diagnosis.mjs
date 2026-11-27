// 个人商业诊断 · 问卷 v0（2026-11-27）
// 骨架：Dan Koe《The most lucrative AI business to start in 2027》原文九组问题（Who you help /
// Your story / Who shaped your mind / Content pillars / Mission and beliefs / What you're against /
// Why it matters right now / Where you're taking them / Rules and words），原文 22 个子问。
// 补的三组，是他明确没给方法的部分：条件（我有什么）、机会（谁在花钱）、交付（能交出去什么）。
// 第一步只存 localStorage；SCHEMA 就是将来 POST /api/diagnosis 的请求体。

export const SCHEMA_VERSION = 'pbs-diag-v0.2';
export const STORAGE_KEY = 'pbs.diag.v0';

export const GROUPS = [
  {
    key: 'A',
    title: '先盘家底',
    source: '补 Dan 没写的：他默认你手上已经有东西可交',
    lead: '这一组只写事实：一周有几个小时、不挣钱能撑多久、今天就能交出去的本事是什么。写不出来就先空着，空着也是答案。',
  },
  {
    key: 'B',
    title: '你想帮的那个人',
    source: 'Dan 第一组 Who you help + 补三问：他花不花钱、你见不见得到',
    lead: '写一个人，不是一群人。他说过的话照抄，别润色——以后你的文案全靠这几句原话。',
  },
  {
    key: 'C',
    title: '你是谁、凭什么信你',
    source: 'Dan 第二到第八组，原问保留',
    lead: '这组看着像自我表达，其实不是。它决定别人三句话内能不能记住你、转介绍你。',
  },
  {
    key: 'D',
    title: '你能交出去什么',
    source: '补 Dan 没写的：他默认你已经会交付',
    lead: '把本事切成一件能交、能验收、能收钱的东西。写不清「怎么算做完」的，钱基本收不回来。',
  },
];

const HOURS = [
  { v: '3', label: '不到 5 小时' },
  { v: '7', label: '5–10 小时' },
  { v: '15', label: '10–20 小时' },
  { v: '30', label: '20–40 小时' },
  { v: '45', label: '40 小时以上' },
];

const RUNWAY = [
  { v: '0.5', label: '不到 1 个月' },
  { v: '2', label: '1–3 个月' },
  { v: '4.5', label: '3–6 个月' },
  { v: '9', label: '6–12 个月' },
  { v: '18', label: '一年以上' },
];

const SPEND = [
  { v: '10000', label: '上万块（买过服务、交过年费）' },
  { v: '1000', label: '上千块（买过课、买过软件）' },
  { v: '100', label: '几百块（买过模板、资料）' },
  { v: '0', label: '一分没花，全自己扛' },
  { v: 'unknown', label: '没问过，不知道' },
];

const FREQ = [
  { v: 'day', label: '每天都在弄' },
  { v: 'week', label: '每周一次' },
  { v: 'month', label: '每月一次' },
  { v: 'once', label: '一年一两次' },
];

const REACH = [
  { v: 'today', label: '今天就能约出来' },
  { v: 'week', label: '一周内能见上' },
  { v: 'month', label: '一个月内' },
  { v: 'never', label: '见不到，只能等' },
];

export const QUESTIONS = [
  // ---------------- A 先盘家底（补） ----------------
  { id: 'a1', group: 'A', label: '一周里，你真正能花在这件事上的小时', why: '不到 10 小时的人，一周只够推一件事。', type: 'radio', options: HOURS },
  { id: 'a2', group: 'A', label: '不挣钱的话，你还能撑几个月', why: '这个数字决定你能做多久「不见钱」的事。', type: 'radio', options: RUNWAY },
  {
    id: 'a3', group: 'A', label: '今天就能拿出去用的本事（可多选）', why: '只选现在能交的，不选「正在学」。', type: 'multi',
    options: [
      { v: 'writing', label: '写字、写稿' },
      { v: 'design', label: '排版、出图' },
      { v: 'video', label: '剪片、出视频' },
      { v: 'code', label: '写代码、搭系统' },
      { v: 'sales', label: '谈人、跑线下' },
      { v: 'domain', label: '某个行业的门道' },
      { v: 'teaching', label: '讲课、带人' },
      { v: 'ops', label: '把乱事理顺' },
    ],
  },
  {
    id: 'a4', group: 'A', label: '你能张口就联系的人（可多选）', why: '一个人都想不到，第一批客户就只能从内容里慢慢长。', type: 'multi',
    options: [
      { v: 'clients', label: '以前服务过的客户' },
      { v: 'peers', label: '前同事、同行' },
      { v: 'offline', label: '线下圈子（商会、老乡、培训班）' },
      { v: 'channel', label: '能帮你介绍人的朋友' },
      { v: 'accounts', label: '账号上认识我的人' },
      { v: 'none', label: '基本没有' },
    ],
  },
  { id: 'a5', group: 'A', label: '上面这些本事里，最强的那一件，说成一个动作', why: '例：把一篇长文做成能在手机上翻的页面。只说名词的，产品会做虚。', type: 'text', placeholder: '把 ___ 做成 ___，对方拿到就能 ___' },

  // ---------------- B 你想帮的那个人 ----------------
  { id: 'b1', group: 'B', label: '你最想帮的那个人，是谁', why: '写一个真的人。写「中小企业主」，等于没写。', type: 'text', placeholder: '例：下周要交标书的项目经理' },
  { id: 'b2', group: 'B', label: '他现在糟糕的一天是什么样', why: '写得越具体，你以后越知道该替他说哪句话。', type: 'text', placeholder: '从早到晚写一遍，别写形容词' },
  { id: 'b3', group: 'B', label: '他跟朋友抱怨的时候，原话是什么', why: '照抄。这句原话会变成你的标题、封面、第一条文案。', type: 'text', placeholder: '「又要改标书，每次都通宵」' },
  { id: 'b4', group: 'B', label: '他已经试过什么，没成', why: '他试过的东西，就是你的对手；不是你同行。', type: 'text', placeholder: '例：买过模板、找过打印店、自己熬夜改' },
  { id: 'b5', group: 'B', label: '他为了这件事，花过多少钱', why: '没花过钱的事，只是他觉得烦，不是他要买的东西。', type: 'radio', options: SPEND },
  { id: 'b6', group: 'B', label: '这事他多久遇到一次', why: '一年一次收一次钱；每周一次能收一年。', type: 'radio', options: FREQ },
  { id: 'b7', group: 'B', label: '你多久能坐到他面前', why: '见不到的人，机会再大也轮不到你。', type: 'radio', options: REACH },
  { id: 'b8', group: 'B', label: '比他现在的做法，你强在哪——一句话', why: '说不清这句，先别去谈。', type: 'text', placeholder: '比他快 / 比他便宜 / 他能讲的东西我讲不了' },

  // ---------------- C 你是谁（Dan 原问） ----------------
  { id: 'c1', group: 'C', label: '你经历过、而他现在正经历的事', why: 'Dan 原问：What have you lived through that your audience is living through now?', type: 'text', placeholder: '一件你亲身经历的事' },
  { id: 'c2', group: 'C', label: '事情变样的那一刻，是什么时候', why: '再小都算。这一句是你所有内容的第一块砖。', type: 'text', placeholder: '带时间、地点的一个瞬间' },
  { id: 'c3', group: 'C', label: '你做成过、也栽过的那些事，从大到小排一遍；能拿出的结果有哪些', why: '失败也算，Dan 原话是「they are all worthy」。别人信的是你摔过还站着。', type: 'text', placeholder: '1. …… 2. …… 结果：……' },
  { id: 'c4', group: 'C', label: '谁的书、谁的帖子，你从来不跳过（说人和书名）', why: '这决定你说话像谁，也决定你反对谁。', type: 'text', placeholder: '例：某某某《……》、某人的 newsletter' },
  { id: 'c5', group: 'C', label: '他哪个说法你老是回到，为什么', why: '你反复回去的那句，往往就是你要替别人说出来的那句。', type: 'text', placeholder: '一句话 + 你为什么认' },
  { id: 'c6', group: 'C', label: '谁改变过你的想法，哪怕你现在不完全同意他', why: '这一题写出你的来路，比履历可信。', type: 'text', placeholder: '一个人 + 他改了你什么' },
  { id: 'c7', group: 'C', label: '什么事你能讲上几个小时（全列出来，哪怕看着不相关）', why: 'Dan 原问：What could you talk about for hours? 别筛选，先列。', type: 'text', placeholder: '一条一行，列 5 条以上' },
  { id: 'c8', group: 'C', label: '这里面，哪两三件对你最重要', why: '这就是你的内容支柱。半年写不完的，只可能是这三条。', type: 'text', placeholder: '1. …… 2. …… 3. ……' },
  { id: 'c9', group: 'C', label: '你的角度和别人哪里不一样', why: '例：从心理学切、当过护士、干过十年财务——一句就够。', type: 'text', placeholder: '「我是从 ___ 这个角度看这件事的」' },
  { id: 'c10', group: 'C', label: '别人最常找你问什么', why: '别人反复问的，就是市场已经替你验过的需求。', type: 'text', placeholder: '原话写，别总结' },
  { id: 'c11', group: 'C', label: '有什么事你一遍一遍跟人解释', why: '解释得最多的事，最值得做成一份能发出去的东西。', type: 'text', placeholder: '例：为什么不要把十件事塞进一个对话' },
  { id: 'c12', group: 'C', label: '一句话：你想帮人做到什么', why: 'Dan 原问：In one sentence, what do you want to help people do?', type: 'text', placeholder: '「我想帮 ___ 做到 ___」' },
  { id: 'c13', group: 'C', label: '你信、而你同行不信的是什么', why: '立场比观点更容易被记住。', type: 'text', placeholder: '一句你敢公开说的话' },
  { id: 'c14', group: 'C', label: '你们这行，哪条常见建议是错的', why: 'Dan 原问：What common advice in your field do you think is wrong?', type: 'text', placeholder: '例：先做品牌，再谈客户' },
  { id: 'c15', group: 'C', label: '哪种活法在伤害他们；你想帮他们逃离什么样的生活', why: '你反对的越具体，你的读者越知道你是不是在替他说话。', type: 'text', placeholder: '两句话：什么在伤害 / 要逃离什么' },
  { id: 'c16', group: 'C', label: '如果能删掉一个习惯或一个说法，你删哪个', why: '删人删公司不算，删习惯和观念。', type: 'text', placeholder: '例：删掉「等我准备好再开始」' },
  { id: 'c17', group: 'C', label: '最近世界上刚变了什么，多数人还没留意', why: "Dan 原问：What just changed in the world that most people haven't noticed yet?", type: 'text', placeholder: '一件今年才成立的事' },
  { id: 'c18', group: 'C', label: '跟着你五年后，他一天是怎么过的', why: '终点要具体到能想象出画面。', type: 'text', placeholder: '从早到晚写一遍' },
  { id: 'c19', group: 'C', label: '五年后，他会在自己的简介里怎么称呼自己', why: 'Dan 原问：What would they proudly call themselves in their own bio? 他敢写的那句，就是你交付的终点。', type: 'text', placeholder: '例：一个不用通宵也能交出材料的人' },
  { id: 'c20', group: 'C', label: '你在他故事里是谁', why: 'Dan 给了三个位置：带路的、记录过程的、出去过又带着地图回来的。', type: 'radio', options: [
    { v: 'guide', label: '带路的人' },
    { v: 'documenter', label: '记录过程的人' },
    { v: 'map', label: '出去过、带地图回来的人' },
  ] },
  { id: 'c21', group: 'C', label: '你的读者每天相信什么、做什么（列 5–12 条）', why: 'Dan 原问：List 5 to 12 rules. 这是你和读者之间的规矩。', type: 'text', placeholder: '一条一行，5 条以上' },
  { id: 'c22', group: 'C', label: '你给自己的方法或问题起过名字吗（名字 + 它指什么）', why: '起过名字的东西，别人才好替你传。', type: 'text', placeholder: '例：「一镜两态」＝一个镜头里放两种状态' },

  // ---------------- D 你能交出去什么（补） ----------------
  { id: 'd1', group: 'D', label: '你能交出去的最小的东西是什么', why: '小到今天就能做出一份样品。', type: 'text', placeholder: '例：15 页能在手机上翻的讲义 + 一条竖版视频' },
  { id: 'd2', group: 'D', label: '做一份要几个钟头', why: '超过 4 小时的单子，先砍范围，再谈价。', type: 'radio', options: [
    { v: '0.5', label: '半小时以内' },
    { v: '1.5', label: '1–2 小时' },
    { v: '4', label: '3–5 小时' },
    { v: '8', label: '一整天' },
    { v: '40', label: '一周以上' },
  ] },
  { id: 'd3', group: 'D', label: '怎么算做完（他拿到什么就算成）', why: '写不出这句，就会出现「做完了他还说不对」。', type: 'text', placeholder: '例：他能翻完 15 页、直接发给他客户，不再改' },
  { id: 'd4', group: 'D', label: '第一份你打算收多少', why: '第一份的价钱是个锚，不是利润。', type: 'radio', options: [
    { v: '0', label: '先不收，免费送' },
    { v: '300', label: '三百以内' },
    { v: '800', label: '三百到八百' },
    { v: '3000', label: '八百到三千' },
    { v: '6000', label: '三千以上' },
  ] },
  { id: 'd5', group: 'D', label: '今天，你能把一份东西先送给谁', why: 'Dan 的做法是「先做出来，再送到他眼前」。送不出去，就等于没做。', type: 'radio', options: [
    { v: 'today', label: '有，今天就能发出去' },
    { v: 'week', label: '有，这周内' },
    { v: 'later', label: '有，但得等机会' },
    { v: 'none', label: '想不到人' },
  ] },
  { id: 'd6', group: 'D', label: '有没有真的交过一单', why: '「做过但没收钱」和「收过钱」是两种证据。', type: 'radio', options: [
    { v: 'none', label: '没有' },
    { v: 'free', label: '做过，但没收钱' },
    { v: 'paid', label: '收过钱' },
  ] },
];

export const TOTAL = QUESTIONS.length;

const SPEND_SCORE = { '0': 0, '100': 1, '1000': 2.5, '10000': 4, unknown: 0 };
const FREQ_SCORE = { once: 0.5, month: 1, week: 2, day: 3 };
const REACH_SCORE = { today: 3, week: 2, month: 1, never: 0 };
const HOURS_LABEL = { '3': '不到 5 小时', '7': '5–10 小时', '15': '10–20 小时', '30': '20–40 小时', '45': '40 小时以上' };
const RUNWAY_LABEL = { '0.5': '不到 1 个月', '2': '1–3 个月', '4.5': '3–6 个月', '9': '6–12 个月', '18': '一年以上' };
const FREQ_LABEL = { day: '每天', week: '每周', month: '每月', once: '一年一两次' };
const REACH_LABEL = { today: '今天就能约出来', week: '一周内能见上', month: '一个月内', never: '见不到' };
const SPEND_LABEL = { '0': '一分没花', '100': '几百块', '1000': '上千块', '10000': '上万块', unknown: '没问过' };
const SKILL_LABEL = { writing: '写字写稿', design: '排版出图', video: '剪片出视频', code: '写代码', sales: '谈人跑线下', domain: '行业门道', teaching: '讲课带人', ops: '把乱事理顺' };
const RES_LABEL = { clients: '老客户', peers: '前同事同行', offline: '线下圈子', channel: '能介绍人的朋友', accounts: '账号上认识的人', none: '没有' };
const ROLE_LABEL = { guide: '带路的人', documenter: '记录过程的人', map: '出去过、带地图回来的人' };

function t(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function opportunity(name, spend, freq, reach, quote, tried) {
  const score =
    (SPEND_SCORE[spend] ?? 0) * 1.2 + (FREQ_SCORE[freq] ?? 0) * 0.8 + (REACH_SCORE[reach] ?? 0) * 1.0;
  return { name: t(name), quote: t(quote), tried: t(tried), spend, freq, reach, score: Math.round(score * 10) / 10 };
}

export function buildReport(answers, today = new Date()) {
  const a = answers || {};
  const hours = Number(a.a1 || 0);
  const runway = Number(a.a2 || 0);
  const skills = Array.isArray(a.a3) ? a.a3 : a.a3 ? [a.a3] : [];
  const res = Array.isArray(a.a4) ? a.a4 : a.a4 ? [a.a4] : [];
  const perUnit = Number(a.d2 || 0);

  const op = opportunity(a.b1, a.b5, a.b6, a.b7, a.b3, a.b4);
  const hasOp = !!op.name;

  // ---------- 一 家底 ----------
  const conditions = [];
  if (hours) {
    conditions.push({
      k: '一周能投入',
      v: HOURS_LABEL[String(hours)] || hours + ' 小时',
      note:
        hours < 10
          ? '一周只够推一件事。同时开两条线，两条都会半死。'
          : hours < 20
            ? '够做一件正事，再带一件维护。正事只能是一件。'
            : '时间够并行；但并行最容易把现金烧光，先认一件正事。',
    });
  }
  if (runway) {
    conditions.push({
      k: '不挣钱能撑',
      v: RUNWAY_LABEL[String(runway)] || runway + ' 个月',
      note:
        runway < 3
          ? '不到三个月：任何「一个月不见钱」的事都先停，先收一笔再说。'
          : runway < 6
            ? '半年以内：可以做一件产品，但第一笔钱要排进前四周。'
            : '还有缓冲，允许试错一次；试错的判据提前写死。',
    });
  }
  if (skills.length) {
    conditions.push({
      k: '今天能交的本事',
      v: skills.map((k) => SKILL_LABEL[k] || k).join('、'),
      note: t(a.a5) ? `你自己说最强的是「${t(a.a5)}」——产品就从这一下切。` : '最强的那件没写成动作，产品会做虚。',
    });
  }
  if (res.length) {
    conditions.push({
      k: '能张口联系的人',
      v: res.map((k) => RES_LABEL[k] || k).join('、'),
      note: res.includes('none')
        ? '一个都想不到：第一批客户只能从内容和线下长出来，前两周必须先做出一个能发的东西。'
        : '有名单就别放着。前十条消息几乎不花钱，比任何投放都便宜。',
    });
  }

  // ---------- 二 那个人值不值得做 ----------
  const opportunityLines = [];
  let verdict = '';
  if (!hasOp) {
    verdict = '还没写出一个具体的人，现在只有想法，没有机会。先去问三个人：最近什么事让你花了钱。';
  } else {
    opportunityLines.push({
      rank: 1,
      name: op.name,
      score: op.score,
      detail: `花过：${SPEND_LABEL[op.spend] || '没填'} · 多久一次：${FREQ_LABEL[op.freq] || '没填'} · 见面：${REACH_LABEL[op.reach] || '没填'}`,
      quote: op.quote ? `他原话：「${op.quote}」` : '',
      solve: op.tried ? `他试过：${op.tried}` : '',
    });
    if (op.score < 4) {
      verdict = `这个人只到 ${op.score} 分：他要么没为这事花过钱，要么你见不到他。先别做产品，去问价、去找人。`;
    } else if (op.score < 7) {
      verdict = `${op.score} 分，方向对但证据薄：先免费做一份，换他一句真话。`;
    } else {
      verdict = `${op.score} 分，这个人值得试：这周就坐到他对面，带一份做好的东西去。`;
    }
  }

  // ---------- 三 第一份东西 ----------
  const spend = op.spend || 'unknown';
  let price;
  let priceHead;
  if (!a.d4) {
    price = '第一份价钱没填，先照建议定一个。';
    priceHead = '没定价';
  } else if (a.d4 === '0') {
    price = '先不收钱：只换两样——一句能公开引用的话，一个愿意被介绍的名字。';
    priceHead = '不收钱，换证言';
  } else {
    const suggested = spend === '10000' ? '八百到两千' : spend === '1000' ? '三百到八百' : spend === '100' ? '一两百' : null;
    priceHead = `¥${Number(a.d4).toLocaleString()}`;
    price = suggested
      ? `按他花钱的量级，先报 ${suggested}；第一份打六折，换一句证言。`
      : '但他还没为这事花过钱：先免费三份，再报价。';
  }
  const product = {
    who: hasOp ? op.name : '（没写人，暂时没有买家）',
    what: t(a.d1) || '（没写交付物）',
    duration: perUnit ? `${perUnit >= 40 ? '一周以上' : perUnit + ' 小时'} / 份` : '（没填工时）',
    acceptance: t(a.d3) || '（没写怎么算做完 → 钱收不回来，必须补）',
    price,
    priceHead,
    capacity:
      a.d6 === 'paid'
        ? '收过钱，按上一单的节奏排'
        : a.d6 === 'free'
          ? '做过一份但没收钱：下一单收钱，节奏照这一单'
          : a.d6 === 'none'
            ? '一次没交过：节奏先按「一周一份」估，交付完再校准'
            : '（没填交付经历）',
    warn: [],
  };
  if (perUnit >= 4) product.warn.push(`一份要 ${perUnit >= 40 ? '一周' : perUnit + ' 小时'}，超过 4 小时：先砍到一页或一条，再谈价。`);
  if (!t(a.d3)) product.warn.push('没有「怎么算做完」，就是「做完了他还说不对」的病根。');
  if (a.d5 === 'none') product.warn.push('今天送不出任何一份：先做一份，再想卖。');
  if (a.d5 === 'later') product.warn.push('要等机会才送得出去：这个机会多半不会来。');
  if (a.d6 === 'none') product.warn.push('一次都没交过：先送一份出去，别先做官网。');
  if (a.d6 === 'free') product.warn.push('做过但没收钱：下一单必须收，哪怕一百块。');

  // ---------- 三之二 能直接拿去用的东西 ----------
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const fmtDay = (d) => `${d.getMonth() + 1}月${d.getDate()}日 ${weekday[d.getDay()]}`;
  const plusDay = (n) => {
    const d = new Date(today.getTime());
    d.setDate(d.getDate() + n);
    return fmtDay(d);
  };

  const who = hasOp ? op.name : '';
  // c9 的占位句是「我是从 ___ 这个角度看这件事的」，有人会连模板一起填，这里剥掉壳只留内容。
  const cleanAngle = (v) => {
    let s = String(v).trim();
    s = s.replace(/^我(?:是)?从\s*/, '');
    s = s.replace(/[，,、]?\s*这个角度看(?:这件事|问题)?(?:的)?$/, '');
    s = s.replace(/^[「『"']+/, '').replace(/[」』"']+$/, '');
    s = s.replace(/[，,、]\s*$/, '');
    return s.trim();
  };
  const sent = (v) => {
    const s = String(v).trim();
    return /[。！？.!?]$/.test(s) ? s : s + '。';
  };
  const positioning = [];
  if (hasOp && t(a.d1)) positioning.push(`我帮${who}，${perUnit ? perUnit + ' 小时内' : '尽快'}拿到「${t(a.d1)}」。`);
  if (t(a.c12)) positioning.push(sent(t(a.c12)));
  if (t(a.c9)) positioning.push(`我习惯从「${cleanAngle(t(a.c9))}」这个角度切入。`);
  if (t(a.c19)) positioning.push(sent(t(a.c19)));
  const believes = t(a.c13);
  const differentiator = believes
    ? /^(我|本人)?(相信|认为|觉得)/.test(believes)
      ? believes
      : `我相信：${believes}`
    : '';

  const evidence = [
    {
      k: '为这事花过钱',
      v: SPEND_LABEL[op.spend] || '没填',
      ok: op.spend === '1000' || op.spend === '10000' ? 1 : op.spend === '100' ? 0.5 : 0,
      note: op.spend === '10000' || op.spend === '1000' ? '花过钱的人不用你说服，只需要你报价。' : '没花过钱，需求就还没成立——先去问价。',
    },
    {
      k: '多久遇到一次',
      v: FREQ_LABEL[op.freq] || '没填',
      ok: op.freq === 'day' || op.freq === 'week' ? 1 : op.freq === 'month' ? 0.5 : 0,
      note: op.freq === 'month' || op.freq === 'once' ? '一个月才遇到一次，教他一次就够，别做订阅。' : '每周都遇到，才养得起回头客。',
    },
    {
      k: '能不能见到面',
      v: REACH_LABEL[op.reach] || '没填',
      ok: op.reach === 'today' || op.reach === 'week' ? 1 : 0,
      note: op.reach === 'never' ? '完全够不到的人，不能当第一个客户。' : op.reach === 'month' ? '要等一个月才见一次，验证会被拖到季度末。' : '一周内见得到，够用。',
    },
    {
      k: '他试过什么',
      v: op.tried || '没填',
      ok: op.tried ? 1 : 0,
      note: op.tried ? '他已经在花钱试，说明这条需求是被验证过的。' : '他没试过，你要先帮他确认这事值得花力气。',
    },
    {
      k: '他的原话',
      v: op.quote || '没填',
      ok: op.quote ? 1 : 0,
      note: op.quote ? '这句原话就是你所有文案的开头，别改写它。' : '没有原话，你写的都是自己的想象。',
    },
  ];
  const evidenceScore = op.score;
  const evidenceMax = 10.2;

  const totalMin = Math.round((perUnit || 3) * 60);
  const shares = [0.2, 0.4, 0.25, 0.15];
  const mins = shares.map((s) => Math.max(5, Math.round((totalMin * s) / 5) * 5));
  const steps = [
    {
      t: '收料：把对方手上的旧东西全要过来——旧模板、上一次交的、他客户的原话。',
      min: mins[0],
      out: '一张「他现在怎么干」的清单，三行以内',
    },
    {
      t: '做样张：按交付物先做第一版，不精修，只求能翻、能发。',
      min: mins[1],
      out: t(a.d1) || '第一版',
    },
    {
      t: `按验收条款改一轮：只改「${t(a.d3) || '他指出的问题'}」，别当场答应新需求。`,
      min: mins[2],
      out: '改完的版本 + 一页改动清单',
    },
    {
      t: '交出去，末尾附一句验收标准，同一封信里开口报价。',
      min: mins[3],
      out: '一份交付 + 一句报价',
    },
  ];

  const userPrice = Number(a.d4 || 0);
  const bands = { '10000': [800, 2000], '1000': [300, 800], '100': [100, 200] };
  const band = bands[spend] || null;
  const tiers = [];
  if (userPrice > 0) {
    const floor = Math.max(50, Math.round((userPrice * 0.6) / 10) * 10);
    tiers.push({
      k: '第一份',
      v: '¥' + floor,
      note: band ? `他这类人的心理价位在 ${band[0]}–${band[1]}；这份只换一句能公开引用的证言。` : '只换一句能公开引用的证言。',
    });
    tiers.push({ k: '标准价', v: '¥' + userPrice, note: '含两轮修改；第三轮起加收 30%。' });
    tiers.push({
      k: '上限',
      v: '¥' + Math.round((userPrice * 1.5) / 10) * 10,
      note: '加急、加页、多平台发布，各加一档。',
    });
  }

  const pitch = [];
  if (userPrice > 0 && t(a.d1)) {
    pitch.push(
      `「${t(a.d1)}，${perUnit ? perUnit + ' 小时' : '按约定时间'}做完，¥${userPrice}。做完的标准是「${t(a.d3) || '……'}」，两轮以内改到符合这句就算完。」`,
    );
  }
  pitch.push('「这一单按上面算。如果合适，帮我介绍一个同样要这个的人。」');

  const week = [
    {
      day: `今天 · ${fmtDay(today)}`,
      act: hasOp ? `把「${who}」的原话和验收标准抄成三行发过去，问他一句「是不是这个」` : '问三个人最近为什么花钱，原话抄下来，别总结',
    },
    {
      day: `明天 · ${plusDay(1)}`,
      act: t(a.d1) ? `把「${t(a.d1)}」做出第一版，不精修，末尾写一句「这只是第一版」` : '先动手做第一版，别等想清楚',
    },
    { day: `${plusDay(3)}`, act: `收反馈、改一轮，然后开口报 ${priceHead}；收款方式一并给过去` },
  ];

  const risks = [];
  if (userPrice > 0 && perUnit > 0) {
    const rate = Math.round(userPrice / perUnit);
    if (rate < 80) {
      risks.push(
        `时薪只有 ¥${rate}：一个下午换一顿饭钱。要么砍范围，要么把价抬到 ¥${Math.round((80 * perUnit) / 10) * 10}。`,
      );
    }
  }
  if (runway > 0 && runway < 3 && a.d6 !== 'paid') {
    risks.push('撑不到三个月、又没收过钱：第一笔必须排在前两周，其它计划全部让路。');
  }
  if (hasOp && (op.reach === 'never' || op.reach === 'month')) {
    risks.push('见不到面的人当第一个客户，等于把验证交给运气：换一个这周就能约到的人。');
  }
  if (hours > 0 && hours < 10 && perUnit >= 4) {
    risks.push('时间少、单份又重：一周只够做一份，别再答应「顺便帮我看看」的活。');
  }
  if (!t(a.d3)) risks.push('没写「怎么算做完」：这一单做完他还会说不对，钱就收不回来。');
  const riskTop3 = risks.slice(0, 3);

  const validate = {
    ok: `他付了钱${userPrice ? `（哪怕只收 ¥${Math.max(50, Math.round((userPrice * 0.6) / 10) * 10)}）` : ''}，并且愿意把你介绍给一个人。`,
    fail: '三次送出去没人回，或者回了只说「挺好的」却不谈钱——换人，不要改产品。',
  };

  // ---------- 四 还缺哪一块 ----------
  const gaps = [];
  if (!t(a.a5)) gaps.push({ layer: '家底', text: '最强的那件本事没写成动作，后面所有判断都会飘。' });
  if (!hasOp || op.spend === 'unknown') gaps.push({ layer: '那个人', text: '没问过他花过多少钱：现在的需求还是你的猜测。' });
  if (!t(a.d3)) gaps.push({ layer: '交付', text: '没有「怎么算做完」，就没有第二次合作。' });
  if (!t(a.c12)) gaps.push({ layer: '一句话', text: '没写出「你想帮人做到什么」，别人没法替你介绍。' });
  if (!t(a.c8)) gaps.push({ layer: '内容支柱', text: '没挑出最重要的两三件，内容会变成随机发帖。' });
  if (op.reach === 'never' || op.reach === 'month') gaps.push({ layer: '见面', text: '一个月以上才见得到的人，不能当第一个客户。' });
  if (a.d6 === 'none') gaps.push({ layer: '第一单', text: '没有一次真实交付，谈不上把流程交给别人。' });
  const gapTop3 = gaps.slice(0, 3);

  // ---------- 五 接下来 90 天 ----------
  const urgentMoney = runway > 0 && runway < 3;
  const lowTime = hours > 0 && hours < 10;
  const plan = [
    {
      phase: '第 1–2 周',
      items: urgentMoney
        ? [
            '做三份免费样品，只送给今天就能见到的人。',
            '每送一份，就问一句「你为这事花过多少钱」，记下来。',
            '不做官网、不发新系列。',
          ]
        : [
            hasOp ? `给「${op.name}」做一份完整样品，48 小时内送出去。` : '先问三个人最近为什么花钱，把原话抄下来。',
            '把这套答案整理成四页，当自己的施工图。',
            '定一条内容主线，只写这一条，连续七天。',
          ],
    },
    {
      phase: '第 3–6 周',
      items: [
        '收第一笔钱，多少不重要，截图留证重要。',
        lowTime ? '一周只排一份交付，其余时间全拿去见人。' : '一周两份交付，外加一次陌生联系。',
        '把这一单花了几小时记下来，超过 4 小时就砍范围。',
      ],
    },
    {
      phase: '第 7–12 周',
      items: [
        '同一件事做第三遍，把步骤写成别人照做也能跑的东西。',
        a.d6 === 'paid' ? '把交付过程写成三条内容，结尾只指向产品页。' : '第三单必须收钱，不然不算生意。',
        '复盘只三行：定价、改了几次、见了几个人。',
      ],
    },
  ];

  // ---------- 六 结论 ----------
  let closing;
  if (!hasOp) closing = '现在缺的不是产品，是去问三个人：最近什么事让你花了钱。';
  else if (urgentMoney) closing = `只剩不到三个月，「${op.name}」要在两周内收到第一笔，否则换人。`;
  else if (perUnit >= 4) closing = `「${op.name}」这条路成立，但一份太费时间：先砍到两小时内，再谈价。`;
  else closing = `「${op.name}」是现在最该做的一件事；先交一份，再谈钱。`;

  const texts = ['a5', 'b1', 'b3', 'b8', 'c12', 'd1', 'd3'].map((k) => t(a[k])).filter(Boolean);
  const shortCount = texts.filter((x) => x.length < 8).length;
  const honesty =
    shortCount >= 3
      ? '有三处以上答案不到八个字。短答案等于没答案，这份诊断会失真。'
      : shortCount > 0
        ? '有个别答案偏短，这份诊断能用，但那一条判断别全信。'
        : '答案够长，这份诊断可以直接用。';

  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  return {
    date: dateStr,
    conditions,
    ranking: hasOp ? [op] : [],
    opportunityLines,
    verdict,
    product,
    gapTop3,
    gaps,
    plan,
    closing,
    honesty,
    top: hasOp ? op : null,
    positioning,
    differentiator,
    evidence,
    evidenceScore,
    evidenceMax,
    steps,
    tiers,
    pitch,
    week,
    risks: riskTop3,
    validate,
  };
}

export function toMarkdown(answers, report) {
  const L = [];
  const mark = (ok) => (ok === 1 ? '✅' : ok === 0.5 ? '⚠️' : '❌');
  L.push('# 个人商业条件诊断', '', `> ${report.date} · 问卷 ${SCHEMA_VERSION}`, '');
  L.push('## 结论', '', report.closing, '', `> ${report.honesty}`, '');

  L.push('## 一 一句话定位', '');
  if (!report.positioning.length) L.push('- （还没写出来，先把「想帮谁做到什么」补上）');
  report.positioning.forEach((p) => L.push(`- ${p}`));
  if (report.differentiator) L.push('', report.differentiator, '');

  L.push('## 二 那个人：证据', '');
  report.evidence.forEach((e) => L.push(`- ${mark(e.ok)} **${e.k}**：${e.v} —— ${e.note}`));
  L.push('', `证据分：${report.evidenceScore} / ${report.evidenceMax}`, '', report.verdict, '');

  L.push('## 三 第一份交付', '');
  L.push(`- 卖给谁：${report.product.who}`);
  L.push(`- 交什么：${report.product.what}`);
  L.push(`- 多久：${report.product.duration}`);
  L.push(`- 怎么算做完：${report.product.acceptance}`);
  L.push(`- 第一份收多少：${report.product.priceHead}。${report.product.price}`);
  report.product.warn.forEach((w) => L.push(`- ⚠️ ${w}`));
  if (report.steps.length) {
    L.push('', '拆成四步（按分钟排）：', '');
    report.steps.forEach((s, i) => L.push(`${i + 1}. ${s.t}（${s.min} 分钟）→ 产出：${s.out}`));
  }
  if (report.tiers.length) {
    L.push('', '报价三档：', '');
    report.tiers.forEach((t) => L.push(`- ${t.k}：${t.v} —— ${t.note}`));
  }
  if (report.pitch.length) {
    L.push('', '可以直接复制的话：', '');
    report.pitch.forEach((p) => L.push(`> ${p}`));
  }

  L.push('', '## 四 本周三件事', '');
  report.week.forEach((w) => L.push(`- **${w.day}**：${w.act}`));

  L.push('', '## 五 会卡在哪', '');
  if (!report.risks.length) L.push('- 暂时没算出硬矛盾，照上面的节奏走。');
  report.risks.forEach((r) => L.push(`- ${r}`));
  L.push('', `**算验证成功**：${report.validate.ok}`, `**算失败**：${report.validate.fail}`, '');

  L.push('## 六 接下来 90 天', '');
  report.plan.forEach((p) => {
    L.push(`### ${p.phase}`);
    p.items.forEach((x) => L.push(`- ${x}`));
    L.push('');
  });

  L.push('## 七 还缺哪一块', '');
  if (!report.gapTop3.length) L.push('- 该写的都写了，剩下的是执行。');
  report.gapTop3.forEach((g, i) => L.push(`${i + 1}. ${g.layer}：${g.text}`));

  L.push('', '---', '', '<details><summary>原始答案</summary>', '');
  QUESTIONS.forEach((q) => {
    const v = answers[q.id];
    if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) return;
    const shown = Array.isArray(v) ? v.map((x) => (q.options ? (q.options.find((o) => o.v === x) || {}).label || x : x)).join('、') : v;
    L.push(`- ${q.label}：${shown}`);
  });
  L.push('', '</details>', '');
  return L.join('\n');
}

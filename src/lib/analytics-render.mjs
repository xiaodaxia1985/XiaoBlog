/**
 * 数据看板渲染：服务端首屏与浏览器实时拉取共用同一份实现。
 * 纯字符串输出、不依赖 DOM，避免 SSR 与客户端两套模板不一致。
 */

const PLATFORMS = [
  { key: 'douyin', name: '抖音', sub: '作品管理 · 逐条', unit: '播放', mainKey: '播放' },
  { key: 'wechat', name: '微信公众号', sub: '发表记录 · 逐篇', unit: '阅读', mainKey: '阅读' },
  { key: 'kuaishou', name: '快手', sub: '内容管理 · 可见作品', unit: '播放', mainKey: '播放' },
  { key: 'xiaohongshu', name: '小红书', sub: '创作服务平台 · 近 7 日聚合', unit: '观看', mainKey: '观看' },
];

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** "11,484" "8.3%" "1.28%" → 数字；不可解析返回 null。 */
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = v.replace(/[,，\s]/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/** 千分位；整数不带小数。 */
function fmt(v) {
  const n = num(v);
  if (n === null) return String(v ?? '—');
  const isInt = Math.abs(n - Math.round(n)) < 1e-9;
  return n.toLocaleString('en-US', isInt ? { maximumFractionDigits: 0 } : { maximumFractionDigits: 2 });
}

const isRate = (v) => typeof v === 'string' && v.includes('%');

/** 日期归一到 MM-DD：2026-11-20 19:34 / 11月16日 / 昨天 21:22 都能认；认不出返回 null。 */
function dateKey(v, base) {
  const s = String(v ?? '');
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m) return `${String(+m[1]).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}`;
  m = s.match(/\b(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}`;
  // 相对日期：以后台观测时点为基准倒推，避免「昨天」永远排在最后。
  const rel = { 今天: 0, 昨天: 1, 前天: 2 };
  for (const [word, back] of Object.entries(rel)) {
    if (s.includes(word) && base) {
      const d = new Date(base);
      if (!Number.isNaN(d.getTime())) {
        d.setDate(d.getDate() - back);
        return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
    }
  }
  // 「星期六 19:26」这类星期表达：从观测时点往前找最近的那个星期几。
  const wk = s.match(/星期([一二三四五六日天])/);
  if (wk && base) {
    const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
    const target = map[wk[1]];
    const d = new Date(base);
    if (!Number.isNaN(d.getTime()) && target !== undefined) {
      const diff = (d.getDay() - target + 7) % 7;
      d.setDate(d.getDate() - diff);
      return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  }
  return null;
}

/** 卡片里字段名太长会把标签截成「平均浏…」，统一给短名。 */
const SHORT_LABEL = {
  平均浏览图片数: '平均图数',
  完播率: '完播',
  划走率: '划走',
  '2秒跳出率': '2 秒跳出',
  文案展开率: '展开率',
  吸粉量: '吸粉',
  累计播放: '播放',
  累计点赞: '点赞',
  累计评论: '评论',
  累计分享: '分享',
  累计收藏: '收藏',
  累计吸粉: '吸粉',
  累计阅读: '阅读',
  累计在看: '在看',
  '合计播放(可见作品)': '合计播放',
  视频完播率: '完播率',
  人均观看时长: '人均时长',
  封面点击率: '封面点击',
  主页访客: '主页访客',
};

const shortLabel = (k) => SHORT_LABEL[k] || k;

function worksOf(p, data) {
  const d = data[p.key] || {};
  const works = d.works || [];
  return p.key === 'wechat' ? works.filter((w) => w.status !== '已删除') : works;
}

function mainValue(p, w) {
  const m = w.metrics || {};
  for (const k of [p.mainKey, '播放', '阅读', '观看']) {
    if (m[k] != null) return num(m[k]) ?? 0;
  }
  return 0;
}

function sum(arr) {
  return arr.reduce((a, b) => a + (Number(b) || 0), 0);
}

/* ===== 顶部 KPI ===== */
function renderKpi(data) {
  const dy = data.douyin || {};
  const wx = data.wechat || {};
  const ks = data.kuaishou || {};
  const xhs = data.xiaohongshu || {};

  const dyW = (dy.works || []).length;
  const wxW = (wx.works || []).filter((w) => w.status !== '已删除').length;
  const ksW = (ks.works || []).length;
  const totalWorks = dyW + wxW + ksW;

  const reach =
    sum((dy.works || []).map((w) => mainValue(PLATFORMS[0], w))) +
    sum((wx.works || []).filter((w) => w.status !== '已删除').map((w) => mainValue(PLATFORMS[1], w))) +
    sum((ks.works || []).map((w) => mainValue(PLATFORMS[2], w))) +
    (num((xhs.summary || {})['观看数']) || 0);

  const dyE = ['累计点赞', '累计评论', '累计分享', '累计收藏'].reduce((a, k) => a + (num((dy.summary || {})[k]) || 0), 0);
  const wxE = ['累计点赞', '累计在看'].reduce((a, k) => a + (num((wx.summary || {})[k]) || 0), 0);
  const xhsE = ['点赞数', '评论数', '收藏数', '分享数'].reduce((a, k) => a + (num((xhs.summary || {})[k]) || 0), 0);
  const engage = dyE + wxE + xhsE;

  const fans = (num((dy.summary || {})['累计吸粉']) || 0) + (num((xhs.summary || {})['净涨粉']) || 0);

  const items = [
    { label: '可见内容', value: totalWorks, unit: '条', sub: `抖音 ${dyW} · 微信 ${wxW} · 快手 ${ksW}`, icon: 'M4 6h16M4 12h16M4 18h10' },
    { label: '全平台触达', value: reach, unit: '次', sub: '播放 / 阅读 / 观看合计', icon: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z' },
    { label: '互动总量', value: engage, unit: '次', sub: '赞 + 评 + 藏 + 分享 + 在看', icon: 'M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 1 0-7.1 7.1L12 21l8.8-8.3a5 5 0 0 0 0-7.1Z' },
    { label: '粉丝净增', value: fans, unit: '人', sub: '抖音吸粉 + 小红书净涨粉', icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M19 8v6M22 11h-6' },
  ];

  return `<div class="an-kpi-row">${items
    .map(
      (i, idx) => `<div class="an-kpi" style="--i:${idx}">
      <div class="an-kpi-top">
        <span class="an-kpi-label">${esc(i.label)}</span>
        <svg class="an-kpi-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${i.icon}"></path></svg>
      </div>
      <div class="an-kpi-value">${fmt(i.value)}<small>${esc(i.unit)}</small></div>
      <div class="an-kpi-sub">${esc(i.sub)}</div>
    </div>`
    )
    .join('')}</div>`;
}

/* ===== 平台体量对比 ===== */
function renderCompare(data) {
  const rows = PLATFORMS.map((p) => {
    let v = sum(worksOf(p, data).map((w) => mainValue(p, w)));
    let label = p.unit;
    if (p.key === 'xiaohongshu') {
      v = num(((data[p.key] || {}).summary || {})['观看数']) || 0;
      label = '观看';
    }
    return { key: p.key, name: p.name, v, label };
  });
  const max = Math.max(1, ...rows.map((r) => r.v));

  return `<section class="an-block" aria-labelledby="an-cmp-title">
    <div class="an-block-head">
      <h2 id="an-cmp-title">平台体量对比</h2>
      <span>条形按播放 / 阅读 / 观看合计，口径不同仅供横向参考</span>
    </div>
    ${rows
      .map(
        (r, i) => `<div class="an-cmp-row" style="--i:${i}">
        <div class="an-cmp-name">${esc(r.name)}</div>
        <div class="an-cmp-track"><div class="an-cmp-fill" style="width:${((r.v / max) * 100).toFixed(1)}%"></div></div>
        <div class="an-cmp-value">${fmt(r.v)}<em>${esc(r.label)}</em></div>
      </div>`
      )
      .join('')}
  </section>`;
}

/* ===== 分析卡 ===== */
/** 转义后把数字与百分比高亮，避免直接拼 HTML 造成注入。 */
function highlight(s) {
  return esc(s).replace(/(\d[\d,]*(?:\.\d+)?\s*%?)/g, '<b class="an-num">$1</b>');
}

/** 按句号拆句：首句作导语，其余作要点列。 */
function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[。！？])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function renderAnalysis(data) {
  const a = data.analysis || {};
  const cards = [];
  const order = [...PLATFORMS.map((p) => ({ key: p.key, name: p.name })), { key: 'overall', name: '整体判断' }];
  order.forEach((p, idx) => {
    const val = a[p.key];
    if (!val) return;
    // 兼容两种形态：结构化 {lead, points[]} 与旧版纯字符串（按句切）。
    let lead = '';
    let points = [];
    if (typeof val === 'string') {
      const sentences = splitSentences(val);
      lead = sentences[0] || '';
      points = sentences.slice(1).map((s) => ({ title: '', text: s }));
    } else {
      lead = val.lead || '';
      points = (val.points || []).map((x) => (typeof x === 'string' ? { title: '', text: x } : x));
    }
    const isOverall = p.key === 'overall';
    cards.push(`<article class="an-analysis-card${isOverall ? ' is-overall' : ''}" style="--i:${idx}">
      <header class="an-analysis-head">
        <span class="an-analysis-idx">${String(idx + 1).padStart(2, '0')}</span>
        <h3>${esc(p.name)}</h3>
      </header>
      <p class="an-analysis-lead">${highlight(lead)}</p>
      ${
        points.length
          ? `<ul class="an-analysis-points">${points
              .map(
                (pt) =>
                  `<li>${pt.title ? `<b class="an-point-title">${esc(pt.title)}</b>` : ''}<span>${highlight(pt.text)}</span></li>`
              )
              .join('')}</ul>`
          : ''
      }
    </article>`);
  });
  if (!cards.length) return '';
  return `<section class="an-block" aria-labelledby="an-analysis-title">
    <div class="an-block-head">
      <h2 id="an-analysis-title">我的分析</h2>
      <span>基于本页原始数字的逐平台判断</span>
    </div>
    <div class="an-analysis-grid">${cards.join('')}</div>
  </section>`;
}

/* ===== 指标网格 ===== */
function renderStats(summary) {
  const entries = Object.entries(summary || {});
  if (!entries.length) return '';
  return `<div class="an-stat-grid">${entries
    .map(
      ([k, v]) =>
        `<div class="an-stat"><span title="${esc(k)}">${esc(shortLabel(k))}</span><strong>${isRate(v) ? esc(v) : fmt(v)}</strong></div>`
    )
    .join('')}</div>`;
}

/* ===== 平台内作品贡献占比（100% 堆叠，颗粒度到每一条） ===== */
function renderShare(p, works) {
  const list = works
    .map((w) => ({ title: w.title || '（无标题）', v: mainValue(p, w) }))
    .filter((w) => w.v > 0)
    .sort((a, b) => b.v - a.v);
  const total = sum(list.map((w) => w.v));
  if (list.length < 2 || total <= 0) return '';
  const segs = list
    .map((w, i) => {
      const pct = (w.v / total) * 100;
      const shade = Math.max(0.2, 1 - i * 0.085);
      return `<span class="an-share-seg" style="flex:${pct.toFixed(3)} 0 0;--s:${shade.toFixed(3)}" title="${esc(w.title)} · ${fmt(w.v)}${esc(p.unit)} · ${pct.toFixed(1)}%"></span>`;
    })
    .join('');
  const top = list.slice(0, 5);
  return `<div class="an-card an-share-card">
    <h3>作品贡献占比<span>条宽＝该作品占本平台${esc(p.unit)}总量的份额 · 悬停看单条</span></h3>
    <div class="an-share">${segs}</div>
    <ul class="an-legend">${top
      .map(
        (w) => `<li><i></i><span>${esc(w.title)}</span><b>${((w.v / total) * 100).toFixed(1)}%</b></li>`
      )
      .join('')}${list.length > top.length ? `<li class="is-more">其余 ${list.length - top.length} 条合计 ${((sum(list.slice(5).map((w) => w.v)) / total) * 100).toFixed(1)}%</li>` : ''}</ul>
  </div>`;
}

/* ===== 互动构成（赞 / 评 / 藏 / 分享），一平台一条堆叠 ===== */
const ENGAGE_KEYS = {
  douyin: ['累计点赞', '累计评论', '累计分享', '累计收藏'],
  wechat: ['累计点赞', '累计在看'],
  xiaohongshu: ['点赞数', '评论数', '收藏数', '分享数'],
  kuaishou: [],
};

function renderEngageMix(p, summary) {
  const keys = (ENGAGE_KEYS[p.key] || []).filter((k) => num(summary?.[k]) !== null);
  if (keys.length < 2) return '';
  const items = keys.map((k) => ({ k: shortLabel(k), v: num(summary[k]) || 0 })).sort((a, b) => b.v - a.v);
  const total = sum(items.map((i) => i.v));
  if (total <= 0) return '';
  return `<div class="an-card an-mix-card">
    <h3>互动构成<span>合计 ${fmt(total)} 次 · 条宽为各动作占比</span></h3>
    <div class="an-mix">${items
      .map(
        (i, idx) =>
          `<span class="an-mix-seg" style="flex:${((i.v / total) * 100).toFixed(3)} 0 0;--s:${Math.max(0.22, 1 - idx * 0.15).toFixed(3)}" title="${esc(i.k)} ${fmt(i.v)}（${((i.v / total) * 100).toFixed(1)}%）"></span>`
      )
      .join('')}</div>
    <ul class="an-legend is-inline">${items
      .map((i) => `<li><i></i><span>${esc(i.k)}</span><b>${fmt(i.v)}</b></li>`)
      .join('')}</ul>
  </div>`;
}

/* ===== 发布趋势：平滑面积曲线（SVG 形 + HTML 圆点，文字不被拉伸） ===== */
/** Catmull-Rom 转三次贝塞尔，做出柔顺曲线。坐标空间固定 0..1000 × 0..100。 */
function smoothPath(pts) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const t = 0.16;
    const c1x = p1.x + (p2.x - p0.x) * t;
    const c1y = p1.y + (p2.y - p0.y) * t;
    const c2x = p2.x - (p3.x - p1.x) * t;
    const c2y = p2.y - (p3.y - p1.y) * t;
    d += ` C ${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

function renderTrend(p, works, base) {
  const list = works
    .map((w, i) => ({ title: w.title || '（无标题）', date: w.date || '', key: dateKey(w.date, base), v: mainValue(p, w), i }))
    .filter((w) => w.v > 0);
  // 没有日期就无法按时间排，硬画出来的「趋势」是假象，不如不出。
  const dated = list.filter((w) => w.key);
  if (dated.length < 3 || dated.length < list.length - 1) return '';
  const ordered = dated.sort((a, b) => a.key.localeCompare(b.key) || a.i - b.i);
  const max = Math.max(...ordered.map((i) => i.v));
  const peak = Math.max(1, Math.round(max / 100) * 100);
  const n = ordered.length;
  const TOP = 6; // 顶部留白（百分比）
  const LEFT = 3; // 左右内缩：首末圆点不许贴在边框上被切掉一半
  const usable = 100 - TOP;
  const span = 100 - LEFT * 2;
  const px = (i) => (n === 1 ? 50 : LEFT + (i / (n - 1)) * span);
  const pts = ordered.map((w, i) => ({
    x: px(i) * 10,
    y: 100 - (w.v / peak) * usable,
  }));
  const line = smoothPath(pts);
  const area = `${line} L ${pts[n - 1].x.toFixed(2)},100 L ${pts[0].x.toFixed(2)},100 Z`;
  const avg = Math.round(sum(ordered.map((w) => w.v)) / n);

  const dots = ordered
    .map((w, i) => {
      const isPeak = w.v === max;
      return `<span class="an-pt${isPeak ? ' is-peak' : ''}" style="left:${px(i).toFixed(2)}%;bottom:${(w.v / peak) * usable}%">
        <i class="an-pt-dot"></i>
        <span class="an-pt-tip"><b>${fmt(w.v)}${esc(p.unit)}</b><em>${esc(w.key || '—')}</em><span>${esc(w.title)}</span></span>
      </span>`;
    })
    .join('');

  const xs = ordered
    .map(
      (w, i) =>
        `<span class="an-x${n > 7 && i % 2 === 1 ? ' is-alt' : ''}${i === 0 ? ' is-edge-l' : i === n - 1 ? ' is-edge-r' : ''}" style="left:${px(i).toFixed(2)}%">${esc(w.key || '—')}</span>`
    )
    .join('');

  const grid = [0, 25, 50, 75, 100]
    .map((g) => `<span class="an-grid" style="bottom:${(g / 100) * usable}%"><em>${fmt(Math.round((peak * g) / 100))}</em></span>`)
    .join('');

  return `<div class="an-card an-trend-card">
    <h3>发布趋势<span>按日期从早到晚 · 曲线高＝${esc(p.unit)} · 峰值 ${fmt(max)} · 均值 ${fmt(avg)}</span></h3>
    <div class="an-chart">
      <div class="an-chart-body">
        ${grid}
        <svg class="an-chart-svg" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="an-trend-fill-${esc(p.key)}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.30"/>
            <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
          </linearGradient></defs>
          <path d="${area}" fill="url(#an-trend-fill-${esc(p.key)})"/>
          <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        ${dots}
      </div>
      <div class="an-chart-x">${xs}</div>
    </div>
  </div>`;
}

/* ===== 作品卡（每篇一张，这是页面的颗粒度核心） ===== */
function renderWorkCards(p, works) {
  if (!works.length) return '';
  const list = works
    .map((w) => ({ ...w, _v: mainValue(p, w) }))
    .sort((a, b) => b._v - a._v);
  const max = Math.max(1, ...list.map((w) => w._v));

  const cards = list
    .map((w, i) => {
      const m = w.metrics || {};
      const ratio = (w._v / max) * 100;
      const rank = String(i + 1).padStart(2, '0');
      const mateList = Object.entries(m).filter(
        ([k, v]) => k !== p.mainKey && k !== '播放' && k !== '阅读' && k !== '观看' && !isRate(v) && !/率$/.test(k)
      );
      const mates = mateList
        .map(([k, v]) => `<li><span title="${esc(k)}">${esc(shortLabel(k))}</span><b>${fmt(v)}</b></li>`)
        .join('');
      // 4 个就铺 4 列、5 个就铺 5 列（不能落单），6 个以上按 4 列两行排。
      const mateCols = mateList.length === 5 ? 5 : Math.min(4, Math.max(2, mateList.length));
      // 值为「—」（后台未回传，常见于样本不足的新作品）的比率项直接不出现，
      // 否则卡片底部挂一串空横线，比不显示更像坏了。
      const rates = Object.entries(m)
        .filter(([, v]) => isRate(v))
        .map(([k, v]) => ({ k, v, n: num(v) }))
        .filter((r) => r.n !== null);
      const rateHtml = rates.length
        ? `<div class="an-work-rates">${rates
            .map((r) => {
              // 比率条按 0–100% 直接量取，不拿完播率和跳出率互相归一——
              // 否则 1.27% 的完播会被 48.55% 的跳出率抬成一条假长条。
              const bar = Math.max(1.2, Math.min(100, r.n));
              return `<div class="an-work-rate">
              <span>${esc(r.k)}</span>
              <b>${esc(r.v)}</b>
              <i style="width:${bar.toFixed(1)}%"></i>
            </div>`;
            })
            .join('')}</div>`
        : '';

      // 零值卡片：条长为 0、比率全是 0%，读起来像页面坏了。改成一句明确的状态说明。
      const isEmpty = !(w._v > 0);
      const ratioText = isEmpty ? '暂无数据' : ratio >= 99.5 ? '平台最高' : `平台的 ${Math.round(ratio)}%`;

      return `<article class="an-work${i < 3 && !isEmpty ? ' is-top' : ''}${isEmpty ? ' is-empty' : ''}" style="--i:${Math.min(i, 11)}">
        <div class="an-work-top">
          <span class="an-work-rank">${rank}</span>
          <span class="an-work-date">${esc(w.date || '—')}</span>
          ${w.status ? `<span class="an-work-status">${esc(w.status)}</span>` : ''}
        </div>
        <h4 class="an-work-title">${esc(w.title || '（无标题）')}</h4>
        <div class="an-work-main">
          <strong>${fmt(w._v)}</strong>
          <span>${esc(p.unit)}</span>
          <em>${esc(ratioText)}</em>
        </div>
        <div class="an-work-track"><i style="width:${ratio.toFixed(1)}%"></i></div>
        ${mates ? `<ul class="an-work-metrics" style="grid-template-columns:repeat(${mateCols},minmax(0,1fr))">${mates}</ul>` : ''}
        ${rateHtml}
      </article>`;
    })
    .join('');

  return `<div class="an-works-head">
      <h3>逐条作品<span>${works.length} 条 · 按${esc(p.unit)}降序 · 卡内条长为平台内相对比较</span></h3>
    </div>
    <div class="an-works">${cards}</div>`;
}

/* ===== 原始数据表（收纳，备查） ===== */
function renderTable(p, works) {
  if (!works.length) return '';
  const rows = works
    .map((w) => {
      const m = w.metrics || {};
      const rest = Object.entries(m)
        .filter(([k]) => k !== p.mainKey && k !== '播放' && k !== '阅读' && k !== '观看')
        .map(([k, v]) => `<span class="an-metric"><span>${esc(k)}</span> ${esc(typeof v === 'number' ? fmt(v) : v)}</span>`)
        .join('');
      const mv = m[p.mainKey] ?? m['播放'] ?? m['阅读'] ?? m['观看'];
      return `<tr>
        <td class="is-title">${esc(w.title)}</td>
        <td class="is-text">${esc(w.date || '—')}</td>
        <td class="is-num">${mv != null ? fmt(mv) : '—'}</td>
        <td class="is-extra">${rest || '—'}</td>
      </tr>`;
    })
    .join('');
  return `<details class="an-table-card">
    <summary>完整原始字段（${works.length} 条，点击展开）</summary>
    <div class="an-table-scroll">
      <table class="an-table">
        <thead><tr><th>作品</th><th>日期</th><th class="is-num">${esc(p.unit)}</th><th>其他原始指标</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </details>`;
}

/* ===== 比率条（小红书这类只有比例的数据） ===== */
function renderRates(pairs) {
  const items = pairs.filter(([, v]) => num(v) !== null);
  if (!items.length) return '';
  const max = Math.max(...items.map(([, v]) => num(v)), 1);
  return `<div class="an-card">
    <h3>关键转化率<span>条形为组内相对比较，数值为后台原值</span></h3>
    <div>${items
      .map(
        ([k, v]) => `<div class="an-rate-row">
        <div class="an-rate-label">${esc(k)}</div>
        <div class="an-rate-track"><div class="an-rate-fill" style="width:${((num(v) / max) * 100).toFixed(1)}%"></div></div>
        <div class="an-rate-value">${esc(v)}</div>
      </div>`
      )
      .join('')}</div>
    <p class="an-scale-note">完播率与封面点击率处在漏斗不同环节，互不叠加。</p>
  </div>`;
}

/* ===== 漏斗（曝光 → 观看） ===== */
function renderFunnel(summary) {
  const exposure = num(summary?.['曝光数']);
  const views = num(summary?.['观看数']);
  if (exposure === null || views === null || exposure <= 0) return '';
  const rate = (views / exposure) * 100;
  const steps = [
    { name: '曝光', v: exposure, ratio: 100, bar: 100 },
    { name: '观看', v: views, ratio: rate, bar: (views / exposure) * 100 },
  ];
  return `<div class="an-card">
    <h3>曝光 → 观看漏斗<span>观看 / 曝光 = ${rate.toFixed(1)}%</span></h3>
    <div class="an-funnel">${steps
      .map(
        (s) => `<div class="an-funnel-step">
        <div class="an-funnel-name">${esc(s.name)}</div>
        <div class="an-funnel-bar" style="width:${Math.max(s.bar, 12).toFixed(1)}%">${fmt(s.v)}</div>
        <div class="an-funnel-meta">${s.ratio.toFixed(1)}%</div>
      </div>`
      )
      .join('')}</div>
  </div>`;
}

/* ===== 单平台段 ===== */
function renderPlatform(p, data) {
  const d = data[p.key] || {};
  const works = worksOf(p, data);
  const summary = d.summary || {};
  const count = works.length;

  let body = renderStats(summary);
  body += renderEngageMix(p, summary);
  if (count) {
    body += renderShare(p, works);
    body += renderTrend(p, works, data.observedAt);
    body += renderWorkCards(p, works);
  }
  if (p.key === 'xiaohongshu') {
    body += renderFunnel(summary);
    body += renderRates([
      ['封面点击率', summary['封面点击率']],
      ['视频完播率', summary['视频完播率']],
    ]);
  }
  if (count) body += renderTable(p, works);

  const note = d.note ? `<p class="an-note">${esc(d.note)}</p>` : '';
  const countText = count ? `可见 ${count} 条` : '聚合数据';

  return `<section class="an-platform" data-platform="${esc(p.key)}" aria-labelledby="an-${p.key}">
    <div class="an-platform-head">
      <h2 id="an-${p.key}">${esc(p.name)}</h2>
      <span class="an-platform-sub">${esc(p.sub)}</span>
      <span class="an-platform-count">${esc(countText)}</span>
    </div>
    ${note}
    ${body}
  </section>`;
}

/* ===== 平台切换 tab ===== */
function renderTabs(data) {
  const tabs = [{ key: 'all', name: '全部' }, ...PLATFORMS.map((p) => ({ key: p.key, name: p.name }))];
  return `<nav class="an-tabs" aria-label="按平台筛选" data-an-tabs>
    ${tabs
      .map(
        (t, i) => `<button type="button" class="an-tab${i === 0 ? ' is-active' : ''}" data-an-tab="${esc(t.key)}" aria-pressed="${i === 0}">${esc(t.name)}</button>`
      )
      .join('')}
  </nav>`;
}

/* ===== 整页 ===== */
export function renderDashboard(data) {
  if (!data || !data.douyin) {
    return `<div class="an-disclaimer">暂无数据。先运行 <code>node scripts/collect-analytics.mjs</code> 生成快照。</div>`;
  }
  const disclaimer = data.disclaimer ? `<p class="an-disclaimer">${esc(data.disclaimer)}</p>` : '';
  return `${disclaimer}
    ${renderKpi(data)}
    ${renderCompare(data)}
    ${renderAnalysis(data)}
    ${renderTabs(data)}
    <div class="an-platforms">${PLATFORMS.map((p) => renderPlatform(p, data)).join('')}</div>
    <p class="an-scale-note">观测时点 ${esc(data.observedAt || '—')}（${esc(data.timezone || 'Asia/Shanghai')}）。数字为各平台后台原始值，未经二次加工；四平台对「播放 / 阅读 / 观看」「完播」的定义互不相同，不做跨平台横比结论。</p>`;
}

export { PLATFORMS };

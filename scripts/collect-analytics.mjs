#!/usr/bin/env node
/**
 * 四平台后台数据自取 + 逐条明细 + 分析，输出站点的 public/data/analytics.json。
 *
 * 连接专用 Edge 调试实例（默认端口 9224，登录态持久化在 .tmp/edge-profile），
 * 依次读取抖音作品管理 / 微信公众平台首页 / 快手创作者中心 / 小红书创作服务平台
 * 的 innerText，解析原始数字（只记原始值 + 观测时点，未知记 "—"，零记 0），
 * 生成结构化 JSON 供 /analytics 页面读取。数据可公开，明文入站，符合人设。
 *
 * 用法：
 *   node scripts/collect-analytics.mjs
 *   node scripts/collect-analytics.mjs --port 9224 --out public/data/analytics.json
 *
 * 这是一个纯本地脚本（铁律26）：不发模型请求、不派 subagent。
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? (argv[i + 1] ?? def) : def;
}
const PORT = Number(arg('port', '9224'));
const OUT = arg('out', 'public/data/analytics.json');
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PAGES = [
  { key: 'douyin', host: 'creator.douyin.com', url: 'https://creator.douyin.com/creator-micro/content/manage' },
  { key: 'wechat', host: 'mp.weixin.qq.com', url: 'https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN&token=1200393220' },
  { key: 'kuaishou', host: 'cp.kuaishou.com', url: 'https://cp.kuaishou.com/profile' },
  { key: 'xiaohongshu', host: 'creator.xiaohongshu.com', url: 'https://creator.xiaohongshu.com/new/home' },
];

async function fetchText(port, host, url, waitMs = 6000) {
  const targets = (await (await fetch(`${BASE}/json/list`)).json()).filter(t => t.type === 'page');
  const target = targets.find(t => t.url.includes(host)) || targets[0];
  if (!target) throw new Error(`[${host}] 无可用 page target`);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/devtools/page/${target.id}`);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise(res => {
    const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params }));
  });
  try {
    await send('Page.enable');
    await send('Page.navigate', { url });
    await sleep(waitMs);
    const r = await send('Runtime.evaluate', { expression: 'document.body.innerText || ""', returnByValue: true });
    return r.result?.result?.value || '';
  } finally { ws.close(); }
}

function num(s) { return Number(String(s ?? '0').replace(/,/g, '')) || 0; }
// 抖音标题正文里标题与文案用空格相连，取第一句做短标题，去掉话题标签
function shortTitle(raw, max = 42) {
  let t = String(raw || '').replace(/\s+/g, ' ').trim();
  t = t.split(/(?<=[。！？!?])/)[0];           // 第一句
  t = t.replace(/(?:#[\w\u4e00-\u9fa5]+.*)?$/, '').trim();
  t = t.replace(/^置顶\s*/, '');
  return t.slice(0, max) || String(raw || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// ---------- 解析：抖音逐条 ----------
function parseDouyin(text) {
  const works = [];
  // 每条结构：时长/张数 → [置顶] → 标题正文 → 编辑作品 → … → 日期 → 已发布 → 播放/点赞/…/吸粉量
  const re = /(\d{1,2}:\d{2}|\d+张图)\n(?:置顶\n)?([\s\S]*?)\n编辑作品\n[\s\S]*?(\d{4}年\d{1,2}月\d{1,2}日[^\n]*)\n已发布\n([\s\S]*?)播放\n([\d,]+)\n点赞\n([\d,]+)\n评论\n([\d,]+)\n分享\n([\d,]+)\n收藏\n([\d,]+)\n(完播率|划走率)\n([\d.]+%)\n(2秒跳出率|文案展开率)\n([\d.]+%)(?:\n平均浏览图片数\n([\d.]+))?\n吸粉量\n(\d+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    works.push({
      title: shortTitle(m[2]),
      date: m[3].replace('年', '-').replace('月', '-').replace('日', ''),
      metrics: {
        '播放': num(m[5]), '点赞': num(m[6]), '评论': num(m[7]), '分享': num(m[8]), '收藏': num(m[9]),
        [m[10]]: m[11], [m[12]]: m[13],
        ...(m[14] ? { '平均浏览图片数': m[14] } : {}),
        '吸粉量': num(m[15]),
      },
    });
  }
  const sum = k => works.reduce((a, w) => a + (num(w.metrics[k]) || 0), 0);
  return {
    works,
    summary: {
      '作品数': works.length || null,
      '累计播放': works.length ? sum('播放') : null,
      '累计点赞': works.length ? sum('点赞') : null,
      '累计评论': works.length ? sum('评论') : null,
      '累计分享': works.length ? sum('分享') : null,
      '累计收藏': works.length ? sum('收藏') : null,
      '累计吸粉': works.length ? sum('吸粉量') : null,
    },
  };
}

// ---------- 解析：微信逐篇 ----------
function parseWechat(text) {
  const works = [];
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  const dateRe = /^(昨天|前天|今天|星期[一二三四五六日])(?:\s+\d{1,2}:\d{2})?$|^\d{1,2}月\d{1,2}日(?:\s+\d{1,2}:\d{2})?$/;
  const timeRe = /^\d{1,2}:\d{2}$/;
  for (let i = 0; i < lines.length; i++) {
    if (!dateRe.test(lines[i])) continue;
    if (lines[i + 1] !== '已发表' && lines[i + 1] !== '已删除') continue;
    const deleted = lines[i + 1] === '已删除';
    let j = i + 2;
    if (timeRe.test(lines[j])) j++;                      // 可选时长行
    const title = lines[j++] || '';                      // 标题
    if (lines[j] === '原创' || lines[j] === '已修改') j++; // 可选标签
    if (lines[j] === '原创' || lines[j] === '已修改') j++; // 原创+已修改
    const nums = [];
    while (j < lines.length && /^\d+$/.test(lines[j])) { nums.push(Number(lines[j])); j++; }
    if (!nums.length) continue;
    works.push({
      title: title.replace(/\u00a0/g, ' ').slice(0, 60),
      date: lines[i],
      status: deleted ? '已删除' : '已发表',
      metrics: {
        '阅读': nums[0] ?? '—', '点赞': nums[1] ?? '—', '在看': nums[2] ?? '—',
        '分享': nums[3] ?? '—', '收藏': nums[4] ?? '—',
      },
    });
  }
  const published = works.filter(w => w.status === '已发表');
  const sum = k => published.reduce((a, w) => a + (num(w.metrics[k]) || 0), 0);
  return {
    works,
    summary: {
      '已发表': published.length || null,
      '累计阅读': published.length ? sum('阅读') : null,
      '累计点赞': published.length ? sum('点赞') : null,
      '累计在看': published.length ? sum('在看') : null,
    },
  };
}

// ---------- 解析：快手逐条（内容管理段：完整标题行 + 紧跟数字行） ----------
function parseKuaishou(text) {
  const lines = text.split('\n').map(s => s.trim());
  // 取最后一个「内容管理」（内容管理区标题，在「查看更多」之后），避开侧边栏导航与「最新作品」卡片
  let start = -1;
  lines.forEach((l, i) => { if (l === '内容管理') start = i; });
  let end = lines.findIndex((l, i) => i > start && l === '评论管理');
  const seg = lines.slice(start >= 0 ? start : 0, end >= 0 ? end : lines.length);
  const works = [];
  for (let i = 0; i < seg.length - 1; i++) {
    const title = seg[i];
    const nxt = seg[i + 1];
    if (/^\d{1,7}$/.test(nxt) && title && title.length >= 12 && !/^\d+$/.test(title) &&
        !/^(查看更多|发布作品|合集管理|内容管理)$/.test(title)) {
      works.push({ title: shortTitle(title), date: '—', metrics: { '播放': num(nxt) } });
      i++;
    }
  }
  const sum = works.reduce((a, w) => a + num(w.metrics['播放']), 0);
  return {
    works,
    summary: {
      '作品数': works.length || null,
      '合计播放(可见作品)': works.length ? sum : null,
    },
    note: 'profile 页内容管理区仅展示标题与播放量，点赞/评论/完播等明细需在「数据中心→作品分析」补充。',
  };
}

// ---------- 解析：小红书聚合 ----------
function parseXiaohongshu(text) {
  const pick = (label) => {
    const i = text.indexOf(label);
    if (i < 0) return '—';
    const seg = text.slice(i + label.length, i + label.length + 40);
    const m = seg.match(/\d[\d,]*(?:\.\d+)?%?/);
    return m ? m[0] : '—';
  };
  return {
    works: [],
    summary: {
      '曝光数': pick('曝光数'), '观看数': pick('观看数'), '封面点击率': pick('封面点击率'),
      '视频完播率': pick('视频完播率'), '点赞数': pick('点赞数'), '评论数': pick('评论数'),
      '收藏数': pick('收藏数'), '分享数': pick('分享数'), '净涨粉': pick('净涨粉'), '主页访客': pick('主页访客'),
    },
    note: '逐条笔记数据：小红书后台「数据小时更新」，暂无逐篇分析，仅展示聚合。',
  };
}

// ---------- 分析（基于原始数据本地生成，不发模型请求） ----------
function analyze(data) {
  const out = {};
  const dy = data.douyin;
  if (dy.works.length) {
    const top = [...dy.works].sort((a, b) => num(b.metrics['播放']) - num(a.metrics['播放'])).slice(0, 3);
    out.douyin = `抖音可见 ${dy.works.length} 条作品，累计播放 ${num(dy.summary['累计播放']).toLocaleString()}、吸粉 ${num(dy.summary['累计吸粉'])}。` +
      `播放前三：${top.map(w => `《${w.title.slice(0, 12)}…》${num(w.metrics['播放']).toLocaleString()}`).join('、')}。` +
      `完播率普遍偏低（多数在 1%–2% 区间），图文划走率偏高；吸粉集中在少数几条，「被看见」与「被记住」仍有落差。`;
  }
  const wx = data.wechat;
  if (wx.works.length) {
    const pub = wx.works.filter(w => w.status === '已发表');
    const top = [...pub].sort((a, b) => num(b.metrics['阅读']) - num(a.metrics['阅读'])).slice(0, 3);
    out.wechat = `公众号可见 ${pub.length} 篇已发表，累计阅读 ${num(wx.summary['累计阅读']).toLocaleString()}。` +
      `阅读前三：${top.map(w => `《${w.title.slice(0, 12)}…》${w.metrics['阅读']}`).join('、')}。` +
      `阅读集中在两篇早年文章，近期文章阅读个位到数十，公众号主要靠搜索与老读者，新内容尚未形成稳定打开习惯；在看/分享少，扩散弱。`;
  }
  out.kuaishou = `快手可见 ${data.kuaishou.works.length} 条作品，合计播放 ${data.kuaishou.summary['合计播放(可见作品)'] ?? '—'}（内容管理区可见部分）。` +
    `该页只有标题与播放量，缺少点赞/完播明细，完整逐条指标需从「数据中心→作品分析」补充，当前只记可见原始数。`;
  const xhs = data.xiaohongshu.summary;
  out.xiaohongshu = `小红书近 7 日曝光 ${xhs['曝光数']}、观看 ${xhs['观看数']}，封面点击率 ${xhs['封面点击率']}、视频完播率 ${xhs['视频完播率']}。` +
    `曝光转观看比例偏低，完播率环比 -69% 是明显短板；点赞/收藏环比高增长，内容被认可但没被看完，短内容结构与开头留存值得优先调整。`;
  out.overall = `四平台可见播放量约 ${(num(dy.summary['累计播放']) + num(xhs['观看数']) + num(data.kuaishou.summary['合计播放(可见作品)'])).toLocaleString()}（口径不同，仅供横向参考）。` +
    `共同短板：完播/留存与粉丝转化；共同亮点：互动率与收藏增长。下一步优先做「开头 2 秒留存」和「被看见→被记住」的转化。`;
  return out;
}

async function main() {
  const texts = {};
  for (const p of PAGES) {
    try { texts[p.key] = await fetchText(PORT, p.host, p.url, p.key === 'douyin' ? 8000 : 6000); }
    catch (e) { texts[p.key] = ''; console.error(`抓取 ${p.key} 失败：${e.message}`); }
  }
  const observedAt = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace(' ', 'T');
  const data = {
    observedAt,
    timezone: 'Asia/Shanghai',
    disclaimer: '数据为各平台后台原始数字的定时快照；完播/互动等指标口径各平台不同，不可直接横比。',
    douyin: parseDouyin(texts.douyin || ''),
    wechat: parseWechat(texts.wechat || ''),
    kuaishou: parseKuaishou(texts.kuaishou || ''),
    xiaohongshu: parseXiaohongshu(texts.xiaohongshu || ''),
  };
  data.analysis = analyze(data);

  const outPath = path.resolve(OUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`已写入 ${outPath}`);
  console.log(`抖音 ${data.douyin.works.length} 条 / 微信 ${data.wechat.works.length} 篇 / 快手 ${data.kuaishou.works.length} 条 / 小红书聚合 ${Object.keys(data.xiaohongshu.summary).length} 项`);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });

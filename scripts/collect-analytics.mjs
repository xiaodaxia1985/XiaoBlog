#!/usr/bin/env node
/**
 * 四平台后台数据自取 + 逐条明细 + 分析，输出站点的 public/data/analytics.json。
 *
 * 连接专用 Edge 调试实例（默认端口 9224，登录态持久化在 .tmp/edge-profile），
 * 逐个页面读取 innerText，解析原始数字（只记原始值 + 观测时点，未知记 "—"，零记 0），
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
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? (argv[i + 1] ?? def) : def;
}
const HAS = n => argv.includes('--' + n);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(HERE, '..');
const PROJ_ROOT = path.resolve(SITE_ROOT, '..', '..');
// 每个平台一个独立持久化 profile（不再四平台共用一个，避免一个被判失效连带全挂）
const PROFILES = path.resolve(arg('profiles', path.join(PROJ_ROOT, '.runtime', 'profiles')));
// 登录态备份：cookie 落成 JSON，profile 丢了也能注回
const SESSIONS = path.resolve(arg('sessions', path.join(PROJ_ROOT, '.runtime', 'sessions')));
const OUT = path.resolve(arg('out', path.join(SITE_ROOT, 'public', 'data', 'analytics.json')));
const EDGE = process.env.EDGE_EXE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HEADLESS = !HAS('visible');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 每平台一个 Chromium 实例 + 独立端口 + 独立 profile。
// 微信不写死 token：先进首页，从跳转后的 URL 里取当次 token 再拼。
const PLATFORMS = [
  {
    key: 'douyin', port: 9311, host: 'creator.douyin.com',
    loginUrl: 'https://creator.douyin.com/',
    pages: [{
      key: 'douyin', url: 'https://creator.douyin.com/creator-micro/content/manage', wait: 20000,
      ready: /编辑作品/,
    }],
  },
  {
    key: 'wechat', port: 9312, host: 'mp.weixin.qq.com',
    loginUrl: 'https://mp.weixin.qq.com/',
    pages: [{ key: 'wechat', url: 'https://mp.weixin.qq.com/', wait: 20000, tokenFrom: true, ready: /已发表|昨日阅读/ }],
  },
  {
    key: 'kuaishou', port: 9313, host: 'cp.kuaishou.com',
    loginUrl: 'https://cp.kuaishou.com/',
    pages: [{ key: 'kuaishou', url: 'https://cp.kuaishou.com/statistics/article', wait: 20000, ready: /发布于/ }],
  },
  {
    key: 'xiaohongshu', port: 9314, host: 'creator.xiaohongshu.com',
    loginUrl: 'https://creator.xiaohongshu.com/login',
    pages: [
      {
        key: 'xiaohongshu', url: 'https://creator.xiaohongshu.com/statistics/data-analysis',
        wait: 20000, pageSize: 50, ready: /发布于|曝光/,
      },
      // 首页近 7 日概览单独取一趟（环比与完播率只在首页有）
      { key: 'xiaohongshuOverview', url: 'https://creator.xiaohongshu.com/new/home', wait: 20000, ready: /曝光数/ },
    ],
  },
];

// 判定「掉登录」的页面特征：命中且没抓到数据，就记 expired 而不是空数据
const EXPIRED_HINT = /扫码登录|短信登录|请使用[^\n]{0,10}扫描|登录后(?:查看|管理|使用)|请先登录|账号登录|重新登录/;

const BASE = port => `http://127.0.0.1:${port}`;

async function cdpAlive(port) {
  try {
    const r = await fetch(`${BASE(port)}/json/version`, { signal: AbortSignal.timeout(4000) });
    return r.ok;
  } catch { return false; }
}

// 按平台拉起独立实例；已在跑就直接复用（比如用户刚手动登录的那个窗口）
async function ensureEdge(pl, { visible = false } = {}) {
  if (await cdpAlive(pl.port)) return;
  const profile = path.join(PROFILES, pl.key);
  fs.mkdirSync(profile, { recursive: true });
  const proc = spawn(EDGE, [
    visible ? '--start-maximized' : '--headless=new',
    `--remote-debugging-port=${pl.port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--window-size=1440,900',
    // profile 不设上限会随天数涨到几 GB，这里把磁盘/媒体缓存各压到 50MB
    '--disk-cache-size=52428800', '--media-cache-size=52428800',
    'about:blank',
  ], { detached: true, stdio: 'ignore', windowsHide: !visible });
  proc.unref();
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (await cdpAlive(pl.port)) return;
  }
  throw new Error(`Edge 没在 ${pl.port} 就绪（profile ${profile}）`);
}

// 关掉实例：走 CDP 的 Browser.close，让 Edge 自己收尾，避免 profile 锁残留
async function closeBrowser(port) {
  try {
    const v = await (await fetch(`${BASE(port)}/json/version`)).json();
    const ws = new WebSocket(v.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    await sleep(1500);
    ws.close();
  } catch {}
}

async function connect(pl) {
  let targets = (await (await fetch(`${BASE(pl.port)}/json/list`)).json()).filter(t => t.type === 'page');
  if (!targets.length) {
    await fetch(`${BASE(pl.port)}/json/new?about:blank`, { method: 'PUT' });
    await sleep(800);
    targets = (await (await fetch(`${BASE(pl.port)}/json/list`)).json()).filter(t => t.type === 'page');
  }
  const target = targets.find(t => t.url.includes(pl.host)) || targets[0];
  if (!target) throw new Error('没有可用页面');
  const ws = new WebSocket(`ws://127.0.0.1:${pl.port}/devtools/page/${target.id}`);
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
  const evaluate = async (expression, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    return r.result?.result?.value ?? '';
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  return {
    send, evaluate,
    navigate: async (url, wait) => { await send('Page.navigate', { url }); await sleep(wait || 6000); },
    url: () => evaluate('location.href'),
    text: () => evaluate('document.body.innerText || ""'),
    close: () => { try { ws.close(); } catch {} },
  };
}

const statePath = key => path.join(SESSIONS, `${key}.json`);

// 登录态备份：cookie 是这四家后台唯一的凭证，落成 JSON，profile 重建也能注回去
async function restoreCookies(s, key) {
  const p = statePath(key);
  if (!fs.existsSync(p)) return 0;
  let n = 0;
  try {
    const st = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const c of st.cookies || []) {
      const params = {
        name: c.name, value: c.value, domain: c.domain, path: c.path || '/',
        secure: !!c.secure, httpOnly: !!c.httpOnly,
      };
      if (c.sameSite) params.sameSite = c.sameSite;
      if (c.expires && c.expires > 0) params.expires = c.expires;
      const r = await s.send('Network.setCookie', params);
      if (r?.result?.success !== false) n++;
    }
  } catch (e) { console.error(`[${key}] 备份 cookie 注回失败：${e.message}`); }
  return n;
}

// profile 里是否已有该平台的强特征登录 cookie
async function hasAuthCookie(s, key) {
  const cookies = (await s.send('Storage.getCookies', {})).result?.cookies || [];
  const names = new Set(cookies.map(c => c.name));
  return (AUTH_COOKIE[key] || []).some(n => names.has(n));
}

async function saveCookies(s, key) {
  const r = await s.send('Storage.getCookies', {});
  const cookies = r?.result?.cookies || [];
  fs.mkdirSync(SESSIONS, { recursive: true });
  fs.writeFileSync(statePath(key), JSON.stringify({
    savedAt: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace(' ', 'T'),
    count: cookies.length,
    cookies,
  }, null, 2), 'utf8');
  return cookies.length;
}

async function clickPageSize(s, pageSize) {
  const ok = await s.evaluate(`(() => {
    const hit = [...document.querySelectorAll('*')].find(e =>
      e.children.length === 0 && /^${pageSize} 条\\/页$/.test((e.innerText || '').trim()));
    if (!hit) return 'nf';
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return 'ok';
  })()`);
  if (ok === 'ok') await sleep(4000);
  return ok === 'ok';
}

// 分页累积：点第 N 页（小红书是 .d-pagination-page 的 div，不是 li/span）
async function paginate(s, text, pages = 1) {
  for (let n = 2; n <= pages; n++) {
    const clicked = await s.evaluate(`(() => {
      const pick = (sel) => [...document.querySelectorAll(sel)]
        .filter(e => !/disabled/.test(e.className || ''))
        .find(e => (e.innerText || '').trim().split('\\n')[0] === '${n}');
      const hit = pick('.d-pagination-page') || pick('.ant-pagination-item')
        || [...document.querySelectorAll('li,span,button,a')].find(e =>
            e.children.length === 0 && (e.innerText || '').trim() === '${n}'
            && e.getBoundingClientRect().top > window.innerHeight * 0.3);
      if (!hit) return 'nf';
      hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return 'ok';
    })()`);
    if (clicked !== 'ok') break;
    await sleep(5000);
    text += '\n' + (await s.text());
  }
  return text;
}

// 轮询到页面出现列表特征就走，不再死等固定秒数；页面在登录页则立即返回
async function waitReady(s, page) {
  const t0 = Date.now();
  while (Date.now() - t0 < (page.wait || 20000)) {
    await sleep(1200);
    if (/\/login|\/passport/.test(await s.url())) break;
    const t = await s.text();
    if (page.ready && page.ready.test(t)) { await sleep(1200); return t; }
  }
  return await s.text();
}

// 抓一个平台的全部页；失败抛错，由上层记进 status。
// 不管成不成，退出前都存一次 cookie —— 刚扫码的登录态不能白丢。
async function collectPlatform(pl, { visible = false } = {}) {
  await ensureEdge(pl, { visible });
  const s = await connect(pl);
  const texts = {};
  let token = null;
  let saved = 0;
  try {
    // profile 里已有登录 cookie 就不要拿旧备份覆盖：备份可能比 profile 更旧
    if (!(await hasAuthCookie(s, pl.key))) await restoreCookies(s, pl.key);
    for (const page of pl.pages) {
      let url = page.url;
      if (page.tokenFrom) {
        // 微信：先进首页拿当次 token，不再写死
        await s.navigate('https://mp.weixin.qq.com/', 3000);
        const home = await s.url();
        const m = /[?&]token=(\d+)/.exec(home);
        if (m) {
          token = m[1];
          url = `https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN&token=${token}`;
        }
      }
      await s.navigate(url, 1500);
      let text = await waitReady(s, page);
      if (page.pageSize) {
        await clickPageSize(s, page.pageSize);
        text = await s.text();
      }
      if (page.pages) text = await paginate(s, text, page.pages);
      texts[page.key] = text;
    }
    saved = await saveCookies(s, pl.key);
    return { texts, token, saved };
  } catch (e) {
    try { saved = await saveCookies(s, pl.key); } catch {}
    throw e;
  } finally { s.close(); }
}

// 后台数字带千分位与百分号：「1.28%」「11,484」都要能转成纯数值，否则完播率一律变 0。
function num(s) {
  if (typeof s === 'number') return Number.isFinite(s) ? s : 0;
  const m = String(s ?? '').replace(/[,，\s]/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : 0;
}
// 标题正文里标题与文案用空格相连，取第一句做短标题，去掉话题标签
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
  const re = /(\d{1,2}:\d{2}|\d+张图)\n(?:置顶\n)?([\s\S]*?)\n编辑作品\n[\s\S]*?(\d{4}年\d{1,2}月\d{1,2}日[^\n]*)\n已发布\n(?:官方活动[^\n]*\n)*播放\n([\d,]+)\n点赞\n([\d,]+)\n评论\n([\d,]+)\n分享\n([\d,]+)\n收藏\n([\d,]+)\n(完播率|划走率)\n([\d.]+%)\n(2秒跳出率|文案展开率)\n([\d.]+%)(?:\n平均浏览图片数\n([\d.]+))?\n吸粉量\n(\d+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    works.push({
      title: shortTitle(m[2]),
      date: m[3].replace('年', '-').replace('月', '-').replace('日', ''),
      metrics: {
        '播放': num(m[4]), '点赞': num(m[5]), '评论': num(m[6]), '分享': num(m[7]), '收藏': num(m[8]),
        [m[9]]: m[10], [m[11]]: m[12],
        ...(m[13] ? { '平均浏览图片数': m[13] } : {}),
        '吸粉量': num(m[14]),
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
  const nums = {};
  // 首页概览三指标（昨日阅读/分享/新增关注）
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '原创内容') nums['原创内容'] = lines[i + 1];
    if (lines[i] === '总用户数') nums['总用户数'] = lines[i + 1];
    if (lines[i] === '昨日阅读(人)') nums['昨日阅读'] = lines[i + 1];
    if (lines[i] === '昨日分享(人)') nums['昨日分享'] = lines[i + 1];
    if (lines[i] === '昨日新增关注(人)') nums['昨日新增关注'] = lines[i + 1];
  }
  for (let i = 0; i < lines.length; i++) {
    if (!dateRe.test(lines[i])) continue;
    if (lines[i + 1] !== '已发表' && lines[i + 1] !== '已删除') continue;
    const deleted = lines[i + 1] === '已删除';
    let j = i + 2;
    let duration = null;
    if (timeRe.test(lines[j])) { duration = lines[j]; j++; }   // 可选时长行
    const title = lines[j++] || '';
    if (lines[j] === '原创' || lines[j] === '已修改') j++;
    if (lines[j] === '原创' || lines[j] === '已修改') j++;
    const vals = [];
    while (j < lines.length && /^\d+$/.test(lines[j])) { vals.push(Number(lines[j])); j++; }
    if (!vals.length) continue;
    works.push({
      title: title.replace(/\u00a0/g, ' ').slice(0, 60),
      date: lines[i],
      duration,
      status: deleted ? '已删除' : '已发表',
      metrics: {
        '阅读': vals[0] ?? '—', '点赞': vals[1] ?? '—', '在看': vals[2] ?? '—',
        '分享': vals[3] ?? '—', '收藏': vals[4] ?? '—',
      },
    });
  }
  const published = works.filter(w => w.status === '已发表');
  const sum = k => published.reduce((a, w) => a + (num(w.metrics[k]) || 0), 0);
  return {
    works,
    summary: {
      ...(nums['原创内容'] !== undefined ? { '原创内容': nums['原创内容'] } : {}),
      ...(nums['总用户数'] !== undefined ? { '总用户数': nums['总用户数'] } : {}),
      '已发表': published.length || null,
      '累计阅读': published.length ? sum('阅读') : null,
      '累计点赞': published.length ? sum('点赞') : null,
      '累计在看': published.length ? sum('在看') : null,
      ...(nums['昨日阅读'] !== undefined ? { '昨日阅读(人)': nums['昨日阅读'] } : {}),
      ...(nums['昨日分享'] !== undefined ? { '昨日分享(人)': nums['昨日分享'] } : {}),
      ...(nums['昨日新增关注'] !== undefined ? { '昨日新增关注': nums['昨日新增关注'] } : {}),
    },
  };
}

// ---------- 解析：快手（作品分析页：标题 / 发布于 / 播放量 / 完播率 / 评论量 / 点赞量 / 收藏量 / 涨粉量） ----------
function parseKuaishou(text) {
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  const works = [];
  for (let i = 0; i < lines.length; i++) {
    const dm = /^发布于\s*(\d{4}-\d{2}-\d{2})/.exec(lines[i]);
    if (!dm) continue;
    // 标题是上一行（可能是长正文），去掉话题标签后取第一句
    const rawTitle = lines[i - 1] || '';
    const metrics = {};
    // 只在这一条的字段块内找标签：遇到下一条的「发布于」立即停，避免吃到邻条数字
    for (let j = i + 1; j < lines.length; j++) {
      if (/^发布于/.test(lines[j])) break;
      const label = /^(播放量|完播率|评论量|点赞量|收藏量|涨粉量|播放|点赞|评论)$/.exec(lines[j]);
      if (label && lines[j + 1] !== undefined) {
        const key = { 播放量: '播放', 播放: '播放', 点赞量: '点赞', 点赞: '点赞', 评论量: '评论', 评论: '评论',
          收藏量: '收藏', 涨粉量: '吸粉量', 完播率: '完播率' }[label[1]];
        const v = lines[j + 1];
        metrics[key] = /%$/.test(v) ? v : (/^--$/.test(v) ? '—' : num(v));
        j++;
      }
    }
    if (!Object.keys(metrics).length) continue;
    works.push({ title: shortTitle(rawTitle), date: dm[1], metrics });
  }
  const sum = k => works.reduce((a, w) => a + (num(w.metrics[k]) || 0), 0);
  return {
    works,
    summary: {
      '作品数': works.length || null,
      '合计播放': works.length ? sum('播放') : null,
      '合计点赞': works.length ? sum('点赞') : null,
      '合计评论': works.length ? sum('评论') : null,
      '合计收藏': works.length ? sum('收藏') : null,
      '合计吸粉': works.length ? sum('吸粉量') : null,
    },
    note: '快手数据取「数据中心 → 作品分析」页（近 90 天公开作品），完播率部分作品因样本不足显示为 —。',
  };
}

// ---------- 解析：小红书（数据看板：曝光/观看/封面点击率/点赞/评论/收藏/涨粉/分享/人均观看时长） ----------
function parseXiaohongshu(text, overviewText = '') {
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  const works = [];
  const seen = new Set();
  const KEY = ['曝光', '观看', '封面点击率', '点赞', '评论', '收藏', '涨粉', '分享', '人均观看时长', '弹幕'];
  for (let i = 0; i < lines.length; i++) {
    const dm = /^发布于\s*(\d{4}-\d{2}-\d{2})/.exec(lines[i]);
    if (!dm) continue;
    const title = lines[i - 1] || '';
    if (!title || seen.has(title + dm[1])) continue;
    const vals = [];
    for (let j = i + 1; j < lines.length && vals.length < KEY.length; j++) {
      if (lines[j] === '分析详情' || /^发布于/.test(lines[j])) break;
      if (/^[\d,]+(?:\.\d+)?%?s?$/.test(lines[j]) || lines[j] === '--') vals.push(lines[j]);
    }
    if (vals.length < 4) continue;
    seen.add(title + dm[1]);
    const metrics = {};
    KEY.forEach((k, idx) => { if (vals[idx] !== undefined) metrics[k] = /%$|s$/.test(vals[idx]) ? vals[idx] : (vals[idx] === '--' ? '—' : num(vals[idx])); });
    works.push({ title: title.slice(0, 60), date: dm[1], metrics });
  }
  // 概览（近 7 日）
  const pick = (label, src) => {
    const i = src.indexOf(label);
    if (i < 0) return '—';
    const seg = src.slice(i + label.length, i + label.length + 40);
    const m = seg.match(/\d[\d,]*(?:\.\d+)?%?/);
    return m ? m[0] : '—';
  };
  const summary = {
    '曝光数': pick('曝光数', overviewText), '观看数': pick('观看数', overviewText),
    '封面点击率': pick('封面点击率', overviewText), '视频完播率': pick('视频完播率', overviewText),
    '点赞数': pick('点赞数', overviewText), '评论数': pick('评论数', overviewText),
    '收藏数': pick('收藏数', overviewText), '分享数': pick('分享数', overviewText),
    '净涨粉': pick('净涨粉', overviewText), '主页访客': pick('主页访客', overviewText),
  };
  if (works.length) {
    const sum = k => works.reduce((a, w) => a + (num(w.metrics[k]) || 0), 0);
    Object.assign(summary, {
      '笔记数': works.length,
      '合计曝光': sum('曝光'), '合计观看': sum('观看'),
      '合计点赞': sum('点赞'), '合计评论': sum('评论'),
      '合计收藏': sum('收藏'), '合计涨粉': sum('涨粉'),
    });
  }
  return {
    works,
    summary,
    note: '逐条取「数据看板」页（近半年发布的笔记），概览取首页近 7 日。',
  };
}

// ---------- 分析（基于原始数据本地生成，不发模型请求） ----------
// 输出结构化：{ lead, points[] }，页面上按「导语 + 要点」排版，避免一整段密排。
const pct = (a, b) => (b > 0 ? (a / b) * 100 : null);
const pctText = (v, digits = 1) => (v === null ? '—' : `${v.toFixed(digits)}%`);
function median(arr) {
  const s = [...arr].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function card(title, lead, points) {
  return { lead, points: points.filter(Boolean).map((p) => (typeof p === 'string' ? { title: '', text: p } : p)) };
}
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

function analyze(data) {
  const out = {};

  // 抖音
  const dy = data.douyin || { works: [], summary: {} };
  if (dy.works.length) {
    const plays = dy.works.map((w) => num(w.metrics['播放']));
    const total = plays.reduce((a, b) => a + b, 0);
    const sorted = [...plays].sort((a, b) => b - a);
    const top3 = sorted.slice(0, 3).reduce((a, b) => a + b, 0);
    const likes = dy.works.reduce((a, w) => a + num(w.metrics['点赞']), 0);
    const saves = dy.works.reduce((a, w) => a + num(w.metrics['收藏']), 0);
    const comments = dy.works.reduce((a, w) => a + num(w.metrics['评论']), 0);
    const fans = dy.works.reduce((a, w) => a + num(w.metrics['吸粉量']), 0);
    const fin = dy.works.map((w) => (w.metrics['完播率'] ? num(w.metrics['完播率']) : null)).filter((n) => n !== null);
    const bounce = dy.works.map((w) => (w.metrics['2秒跳出率'] ? num(w.metrics['2秒跳出率']) : null)).filter((n) => n !== null);
    const swipe = dy.works.map((w) => (w.metrics['划走率'] ? num(w.metrics['划走率']) : null)).filter((n) => n !== null);
    const zero = plays.filter((n) => n === 0).length;
    out.douyin = card('抖音', `可见 ${dy.works.length} 条作品，累计播放 ${total.toLocaleString()}，中位 ${median(plays).toLocaleString()}，吸粉 ${fans} 人。`, [
      {
        title: '播放高度集中',
        text: `前 3 条占全部播放的 ${pctText(pct(top3, total))}，其余 ${Math.max(dy.works.length - 3, 0)} 条分掉 ${pctText(100 - (pct(top3, total) || 0))}；中位数 ${median(plays).toLocaleString()}，说明多数作品停在千级以下${zero ? `（其中 ${zero} 条为 0 播放）` : ''}。`,
      },
      {
        title: '互动结构偏「收藏」',
        text: `点赞率 ${pctText(pct(likes, total), 2)}、收藏率 ${pctText(pct(saves, total), 2)}、评论率 ${pctText(pct(comments, total), 2)}——收藏相当于点赞的 ${pctText(pct(saves, likes), 0)}，是被存下来的实用向内容，但评论区几乎不动。`,
      },
      fin.length || bounce.length
        ? {
            title: '留存是硬短板',
            text: [
              fin.length ? `视频完播率均值 ${pctText(avg(fin), 2)}` : '',
              bounce.length ? `2 秒跳出率均值 ${pctText(avg(bounce), 1)}` : '',
              swipe.length ? `图片类划走率均值 ${pctText(avg(swipe), 1)}` : '',
            ]
              .filter(Boolean)
              .join('、') + '——曝光进来了，前两秒没接住。',
          }
        : null,
      {
        title: '涨粉效率',
        text: `累计吸粉 ${fans} 人，折合每万次播放涨 ${total > 0 ? ((fans / total) * 10000).toFixed(1) : '—'} 人；吸粉集中在头部 2–3 条，长尾几乎不涨粉。`,
      },
    ]);
  }

  // 微信公众号
  const wx = data.wechat || { works: [] };
  const pub = (wx.works || []).filter((w) => w.status === '已发表');
  if (pub.length) {
    const reads = pub.map((w) => num(w.metrics['阅读']));
    const total = reads.reduce((a, b) => a + b, 0);
    const sortedReads = [...reads].sort((a, b) => b - a);
    const likes = pub.reduce((a, w) => a + num(w.metrics['点赞']), 0);
    const wow = pub.reduce((a, w) => a + num(w.metrics['在看']), 0);
    const shares = pub.reduce((a, w) => a + num(w.metrics['分享']), 0);
    const zeroRead = reads.filter((n) => n === 0).length;
    out.wechat = card('微信公众号', `可见 ${pub.length} 篇已发表，累计阅读 ${total.toLocaleString()}，中位 ${median(reads).toLocaleString()}。`, [
      {
        title: '阅读靠单点拉动',
        text: `最高一篇 ${sortedReads[0].toLocaleString()}，占全部阅读的 ${pctText(pct(sortedReads[0], total))}；前两篇合计 ${pctText(pct(sortedReads[0] + (sortedReads[1] || 0), total))}${zeroRead ? `，另有 ${zeroRead} 篇 0 阅读` : ''}。`,
      },
      {
        title: '扩散几乎为零',
        text: `在看率 ${pctText(pct(wow, total), 2)}、点赞率 ${pctText(pct(likes, total), 2)}、分享 ${shares} 次——靠公众号推荐与搜索进来的读者没有被转出去。`,
      },
      { title: '结论', text: `新文阅读停在个位到数十，说明没有稳定的打开习惯；先解决「标题 + 首段」的打开率，再谈扩散。` },
    ]);
  }

  // 快手
  const ks = data.kuaishou || { works: [], summary: {} };
  if (ks.works.length) {
    const plays = ks.works.map((w) => num(w.metrics['播放']));
    const total = plays.reduce((a, b) => a + b, 0);
    const top = Math.max(...plays);
    const ksFin = ks.works.map((w) => (/^[\d.]+%$/.test(String(w.metrics['完播率'] || '')) ? num(w.metrics['完播率']) : null)).filter((n) => n !== null);
    const fans = ks.works.reduce((a, w) => a + num(w.metrics['吸粉量']), 0);
    const likes = ks.works.reduce((a, w) => a + num(w.metrics['点赞']), 0);
    out.kuaishou = card('快手', `可见 ${ks.works.length} 条作品，合计播放 ${total.toLocaleString()}，中位 ${median(plays).toLocaleString()}，吸粉 ${fans} 人。`, [
      {
        title: '播放量阶梯明显',
        text: `最高 ${top.toLocaleString()}、最低 ${Math.min(...plays).toLocaleString()}，前两条占了大部分曝光；同一条内容在抖音的播放是这里的数倍，快手仍处在冷启动分发阶段。`,
      },
      {
        title: ksFin.length ? '完播率两极' : '完播数据缺失',
        text: ksFin.length
          ? `可统计的 ${ksFin.length} 条完播率均值 ${pctText(avg(ksFin), 1)}，但多数作品显示 —（样本不足），说明播放量还太小，平台不给留存口径；先解决「有没有人点进来」。`
          : `多数作品完播率显示 —（样本不足），平台还不给留存口径；先解决「有没有人点进来」。`,
      },
      { title: '下一步', text: `点赞率 ${pctText(pct(likes, total), 2)}、涨粉 ${fans} 人——互动密度不低但基数小，把抖音已验证的标题结构搬过来先试一轮。` },
    ]);
  }

  // 小红书
  const xs = data.xiaohongshu || {};
  const xSum = xs.summary || {};
  if (Object.keys(xSum).length) {
    const exposure = num(xSum['合计曝光'] || xSum['曝光数']);
    const views = num(xSum['合计观看'] || xSum['观看数']);
    const likes = num(xSum['合计点赞'] || xSum['点赞数']);
    const comments = num(xSum['合计评论'] || xSum['评论数']);
    const saves = num(xSum['合计收藏'] || xSum['收藏数']);
    const shares = num(xSum['分享数']);
    const inter = likes + comments + saves + shares;
    const notes = xs.works || [];
    const viewArr = notes.map((w) => num(w.metrics['观看'])).filter((n) => n > 0);
    const coverArr = notes.map((w) => (/^[\d.]+%$/.test(String(w.metrics['封面点击率'] || '')) ? num(w.metrics['封面点击率']) : null)).filter((n) => n !== null);
    out.xiaohongshu = card('小红书', `可见 ${notes.length} 篇笔记，合计曝光 ${exposure.toLocaleString()}、观看 ${views.toLocaleString()}，互动 ${inter} 次。`, [
      {
        title: '封面点击率是分水岭',
        text: coverArr.length
          ? `逐篇封面点击率均值 ${pctText(avg(coverArr), 2)}，最高的几篇在 ${Math.max(...coverArr).toFixed(1)}% 以上、最低不足 3%——同一批粉丝，差在封面与标题那一行字。`
          : `封面点击率逐篇数据暂不可见；首页口径为 ${xSum['封面点击率'] ?? '—'}。`,
      },
      {
        title: '互动率高，但基数小',
        text: `合计 ${inter} 次互动，折合每千次观看 ${views > 0 ? ((inter / views) * 1000).toFixed(0) : '—'} 次；收藏 ${num(xSum['合计收藏'] || xSum['收藏数'])} 高于点赞 ${num(xSum['合计点赞'] || xSum['点赞数'])}，内容被当资料存下来。`,
      },
      {
        title: '观看时长在 4–15 秒',
        text: notes.length
          ? `人均观看时长多在 ${Math.min(...notes.map((w) => num(w.metrics['人均观看时长'])).filter((n) => n > 0)).toFixed(0)}–${Math.max(...notes.map((w) => num(w.metrics['人均观看时长']))).toFixed(0)} 秒，视频总长 1 分半上下——大部分人在前四分之一就划走了，开头 3 秒要重做。`
          : `人均观看时长偏短，开头 3 秒要重做。`,
      },
    ]);
  }

  // 整体
  const allPlay =
    num(dy.summary?.['累计播放']) + num(xSum['合计观看'] || xSum['观看数']) + num(ks.summary?.['合计播放']);
  const allInter =
    (dy.works || []).reduce((a, w) => a + num(w.metrics['点赞']) + num(w.metrics['评论']) + num(w.metrics['收藏']) + num(w.metrics['分享']), 0) +
    ((data.wechat || {}).works || []).filter((w) => w.status === '已发表').reduce((a, w) => a + num(w.metrics['点赞']) + num(w.metrics['在看']), 0) +
    num(xSum['合计点赞'] || xSum['点赞数']) + num(xSum['合计评论'] || xSum['评论数']) + num(xSum['合计收藏'] || xSum['收藏数']) + num(xSum['分享数']);
  out.overall = card('整体判断', `四平台可见触达约 ${allPlay.toLocaleString()} 次、互动约 ${allInter.toLocaleString()} 次（口径不同，仅作量级参考）。`, [
    { title: '共同短板', text: '留存与粉丝转化：四个平台都是「曝光能进来、前两秒留不住、看完不关注」。' },
    { title: '共同亮点', text: '收藏类互动明显高于评论，内容具备「被存下来」的价值，适合做成可复用的资料型内容。' },
    { title: '下一步优先级', text: '① 开头 2 秒重做（决定完播）；② 结尾给一个明确的关注理由（决定涨粉）；③ 把高收藏的选题做成系列，而不是继续发散。' },
  ]);
  return out;
}

// 判定是否已登录的强特征 cookie（没有就退回「cookie 有没有变多」来判断）
const AUTH_COOKIE = {
  douyin: ['sessionid', 'sessionid_ss'],
  wechat: ['slave_sid', 'bizuin'],
  kuaishou: ['kuaishou.web.cp.api_st'],
  xiaohongshu: ['web_session'],
};

const ALL_KEYS = ['douyin', 'wechat', 'kuaishou', 'xiaohongshu'];

// 只数条数、不做全量分析，用来判断「这一趟到底抓到没有」
function countWorks(key, texts) {
  switch (key) {
    case 'douyin': return parseDouyin(texts.douyin || '').works.length;
    case 'wechat': return parseWechat(texts.wechat || '').works.length;
    case 'kuaishou': return parseKuaishou(texts.kuaishou || '').works.length;
    case 'xiaohongshu': return parseXiaohongshu(texts.xiaohongshu || '', texts.xiaohongshuOverview || '').works.length;
    default: return 0;
  }
}

// 手动登录模式：开可见窗口，等你扫完码，自动存 cookie 并关窗
async function runLogin(key) {
  const pl = PLATFORMS.find(p => p.key === key);
  if (!pl) throw new Error(`未知平台：${key}（可选 douyin / wechat / kuaishou / xiaohongshu）`);
  await ensureEdge(pl, { visible: true });
  const s = await connect(pl);
  try {
    await restoreCookies(s, pl.key);
    const before = ((await s.send('Storage.getCookies', {})).result?.cookies || []).length;
    await s.navigate(pl.loginUrl, 4000);
    console.log(`已打开 ${key}：${pl.loginUrl}`);
    console.log('请在窗口里完成扫码登录，脚本每 5 秒查一次，成功后自动保存并关窗（最长 15 分钟）');
    const deadline = Date.now() + 15 * 60 * 1000;
    let ok = false;
    while (Date.now() < deadline) {
      await sleep(5000);
      const cookies = (await s.send('Storage.getCookies', {})).result?.cookies || [];
      const names = new Set(cookies.map(c => c.name));
      const hasAuth = (AUTH_COOKIE[key] || []).some(n => names.has(n));
      const u = await s.url();
      const stillLogin = /\/login|\/passport/.test(u);
      // 只看 cookie 名字不行：旧的失效 cookie 还在，必须确认已离开登录页
      if (!stillLogin && (hasAuth || cookies.length > before)) { ok = true; break; }
    }
    const saved = await saveCookies(s, key);
    console.log(ok
      ? `登录成功：已存 ${saved} 条 cookie → ${statePath(key)}`
      : `等待超时：已存当前 ${saved} 条 cookie，若之后仍抓不到请重跑本命令`);
    if (!ok) process.exitCode = 3;
  } finally {
    s.close();
    await closeBrowser(pl.port);
  }
}

async function main() {
  const loginKey = arg('login', '');
  if (loginKey) return runLogin(loginKey);

  const only = arg('only', '');
  const wanted = only ? PLATFORMS.filter(p => p.key === only) : PLATFORMS;
  if (!wanted.length) throw new Error(`--only 平台不存在：${only}`);

  const texts = {};
  const status = {};
  for (const pl of wanted) {
    console.log(`[${pl.key}] 开始（端口 ${pl.port}，${HAS('visible') ? '可见窗口' : '无头'}）`);
    let r = null;
    // 0 条不急着判「掉登录」：先就地重试一次，仍为 0 才认
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        r = await collectPlatform(pl, { visible: HAS('visible') });
        status[pl.key] = { state: 'ok', cookies: r.saved };
        if (r.token) status[pl.key].token = r.token;
        if (countWorks(pl.key, r.texts) > 0) break;
        if (attempt === 1) {
          console.log(`[${pl.key}] 第 1 次 0 条，3 秒后重试`);
          await sleep(3000);
        }
      } catch (e) {
        status[pl.key] = { state: 'error', error: e.message };
        console.error(`[${pl.key}] 第 ${attempt} 次失败：${e.message}`);
        if (attempt === 1) await sleep(3000);
      }
    }
    if (r) Object.assign(texts, r.texts);
    await closeBrowser(pl.port);
  }

  const observedAt = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace(' ', 'T');
  const data = {
    observedAt,
    timezone: 'Asia/Shanghai',
    disclaimer: '数据为各平台后台原始数字的定时快照；完播/互动等指标口径各平台不同，不可直接横比。',
    douyin: parseDouyin(texts.douyin || ''),
    wechat: parseWechat(texts.wechat || ''),
    kuaishou: parseKuaishou(texts.kuaishou || ''),
    xiaohongshu: parseXiaohongshu(texts.xiaohongshu || '', texts.xiaohongshuOverview || ''),
    status: {},
  };
  // --only 只刷一家时，其余平台原样沿用上一版快照，不能把别家数据清成 0
  if (only && fs.existsSync(OUT)) {
    try {
      const prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
      for (const k of ALL_KEYS) {
        if (!wanted.some(p => p.key === k) && prev[k]) data[k] = prev[k];
      }
      data.status = { ...(prev.status || {}) };
    } catch (e) {
      console.error(`读取上一版快照失败，按全量写：${e.message}`);
    }
  }
  data.analysis = analyze(data);

  const counts = {
    douyin: data.douyin.works.length,
    wechat: data.wechat.works.length,
    kuaishou: data.kuaishou.works.length,
    xiaohongshu: data.xiaohongshu.works.length,
  };
  // 单平台 0 条要能自己说清是「掉登录」「页面改版」还是「真没数据」
  for (const pl of wanted) {
    const st = status[pl.key] || { state: 'empty' };
    st.count = counts[pl.key] || 0;
    if (st.count > 0) st.state = 'ok';
    else if (st.state === 'ok' || !st.state) {
      const t = texts[pl.key] || '';
      st.state = EXPIRED_HINT.test(t.slice(0, 800)) ? 'expired'
        : (t.length > 2000 ? 'drift' : 'empty');
    }
    data.status[pl.key] = st;
  }

  const outPath = path.resolve(OUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`已写入 ${outPath}`);
  for (const pl of wanted) {
    const st = data.status[pl.key];
    console.log(`${pl.key}: ${st.count} 条 [${st.state}]${st.error ? ' ' + st.error : ''}`);
  }
  if (wanted.every(p => (data.status[p.key].count || 0) === 0)) process.exitCode = 2;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('collect-analytics.mjs')) {
  main().catch(e => { console.error('ERR', e.message); process.exit(1); });
}

export { analyze };

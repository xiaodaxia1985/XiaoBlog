#!/usr/bin/env node
/**
 * 抖音视频直链解析 + 同源代理
 *
 * 站点里不存任何一个视频文件，播放器的 src 指向本服务：
 *   GET /video?vid=7710583226288344354   → 302/流式返回成片
 * 解析靠无头 Chrome 打开抖音视频页，抓 aweme detail 里本视频的 h264 720p 档
 * （`normal_720_0`，Douyin Web 唯一给的 h264 档；1080 档只有 h265，Chrome 未必能解）。
 *
 * 直链是签名 URL，几小时后会失效；这里带 TTL 缓存，过期自动重解析。
 * 抖音 CDN 校验 Referer，浏览器直连会被 403，所以这里做流式代理（支持 Range，可拖动进度）。
 *
 * 启动：node tools/video-resolver.mjs        （默认 127.0.0.1:4181）
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire('E:/works/New Journal/个人商业实战/.runtime/node_modules/');
const WebSocket = require('ws');

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.VIDEO_RESOLVER_PORT || 4181);
const TTL = 40 * 60 * 1000;              // 直链缓存 40 分钟，过期重解析
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const REFERER = 'https://www.douyin.com/';
// 无头 Chrome 的临时 profile：默认放仓库 .tmp 下，换机器用 CDP_PROFILE 指过去
const PROFILE = process.env.CDP_PROFILE || fileURLToPath(new URL('../.tmp/cdp-resolve', import.meta.url));

const cache = new Map();                  // vid -> { url, at }
const inflight = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function resolveDirect(vid) {
  const port = 9400 + Math.floor(Math.random() * 60);
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`,
    '--user-data-dir=' + PROFILE,
    '--window-size=1280,900', `https://www.douyin.com/video/${vid}`,
  ], { stdio: 'ignore' });
  try {
    let tab = null;
    for (let i = 0; i < 80 && !tab; i++) {
      await sleep(200);
      try { tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page'); } catch {}
    }
    if (!tab) throw new Error('chrome 未启动');
    const ws = new WebSocket(tab.webSocketDebuggerUrl, { maxPayload: 512 * 1024 * 1024 });
    await new Promise((r) => ws.on('open', r));
    let seq = 0; const pend = new Map(); const bodies = new Set(); let aweme = null;
    ws.on('message', async (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
      if (m.method === 'Network.responseReceived') {
        const r = m.params.response;
        if (/json/i.test(r.mimeType || '') && /aweme|detail|iteminfo/i.test(r.url)) bodies.add(m.params.requestId);
      }
    });
    const send = (method, params = {}) => new Promise((r) => { const i = ++seq; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Network.enable');
    const t0 = Date.now();
    while (Date.now() - t0 < 25000 && !aweme) {
      await sleep(400);
      for (const rid of [...bodies]) {
        if (aweme) break;
        const r = await send('Network.getResponseBody', { requestId: rid });
        bodies.delete(rid);
        if (!r.result?.body?.includes('play_addr')) continue;
        let j; try { j = JSON.parse(r.result.body); } catch { continue; }
        const stack = [j];
        while (stack.length) {
          const o = stack.pop();
          if (!o || typeof o !== 'object') continue;
          if (Array.isArray(o)) { for (const v of o) stack.push(v); continue; }
          if (String(o.aweme_id) === String(vid) && o.video?.play_addr) { aweme = o; break; }
          for (const k in o) if (typeof o[k] === 'object') stack.push(o[k]);
        }
      }
    }
    ws.close();
    if (!aweme) throw new Error('没抓到 play_addr');
    const gears = (aweme.video.bit_rate || []).map((b) => b);
    const h264 = gears.find((b) => b.gear_name === 'normal_720_0') || gears.find((b) => b.gear_name === 'low_720_0');
    const url = (h264 || aweme.video).play_addr.url_list[0];
    return { url, gear: h264?.gear_name || 'default' };
  } finally { proc.kill(); }
}

async function direct(vid) {
  const hit = cache.get(vid);
  if (hit && Date.now() - hit.at < TTL) return hit.url;
  if (inflight.has(vid)) return inflight.get(vid);
  const p = resolveDirect(vid).then(({ url, gear }) => {
    cache.set(vid, { url, at: Date.now() });
    console.log(`[resolve] ${vid} → ${gear} …${url.slice(-40)}`);
    return url;
  }).finally(() => inflight.delete(vid));
  inflight.set(vid, p);
  return p;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Range,Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length,Content-Range,Accept-Ranges');

  if (url.pathname === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, cached: [...cache.keys()] })); }

  if (url.pathname === '/warm') {
    const vid = (url.searchParams.get('vid') || '').trim();
    if (!/^\d{15,20}$/.test(vid)) { res.writeHead(400); return res.end('bad vid'); }
    try { await direct(vid); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); }
    catch (e) { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: e.message })); }
    return;
  }

  if (url.pathname === '/video') {
    const vid = (url.searchParams.get('vid') || '').trim();
    if (!/^\d{15,20}$/.test(vid)) { res.writeHead(400); return res.end('bad vid'); }
    let src;
    try { src = await direct(vid); } catch (e) { res.writeHead(502); return res.end('resolve failed: ' + e.message); }
    const headers = { 'user-agent': UA, referer: REFERER };
    if (req.headers.range) headers.range = req.headers.range;
    try {
      const upstream = await fetch(src, { headers, redirect: 'follow' });
      if (!upstream.ok && upstream.status !== 206) { res.writeHead(502); return res.end('upstream ' + upstream.status); }
      const h = {
        'content-type': upstream.headers.get('content-type') || 'video/mp4',
        'accept-ranges': 'bytes',
        'cache-control': 'public, max-age=600',
      };
      for (const k of ['content-length', 'content-range']) { const v = upstream.headers.get(k); if (v) h[k] = v; }
      res.writeHead(upstream.status, h);
      const body = upstream.body ? Readable.fromWeb(upstream.body) : null;
      if (req.method === 'HEAD') { body?.destroy(); return res.end(); }
      if (!body) return res.end();
      body.pipe(res);
      req.on('close', () => body.destroy?.());
    } catch (e) { res.writeHead(502); res.end('proxy failed: ' + e.message); }
    return;
  }

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  res.writeHead(404); res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => console.log(`video-resolver on http://127.0.0.1:${PORT}/video?vid=<douyin video id>`));

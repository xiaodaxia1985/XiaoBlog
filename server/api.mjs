#!/usr/bin/env node
/**
 * XiaoBlog 数据统计只读 API：给站点 / 外部读取每天各平台数据。
 * 只监听 127.0.0.1，由 nginx 反代 /api/ 对外；数据可公开，无写接口。
 *   GET /api/health
 *   GET /api/analytics/latest              最新一次快照（结构与 public/data/analytics.json 同构）
 *   GET /api/analytics/daily?platform=&days=30
 *   GET /api/analytics/works?platform=&days=30&limit=200
 */
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import pg from 'pg';

const { Pool } = pg;

function readEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = readEnv(path.resolve('server/.env'));
const DATABASE_URL = process.env.DATABASE_URL || env.DATABASE_URL;
const PORT = Number(process.env.PORT || env.PORT || 8787);
if (!DATABASE_URL) { console.error('缺少 DATABASE_URL'); process.exit(1); }

const pool = new Pool({ connectionString: DATABASE_URL, max: 5, idleTimeoutMillis: 30000 });
const app = Fastify({ logger: true, trustProxy: true });
const fmt = d => new Date(d).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace(' ', 'T');

app.get('/api/health', async () => ({ ok: true, time: new Date().toISOString() }));

app.get('/api/analytics/latest', async () => {
  const snap = await pool.query(
    'SELECT observed_at, timezone, disclaimer, analysis FROM analytics_snapshot ORDER BY observed_at DESC LIMIT 1'
  );
  if (!snap.rows.length) return { error: 'no_data' };
  const s = snap.rows[0];
  const out = {
    observedAt: fmt(s.observed_at),
    timezone: s.timezone,
    disclaimer: s.disclaimer,
    analysis: s.analysis || {},
    douyin: { works: [], summary: {} },
    wechat: { works: [], summary: {} },
    kuaishou: { works: [], summary: {} },
    xiaohongshu: { works: [], summary: {} },
  };
  const daily = await pool.query(
    'SELECT platform, summary, note FROM analytics_daily WHERE observed_at = $1', [s.observed_at]
  );
  for (const r of daily.rows) {
    if (!out[r.platform]) continue;
    out[r.platform].summary = r.summary || {};
    if (r.note) out[r.platform].note = r.note;
  }
  const works = await pool.query(
    'SELECT platform, title, pub_date, status, metrics FROM analytics_works WHERE observed_at = $1 ORDER BY id', [s.observed_at]
  );
  for (const r of works.rows) {
    if (!out[r.platform]) continue;
    out[r.platform].works.push({
      title: r.title,
      date: r.pub_date,
      ...(r.status ? { status: r.status } : {}),
      metrics: r.metrics || {},
    });
  }
  return out;
});

app.get('/api/analytics/daily', async (req) => {
  const platform = String(req.query.platform || '');
  const days = Math.min(Number(req.query.days) || 30, 366);
  const params = [days];
  let where = 'observed_at >= NOW() - ($1::int * INTERVAL \'1 day\')';
  if (platform) { params.push(platform); where += ` AND platform = $${params.length}`; }
  const r = await pool.query(
    `SELECT observed_at, platform, summary, note FROM analytics_daily WHERE ${where} ORDER BY observed_at DESC, platform`, params
  );
  return {
    count: r.rows.length,
    rows: r.rows.map(x => ({ observedAt: fmt(x.observed_at), platform: x.platform, summary: x.summary, note: x.note })),
  };
});

app.get('/api/analytics/works', async (req) => {
  const platform = String(req.query.platform || '');
  const days = Math.min(Number(req.query.days) || 30, 366);
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const params = [days, limit];                 // $1=days $2=limit $3=platform(可选)
  let where = 'observed_at >= NOW() - ($1::int * INTERVAL \'1 day\')';
  if (platform) { params.push(platform); where += ' AND platform = $3'; }
  const r = await pool.query(
    `SELECT observed_at, platform, title, pub_date, status, metrics
     FROM analytics_works WHERE ${where} ORDER BY observed_at DESC, id LIMIT $2`, params
  );
  return {
    count: r.rows.length,
    rows: r.rows.map(x => ({
      observedAt: fmt(x.observed_at), platform: x.platform, title: x.title,
      date: x.pub_date, status: x.status, metrics: x.metrics,
    })),
  };
});

try {
  await app.listen({ port: PORT, host: '127.0.0.1' });
} catch (e) {
  app.log.error(e);
  process.exit(1);
}

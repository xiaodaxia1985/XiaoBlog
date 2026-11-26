#!/usr/bin/env node
/**
 * 把 public/data/analytics.json 幂等 upsert 进 PostgreSQL。
 * 用法（在 ECS /opt/XiaoBlog 下）：
 *   DATABASE_URL='postgresql://xb:***@127.0.0.1:5432/xiaoblog' node server/ingest-analytics.mjs
 * 也可不传环境变量，改从 server/.env 读取 DATABASE_URL。
 * 入库前自动执行 server/migrations/0002_analytics.sql，保证表存在。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';

const { Client } = pg;

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
const JSON_PATH = process.env.ANALYTICS_JSON || 'public/data/analytics.json';

if (!DATABASE_URL) { console.error('缺少 DATABASE_URL：设置环境变量或写进 server/.env'); process.exit(1); }
if (!fs.existsSync(JSON_PATH)) { console.error(`找不到数据文件：${JSON_PATH}`); process.exit(1); }

const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
const observedAt = /[+-]\d{2}:?\d{2}$/.test(data.observedAt) ? data.observedAt : data.observedAt + '+08:00';
const observedDate = data.observedAt.slice(0, 10);
const PLATFORMS = ['douyin', 'wechat', 'kuaishou', 'xiaohongshu'];
const WORK_PLATFORMS = ['douyin', 'wechat', 'kuaishou'];
const workKey = (p, w) => crypto.createHash('sha1')
  .update([p, w.title || '', w.date || '', w.status || ''].join('|'))
  .digest('hex').slice(0, 20);

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();
try {
  await client.query(fs.readFileSync(path.resolve('server/migrations/0002_analytics.sql'), 'utf8'));
  await client.query('BEGIN');

  await client.query(
    `INSERT INTO analytics_snapshot (observed_at, observed_date, timezone, disclaimer, analysis, source_file)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (observed_at) DO UPDATE SET
       timezone    = EXCLUDED.timezone,
       disclaimer  = EXCLUDED.disclaimer,
       analysis    = EXCLUDED.analysis,
       source_file = EXCLUDED.source_file`,
    [observedAt, observedDate, data.timezone || 'Asia/Shanghai', data.disclaimer || null, JSON.stringify(data.analysis || {}), JSON_PATH]
  );

  for (const p of PLATFORMS) {
    const d = data[p] || {};
    await client.query(
      `INSERT INTO analytics_daily (observed_at, observed_date, platform, summary, note)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (observed_at, platform) DO UPDATE SET
         summary = EXCLUDED.summary,
         note    = EXCLUDED.note`,
      [observedAt, observedDate, p, JSON.stringify(d.summary || {}), d.note || null]
    );
  }

  let nWorks = 0;
  for (const p of WORK_PLATFORMS) {
    for (const w of (data[p]?.works || [])) {
      await client.query(
        `INSERT INTO analytics_works (observed_at, observed_date, platform, work_key, title, pub_date, status, metrics)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (observed_at, platform, work_key) DO UPDATE SET
           title    = EXCLUDED.title,
           pub_date = EXCLUDED.pub_date,
           status   = EXCLUDED.status,
           metrics  = EXCLUDED.metrics`,
        [observedAt, observedDate, p, workKey(p, w), w.title || null, w.date || null, w.status || null, JSON.stringify(w.metrics || {})]
      );
      nWorks++;
    }
  }

  await client.query('COMMIT');
  console.log(`入库完成 observed_at=${observedAt} platforms=${PLATFORMS.length} works=${nWorks}`);
} catch (e) {
  await client.query('ROLLBACK');
  console.error('入库失败:', e.message || e);
  process.exitCode = 1;
} finally {
  await client.end();
}

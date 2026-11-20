// 从 src/data/redirects.json 生成两层兜底：
//   1) astro.config.mjs 读同一份 JSON，构建时为旧路径产出 meta-refresh 页面（零运维成本）
//   2) 本脚本产出 deploy/nginx/redirects.conf，由线上 nginx include 后发真正的 301
//
// 数据源格式（数组，按顺序）：
//   { "from": "/insight/old-slug", "to": "/insight/new-slug", "code": 301 }

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(root, 'src/data/redirects.json');
const OUT = resolve(root, 'deploy/nginx/redirects.conf');

function fail(msg) {
  console.error(`[gen-redirects] ${msg}`);
  process.exit(1);
}

let list;
try {
  list = JSON.parse(readFileSync(SRC, 'utf8'));
} catch (err) {
  fail(`读不了 ${SRC}：${err.message}`);
}
if (!Array.isArray(list)) fail('redirects.json 必须是数组');

const seen = new Set();
const rows = [];
for (const [i, r] of list.entries()) {
  const at = `第 ${i + 1} 条`;
  if (!r || typeof r.from !== 'string' || typeof r.to !== 'string') fail(`${at} 缺 from / to`);
  if (!r.from.startsWith('/') || !r.to.startsWith('/')) fail(`${at} from / to 必须以 / 开头`);
  if (r.from === r.to) fail(`${at} from 与 to 相同（${r.from}）`);
  if (r.to.endsWith('/') === false && !r.to.includes('.')) {
    // 统一成带尾斜杠，避免 nginx 二次 301 链路
    r.to = `${r.to}/`;
  }
  const from = r.from.replace(/\/+$/, '');
  if (seen.has(from)) fail(`${at} from 重复（${from}）`);
  seen.add(from);
  const code = r.code ?? 301;
  if (code !== 301 && code !== 302) fail(`${at} code 只能是 301 / 302`);
  rows.push({ from, to: r.to, code });
}

mkdirSync(dirname(OUT), { recursive: true });
const head = [
  '# 由 scripts/gen-redirects.mjs 生成，不要手改。',
  '# 数据源：src/data/redirects.json。改 slug 时只改那份 JSON，然后 push。',
  '# 挂载方式（一次性，root）：在站点 server 块里加',
  '#   include /opt/XiaoBlog/deploy/nginx/redirects.conf;',
  '',
];
const body = rows.flatMap(({ from, to, code }) => [
  `location = ${from} { return ${code} ${to}$is_args$args; }`,
  `location = ${from}/ { return ${code} ${to}$is_args$args; }`,
]);
writeFileSync(OUT, [...head, ...(body.length ? body : ['# 当前没有 redirect 条目。']), ''].join('\n'), 'utf8');

console.log(`[gen-redirects] ${rows.length} 条 → ${OUT}`);

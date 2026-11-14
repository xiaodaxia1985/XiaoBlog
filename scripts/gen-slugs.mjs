// 生成薄 API 的 slug 白名单清单 public/data/slugs.json。
// 只收录已发布文章（draft 不为 true）的文件名 slug；草稿不进白名单。
// server/ 启动时读这份清单，缺失或失败会拒绝全部写入，因此构建链必须先跑本脚本。
// 纯 Node、无第三方依赖。运行：node scripts/gen-slugs.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const insightsDir = path.join(root, 'src', 'content', 'insights');
const dataDir = path.join(root, 'public', 'data');
const outFile = path.join(dataDir, 'slugs.json');

function parseDraft(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw.replace(/^\uFEFF/, ''));
  if (!match) return false;
  for (const line of match[1].split(/\r?\n/)) {
    const m = /^draft:\s*(.*)$/.exec(line);
    if (!m) continue;
    const val = m[1].trim().replace(/^['"]/, '').replace(/['"]$/, '');
    return val === 'true';
  }
  return false;
}

const files = fs.existsSync(insightsDir)
  ? fs.readdirSync(insightsDir).filter((f) => f.endsWith('.md'))
  : [];

const slugs = files
  .filter((file) => !parseDraft(fs.readFileSync(path.join(insightsDir, file), 'utf8')))
  .map((file) => file.replace(/\.md$/, ''))
  .sort();

fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(outFile, `${JSON.stringify(slugs, null, 2)}\n`, 'utf8');
console.log(`[gen-slugs] 写出 ${slugs.length} 个已发布 slug → public/data/slugs.json`);

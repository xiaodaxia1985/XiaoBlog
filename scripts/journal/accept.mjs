// 审核通过后落库：把 .inbox 草稿合入 journal/daily.json（这是唯一进入页面与仓库的路径）
// 硬规则：草稿里还有 needsTranslation=true 的条目时拒绝写入，必须先翻成中文。
import fs from 'node:fs';
import path from 'node:path';

const SITE = 'E:/works/New Journal/个人商业实战/site/XiaoBlog';
const INBOX = path.join(SITE, 'journal/.inbox');
const DAILY = path.join(SITE, 'journal/daily.json');

const argv = process.argv.slice(2);
const fileArg = (() => {
  const i = argv.indexOf('--file');
  return i >= 0 ? argv[i + 1] : null;
})();
const force = argv.includes('--force');

function pickInbox() {
  if (fileArg) return path.isAbsolute(fileArg) ? fileArg : path.join(INBOX, fileArg);
  const files = fs.readdirSync(INBOX).filter((f) => f.endsWith('.json')).sort();
  if (!files.length) throw new Error('journal/.inbox 下没有草稿，先跑 npm run journal:sync');
  return path.join(INBOX, files[files.length - 1]);
}

const inboxPath = pickInbox();
const raw = JSON.parse(fs.readFileSync(inboxPath, 'utf8'));
const drafts = raw.drafts || [];

const blocked = drafts.flatMap((d) => (d.items || []).filter((i) => i.needsTranslation).map((i) => `${d.date} ${i.hashes ? i.hashes[0] : ''} ${i.title}`));
if (blocked.length) {
  console.error('拒绝写入：以下条目仍未翻译成中文');
  for (const b of blocked) console.error('  - ' + b);
  process.exit(1);
}

let store = { entries: [] };
if (fs.existsSync(DAILY)) store = JSON.parse(fs.readFileSync(DAILY, 'utf8'));
store.entries = store.entries || [];

let added = 0;
let skipped = 0;
for (const d of drafts) {
  const exist = store.entries.find((e) => e.date === d.date);
  if (exist && !force) { skipped += 1; continue; }
  if (exist && force) store.entries = store.entries.filter((e) => e.date !== d.date);
  store.entries.push({ ...d, verified: true, verifiedAt: new Date().toISOString().slice(0, 10) });
  added += 1;
}

store.entries.sort((a, b) => b.date.localeCompare(a.date));
store.updatedAt = new Date().toISOString().slice(0, 10);
fs.writeFileSync(DAILY, JSON.stringify(store, null, 2), 'utf8');

console.log(`写入 ${added} 天，跳过 ${skipped} 天 → journal/daily.json（共 ${store.entries.length} 天）`);

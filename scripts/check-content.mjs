// 内容严格校验：frontmatter 必填/枚举/日期、slug 规范与查重、封面与本地图片存在性、内部文章链接。
// 纯 Node、无第三方依赖；报错退出码 1，警告不阻断。运行：npm run check:content
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, TOPICS } from '../src/lib/taxonomy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const insightsDir = path.join(root, 'src', 'content', 'insights');
const imagesDir = path.join(root, 'public', 'images');
const coversDir = path.join(root, 'src', 'assets', 'covers');

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}[.-]\d{1,2}[.-]\d{1,2}$/;

const errors = [];
const warnings = [];
const err = (file, msg) => errors.push(`✗ ${file}: ${msg}`);
const warn = (file, msg) => warnings.push(`⚠ ${file}: ${msg}`);

function stripQuotes(v) {
  return v.replace(/^['"]/, '').replace(/['"]$/, '');
}

function parseFrontmatter(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw.replace(/^\uFEFF/, ''));
  if (!match) return null;
  const fm = match[1];
  const body = raw.slice(match[0].length);
  const out = {};
  for (const line of fm.split(/\r?\n/)) {
    const m = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (val === '') { out[key] = undefined; continue; }
    if (val.startsWith('[') || val.startsWith('{')) {
      try { out[key] = JSON.parse(val); } catch { out[key] = stripQuotes(val); }
    } else if (val === 'true') { out[key] = true; }
    else if (val === 'false') { out[key] = false; }
    else { out[key] = stripQuotes(val); }
  }
  return { fm: out, body };
}

function listFiles(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
}

function coverExists(slug, explicit) {
  const files = fs.existsSync(coversDir) ? fs.readdirSync(coversDir) : [];
  const has = (name) => files.some((f) => f === name || f.startsWith(`${name}.`));
  if (explicit && explicit.trim()) {
    const v = explicit.trim();
    if (v.startsWith('/')) return fs.existsSync(path.join(root, 'public', v.replace(/^\//, '')));
    return has(v) || has(v.replace(/\.(webp|jpg|png|svg)$/i, ''));
  }
  return has(`${slug}-1`) || has(slug);
}

function checkLocalImage(src, file) {
  if (!src || /^(https?:|mailto:|#|\/#)/.test(src)) return;
  const rel = src.replace(/^\//, '');
  if (!fs.existsSync(path.join(root, 'public', rel))) {
    err(file, `本地图片不存在：${src}`);
  }
}

const files = listFiles(insightsDir);
const seenSlugs = new Map();
const publishedSlugs = new Set();

for (const file of files) {
  const slug = file.replace(/\.md$/, '');
  const full = path.join(insightsDir, file);
  const raw = fs.readFileSync(full, 'utf8');
  const parsed = parseFrontmatter(raw);

  if (!parsed) { err(file, '缺少 frontmatter'); continue; }
  const { fm, body } = parsed;

  // slug 规范与查重
  if (!SLUG_RE.test(slug)) err(file, `slug 不符合 kebab-case：${slug}`);
  if (seenSlugs.has(slug)) err(file, `slug 重复：${slug}`);
  seenSlugs.set(slug, file);

  const title = typeof fm.title === 'string' ? fm.title.trim() : '';
  const category = typeof fm.category === 'string' ? fm.category.trim() : '';
  const date = typeof fm.date === 'string' ? fm.date.trim() : '';
  const topicRaw = fm.topic;
  const topics = Array.isArray(topicRaw) ? topicRaw.filter(Boolean) : topicRaw ? [topicRaw] : [];
  const draft = fm.draft === true;
  const takeaways = Array.isArray(fm.takeaways) ? fm.takeaways : [];

  if (!title) err(file, '缺少 title');
  if (!category) err(file, '缺少 category');
  else if (!CATEGORIES.includes(category)) err(file, `category 不在清单内：${category}`);
  if (!date) err(file, '缺少 date');
  else if (!DATE_RE.test(date)) err(file, `date 格式应为 2026.11.12 或 2026-11-12：${date}`);
  if (fm.draft !== undefined && typeof fm.draft !== 'boolean') err(file, 'draft 必须是布尔值');

  for (const t of topics) {
    if (!TOPICS.includes(t)) err(file, `topic 不在清单内：${t}`);
  }

  if (!draft) {
    publishedSlugs.add(slug);
    if (!topics.length) err(file, '已发布文章缺少 topic');
    if (!takeaways.length) err(file, '已发布文章缺少 takeaways（观点卡无内容）');
    if (!coverExists(slug, fm.cover)) warn(file, '未找到封面资源，将回退默认图');
  } else if (!topics.length) {
    warn(file, '草稿暂无 topic');
  }

  // 正文图片（裸 <img> 与 markdown 图片）本地存在性
  for (const m of body.matchAll(/<img[^>]+src="([^"]+)"/g)) checkLocalImage(m[1], file);
  for (const m of body.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) checkLocalImage(m[1], file);

  // 内部文章链接目标存在性
  for (const m of body.matchAll(/\[[^\]]*\]\(\/insight\/([^/)]+)\//g)) {
    const target = m[1];
    if (!fs.existsSync(path.join(insightsDir, `${target}.md`))) err(file, `内部链接指向不存在的文章：/insight/${target}/`);
  }
}

// 孤儿图片：public/images 下未被任何文章引用的静态图（封面 logo-mark.svg 除外）。
const referenced = new Set();
for (const file of files) {
  const body = fs.readFileSync(path.join(insightsDir, file), 'utf8');
  for (const m of body.matchAll(/<img[^>]+src="\/images\/([^"]+)"/g)) referenced.add(m[1]);
  for (const m of body.matchAll(/!\[[^\]]*\]\(\/images\/([^)]+)\)/g)) referenced.add(m[1]);
}
// 生成子目录（响应式变体、RSS 缩略图）由构建脚本维护，不参与正文孤儿扫描。
const GENERATED_IMG_DIRS = new Set(['responsive', 'thumb']);
if (fs.existsSync(imagesDir)) {
  for (const img of fs.readdirSync(imagesDir, { withFileTypes: true })) {
    if (img.isDirectory()) continue;
    if (img.name === 'logo-mark.svg') continue;
    if (!referenced.has(img.name)) warnings.push(`⚠ public/images/${img.name}: 未被任何文章引用（待 B4 清理）`);
  }
}

console.log(`校验 ${files.length} 篇文章（已发布 ${publishedSlugs.size} 篇）。`);
for (const w of warnings) console.log(w);
for (const e of errors) console.error(e);

if (errors.length) {
  console.error(`\n校验未通过：${errors.length} 个错误，${warnings.length} 个警告。`);
  process.exit(1);
}
console.log(`\n校验通过：0 错误，${warnings.length} 个警告。`);

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const insightsDir = path.join(root, 'src', 'content', 'insights');
const coversDir = path.join(root, 'src', 'assets', 'covers');
const template = fs.readFileSync(path.join(root, 'scripts', 'cover-template.html'), 'utf8');

const palette = {
  '90天实战': { bg: '#0C1F13', accent: '#39FF14' },
  '产业数字化': { bg: '#0A1A26', accent: '#4DA6FF' },
  'AI 与产品': { bg: '#171027', accent: '#B48CFF' },
  '技术与管理': { bg: '#1B1810', accent: '#F2C14E' },
};

const edgeCandidates = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const edge = edgeCandidates.find((p) => fs.existsSync(p));
if (!edge) {
  console.error('未找到 Edge，请用 EDGE_PATH 指定 msedge.exe 路径。');
  process.exit(1);
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fontUrl = (rel) => pathToFileURL(path.join(root, rel)).href;

function readFrontmatter(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!match) throw new Error(`${file} 缺少 frontmatter`);
  const fm = match[1];
  const line = (name) => {
    const m = new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(fm);
    return m ? m[1].trim() : '';
  };
  const parse = (name) => {
    const v = line(name);
    if (!v) return undefined;
    try {
      return JSON.parse(v);
    } catch {
      return v.replace(/^['"]|['"]$/g, '');
    }
  };
  return {
    title: parse('title'),
    category: parse('category'),
    date: parse('date') ?? '',
    draft: parse('draft') === true,
    takeaways: parse('takeaways') ?? [],
  };
}

function fontSizeFor(text) {
  const n = [...text].length;
  if (n <= 16) return 132;
  if (n <= 24) return 108;
  if (n <= 34) return 92;
  if (n <= 44) return 80;
  return 68;
}

async function render(slug, meta) {
  const color = palette[meta.category];
  if (!color) throw new Error(`${slug} 的分类「${meta.category}」没有封面配色`);
  const headline = meta.takeaways[0];
  if (!headline) {
    console.warn(`跳过 ${slug}：没有 takeaways，将使用默认封面`);
    return null;
  }

  const html = template
    .replace(/{{FONT_SC}}/g, fontUrl('public/fonts/noto-sans-sc.woff2'))
    .replace(/{{FONT_INTER}}/g, fontUrl('public/fonts/inter.woff2'))
    .replace(/{{BG}}/g, color.bg)
    .replace(/{{ACCENT}}/g, color.accent)
    .replace(/{{CATEGORY}}/g, esc(meta.category))
    .replace(/{{DATE}}/g, esc(meta.date))
    .replace(/{{HEADLINE}}/g, esc(headline))
    .replace(/{{FS}}/g, String(fontSizeFor(headline)));

  const tmpHtml = path.join(os.tmpdir(), `cover-${slug}.html`);
  const tmpPng = path.join(os.tmpdir(), `cover-${slug}.png`);
  const profile = path.join(os.tmpdir(), `edge-cover-${process.pid}`);
  fs.writeFileSync(tmpHtml, html, 'utf8');

  execFileSync(edge, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--allow-file-access-from-files',
    `--user-data-dir=${profile}`,
    '--window-size=1600,1000',
    '--force-device-scale-factor=1',
    '--virtual-time-budget=1500',
    `--screenshot=${tmpPng}`,
    pathToFileURL(tmpHtml).href,
  ], { stdio: 'ignore' });

  if (!fs.existsSync(tmpPng)) throw new Error('截图失败，未生成 PNG');
  const out = path.join(coversDir, `${slug}.webp`);
  let quality = 82;
  let size = 0;
  for (let i = 0; i < 3; i++) {
    await sharp(tmpPng).webp({ quality, effort: 6 }).toFile(out);
    size = fs.statSync(out).size;
    if (size <= 120 * 1024) break;
    quality -= 10;
  }

  for (const p of [tmpHtml, tmpPng]) fs.rmSync(p, { force: true });
  fs.rmSync(profile, { recursive: true, force: true });

  console.log(`${slug}: ${path.relative(root, out)}  ${(size / 1024).toFixed(1)}KB  q=${quality}  「${headline}」`);
  return { slug, size, headline };
}

const args = process.argv.slice(2);
const files = fs.readdirSync(insightsDir).filter((f) => f.endsWith('.md'));
const targets = files
  .map((f) => ({ slug: f.replace(/\.md$/, ''), file: path.join(insightsDir, f) }))
  .filter(({ slug }) => (args.length ? args.includes(slug) : !readFrontmatter(path.join(insightsDir, `${slug}.md`)).draft));

const results = [];
for (const { slug, file } of targets) {
  const meta = readFrontmatter(file);
  const r = await render(slug, meta);
  if (r) results.push(r);
}
console.log(`完成 ${results.length} 张封面。`);

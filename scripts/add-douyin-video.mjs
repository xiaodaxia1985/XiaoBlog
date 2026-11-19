// 抖音视频 → 文章（标题 + 正文 + 话题自动取自抖音文案）。
// 用法：
//   npm run dy:add -- "https://v.douyin.com/xxxx/" --slug my-article --date 2026.11.19 --category "AI 与产品"
//   npm run dy:add -- "https://www.douyin.com/video/7709149690415140159"
//   npm run dy:add -- 7709149690415140159 --slug my-article --topics "个人商业创造,AI与产品创造"
//
// 数据来源：open.douyin.com 免鉴权接口 get_iframe_by_video。
// 它的 video_title 实际是整条文案：首行=标题、中间=正文段落、末尾=纯话题行。
// 默认据此自动拆出 title / 正文 / tags；--title、--tagline 可覆盖。
// 默认 draft: true，正文沿用抖音原文，审定后自行改 false。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const insightsDir = path.join(root, 'src', 'content', 'insights');

const ID_RE = /^\d{15,20}$/;

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

/** 从任意形态的输入里取 video_id。 */
async function resolveVideoId(input) {
  const raw = (input || '').trim();
  if (ID_RE.test(raw)) return raw;
  const direct = raw.match(/(?:video\/|modal_id=|aweme_id=)(\d{15,20})/);
  if (direct) return direct[1];
  if (/^https?:\/\//.test(raw)) {
    const res = await fetch(raw, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0' } });
    const finalUrl = res.url || '';
    const fromFinal = finalUrl.match(/(?:video\/|modal_id=)(\d{15,20})/) || finalUrl.match(/(\d{15,20})/);
    if (fromFinal) return fromFinal[1];
  }
  throw new Error(`无法从输入里取到 video_id：${raw}`);
}

/** 官方免鉴权接口。video_title 是整条文案，不是单纯标题。 */
async function fetchMeta(id) {
  const url = `https://open.douyin.com/api/douyin/v1/video/get_iframe_by_video?video_id=${id}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`元数据接口返回 ${res.status}`);
  const json = await res.json();
  if (json.err_no !== 0) throw new Error(`视频不可用（err_no=${json.err_no}）：${json.err_msg || '未知错误'}`);
  const d = json.data ?? {};
  return {
    caption: (d.video_title ?? '').trim(),
    width: Number(d.video_width) || 0,
    height: Number(d.video_height) || 0,
  };
}

/**
 * 从抖音文案里拆出 标题 / 正文段落 / 话题。
 * 规则：末尾整行都是话题的，并入 tags；首行作标题，并剥掉其中夹带的话题；其余行作正文。
 */
function splitCaption(caption) {
  const lines = caption
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (!lines.length) return { title: '', body: [], tags: [] };

  const hashtagOnly = (s) => /^(#[^\s#]+[\s]*)+$/u.test(s);
  const tags = [];

  while (lines.length > 1 && hashtagOnly(lines[lines.length - 1])) {
    tags.unshift(...extractTags(lines.pop()));
  }

  let title = lines.shift() ?? '';
  const titleTags = extractTags(title);
  if (titleTags.length) {
    tags.unshift(...titleTags);
    title = title.replace(/[#＃][^\s#]+/gu, '').replace(/\s{2,}/gu, ' ').trim();
  }

  return { title, body: lines, tags: unique(tags) };
}

function extractTags(text) {
  const out = [];
  for (const m of String(text).matchAll(/[#＃]([^\s#，。,.!！?？、]+)/gu)) {
    const t = m[1].trim();
    if (t) out.push(t);
  }
  return out;
}

function unique(list) {
  return [...new Set(list.map((s) => s.trim()).filter(Boolean))];
}

/** 宽高 → 画幅枚举（最近档）。 */
function ratioOf(w, h) {
  if (!w || !h) return 'auto';
  const r = w / h;
  const table = [
    [9 / 16, '9:16'],
    [3 / 4, '3:4'],
    [1, '1:1'],
    [4 / 3, '4:3'],
    [16 / 9, '16:9'],
  ];
  let best = table[0];
  for (const row of table) {
    if (Math.abs(r - row[0]) < Math.abs(r - best[0])) best = row;
  }
  return best[1];
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[#＃][^\s]*/g, '')
    .replace(/[^\w\u4e00-\u9fff-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function yamlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function main() {
  const input = process.argv[2];
  if (!input || input.startsWith('--')) {
    console.error('用法：npm run dy:add -- "<抖音链接或 video_id>" --slug <slug> --date 2026.11.19');
    process.exit(1);
  }

  const id = await resolveVideoId(input);
  console.log(`video_id: ${id}`);

  let meta;
  try {
    meta = await fetchMeta(id);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    console.error('   （离线或接口异常时可加 --offline 跳过元数据，仅写 id）');
    if (!hasFlag('offline')) process.exit(1);
    meta = { caption: '', width: 0, height: 0 };
  }

  const parsed = splitCaption(meta.caption);
  const ratio = hasFlag('offline') ? 'auto' : ratioOf(meta.width, meta.height);
  const slug = arg('slug') || slugify(parsed.title) || `douyin-${id}`;
  const date = arg('date');
  const category = arg('category', 'AI 与产品');
  const topics = unique(arg('topics').split(','));
  const topic = arg('topic');
  const allTopics = topics.length ? topics : topic ? [topic] : [];
  const title = arg('title') || parsed.title || `抖音视频 ${id}`;
  const tagline = arg('tagline');
  const sourceUrl = input.startsWith('http') ? input : `https://www.douyin.com/video/${id}`;

  if (!date) {
    console.error('✗ 缺少 --date（如 2026.11.19）。日期决定排序，必须由你确认。');
    process.exit(1);
  }
  if (!/^\d{4}[.-]\d{1,2}[.-]\d{1,2}$/.test(date)) {
    console.error(`✗ date 格式应为 2026.11.19：${date}`);
    process.exit(1);
  }

  const target = path.join(insightsDir, `${slug}.md`);
  if (fs.existsSync(target)) {
    console.error(`✗ 已存在同名文章：src/content/insights/${slug}.md`);
    process.exit(1);
  }

  const fm = [
    '---',
    `title: ${yamlString(title)}`,
    `tagline: ${yamlString(tagline)}`,
    `category: ${yamlString(category)}`,
    ...(allTopics.length
      ? [`topic: ${allTopics.length > 1 ? `[${allTopics.map(yamlString).join(', ')}]` : yamlString(allTopics[0])}`]
      : []),
    `date: ${yamlString(date)}`,
    'draft: true',
    `videoId: ${yamlString(id)}`,
    `videoRatio: ${yamlString(ratio)}`,
    `videoUrl: ${yamlString(sourceUrl)}`,
    ...(parsed.tags.length ? [`tags: [${parsed.tags.map(yamlString).join(', ')}]`] : []),
    '---',
  ];

  const bodyLines = parsed.body.length
    ? parsed.body.flatMap((p) => [p, ''])
    : ['<!-- TODO 正文：接口没有返回文案，需自行补写 -->', ''];

  fs.writeFileSync(target, [...fm, '', ...bodyLines].join('\n'), 'utf8');

  console.log(`✓ 已生成 src/content/insights/${slug}.md`);
  console.log(`  标题：${title}`);
  console.log(`  正文：${parsed.body.length} 段，话题：${parsed.tags.length} 个（${parsed.tags.join(' ')}）`);
  console.log(`  画幅 ${ratio}（${meta.width}x${meta.height}），draft: true`);
  console.log('   下一步：放封面 src/assets/covers/<slug>-1.webp → npm run check:content → 审正文 → draft: false');
}

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});

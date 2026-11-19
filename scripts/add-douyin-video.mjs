// 抖音视频 → 文章骨架。
// 用法：
//   npm run dy:add -- "https://v.douyin.com/xxxx/" --slug my-article --date 2026.11.19 --category "AI 与产品"
//   npm run dy:add -- "https://www.douyin.com/video/7709149690415140159"
//   npm run dy:add -- 7709149690415140159 --slug my-article
//
// 做的事：解析链接拿 video_id → 调官方免鉴权接口取标题/画幅 → 生成 src/content/insights/<slug>.md 骨架。
// 不做的事：不写正文（正文由人审定）、不出封面、不发布。
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
  // douyin.com/video/<id>、iesdouyin.com/share/video/<id>、modal_id=<id>
  const direct = raw.match(/(?:video\/|modal_id=|aweme_id=)(\d{15,20})/);
  if (direct) return direct[1];
  // 短链：跟随 302 拿最终地址
  if (/^https?:\/\//.test(raw)) {
    const res = await fetch(raw, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0' } });
    const finalUrl = res.url || '';
    const fromFinal = finalUrl.match(/(?:video\/|modal_id=)(\d{15,20})/) || finalUrl.match(/(\d{15,20})/);
    if (fromFinal) return fromFinal[1];
  }
  throw new Error(`无法从输入里取到 video_id：${raw}`);
}

/** 官方免鉴权接口，返回标题与画幅。 */
async function fetchMeta(id) {
  const url = `https://open.douyin.com/api/douyin/v1/video/get_iframe_by_video?video_id=${id}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`元数据接口返回 ${res.status}`);
  const json = await res.json();
  if (json.err_no !== 0) throw new Error(`视频不可用（err_no=${json.err_no}）：${json.err_msg || '未知错误'}`);
  const d = json.data ?? {};
  return {
    title: (d.video_title ?? '').trim(),
    width: Number(d.video_width) || 0,
    height: Number(d.video_height) || 0,
  };
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
    meta = { title: '', width: 0, height: 0 };
  }

  const ratio = hasFlag('offline') ? 'auto' : ratioOf(meta.width, meta.height);
  const slug = arg('slug') || slugify(meta.title) || `douyin-${id}`;
  const date = arg('date');
  const category = arg('category', 'AI 与产品');
  const topic = arg('topic');
  const title = arg('title') || meta.title.split(/[#＃]/)[0].trim() || `抖音视频 ${id}`;

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

  const lines = [
    '---',
    `title: ${yamlString(title)}`,
    'tagline: ""',
    `category: ${yamlString(category)}`,
    ...(topic ? [`topic: ${yamlString(topic)}`] : []),
    `date: ${yamlString(date)}`,
    'draft: true',
    `videoId: ${yamlString(id)}`,
    `videoRatio: ${yamlString(ratio)}`,
    `videoUrl: ${yamlString(input.startsWith('http') ? input : `https://www.douyin.com/video/${id}`)}`,
    '---',
    '',
    '<!-- TODO 正文：在这条视频的基础上写解读，审定后再把 draft 改为 false -->',
    '',
  ];

  fs.writeFileSync(target, lines.join('\n'), 'utf8');
  console.log(`✓ 已生成 src/content/insights/${slug}.md`);
  console.log(`  画幅 ${ratio}（${meta.width}x${meta.height}），draft: true`);
  console.log('   下一步：写正文 → 出封面 → 补 topic/takeaways → npm run check:content → 改 draft: false');
}

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});

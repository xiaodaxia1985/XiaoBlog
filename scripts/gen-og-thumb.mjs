// 生成 Open Graph 1200×630 裁剪图与 RSS 240px 缩略图。
// 直接对现有封面做 cover-fit 裁剪，不重渲染文字；默认 OG 由 _default.svg 兜底。
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
const COVER_DIR = path.join(ROOT, 'src', 'assets', 'covers');
const OG_DIR = path.join(ROOT, 'public', 'og');
const THUMB_DIR = path.join(ROOT, 'public', 'images', 'thumb');
const DATA_DIR = path.join(ROOT, 'public', 'data');

const OG_W = 1200;
const OG_H = 630;
const THUMB_W = 240;

fs.rmSync(OG_DIR, { recursive: true, force: true });
fs.rmSync(THUMB_DIR, { recursive: true, force: true });
fs.mkdirSync(OG_DIR, { recursive: true });
fs.mkdirSync(THUMB_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

function slugOf(file) {
  return path.basename(file, path.extname(file)).replace(/-1$/, '');
}

async function main() {
  const og = {};
  const thumb = {};
  const covers = fs.readdirSync(COVER_DIR).filter((f) => /\.(webp|png|jpg|svg)$/i.test(f));

  for (const file of covers) {
    const slug = slugOf(file);
    if (file === '_default.svg') continue;
    const src = path.join(COVER_DIR, file);

    const ogOut = `${slug}-og.webp`;
    await sharp(src)
      .resize({ width: OG_W, height: OG_H, fit: 'cover', position: 'center' })
      .webp({ quality: 72, effort: 6 })
      .toFile(path.join(OG_DIR, ogOut));
    og[slug] = `/og/${ogOut}`;

    const thumbOut = `${slug}-thumb.webp`;
    await sharp(src)
      .resize({ width: THUMB_W, withoutEnlargement: true })
      .webp({ quality: 70, effort: 6 })
      .toFile(path.join(THUMB_DIR, thumbOut));
    thumb[slug] = `/images/thumb/${thumbOut}`;
  }

  // 默认 OG：兜底封面裁成 1200×630。
  const defaultSvg = path.join(COVER_DIR, '_default.svg');
  await sharp(defaultSvg)
    .resize({ width: OG_W, height: OG_H, fit: 'cover', position: 'center' })
    .webp({ quality: 72, effort: 6 })
    .toFile(path.join(OG_DIR, 'default-og.webp'));

  const manifest = {
    default: '/og/default-og.webp',
    og,
    thumb,
  };
  fs.writeFileSync(path.join(DATA_DIR, 'og-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[og] ${Object.keys(og).length} 篇 OG，${Object.keys(thumb).length} 张缩略图`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

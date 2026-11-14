// 正文图片响应式变体生成：为 public/images 下的正文 WebP 产出 AVIF/WebP 1x/2x 变体，
// 并写出 image-manifest.json，供 remark 插件把裸 <img> 升级为 <picture> + srcset。
// 仅处理正文图；logo-mark.svg 与封面目录不在此列。
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
const IMG_DIR = path.join(ROOT, 'public', 'images');
const OUT_DIR = path.join(IMG_DIR, 'responsive');
const DATA_DIR = path.join(ROOT, 'public', 'data');

const CONTENT_FULL = 686; // 正文版心内图片 CSS 显示宽度（1x）
const QUALITY_WEBP = 72;
const QUALITY_AVIF = 50;

function unique(list) {
  return [...new Set(list)].sort((a, b) => a - b);
}

async function variantsFor(file) {
  const src = path.join(IMG_DIR, file);
  const meta = await sharp(src).metadata();
  const W = meta.width;
  const H = meta.height;
  // 宽图：1x 按版心宽度，2x 翻倍；窄图：1x 自身折半，2x 原始宽度。均不超过原始宽度。
  const targetW = unique(
    W <= CONTENT_FULL * 2
      ? [Math.round(W / 2), W]
      : [CONTENT_FULL, Math.min(W, CONTENT_FULL * 2)]
  ).filter((w) => w > 0 && w <= W);

  const webp = [];
  const avif = [];
  for (const w of targetW) {
    const stem = file.replace(/\.webp$/i, '');
    const base = `${stem}-${w}`;
    const webpOut = `${base}.webp`;
    const avifOut = `${base}.avif`;
    await sharp(src).resize({ width: w, withoutEnlargement: true }).webp({ quality: QUALITY_WEBP }).toFile(path.join(OUT_DIR, webpOut));
    await sharp(src).resize({ width: w, withoutEnlargement: true }).avif({ quality: QUALITY_AVIF }).toFile(path.join(OUT_DIR, avifOut));
    webp.push({ src: `/images/responsive/${webpOut}`, w });
    avif.push({ src: `/images/responsive/${avifOut}`, w });
  }

  return {
    width: W,
    height: H,
    webp,
    avif,
    fallback: `/images/${file}`,
  };
}

async function main() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const files = fs.readdirSync(IMG_DIR).filter((f) => f.toLowerCase().endsWith('.webp'));
  const manifest = {};
  for (const file of files) {
    manifest[`/images/${file}`] = await variantsFor(file);
    console.log(`[img] ${file} → ${manifest[`/images/${file}`].webp.length} 档`);
  }

  fs.writeFileSync(path.join(DATA_DIR, 'image-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[img] 清单写入 ${Object.keys(manifest).length} 张`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

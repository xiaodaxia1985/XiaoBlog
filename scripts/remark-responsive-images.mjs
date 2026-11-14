// remark 插件：把正文裸 <img src="/images/...webp"> 升级为 <picture>，
// 输出 AVIF/WebP srcset（1x/2x），同时保留原 alt / 宽高 / lazy / async / 居中样式。
// 清单由 scripts/gen-image-variants.mjs 在构建前生成。
import fs from 'node:fs';
import path from 'node:path';

const MANIFEST_PATH = path.join(process.cwd(), 'public', 'data', 'image-manifest.json');
const SIZES = '(max-width: 720px) 100vw, 686px';

let manifest = {};
try {
  manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
} catch {
  manifest = {};
}

const ATTR_RE = /([a-zA-Z-]+)\s*=\s*"([^"]*)"/g;

function parseAttrs(tag) {
  const attrs = {};
  for (const match of tag.matchAll(ATTR_RE)) attrs[match[1].toLowerCase()] = match[2];
  return attrs;
}

function srcset(list) {
  return list.map((x) => `${x.src} ${x.w}w`).join(', ');
}

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export default function remarkResponsiveImages() {
  return (tree) => {
    if (!Object.keys(manifest).length) return;
    const walk = (node) => {
      if (node.type === 'html' && typeof node.value === 'string' && node.value.includes('<img')) {
        const imgMatch = node.value.match(/<img\b[^>]*>/);
        if (!imgMatch) return;
        const tag = imgMatch[0];
        const attrs = parseAttrs(tag);
        const src = attrs.src;
        const entry = src ? manifest[src] : undefined;
        if (!entry) return;

        const webpSet = srcset(entry.webp);
        const avifSet = srcset(entry.avif);
        const keep = ['alt', 'width', 'height', 'loading', 'decoding', 'style', 'class']
          .filter((k) => attrs[k] !== undefined)
          .map((k) => `${k}="${escapeAttr(attrs[k])}"`)
          .join(' ');

        const picture = [
          '<picture>',
          `  <source type="image/avif" srcset="${avifSet}" sizes="${SIZES}">`,
          `  <source type="image/webp" srcset="${webpSet}" sizes="${SIZES}">`,
          `  <img src="${entry.fallback}" srcset="${webpSet}" sizes="${SIZES}" ${keep}>`,
          '</picture>',
        ].join('\n');

        node.value = node.value.replace(tag, picture);
      }
      for (const key of Object.keys(node)) {
        const child = node[key];
        if (Array.isArray(child)) child.forEach(walk);
      }
    };
    walk(tree);
  };
}

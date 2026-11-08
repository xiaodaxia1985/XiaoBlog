// 封面配色：同一 category 内固定色相与饱和度，只提亮明度；第 1 张最深，逐张递进。
// Astro 页面与 scripts/generate-covers.mjs 共用，保证 HTML 卡片与生成的图片同色。

export const CATEGORY_THEMES = {
  '90天实战': { hue: 142, sat: 44, l: 8.4, step: 4.5, accent: '#39FF14' },
  '产业数字化': { hue: 206, sat: 58, l: 9.4, step: 4.5, accent: '#4DA6FF' },
  'AI 与产品': { hue: 258, sat: 59, l: 10.8, step: 4.5, accent: '#B48CFF' },
  '技术与管理': { hue: 44, sat: 41, l: 8.4, step: 4.5, accent: '#F2C14E' },
};

const FALLBACK = CATEGORY_THEMES['90天实战'];
const MAX_L = 26;

/**
 * @param {string} category 分类名
 * @param {number} index 0 起的卡片序号
 * @param {number} total 卡片总数
 * @returns {{ bg: string, accent: string, lightness: number }}
 */
export function shade(category, index, total) {
  const theme = CATEGORY_THEMES[category] ?? FALLBACK;
  const steps = Math.max(total - 1, 1);
  const rise = Math.min(theme.step * index, MAX_L - theme.l);
  const lightness = Number((theme.l + rise).toFixed(1));
  return {
    bg: `hsl(${theme.hue} ${theme.sat}% ${lightness}%)`,
    accent: theme.accent,
    lightness,
  };
}

// 站点唯一色板：主色 #D8F26B（荧光笔绿）。
// 封面图片与文章页卡片共用这一份定义；只做明度阶梯，不换色相。
// 深色文字 4 档透明度，对比度均已按 WCAG 2.x 正文 4.5:1 校验（见 docs 记录）。

export const MAIN = {
  hex: '#D8F26B',
  hue: 71.6,
  sat: 83.9,
  l: 68.4,
};

// 绿色底上一律用近黑文字；strong/body/soft 用于正文、序号、署名，dot 用于圆点普通态。
export const INK = {
  strong: 'rgba(12,12,12,.92)',
  body: 'rgba(12,12,12,.80)',
  soft: 'rgba(12,12,12,.72)',
  rule: 'rgba(12,12,12,.24)',
  dot: 'rgba(12,12,12,.50)',
  solid: '#0C0C0C',
};

const MAX_L = 88;

/**
 * 第 index 张卡的底色：以主色为第 1 档，按卡片总数在主色明度到封顶明度之间均匀分配阶梯，
 * 多卡时每张仍可区分，不会在第几张后停止渐变。
 * @param {number} index 0 起的序号
 * @param {number} total 卡片总数
 * @returns {{ bg: string, accent: string, lightness: number, ink: object }}
 */
export function shade(index, total = 4) {
  const span = MAX_L - MAIN.l;
  const step = total > 1 ? span / (total - 1) : 0;
  const lightness = Number(Math.min(MAIN.l + step * index, MAX_L).toFixed(1));
  return {
    bg: `hsl(${MAIN.hue} ${MAIN.sat}% ${lightness}%)`,
    accent: INK.strong,
    lightness,
    ink: INK,
  };
}

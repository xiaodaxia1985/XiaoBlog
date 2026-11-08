// 把文章 Markdown 拆成杂志式版块：首屏 hook、节编号、判断块、引用卡、图与图注。
// 只处理本站实际用到的语法：## / ###、段落、- 与 1. 列表、**粗体**、`代码`、链接、<img>。
// 所有文字都来自原文，只做位置重排：提取强调句、引用句，超长段落按句号边界拆开。

export type FigureBlock = {
  type: 'figure';
  src: string;
  alt: string;
  width?: string;
  height?: string;
};

export type Block =
  | { type: 'p'; html: string }
  | { type: 'hook'; html: string }
  | { type: 'key'; html: string }
  | { type: 'quote'; html: string }
  | { type: 'h3'; html: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | FigureBlock;

export type Section = {
  num: string;
  label: string;
  title: string;
  blocks: Block[];
};

export type ArticleLayout = {
  intro: Block[];
  sections: Section[];
  end: string[];
};

type RawBlock =
  | { kind: 'p'; raw: string }
  | { kind: 'h3'; raw: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'img'; src: string; alt: string; width?: string; height?: string };

type RawSection = { title: string; blocks: RawBlock[] };

const STRONG: RegExp[] = [
  /不是[^。]{0,60}而是/,
  /而是/,
  /真正/,
  /其实/,
  /才发现|才意识/,
  /越来越/,
  /意味着/,
  /只有/,
  /必须/,
  /关键/,
  /本质/,
  /核心/,
  /问题在于/,
  /而不是/,
  /不能/,
  /不会/,
  /没有/,
];

// 手机每行约 21 个汉字，4 行约 84 字；按视觉宽度（汉字 1、拉丁字符约 0.55）控制拆段。
const MAX_PARA_WIDTH = 84;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(raw: string): string {
  const segments = raw.split(/(`[^`]+`)/g);
  return segments
    .map((seg) => {
      if (/^`[^`]+`$/.test(seg)) return `<code>${escapeHtml(seg.slice(1, -1))}</code>`;
      let text = escapeHtml(seg);
      text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
      return text;
    })
    .join('');
}

function plain(raw: string): string {
  return raw
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function plainLen(raw: string): number {
  return plain(raw).length;
}

/** 估算排版宽度：汉字按 1 个字宽，拉丁字符、数字与半角标点按 0.55 计。 */
function visualWidth(raw: string): number {
  let total = 0;
  for (const ch of plain(raw)) {
    total += /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.55;
  }
  return total;
}

/** 句号是否落在 ** 粗体或 `代码` 内部；内部不切，避免把标记拆成半个。 */
function insideInline(raw: string, index: number): boolean {
  const head = raw.slice(0, index + 1);
  const bold = (head.match(/\*\*/g) || []).length;
  const ticks = (head.match(/`/g) || []).length;
  return bold % 2 === 1 || ticks % 2 === 1;
}

/** 按句号、问号、叹号、省略号切句，保留标点；句尾紧跟的收引号一并归入。 */
function splitSentences(raw: string): string[] {
  const out: string[] = [];
  let buf = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    buf += ch;
    if ('。！？…'.includes(ch) && !insideInline(raw, i)) {
      while (i + 1 < raw.length && '。！？…”’」』）)'.includes(raw[i + 1])) {
        i += 1;
        buf += raw[i];
      }
      out.push(buf);
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf);
  return out;
}

function parseSections(body: string): RawSection[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const sections: RawSection[] = [{ title: '', blocks: [] }];
  let cur = sections[0];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushPara = () => {
    if (!para.length) return;
    const text = para.join('').trim();
    para = [];
    if (text) cur.blocks.push({ kind: 'p', raw: text });
  };
  const flushList = () => {
    if (!list) return;
    cur.blocks.push({ kind: 'list', ordered: list.ordered, items: list.items });
    list = null;
  };

  for (const line of lines) {
    const text = line.trim();
    if (!text) {
      flushPara();
      // 列表项之间允许空行，列表本身不在这里结束
      continue;
    }
    if (/^##\s+/.test(text)) {
      flushPara();
      flushList();
      cur = { title: text.replace(/^##\s+/, '').trim(), blocks: [] };
      sections.push(cur);
      continue;
    }
    if (/^###\s+/.test(text)) {
      flushPara();
      flushList();
      cur.blocks.push({ kind: 'h3', raw: text.replace(/^###\s+/, '').trim() });
      continue;
    }
    if (/^<img\b/i.test(text)) {
      flushPara();
      flushList();
      const src = text.match(/src=["']([^"']+)["']/)?.[1] ?? '';
      const alt = text.match(/alt=["']([^"']*)["']/)?.[1] ?? '';
      const width = text.match(/width=["']([^"']+)["']/)?.[1];
      const height = text.match(/height=["']([^"']+)["']/)?.[1];
      if (src) cur.blocks.push({ kind: 'img', src, alt, width, height });
      continue;
    }
    const ordered = text.match(/^(\d+)\.\s+(.*)$/);
    const bullet = text.match(/^[-*+]\s+(.*)$/);
    if (ordered || bullet) {
      flushPara();
      const isOrdered = Boolean(ordered);
      const item = (ordered ? ordered[2] : bullet![1]).trim();
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push(item);
      continue;
    }
    flushList();
    para.push(text);
  }
  flushPara();
  flushList();
  return sections;
}

/** 单句过长时退到逗号处断开，保证手机每段 ≤ 4 行。 */
function splitLongSentence(raw: string): string[] {
  if (visualWidth(raw) <= MAX_PARA_WIDTH) return [raw];
  const parts: string[] = [];
  let buf = '';
  for (let i = 0; i < raw.length; i += 1) {
    buf += raw[i];
    if ('，、；'.includes(raw[i]) && !insideInline(raw, i) && visualWidth(buf) >= 64) {
      parts.push(buf);
      buf = '';
    }
  }
  if (buf.trim()) parts.push(buf);
  return parts.length ? parts : [raw];
}

function splitParagraph(raw: string): string[] {
  if (visualWidth(raw) <= MAX_PARA_WIDTH) return [raw];
  const sentences = splitSentences(raw);
  if (sentences.length <= 1) return splitLongSentence(raw);
  const out: string[] = [];
  let buf = '';
  for (const sentence of sentences) {
    if (buf && visualWidth(buf + sentence) > MAX_PARA_WIDTH) {
      out.push(buf);
      buf = sentence;
    } else {
      buf += sentence;
    }
  }
  if (buf.trim()) out.push(buf);
  return out.map((chunk) => splitLongSentence(chunk)).flat();
}

function scoreKey(sentence: string, index: number, total: number): number {
  const len = plainLen(sentence);
  if (len < 14 || len > 60) return -1;
  if (/[：:]$/.test(sentence.trim())) return -1;
  let score = 0;
  for (const re of STRONG) if (re.test(sentence)) score += 2;
  if (len >= 20 && len <= 42) score += 2;
  else if (len > 42 && len <= 55) score += 1;
  const pos = total <= 1 ? 0.5 : index / (total - 1);
  if (pos > 0.28 && pos < 0.85) score += 1;
  return score;
}

/** 每节挑一处判断句：优先带转折 / 判断词、长度适中的句子。 */
function pickKey(section: RawSection): { block: number; sentence: number } | null {
  const candidates: { block: number; sentence: number; score: number; len: number }[] = [];
  section.blocks.forEach((block, blockIndex) => {
    if (block.kind !== 'p' || block.raw.startsWith('[[')) return;
    const sentences = splitSentences(block.raw);
    sentences.forEach((sentence, sentenceIndex) => {
      const score = scoreKey(sentence, sentenceIndex, sentences.length);
      if (score >= 0) candidates.push({ block: blockIndex, sentence: sentenceIndex, score, len: plainLen(sentence) });
    });
  });
  if (!candidates.length) return null;
  const best = candidates.reduce((a, b) => (b.score > a.score || (b.score === a.score && b.len > a.len) ? b : a));
  if (best.score >= 2) return best;
  const fallback = candidates.filter((c) => c.len >= 18).sort((a, b) => b.len - a.len)[0];
  return fallback ? { block: fallback.block, sentence: fallback.sentence } : null;
}

function applyKey(blocks: RawBlock[], pick: { block: number; sentence: number }): RawBlock[] {
  const out: RawBlock[] = [];
  blocks.forEach((block, index) => {
    if (index !== pick.block || block.kind !== 'p') {
      out.push(block);
      return;
    }
    const sentences = splitSentences(block.raw);
    const before = sentences.slice(0, pick.sentence).join('');
    const key = sentences[pick.sentence] ?? '';
    const after = sentences.slice(pick.sentence + 1).join('');
    if (before.trim()) out.push({ kind: 'p', raw: before.trim() });
    if (key.trim()) out.push({ kind: 'p', raw: `[[key]]${key.trim()}` });
    if (after.trim()) out.push({ kind: 'p', raw: after.trim() });
  });
  return out;
}

function quoteScore(raw: string): number {
  const len = plainLen(raw);
  if (len < 16 || len > 74) return -1;
  if (/[：:]$/.test(raw.trim())) return -1;
  let score = 0;
  if (/不是[^。]{0,60}而是/.test(raw)) score += 4;
  for (const re of STRONG) if (re.test(raw)) score += 1;
  if (/。/.test(raw)) score += 1;
  return score;
}

export function layoutArticle(body: string, label: string): ArticleLayout {
  const parsed = parseSections(body);
  const introRaw = parsed[0];
  const rawSections = parsed.slice(1);

  // 1. 首屏 hook：开头一段足够短时放大
  let introBlocks = introRaw.blocks;
  let hookHtml = '';
  const firstP = introBlocks[0];
  if (firstP && firstP.kind === 'p' && plainLen(firstP.raw) <= 18) {
    hookHtml = inline(firstP.raw);
    introBlocks = introBlocks.slice(1);
  }

  // 2. 结尾三行：最后一段开始连续短句，最多取 3 段
  const end: string[] = [];
  if (rawSections.length) {
    const last = rawSections[rawSections.length - 1];
    const trailing: number[] = [];
    for (let i = last.blocks.length - 1; i >= 0 && trailing.length < 3; i -= 1) {
      const block = last.blocks[i];
      if (block.kind !== 'p' || block.raw.startsWith('[[')) break;
      if (plainLen(block.raw) > 28) break;
      trailing.unshift(i);
    }
    if (trailing.length >= 2) {
      end.push(...trailing.map((i) => inline((last.blocks[i] as { raw: string }).raw)));
      last.blocks = last.blocks.filter((_, i) => !trailing.includes(i));
    }
  }

  // 3. 引用卡：整段抽为引用，优先中段、带“不是……而是”“真正”等判断的短段
  const quotePicks: { section: number; block: number; score: number }[] = [];
  rawSections.forEach((section, sectionIndex) => {
    if (sectionIndex < 1 || sectionIndex > 4) return;
    section.blocks.forEach((block, blockIndex) => {
      if (block.kind !== 'p' || block.raw.startsWith('[[')) return;
      const score = quoteScore(block.raw);
      if (score >= 4) quotePicks.push({ section: sectionIndex, block: blockIndex, score });
    });
  });
  const quotes = quotePicks.sort((a, b) => b.score - a.score).slice(0, 2);
  const seenSection = new Set<number>();
  const appliedQuotes = quotes.filter((q) => {
    if (seenSection.has(q.section)) return false;
    seenSection.add(q.section);
    return true;
  });
  for (const q of appliedQuotes) {
    const block = rawSections[q.section].blocks[q.block];
    if (block && block.kind === 'p') {
      rawSections[q.section].blocks[q.block] = { kind: 'p', raw: `[[quote]]${block.raw}` };
    }
  }

  // 4. 每节一处判断块
  rawSections.forEach((section) => {
    const pick = pickKey(section);
    if (!pick) return;
    section.blocks = applyKey(section.blocks, pick);
  });

  // 5. 组装：超长段落按句号拆到手机 4 行以内
  const toBlock = (raw: string): Block => {
    if (raw.startsWith('[[key]]')) return { type: 'key', html: inline(raw.slice(7)) };
    if (raw.startsWith('[[quote]]')) return { type: 'quote', html: inline(raw.slice(9)) };
    return { type: 'p', html: inline(raw) };
  };

  const buildBlocks = (blocks: RawBlock[]): Block[] =>
    blocks
      .map((block) => {
        if (block.kind === 'p') {
          if (block.raw.startsWith('[[')) return [toBlock(block.raw)];
          return splitParagraph(block.raw).map((chunk) => ({ type: 'p', html: inline(chunk) }) as Block);
        }
        if (block.kind === 'h3') return [{ type: 'h3', html: inline(block.raw) }];
        if (block.kind === 'list') return [{ type: 'list', ordered: block.ordered, items: block.items.map(inline) }];
        return [{ type: 'figure', src: block.src, alt: block.alt, width: block.width, height: block.height }];
      })
      .flat();

  const intro: Block[] = [
    ...(hookHtml ? [{ type: 'hook', html: hookHtml } as Block] : []),
    ...buildBlocks(introBlocks),
  ];

  const sections: Section[] = rawSections.map((section, index) => ({
    num: String(index + 1).padStart(2, '0'),
    label,
    title: section.title,
    blocks: buildBlocks(section.blocks),
  }));

  return { intro, sections, end };
}

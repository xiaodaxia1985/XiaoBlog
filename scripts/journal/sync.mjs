// 每日记录同步：从四个仓库的 git 历史聚合「当天做了什么」，输出待审草稿。
// 铁律：脚本只写 journal/.inbox/<date>.json 草稿，绝不直接改 journal/daily.json。
// 草稿需用户审核通过后，再跑 journal:accept 才进入正式数据（入 git）。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'E:/works/New Journal/个人商业实战';
const SITE = path.join(ROOT, 'site/XiaoBlog');
const JOURNAL = path.join(SITE, 'journal');
const INBOX = path.join(JOURNAL, '.inbox');

const GIT = fs.existsSync('C:/Program Files/Git/cmd/git.exe') ? 'C:/Program Files/Git/cmd/git.exe' : 'git';

const REPOS = [
  { key: 'xiaoblog', dir: SITE, label: '站点' },
  { key: 'engine', dir: path.join(ROOT, 'engine'), label: '产线' },
  { key: 'text2media', dir: path.join(ROOT, 'text2Media'), label: '产线' },
  { key: 'webppt', dir: path.join(ROOT, 'productions/webppt'), label: '产线' },
];

// 路径 → 面的映射。维护点：新目录出现时在首条命中后补规则即可。
const PATH_RULES = {
  xiaoblog: [
    ['src/content/', '内容'],
    ['src/pages/', '站点'],
    ['src/components/', '站点'],
    ['src/layouts/', '站点'],
    ['src/data/', '站点'],
    ['src/lib/', '站点'],
    ['public/', '站点'],
    ['scripts/', '站点'],
    ['server/', '站点'],
    ['docs/', '文档'],
    ['journal/', '内容'],
  ],
  engine: [
    ['src/pieces/', '产线'],
    ['src/vbase/', '产线'],
    ['src/epbase/', '产线'],
    ['src/a2e/', '产线'],
    ['tools/', '产线'],
    ['releases/', '产线'],
    ['docs/', '文档'],
  ],
  text2media: [
    ['skills/', '产线'],
    ['docs/', '文档'],
  ],
  webppt: [
    ['src/', '产线'],
    ['deck/', '产线'],
    ['demo/', '产线'],
    ['scripts/', '产线'],
    ['prompts/', '产线'],
    ['public/', '产线'],
    ['docs/', '文档'],
  ],
};

// 改动面 → 中文类别（展示用）
function areaOf(repoKey, filePath) {
  const rules = PATH_RULES[repoKey] || [];
  for (const [prefix, face] of rules) {
    if (filePath.startsWith(prefix)) return { face, area: prefix.replace(/\/$/, '') };
  }
  return { face: repoKey === 'xiaoblog' ? '站点' : '产线', area: '其他' };
}

function git(repoDir, args, opts = {}) {
  return execFileSync(GIT, ['-C', repoDir, '-c', 'core.quotepath=false', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
}

function parseLog(repoDir) {
  // 一次拿到 hash / 日期 / subject 与 numstat，按 \x1e 分块
  const raw = git(repoDir, ['log', '--date=short', '--numstat', '--pretty=format:%x1e%H%x09%ad%x09%s']);
  const blocks = raw.split('\x1e').filter((b) => b.trim());
  const commits = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const head = lines[0];
    const [hash, date, ...subjectParts] = head.split('\t');
    const subject = subjectParts.join('\t');
    const files = [];
    let add = 0;
    let del = 0;
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const parts = line.split('\t');
      if (parts.length < 3) continue;
      const [a, d, file] = parts;
      files.push(file);
      add += a === '-' ? 0 : Number(a) || 0;
      del += d === '-' ? 0 : Number(d) || 0;
    }
    commits.push({ hash, date, subject, files, add, del, added: [] });
  }
  // 新增文件单独取：只有当次是 A（新增）才算「新发布」，改 frontmatter 不算
  const statusRaw = git(repoDir, ['log', '--name-status', '--pretty=format:%x1e%H']);
  for (const block of statusRaw.split('\x1e').filter((b) => b.trim())) {
    const lines = block.split('\n');
    const hash = lines[0].trim();
    const target = commits.find((c) => c.hash === hash);
    if (!target) continue;
    for (const line of lines.slice(1)) {
      const m = line.match(/^A\s+(.+)$/);
      if (m) target.added.push(m[1]);
    }
  }
  return commits;
}

const NOISE = /^(Merge |Merge pull|Revert |chore:\s*bump|chore\(deps\)|\s*wip)/i;
const LOCKFILES = /(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|\.webp|\.png|\.jpg)$/i;

const TYPES = new Set(['feat', 'fix', 'chore', 'docs', 'content', 'refactor', 'style', 'test', 'perf', 'build', 'ci', 'ops', 'release', 'polish', 'a11y', 'seo']);

function parseSubject(subject) {
  // 只认「已知 type(可选 scope): 标题」，否则整句当标题。避免把 EP03、article-video 这类词误判成 type。
  const m = subject.match(/^([a-zA-Z]+)(?:\(([^)]+)\))?:\s+(.+)$/);
  if (m && TYPES.has(m[1].toLowerCase())) {
    return { type: m[1].toLowerCase(), scope: m[2] || '', title: m[3].trim() };
  }
  // 无 type 前缀时，若无空格前导词就直接当标题
  const clean = subject.replace(/^\s*[-*]\s*/, '').trim();
  return { type: 'other', scope: '', title: clean };
}

// 是否需要翻译：subject 里有连续英文单词且几乎没有中文
function needsTranslation(subject) {
  const cjk = (subject.match(/[\u4e00-\u9fa5]/g) || []).length;
  const latinWords = (subject.match(/[A-Za-z]{3,}/g) || []).length;
  return latinWords >= 2 && cjk < latinWords;
}

function slugFromFile(file) {
  const m = file.match(/src\/content\/insights\/([^/]+)\.md$/);
  return m ? m[1] : null;
}

function frontmatterTitle(siteDir, slug) {
  const p = path.join(siteDir, 'src/content/insights', slug + '.md');
  if (!fs.existsSync(p)) return null;
  const head = fs.readFileSync(p, 'utf8').slice(0, 2000);
  const m = head.match(/^title:\s*["']?(.*?)["']?\s*$/m);
  return m ? m[1] : null;
}

function parseMarkdownSections(file) {
  if (!fs.existsSync(file)) return new Map();
  const text = fs.readFileSync(file, 'utf8');
  const out = new Map();
  let cur = null;
  for (const line of text.split('\n')) {
    const h = line.match(/^##\s+(\d{4}-\d{2}-\d{2})/);
    if (h) {
      cur = h[1];
      out.set(cur, []);
      continue;
    }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li && cur) {
      const item = li[1].trim();
      const tag = (item.match(/^\[(判断|失误|活动|反馈|收入|里程碑)\]\s*/) || [])[1] || '';
      out.get(cur).push({ tag: tag || '补充', text: item.replace(/^\[[^\]]+\]\s*/, '') });
    }
  }
  return out;
}

function buildDraft(dateFilter) {
  const all = [];
  for (const repo of REPOS) {
    let commits = [];
    try { commits = parseLog(repo.dir); } catch (e) { console.error('skip repo', repo.key, e.message); }
    for (const c of commits) all.push({ ...c, repo: repo.key, repoLabel: repo.label });
  }

  const byDate = new Map();
  for (const c of all) {
    if (dateFilter && c.date !== dateFilter) continue;
    if (NOISE.test(c.subject)) continue;
    const { type, scope, title } = parseSubject(c.subject);
    const realFiles = c.files.filter((f) => !LOCKFILES.test(f));
    if (!realFiles.length && !title) continue;

    // 主面：取改动文件里第一个非内容文件的归属
    const faces = new Set();
    const areas = new Set();
    for (const f of realFiles) {
      const { face, area } = areaOf(c.repo, f);
      faces.add(face);
      areas.add(face + '/' + area);
    }
    const primaryFace = faces.has('内容') && faces.size === 1 ? '内容' : (faces.has('站点') ? '站点' : (faces.has('文档') && faces.size === 1 ? '文档' : '产线'));

    if (!byDate.has(c.date)) byDate.set(c.date, []);
    byDate.get(c.date).push({
      hash: c.hash.slice(0, 7),
      repo: c.repo,
      face: primaryFace,
      type,
      scope,
      title,
      files: realFiles.length,
      areas: [...areas],
      add: c.add,
      del: c.del,
      needsTranslation: needsTranslation(title),
      slugs: c.added.filter((f) => !LOCKFILES.test(f)).map(slugFromFile).filter(Boolean),
    });
  }

  const activities = parseMarkdownSections(path.join(JOURNAL, 'activity.md'));
  const milestones = parseMarkdownSections(path.join(JOURNAL, 'milestones.md'));

  const drafts = [];
  for (const [date, list] of [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
    // 同 (face, type, scope) 合并；无 type 前缀的按标题前缀（冒号前）聚合，避免 20 条 releases 挤在一起
    const groupKeyOf = (c) => {
      const base = c.type !== 'other'
        ? `${c.type}|${c.scope}`
        : `other|${c.title.split(/[：:（(，,]/)[0].trim().slice(0, 14)}`;
      return c.face + '|' + base;
    };
    const groups = new Map();
    for (const c of list) {
      const k = groupKeyOf(c);
      if (!groups.has(k)) groups.set(k, { ...c, hashes: [c.hash], merged: 1, titles: [c.title] });
      else {
        const g = groups.get(k);
        g.merged += 1;
        g.hashes.push(c.hash);
        g.files += c.files;
        if (g.titles.length < 4) g.titles.push(c.title);
      }
    }
    const items = [...groups.values()]
      .sort((a, b) => b.files - a.files)
      .map((g) => ({ ...g, hashes: g.hashes.slice(0, 6) }));

    const slugs = [...new Set(list.flatMap((c) => c.slugs))];
    const posts = slugs.map((s) => ({ slug: s, title: frontmatterTitle(SITE, s) || s, url: `/insight/${s}/` })).filter((p) => p.title);

    const entry = {
      date,
      totalCommits: list.length,
      totalFiles: list.reduce((n, c) => n + c.files, 0),
      faces: {},
      items,
      posts,
      activities: activities.get(date) || [],
      milestones: milestones.get(date) || [],
      needsTranslation: items.filter((i) => i.needsTranslation).map((i) => ({ hash: i.hashes[0], title: i.title })),
    };
    for (const it of items) {
      entry.faces[it.face] = entry.faces[it.face] || { count: 0, files: 0 };
      entry.faces[it.face].count += it.merged;
      entry.faces[it.face].files += it.files;
    }
    drafts.push(entry);
  }
  return drafts;
}

function printSummary(drafts) {
  for (const d of drafts) {
    const faces = Object.entries(d.faces).map(([f, v]) => `${f} ${v.count} 条/${v.files} 文件`).join('，');
    console.log(`\n== ${d.date} ==  ${d.totalCommits} 个提交 · ${faces}`);
    for (const it of d.items.slice(0, 8)) {
      const flag = it.needsTranslation ? '  [需翻译]' : '';
      console.log(`  - [${it.face}/${it.type}${it.scope ? '/' + it.scope : ''}] ${it.title}${it.merged > 1 ? `  (+${it.merged - 1} 合并)` : ''}${flag}  ${it.hashes[0]}`);
    }
    if (d.items.length > 8) console.log(`  … 另有 ${d.items.length - 8} 条`);
    if (d.posts.length) console.log(`  发文：${d.posts.map((p) => p.title).join('、')}`);
    if (d.activities.length) console.log(`  活动：${d.activities.map((a) => `[${a.tag}]${a.text}`).join(' | ')}`);
    if (d.milestones.length) console.log(`  里程碑：${d.milestones.map((m) => m.text).join(' | ')}`);
    if (d.needsTranslation.length) console.log(`  待翻译 ${d.needsTranslation.length} 条`);
  }
}

const argv = process.argv.slice(2);
const argOf = (name, def = null) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : def;
};

const dateArg = argOf('date');
const sinceArg = argOf('since');

fs.mkdirSync(INBOX, { recursive: true });
const drafts = buildDraft(dateArg);
printSummary(drafts);

const outPath = dateArg
  ? path.join(INBOX, `${dateArg}.json`)
  : path.join(INBOX, 'batch-' + (sinceArg || 'all') + '.json');
fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), drafts }, null, 2), 'utf8');
console.log(`\n草稿已写入 ${path.relative(SITE, outPath)}（未入 git，待审核）`);

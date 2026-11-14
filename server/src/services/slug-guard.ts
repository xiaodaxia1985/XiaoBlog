import fs from 'node:fs';

/**
 * slug 白名单：只接受静态站构建产物里存在的已发布文章 slug。
 * 清单文件由前端构建生成（public/data/slugs.json），API 不接受任意 slug 写入。
 */
export class SlugGuard {
  private readonly allowed: ReadonlySet<string>;

  constructor(whitelistFile: string) {
    let list: string[] = [];
    try {
      const raw = JSON.parse(fs.readFileSync(whitelistFile, 'utf8'));
      list = Array.isArray(raw) ? raw : raw.slugs ?? [];
    } catch (err) {
      // 清单缺失时拒绝全部，避免裸奔写入。
      console.error(`[slug-guard] 白名单读取失败 ${whitelistFile}:`, err);
      list = [];
    }
    this.allowed = new Set(list);
  }

  isAllowed(slug: string): boolean {
    return this.allowed.has(slug);
  }
}

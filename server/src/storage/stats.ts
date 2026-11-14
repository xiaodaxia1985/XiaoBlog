import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { articleStats } from '../db/schema';
import type { ArticleStats } from './types';

const ZERO: ArticleStats = { views: 0, likes: 0, dislikes: 0 };

/**
 * 物化计数仓储：读走 article_stats；点赞数以 votes 为唯一事实源，
 * 投票变更后由 recomputeFromVotes 回填，避免计数漂移。
 */
export class StatsRepo {
  async get(slug: string): Promise<ArticleStats> {
    const rows = await db.select().from(articleStats).where(eq(articleStats.slug, slug)).limit(1);
    const row = rows[0];
    if (!row) return { ...ZERO };
    return { views: row.views, likes: row.likes, dislikes: row.dislikes };
  }

  /** 阅读量 +1（幂等性由 view_dedup 在上层保证）。 */
  async recordView(slug: string): Promise<void> {
    await db
      .insert(articleStats)
      .values({ slug, views: 1 })
      .onConflictDoUpdate({
        target: articleStats.slug,
        set: { views: sql`${articleStats.views} + 1`, updatedAt: sql`now()` },
      });
  }

  /** 以 votes 为准回填点赞/点踩计数。 */
  async recomputeFromVotes(slug: string, counts: { likes: number; dislikes: number }): Promise<void> {
    await db
      .insert(articleStats)
      .values({ slug, views: 0, likes: counts.likes, dislikes: counts.dislikes })
      .onConflictDoUpdate({
        target: articleStats.slug,
        set: { likes: counts.likes, dislikes: counts.dislikes, updatedAt: sql`now()` },
      });
  }
}

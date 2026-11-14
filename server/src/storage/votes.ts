import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { votes } from '../db/schema';
import type { VoteChoice, VoteRecord } from './types';

/**
 * 点赞仓储：唯一键 (slug, voter_hash)，改票更新原行，不产生重复票。
 * 路由层只允许调用本仓储方法，不直接写 SQL。
 */
export class VoteRepo {
  async getVote(slug: string, voterHash: string): Promise<VoteRecord | null> {
    const rows = await db
      .select()
      .from(votes)
      .where(and(eq(votes.slug, slug), eq(votes.voterHash, voterHash)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { slug: row.slug, voterHash: row.voterHash, choice: row.choice as VoteChoice };
  }

  /** 写入或更新投票；返回最终选择与是否发生变化。 */
  async upsertVote(
    slug: string,
    voterHash: string,
    choice: VoteChoice
  ): Promise<{ choice: VoteChoice; changed: boolean }> {
    const existing = await this.getVote(slug, voterHash);
    if (existing && existing.choice === choice) {
      return { choice, changed: false };
    }

    await db
      .insert(votes)
      .values({ slug, voterHash, choice })
      .onConflictDoUpdate({
        target: [votes.slug, votes.voterHash],
        set: { choice, updatedAt: sql`now()` },
      });

    return { choice, changed: true };
  }

  /** 取消当前访客的票（用于再次点击取消）。 */
  async removeVote(slug: string, voterHash: string): Promise<void> {
    await db.delete(votes).where(and(eq(votes.slug, slug), eq(votes.voterHash, voterHash)));
  }

  async countsBySlug(slug: string): Promise<{ likes: number; dislikes: number }> {
    const rows = await db
      .select({
        choice: votes.choice,
        n: sql<number>`count(*)::int`,
      })
      .from(votes)
      .where(eq(votes.slug, slug))
      .groupBy(votes.choice);

    const result = { likes: 0, dislikes: 0 };
    for (const row of rows) {
      if (row.choice === 'like') result.likes = row.n;
      if (row.choice === 'dislike') result.dislikes = row.n;
    }
    return result;
  }
}

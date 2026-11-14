import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { viewDedup } from '../db/schema';

/**
 * 阅读去重仓储：同一访客同一天同一篇文章只记一次。
 * 写入冲突视为已看过，不报错。
 */
export class ViewRepo {
  async hasViewedToday(slug: string, visitorHash: string): Promise<boolean> {
    const rows = await db
      .select({ id: sql<number>`1` })
      .from(viewDedup)
      .where(
        and(
          eq(viewDedup.slug, slug),
          eq(viewDedup.visitorHash, visitorHash),
          sql`viewed_date = current_date`
        )
      )
      .limit(1);
    return rows.length > 0;
  }

  /** 记录一次阅读；返回是否为今日首次（需要计入阅读量）。 */
  async markViewed(slug: string, visitorHash: string): Promise<boolean> {
    const inserted = await db
      .insert(viewDedup)
      .values({ slug, visitorHash })
      .onConflictDoNothing()
      .returning({ slug: viewDedup.slug });
    return inserted.length > 0;
  }
}

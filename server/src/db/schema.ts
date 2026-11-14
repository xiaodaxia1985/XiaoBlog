import { pgTable, bigserial, text, integer, timestamp, date, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';

/**
 * 点赞/点踩：同一访客（voter_hash）对同一篇文章仅一条记录，改票更新原行。
 * 唯一键 (slug, voter_hash)。
 */
export const votes = pgTable(
  'votes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    slug: text('slug').notNull(),
    voterHash: text('voter_hash').notNull(),
    choice: text('choice', { enum: ['like', 'dislike'] }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    slugVoterIdx: uniqueIndex('votes_slug_voter_idx').on(table.slug, table.voterHash),
  })
);

/**
 * 物化计数：列表/详情直接读，避免每次聚合 votes。
 * 与 votes 不一致时由仓储层按 votes 重算回填。
 */
export const articleStats = pgTable('article_stats', {
  slug: text('slug').primaryKey(),
  views: integer('views').notNull().default(0),
  likes: integer('likes').notNull().default(0),
  dislikes: integer('dislikes').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * 阅读量当日去重：同一访客同一天同一篇只计一次。
 * 复合主键 (slug, visitor_hash, viewed_date)。
 */
export const viewDedup = pgTable(
  'view_dedup',
  {
    slug: text('slug').notNull(),
    visitorHash: text('visitor_hash').notNull(),
    viewedDate: date('viewed_date').notNull().defaultNow(),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.slug, table.visitorHash, table.viewedDate] }),
  })
);

/**
 * 预留实体（后续批次只加迁移，不改业务调用层）：
 * comments、subscribers、contact_messages、assets、audit_events。
 * 当前不建表，避免空表与无业务写入；对应迁移在需要时以 forward-only 方式追加。
 */

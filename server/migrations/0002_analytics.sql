-- 0002_analytics.sql — 后台数据统计：整体快照 / 每平台聚合 / 逐条作品
-- 前向迁移，全部 IF NOT EXISTS，可重复执行；后续变更只追加 0003_*.sql，不改本文件。
-- 执行：psql "$DATABASE_URL" -f server/migrations/0002_analytics.sql
--       server/ingest-analytics.mjs 每次入库前也会自动跑一遍本文件。

CREATE TABLE IF NOT EXISTS analytics_snapshot (
  id            BIGSERIAL PRIMARY KEY,
  observed_at   TIMESTAMPTZ NOT NULL,
  observed_date DATE        NOT NULL,
  timezone      TEXT        NOT NULL DEFAULT 'Asia/Shanghai',
  disclaimer    TEXT,
  analysis      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  source_file   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS analytics_snapshot_observed_uq
  ON analytics_snapshot (observed_at);
CREATE INDEX IF NOT EXISTS analytics_snapshot_date_idx
  ON analytics_snapshot (observed_date DESC);
COMMENT ON TABLE analytics_snapshot IS '每次抓取一条整体快照：元信息 + 各平台中文分析文本';

CREATE TABLE IF NOT EXISTS analytics_daily (
  id            BIGSERIAL PRIMARY KEY,
  observed_at   TIMESTAMPTZ NOT NULL,
  observed_date DATE        NOT NULL,
  platform      TEXT        NOT NULL CHECK (platform IN ('douyin','wechat','kuaishou','xiaohongshu')),
  summary       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS analytics_daily_uq
  ON analytics_daily (observed_at, platform);
CREATE INDEX IF NOT EXISTS analytics_daily_lookup_idx
  ON analytics_daily (platform, observed_date DESC);
COMMENT ON TABLE analytics_daily IS '每平台每次抓取的聚合指标，原始 summary 原样存 JSONB';

CREATE TABLE IF NOT EXISTS analytics_works (
  id            BIGSERIAL PRIMARY KEY,
  observed_at   TIMESTAMPTZ NOT NULL,
  observed_date DATE        NOT NULL,
  platform      TEXT        NOT NULL CHECK (platform IN ('douyin','wechat','kuaishou')),
  work_key      TEXT        NOT NULL,
  title         TEXT,
  pub_date      TEXT,
  status        TEXT,
  metrics       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS analytics_works_uq
  ON analytics_works (observed_at, platform, work_key);
CREATE INDEX IF NOT EXISTS analytics_works_lookup_idx
  ON analytics_works (platform, observed_date DESC);
COMMENT ON TABLE analytics_works IS '逐条作品/文章明细；work_key = sha1(platform|title|pub_date|status) 前 20 位';
COMMENT ON COLUMN analytics_works.work_key IS '同一天同一条作品跨次抓取保持稳定，用于幂等 upsert';

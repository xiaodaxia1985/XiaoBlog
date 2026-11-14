-- 0001_init.sql — forward-only 初始结构。可重复执行（IF NOT EXISTS）。
-- 后续变更只追加新迁移文件，不修改本文件。

CREATE TABLE IF NOT EXISTS votes (
  id          BIGSERIAL PRIMARY KEY,
  slug        TEXT NOT NULL,
  voter_hash  TEXT NOT NULL,
  choice      TEXT NOT NULL CHECK (choice IN ('like', 'dislike')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS votes_slug_voter_idx
  ON votes (slug, voter_hash);

CREATE TABLE IF NOT EXISTS article_stats (
  slug        TEXT PRIMARY KEY,
  views       INTEGER NOT NULL DEFAULT 0,
  likes       INTEGER NOT NULL DEFAULT 0,
  dislikes    INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS view_dedup (
  slug          TEXT NOT NULL,
  visitor_hash  TEXT NOT NULL,
  viewed_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  viewed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (slug, visitor_hash, viewed_date)
);

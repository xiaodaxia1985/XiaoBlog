-- 0003_diagnosis.sql · 个人商业诊断提交表（第一步未启用，先建表备用）
-- 对应页面：site/XiaoBlog/src/pages/system.astro
-- 请求体即 site/XiaoBlog/src/lib/diagnosis.mjs 的 answers 对象（键为题目 id，值为字符串或字符串数组）。

CREATE TABLE IF NOT EXISTS diagnosis_submissions (
  id            BIGSERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  schema_version TEXT NOT NULL,                 -- 例：pbs-diag-v0.1
  answers        JSONB NOT NULL,                -- { a1:"15", a3:["writing","design"], b1:"下周要交标书的项目经理", ... }
  report_md      TEXT,                          -- 客户端生成的 Markdown 全文（可空）
  top_score      NUMERIC(4,1),                  -- 机会最高分，便于后续按分筛选
  runway_months  NUMERIC(4,1),
  hours_week     INT,
  source         TEXT,                          -- 例：site/system?ref=xxx
  user_agent     TEXT,
  ip_hash        TEXT                           -- 只存加盐哈希，不存原 IP
);

CREATE INDEX IF NOT EXISTS idx_diagnosis_created ON diagnosis_submissions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_diagnosis_score ON diagnosis_submissions (top_score DESC);

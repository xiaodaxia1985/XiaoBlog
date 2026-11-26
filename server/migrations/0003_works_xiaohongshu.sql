-- 0003_works_xiaohongshu.sql — 逐条作品表放开小红书
-- 背景：0002 建表时 analytics_works.platform 的 CHECK 只允许 douyin/wechat/kuaishou，
--       导致小红书逐条明细虽然抓到了（10–18 条），入库时被 ingest 的 WORK_PLATFORMS 跳过，
--       线上 /api/analytics/latest 的 xiaohongshu.works 恒为空数组。
-- 做法：换掉匿名 CHECK 约束，补上 xiaohongshu。前向迁移，可重复执行。

ALTER TABLE analytics_works
  DROP CONSTRAINT IF EXISTS analytics_works_platform_check;

ALTER TABLE analytics_works
  ADD CONSTRAINT analytics_works_platform_check
  CHECK (platform IN ('douyin','wechat','kuaishou','xiaohongshu'));

COMMENT ON COLUMN analytics_works.platform IS '平台标识：douyin | wechat | kuaishou | xiaohongshu（0003 起含小红书）';

-- apps/api/db/migrations/20260715_150000_acquisition_leads_douyin_id.sql
-- Seg3 方案 B′：acquisition_leads 增加 douyin_id（评论人的真实抖音号）
--
-- 根因：派单侧 acquisition-dispatch.ts dispatchDue() 把 l.profile_url 塞进 dm payload，
-- 而 Android 端 DouyinDmOutreachService.startOutreach()（services/agent-android/.../
-- DouyinDmOutreachService.kt:151-153）把该字段【当抖音号搜索】：
--     val targetDouyinId = profileUrl
-- 设备拿 "https://www.douyin.com/user/MS4wLj..." 去抖音搜索框搜 → matchProfileByDouyinId
-- 零匹配 → NO_MATCH → 私信段 0 送达。
--
-- 根治：抓评论时点评论人头像进主页读出真实抖音号（真机 2026-07-15 xian-rog 实证：主页一次
-- dump 即含 resource-id=.../5mt、text="抖音号：1689210742"），随 comments[].douyin_id 上行，
-- 落到本列；派单发号不发 URL。实测该列此前【不存在】，读出来也无处可落。
--
-- 可空：读不到号的 lead 仍要能进库（宁可空，不可猜 —— PR #1306）。加 NOT NULL 会逼落库侧
-- 编一个假值填进去，那正是 #1306 修掉的病。存量行一律 NULL，等下次采到该评论人时回填。
--
-- 幂等：ADD COLUMN IF NOT EXISTS（重复跑安全）。非破坏性：不动任何已有数据。

ALTER TABLE zenithjoy.acquisition_leads
  ADD COLUMN IF NOT EXISTS douyin_id text;

COMMENT ON COLUMN zenithjoy.acquisition_leads.douyin_id IS
  '评论人真实抖音号（Seg3 点头像进主页读出）。派单发它给设备做精确搜索定位；NULL = 尚未读到，不可派 Android 私信。';

-- 不建索引：没有任何查询按 douyin_id 过滤（dispatchDue 按 l.id = $1 取 lead，
-- Step E 按 tenant_id + relevance_score 取）。等真出现按号查的热路径再加。

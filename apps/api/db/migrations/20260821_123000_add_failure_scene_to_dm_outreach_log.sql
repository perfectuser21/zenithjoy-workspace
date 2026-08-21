-- RPA 失败现场落进正表（invariant 93ed0761）。
--
-- PR#1687 已把 error_code 接进来，但"为什么会有这个错误码"还是看不见——
-- 0821 真正定位靠的是 agent 日志里的前台包名和那条诊断行，而它们只存在于
-- logcat，重启就没了。于是每次排查都得重新去 adb 抓，抓不到就只能猜。
ALTER TABLE zenithjoy.dm_outreach_log
  ADD COLUMN IF NOT EXISTS foreground_pkg TEXT,
  ADD COLUMN IF NOT EXISTS failure_diag   TEXT;

COMMENT ON COLUMN zenithjoy.dm_outreach_log.foreground_pkg IS
  '判失败那一刻手机前台是谁。0821 靠它拍到荣耀全局搜索接走输入、系统管家广告盖在抖音上';
COMMENT ON COLUMN zenithjoy.dm_outreach_log.failure_diag IS
  'agent 的诊断行（等待轮数/失败分类/找到了什么）。0821 靠它发现 searchBtnFound=true，推翻了"找不到搜索按钮"的错判';

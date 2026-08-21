-- 私信失败原因落进正表 —— NO_SEARCH_INPUT 反复"修好又复发"四次的元凶。
--
-- 现状：agent 把 error_code 上报上来了，服务端也收到了，但写 dm_outreach_log
-- （"私信成没成"的正表、看板读的就是它）的那条 UPDATE 只写 status，原因被丢在
-- 旁边 publish_tasks.response 的 JSONB 里，没人会去翻。于是看板上永远只有
-- "failed" 三个字。0821 硬翻 JSON 才发现连续 6 次全是同一个 NO_SEARCH_INPUT。
ALTER TABLE zenithjoy.dm_outreach_log
  ADD COLUMN IF NOT EXISTS error_code TEXT;

COMMENT ON COLUMN zenithjoy.dm_outreach_log.error_code IS
  'agent 上报的失败原因（NO_SEARCH_INPUT / DOUYIN_NOT_FOREGROUND / LEAD_TIMEOUT 等）；status=sent 时为 NULL';

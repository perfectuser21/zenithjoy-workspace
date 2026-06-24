-- Line04 客服每日工作报告（S4）— 每天结算把当天每客服 4 个数固化成历史日报
--
-- 与 S3 区别：S3 是实时今天/昨天（从 wechat_messages 现算）；S4 是每天北京 23:55 定时把当天
-- 冻结成一行历史日报，可翻任意一天回看。数据来源复用 S3 的 /cs/stats 聚合口径（不重发明）。
--
-- 唯一键 (cs_wechat_id, report_date) 保证幂等：同一天重复触发结算 → 覆盖同一行，不翻倍。
-- tenant_id nullable：结算时 best-effort 从 service_agents 解析（1 账户=1 机器=1 微信号），解不到不阻塞。
-- 幂等：CREATE TABLE / INDEX IF NOT EXISTS（E2E smoke 可重入）。

CREATE TABLE IF NOT EXISTS zenithjoy.daily_report (
  id                    BIGSERIAL PRIMARY KEY,
  cs_wechat_id          TEXT NOT NULL,
  tenant_id             TEXT,
  report_date           DATE NOT NULL,
  received_count        INTEGER NOT NULL DEFAULT 0,
  reply_count           INTEGER NOT NULL DEFAULT 0,
  served_customers      INTEGER NOT NULL DEFAULT 0,
  work_duration_minutes INTEGER NOT NULL DEFAULT 0,
  summary_text          TEXT NOT NULL DEFAULT '',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cs_wechat_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_report_date
  ON zenithjoy.daily_report (report_date);

COMMENT ON TABLE zenithjoy.daily_report
  IS 'Line04 客服每日工作报告（S4）：每天北京 23:55 把当天每客服 4 个数固化；(cs_wechat_id, report_date) 唯一保幂等';

-- agent_scan_failures：安卓端账号扫描失败留痕表
-- 背景（2026-07-28 issue，Path2真机复测暴露）：DeviceAccountScanService 扫描失败时会把
-- error_code/screenshot_b64/tree_dump POST 到 /account-scan-result，但服务端此前只有当
-- request_id 是合法 UUID 且能在 publish_tasks 查到对应行（即"Dashboard 手动触发扫描"这条
-- 路径）时才落库；手机内部30-60秒自动循环扫描（request_id="scan-<timestamp>"，占真机
-- 常态运行的绝大多数场景）失败时，这些信息此前被服务端无条件丢弃，只留在手机本地 logcat，
-- 服务端完全查不到失败原因（07-28 复测两台设备"中台无法绑定安卓机"卡点查无痕迹的根因）。
CREATE TABLE IF NOT EXISTS zenithjoy.agent_scan_failures (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      TEXT NOT NULL,
  request_id    TEXT,
  error_code    TEXT,
  detail        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_scan_failures_agent_created
  ON zenithjoy.agent_scan_failures (agent_id, created_at DESC);

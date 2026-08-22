-- apps/api/db/migrations/20260822_201800_rpa_locator_assist.sql
-- AI on-call 横切件 · 刀2a：定位求助出诊病历 + 中台缓存（一张表两用）。
--
-- 每次出诊（含缓存命中）一行：机型×安卓版本×抖音版本就是碎片化矩阵的格子坐标，
-- 也是缓存键与刀3 周报的聚类键。verified 列由刀2b 安卓端验证闸回执回填
-- （AI 指的候选点完预期状态是否真达成），周报据此判"AI 在该格子的答案是否稳定"。
--
-- 幂等：IF NOT EXISTS。

CREATE TABLE IF NOT EXISTS zenithjoy.rpa_locator_assist (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        text NOT NULL,
  step             text NOT NULL,
  target_desc      text NOT NULL,
  device_model     text,
  os_version       text,
  douyin_version   text,
  app_version      text,
  error_code       text,
  ui_tree_snapshot text,
  backend          text NOT NULL,
  model            text,
  answer_line      int,
  answer_selector  jsonb,
  verified         boolean,
  cache_hit        boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE zenithjoy.rpa_locator_assist IS
  'AI on-call 定位求助出诊病历+缓存：碎片化格子(机型×系统×抖音版本)每格 AI 成本只花一次；verified 由安卓验证闸回填，刀3周报据此固化定位器';

CREATE INDEX IF NOT EXISTS idx_rpa_locator_assist_cache_key
  ON zenithjoy.rpa_locator_assist (step, target_desc, device_model, os_version, douyin_version, created_at DESC);

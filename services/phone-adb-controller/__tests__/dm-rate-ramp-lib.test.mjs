import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDailyCap, loadRampConfig } from "../dm-rate-ramp-lib.js";

const DAILY_STEP = {
  mode: "daily_step",
  start_date: "2026-09-20",
  base_per_day: 10,
  step_per_day: 5,
  ceiling_per_day: 60,
};

const INTRADAY_STEP = {
  mode: "intraday_step",
  start_date: "2026-09-20",
  base_per_day: 10,
  step_every_hours: 3,
  step_amount: 5,
  ceiling_per_day: 60,
};

test("daily_step: 起始日=base", () => {
  assert.equal(computeDailyCap(DAILY_STEP, new Date("2026-09-20T01:00:00+08:00")), 10);
});
test("daily_step: 第3天 = base + 2*step", () => {
  assert.equal(computeDailyCap(DAILY_STEP, new Date("2026-09-22T01:00:00+08:00")), 20);
});
test("daily_step: 起始日之前按第0天算,不倒扣", () => {
  assert.equal(computeDailyCap(DAILY_STEP, new Date("2026-09-01T01:00:00+08:00")), 10);
});
test("daily_step: 超过天花板封顶", () => {
  assert.equal(computeDailyCap(DAILY_STEP, new Date("2026-12-01T01:00:00+08:00")), 60);
});

test("intraday_step: 0点档位=base", () => {
  assert.equal(computeDailyCap(INTRADAY_STEP, new Date("2026-09-20T00:30:00+08:00")), 10);
});
test("intraday_step: 每3小时+5,9点=base+3档", () => {
  assert.equal(computeDailyCap(INTRADAY_STEP, new Date("2026-09-20T09:30:00+08:00")), 25);
});
test("intraday_step: 每天重新从0点档位起跳(不跨天累加)", () => {
  assert.equal(computeDailyCap(INTRADAY_STEP, new Date("2026-09-25T00:30:00+08:00")), 10);
});
test("intraday_step: 超过天花板封顶", () => {
  const lowCeiling = { ...INTRADAY_STEP, ceiling_per_day: 20 };
  assert.equal(computeDailyCap(lowCeiling, new Date("2026-09-20T23:59:00+08:00")), 20);
});

test("loadRampConfig: 从文件读取并按profile取配置", () => {
  const cfg = loadRampConfig(new URL("../config/dm-rate-ramp.json", import.meta.url).pathname);
  assert.equal(cfg["jinoshengyuan-work"].mode, "daily_step");
  assert.equal(cfg["legacy"].mode, "intraday_step");
});

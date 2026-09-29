// harvest-cron.sh cleanup(关App/回安全桌面) 接线回归测试（0929 DoD 审计批次4）。
// 事故：契约 cleanup 活动的"关App"/"回安全桌面"两步从建成起零实现——close-app 子命令
// 早就写好但没人调，return-safe-desktop 本批次新建同样需要真的接进采收链，否则跟没写
// 一样。workflow-result.sh 的 cleanup 指标(close_app_attempts/safe_desktop_visible)
// 此前写死为0，不是真实判定。
//
// 修法：run_finalize() 里真调 close-app + return-safe-desktop，导出真实结果给
// workflow-result.sh finalize 写进指标；回不了安全桌面时 escalate(可能卡在异常界面)。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HC = join(HERE, "..", "harvest-cron.sh");
// 7f842d12: harvest-cron.sh 已退成薄壳(exec wf-run.sh keyword_acquisition),源码接线守卫改查实现 wf-run.sh
const HC_IMPL = join(HERE, "..", "wf-run.sh");

test("接线守卫: run_finalize 必须真调 close-app 和 return-safe-desktop,并把结果导出为 WFR_CLOSE_APP_ATTEMPTS/WFR_SAFE_DESKTOP_VISIBLE 供 finalize 使用", () => {
  const src = readFileSync(HC_IMPL, "utf8");
  const iFn = src.indexOf("run_finalize(){");
  const iEnd = src.indexOf("\n}", iFn);
  assert.ok(iFn > 0, "找不到 run_finalize 函数");
  const body = src.slice(iFn, iEnd);
  assert.match(body, /close-app/, "run_finalize 里没有调用 close-app");
  assert.match(body, /return-safe-desktop/, "run_finalize 里没有调用 return-safe-desktop");
  assert.match(body, /WFR_CLOSE_APP_ATTEMPTS/, "没有导出 close-app 的真实结果");
  assert.match(body, /WFR_SAFE_DESKTOP_VISIBLE/, "没有导出 return-safe-desktop 的真实结果");
  assert.match(body, /export WFR_CLOSE_APP_ATTEMPTS WFR_SAFE_DESKTOP_VISIBLE/, "两个变量必须在调用 finalize 前 export,子进程才读得到");
  const iExport = body.indexOf("export WFR_CLOSE_APP_ATTEMPTS");
  const iFinalizeCall = body.indexOf('bash "$WFR" finalize');
  assert.ok(iExport > 0 && iFinalizeCall > iExport, "export 必须在调用 workflow-result.sh finalize 之前");
  assert.match(body, /escalate.*安全桌面|安全桌面.*escalate/s, "回不了安全桌面应该 escalate,不能悄悄放过");
});

test("workflow-result.sh 的 cleanup 指标必须从 WFR_CLOSE_APP_ATTEMPTS/WFR_SAFE_DESKTOP_VISIBLE 读,不能再写死字面量0", () => {
  const wfr = readFileSync(join(HERE, "..", "workflow-result.sh"), "utf8");
  const line = wfr.split("\n").find((l) => l.includes("cleanup completed 1"));
  assert.ok(line, "找不到 cleanup write_stage 调用");
  assert.match(line, /WFR_CLOSE_APP_ATTEMPTS/, `close_app_attempts 应该读env, line=${line}`);
  assert.match(line, /WFR_SAFE_DESKTOP_VISIBLE/, `safe_desktop_visible 应该读env, line=${line}`);
  assert.doesNotMatch(line, /"close_app_attempts":0/, "close_app_attempts 不应该还是写死的字面量0");
  assert.doesNotMatch(line, /"safe_desktop_visible":0/, "safe_desktop_visible 不应该还是写死的字面量0");
});

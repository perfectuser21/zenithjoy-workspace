// wf-limits.sh — 执行器限时共享库(任务 7d150e33,决策 3c98fb36 阶段1)。
// 0930 事故: 三部手机死循环 6 小时无人能停——执行器没有整批总时限,也没有按契约预算封顶的活动段。
// 这里钉: ①总时限默认 14400s、env 可覆盖、缺起跑时刻永不到点 ②预算/超时分类读取的默认值
// ③有界子进程: 超时 rc=124 并真把子进程收掉,未超时透传出口码与 stdout。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, "..", "wf-limits.sh");
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
const SKIP = !ZSH && "no zsh (CI: sudo apt-get install -y zsh)";

const run = (cmd, env = {}) => spawnSync(ZSH, ["-c", `source ${LIB} || exit 99; ${cmd}`], { encoding: "utf8", env: { ...process.env, ...env }, timeout: 15000 });
const rc = (cmd, env) => { const r = run(cmd, env); assert.notEqual(r.status, 99, "wf-limits.sh 不存在或 source 失败"); return r; };

test("wf_deadline_reached: 默认总时限 14400s,按 WF_RUN_START_TS + WF_NOW_TS 判到点", { skip: SKIP }, () => {
  assert.equal(rc("wf_deadline_reached", { WF_RUN_START_TS: "1000", WF_NOW_TS: "15399" }).status, 1, "差 1 秒未到点");
  assert.equal(rc("wf_deadline_reached", { WF_RUN_START_TS: "1000", WF_NOW_TS: "15400" }).status, 0, "恰好 14400s 到点");
});

test("wf_deadline_reached: WF_RUN_MAX_SECONDS 可覆盖;缺 WF_RUN_START_TS(单脚本手跑)永不到点", { skip: SKIP }, () => {
  assert.equal(rc("wf_deadline_reached", { WF_RUN_START_TS: "1000", WF_NOW_TS: "1060", WF_RUN_MAX_SECONDS: "60" }).status, 0);
  assert.equal(rc("wf_deadline_reached", { WF_RUN_START_TS: "1000", WF_NOW_TS: "1059", WF_RUN_MAX_SECONDS: "60" }).status, 1);
  const env = { ...process.env }; delete env.WF_RUN_START_TS;
  assert.equal(spawnSync(ZSH, ["-c", `source ${LIB}; wf_deadline_reached`], { encoding: "utf8", env: { ...env, WF_NOW_TS: "99999999999" } }).status, 1);
  assert.equal(rc("wf_deadline_reached", { WF_RUN_START_TS: "abc", WF_NOW_TS: "99999999999" }).status, 1, "非数字起跑时刻视为未设");
});

test("wf_budget_of / wf_timeout_class: 未设 → 0 / record;设了照读", { skip: SKIP }, () => {
  const env = { ...process.env }; delete env.WF_BUDGET_discovery; delete env.WF_TIMEOUT_CLASS_discovery;
  const a = spawnSync(ZSH, ["-c", `source ${LIB}; wf_budget_of discovery; wf_timeout_class discovery`], { encoding: "utf8", env });
  assert.equal(a.stdout, "0\nrecord\n", a.stderr);
  const b = rc("wf_budget_of discovery; wf_timeout_class discovery; wf_budget_of bad", { WF_BUDGET_discovery: "600", WF_TIMEOUT_CLASS_discovery: "retryable", WF_BUDGET_bad: "x" });
  assert.equal(b.stdout, "600\nretryable\n0\n", "非数字预算按不限(0)");
});

test("wf_run_bounded: 超时 rc=124 且子进程被收掉,不等它跑完", { skip: SKIP }, () => {
  const t0 = Date.now();
  const r = rc("wf_run_bounded 1 /bin/sleep 20; echo rc=$?", { WF_BOUNDED_POLL: "0.1" });
  assert.match(r.stdout, /rc=124/, r.stderr);
  assert.ok(Date.now() - t0 < 5000, "应在约 1.5s 内返回,实际 " + (Date.now() - t0) + "ms");
});

test("wf_run_bounded: 超时要连子进程树一起收——孙进程占着 stdout 管道,命令替换会一直等它跑完", { skip: SKIP }, () => {
  const t0 = Date.now();
  const r = rc("OUT=$(wf_run_bounded 1 sh -c '/bin/sleep 20; echo late'); echo rc=$? out=$OUT", { WF_BOUNDED_POLL: "0.1" });
  assert.match(r.stdout, /rc=124 out=$/m, r.stderr);
  assert.ok(Date.now() - t0 < 5000, "sh 下面的 sleep 也该被收掉,实际 " + (Date.now() - t0) + "ms");
});

test("wf_run_bounded: 未超时透传 stdout 与出口码;预算 0 = 不限时直接跑", { skip: SKIP }, () => {
  const a = rc("wf_run_bounded 5 sh -c 'echo hi; exit 7'; echo rc=$?", { WF_BOUNDED_POLL: "0.1" });
  assert.equal(a.stdout, "hi\nrc=7\n", a.stderr);
  const b = rc("wf_run_bounded 0 sh -c 'echo z; exit 3'; echo rc=$?");
  assert.equal(b.stdout, "z\nrc=3\n", b.stderr);
  const c = rc("OUT=$(wf_run_bounded 5 sh -c 'echo captured'); echo got=$OUT", { WF_BOUNDED_POLL: "0.1" });
  assert.equal(c.stdout, "got=captured\n", "命令替换里也能拿到子进程 stdout");
});

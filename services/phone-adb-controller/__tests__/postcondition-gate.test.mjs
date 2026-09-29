// 活动后置条件运行时拦截（任务 6b133a81，决策 3240824c⑦「后置条件=判定，默认拦截」/ f18f56b8②「每个活动后置条件一律拦截」）。
//
// 此前：17 条探针只有 delivery/scoring 在运行时读回，且只把 observed 交给 Brain，执行侧从不据此拦截；
// preflight/cleanup 指标写死；qualification 账本硬写 not_in_profile；outreach 不进账本；blocked 占位工件不判探针。
// 现在：
//   ① 探针声明 failure_class（契约失败语义闭集：retryable/needs_human/fatal）+ on_fail（stop_run/fail_stage）
//   ② verify-step 在读回同时按 expect 判 pass，汇总 gate {verdict, action, failed, alert}
//   ③ workflow-result.sh 每个 stage（含 blocked）都读回并按 gate 处理：不过 → 工件改 failed、账本 failed；
//      stop_run → 写 STOP 标记，batch2/harvest-cron 停后续活动；needs_human/fatal → 告警
//   ④ 读不回（mmv 不通/单条 error）= unknown → 工件 failed（不许假绿），但不停跑
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { evaluateExpect, summarizeGate, runProbes } from "../verify-step.mjs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");
const WFR = join(SRC, "workflow-result.sh");
const LEDGER = join(SRC, "ledger.mjs");
const CHECKS = join(SRC, "checks");
const JQ = spawnSync("bash", ["-lc", "command -v jq"], { encoding: "utf8" }).stdout.trim();
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
const { loadChecks, validateSchema } = require(join(CHECKS, "probes-lib.js"));
const ALL_STAGES = "preflight discovery qualification collection scoring delivery outreach cleanup";

// ── ① 探针声明失败语义 ─────────────────────────────────────────────────
test("17 条探针全部声明 failure_class ∈ 契约闭集 + on_fail ∈ {stop_run, fail_stage}", () => {
  const { doc, errors } = loadChecks(join(CHECKS, "social-keyword-leadgen.yaml"), join(CHECKS, "schema.json"));
  assert.deepEqual(errors, []);
  assert.equal(doc.probes.length, 17);
  for (const p of doc.probes) {
    assert.ok(["retryable", "needs_human", "fatal"].includes(p.failure_class), `${p.key} failure_class=${p.failure_class}`);
    assert.ok(["stop_run", "fail_stage"].includes(p.on_fail), `${p.key} on_fail=${p.on_fail}`);
  }
  const by = Object.fromEntries(doc.probes.map((p) => [p.key, p]));
  for (const k of ["pf_device_verified", "pf_account_verified", "pf_call_idle", "pf_lock_acquired"]) assert.equal(by[k].on_fail, "stop_run", `${k}: 预检不过不得开采`);
  for (const k of ["coll_only_matched", "coll_video_binding_consistent"]) assert.equal(by[k].on_fail, "stop_run", `${k}: 脏采集不得配送`);
  assert.equal(by.coll_only_matched.failure_class, "fatal");
});

test("schema 拒缺 failure_class / on_fail、拒闭集外取值", () => {
  const schema = JSON.parse(readFileSync(join(CHECKS, "schema.json"), "utf8"));
  const { doc } = loadChecks(join(CHECKS, "social-keyword-leadgen.yaml"), join(CHECKS, "schema.json"));
  const base = JSON.parse(JSON.stringify(doc.probes[0]));
  for (const bad of [{ failure_class: undefined }, { on_fail: undefined }, { failure_class: "empty_ok" }, { on_fail: "warn" }]) {
    const p = { ...base, ...bad };
    for (const k of Object.keys(bad)) if (bad[k] === undefined) delete p[k];
    assert.ok(validateSchema({ ...doc, probes: [p] }, schema).length > 0, JSON.stringify(bad));
  }
});

// ── ② verify-step 判 pass + gate 汇总 ───────────────────────────────────
test("evaluateExpect: >= <= == 对 value/ref；not_null_all 数组/标量/空；ref 缺 → null", () => {
  assert.equal(evaluateExpect({ op: ">=", ref: "metrics.videos_pushed" }, 3, { videos_pushed: 3 }), true);
  assert.equal(evaluateExpect({ op: ">=", ref: "metrics.videos_pushed" }, 2, { videos_pushed: 3 }), false);
  assert.equal(evaluateExpect({ op: "<=", value: 0 }, 0, {}), true);
  assert.equal(evaluateExpect({ op: "<=", value: 0 }, 4, {}), false);
  assert.equal(evaluateExpect({ op: "==", value: 1 }, 1, {}), true);
  assert.equal(evaluateExpect({ op: "==", value: 1 }, 0, {}), false);
  assert.equal(evaluateExpect({ op: "not_null_all" }, ["jinuo", "yuesheng"], {}), true);
  assert.equal(evaluateExpect({ op: "not_null_all" }, ["jinuo", null], {}), false);
  assert.equal(evaluateExpect({ op: "not_null_all" }, ["jinuo", ""], {}), false);
  assert.equal(evaluateExpect({ op: "not_null_all" }, "jinuo", {}), true, "单行单列回标量");
  assert.equal(evaluateExpect({ op: "not_null_all" }, [], {}), true);
  assert.equal(evaluateExpect({ op: ">=", ref: "metrics.nope" }, 3, {}), null);
  assert.equal(evaluateExpect({ op: ">=", value: 1 }, "abc", {}), null, "非数字 observed 判不了");
});

test("summarizeGate: 全过 → continue；有 stop_run 失败 → stop_run；只有 fail_stage 失败 → fail_stage；needs_human/fatal 失败才告警；读不回 → unknown/fail_stage；无探针 → none", () => {
  const P = (key, pass, failure_class = "retryable", on_fail = "fail_stage") => ({ key, pass, failure_class, on_fail });
  assert.deepEqual(summarizeGate([]), { verdict: "none", action: "continue", failed: [], unknown: [], alert: false });
  assert.equal(summarizeGate([P("a", true)]).action, "continue");
  const g1 = summarizeGate([P("a", false, "needs_human", "stop_run"), P("b", false)]);
  assert.deepEqual([g1.verdict, g1.action, g1.alert], ["fail", "stop_run", true]);
  assert.deepEqual(g1.failed, ["a", "b"]);
  const g2 = summarizeGate([P("a", false), P("b", true)]);
  assert.deepEqual([g2.verdict, g2.action, g2.alert], ["fail", "fail_stage", false]);
  const g3 = summarizeGate([P("a", null), P("b", true)]);
  assert.deepEqual([g3.verdict, g3.action, g3.alert, g3.unknown], ["unknown", "fail_stage", false, ["a"]]);
});

test("runProbes: 每条带 pass/failure_class/on_fail，结果带 gate；metric 探针用传入 metrics 判", async () => {
  const { doc } = loadChecks(join(CHECKS, "social-keyword-leadgen.yaml"), join(CHECKS, "schema.json"));
  const ok = await runProbes({ doc, stage: "preflight", params: { metrics: { device_verified: 1, account_verified: 1, call_state_idle: 1, lock_acquired: 1 } } });
  assert.ok(ok.probes.every((p) => p.pass === true), JSON.stringify(ok));
  assert.equal(ok.gate.action, "continue");
  const bad = await runProbes({ doc, stage: "preflight", params: { metrics: { device_verified: 1, account_verified: 1, call_state_idle: 1, lock_acquired: 0 } } });
  assert.deepEqual([bad.gate.verdict, bad.gate.action, bad.gate.failed], ["fail", "stop_run", ["pf_lock_acquired"]]);
  const pool = { query: async () => ({ rows: [{ count: "2" }], fields: [{ name: "count" }] }) };
  const q = await runProbes({ doc, stage: "qualification", params: { runTag: "t", lineKey: "jinuo" }, deps: { pool } });
  const none = q.probes.find((p) => p.key === "qual_none_pending");
  assert.equal(none.pass, false, "还有 2 条 pending");
  assert.equal(q.gate.action, "fail_stage", "判定接口故障留 pending 属 retryable：本阶段判失败但不停跑");
});

test("verify-step CLI: --metrics 直接收 JSON（执行机工件不在 mmv 上）", () => {
  const r = spawnSync(process.execPath, [join(SRC, "verify-step.mjs"), "--stage", "cleanup", "--metrics", JSON.stringify({ close_app_attempts: 1, lock_released: 1, safe_desktop_visible: 0 })], { encoding: "utf8" });
  const out = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.deepEqual(out.gate.failed, ["cl_safe_desktop_visible"]);
  assert.equal(out.gate.alert, true, "cleanup needs_human 告警");
});

// ── ③ workflow-result.sh 按 gate 拦截 ───────────────────────────────────
function env(home, extra = {}) {
  return { ...process.env, WFR_HOME: home, WFR_NODE: process.execPath, WFR_JQ: JQ, WFR_LEDGER_MJS: LEDGER, WFR_SCP_TARGET: "",
    WFR_BRAIN_ENV: join(home, "no-brain.env"), BRAIN_URL: "", BRAIN_INTERNAL_TOKEN: "", WFR_BRAIN_TASK_ID: "",
    WFR_CHECKS_YAML: join(home, "no.yaml"), WFR_PROBE_STAGES: ALL_STAGES, ...extra };
}
// 假 ssh：按 --stage 从 canned 目录回放 <stage>.json（没有则回 gate=pass 的空探针），argv 记一行 JSON
function fakeSsh(dir, canned = {}) {
  const bin = join(dir, "sshbin"); mkdirSync(bin, { recursive: true });
  const cdir = join(dir, "canned"); mkdirSync(cdir, { recursive: true });
  for (const [st, obj] of Object.entries(canned)) writeFileSync(join(cdir, `${st}.json`), JSON.stringify(obj));
  const calls = join(dir, "ssh.calls");
  writeFileSync(join(bin, "ssh"), `#!/usr/bin/env bash
python3 -c 'import json,sys;print(json.dumps(sys.argv[1:]))' "$@" >> "${calls}"
st=$(printf '%s' "$*" | python3 -c "import re,sys;m=re.search(r\\"--stage '([a-z]+)'\\",sys.stdin.read());print(m.group(1) if m else '')")
if [ -f "${cdir}/$st.json" ]; then cat "${cdir}/$st.json"; else printf '{"stage":"%s","probes":[{"key":"x","observed":1,"pass":true}],"gate":{"verdict":"pass","action":"continue","failed":[],"unknown":[],"alert":false}}\\n' "$st"; fi
`);
  chmodSync(join(bin, "ssh"), 0o755);
  return { PATH: `${bin}:${process.env.PATH}`, calls: () => (existsSync(calls) ? readFileSync(calls, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []) };
}
function wfr(home, extra, ...args) {
  const r = spawnSync("bash", [WFR, ...args], { encoding: "utf8", env: env(home, extra) });
  const kv = Object.fromEntries(r.stdout.split("\n").filter((l) => /^WFR_[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^'(.*)'$/, "$1")]; }));
  return { code: r.status, kv, err: r.stderr, out: r.stdout };
}
const words = (d) => { const f = join(d, "kw.txt"); writeFileSync(f, "A\n"); return f; };
const gate = (verdict, action, failed = [], alert = false) => ({ verdict, action, failed, unknown: [], alert });
const FAIL_STOP = (st, key, cls = "needs_human") => ({ stage: st, probes: [{ key, observed: 0, pass: false, failure_class: cls, on_fail: "stop_run" }], gate: gate("fail", "stop_run", [key], cls !== "retryable") });
const FAIL_STAGE = (st, key) => ({ stage: st, probes: [{ key, observed: 3, pass: false, failure_class: "retryable", on_fail: "fail_stage" }], gate: gate("fail", "fail_stage", [key]) });
const art = (kv, name) => JSON.parse(readFileSync(join(kv.WFR_ART_DIR, `${kv.WFR_RUN_ID}__${kv.WFR_ATTEMPT || "a0"}.${name}.worker-result.json`), "utf8"));
const book = (kv) => JSON.parse(readFileSync(join(kv.WFR_RUN_DIR, "ledger.json"), "utf8"));
function started(d, ssh, extra = {}) {
  const i = wfr(d, { PATH: ssh.PATH, DEVICE_VERIFIED: "1", ACCOUNT_VERIFIED: "1", CALL_STATE_IDLE: "1", LOCK_ACQUIRED: "1", ...extra }, "init", "t1", "jinoshengyuan-work", words(d), "1", "S", "h");
  const e = wfr(d, { ...i.kv, PATH: ssh.PATH }, "enter");
  return { ...i.kv, ...e.kv };
}

test("init: preflight 指标取真实环境（不再写死），不再写 qualification/scoring 占位；preflight 读回带 --metrics", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "gate-"));
  const ssh = fakeSsh(d);
  const r = wfr(d, { PATH: ssh.PATH, DEVICE_VERIFIED: "1", ACCOUNT_VERIFIED: "1", CALL_STATE_IDLE: "1", LOCK_ACQUIRED: "0" }, "init", "t1", "p1", words(d), "1", "S", "h");
  const files = readdirSync(r.kv.WFR_ART_DIR);
  assert.deepEqual(files, ["social-keyword-leadgen-crontab-t1__a0.preflight.1.worker-result.json"], "不再有 not_in_profile 占位");
  assert.deepEqual(art(r.kv, "preflight.1").metrics.lock_acquired, 0);
  const remote = ssh.calls()[0].at(-1);
  assert.match(remote, /--stage 'preflight'/);
  assert.match(remote, /--metrics '\{[^']*"lock_acquired":0[^']*\}'/);
  const r0 = wfr(mkdtempSync(join(tmpdir(), "gate-")), { PATH: ssh.PATH }, "init", "t2", "p1", words(d), "1", "S", "h");
  const m0 = art(r0.kv, "preflight.1").metrics;
  assert.deepEqual([m0.device_verified, m0.call_state_idle, m0.lock_acquired], [0, 0, 0], "没读到就是 0，不再默认 1");
});

test("stage: gate fail + stop_run → 工件改 failed/stop、账本 failed、写 STOP；gate 子命令报停跑与告警（只报一次）", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "gate-"));
  const ssh = fakeSsh(d, { collection: FAIL_STOP("collection", "coll_only_matched", "fatal") });
  const kv = started(d, ssh);
  wfr(d, { ...kv, PATH: ssh.PATH }, "stage", "collection", "completed", "1", "word=A", '[{"type":"log","ref":"l"}]', '{"comments_collected":2,"videos_processed":1,"cursor_updates":0}', "A");
  const a = art(kv, "collection.1");
  assert.equal(a.status, "failed");
  assert.equal(a.recommended_next_action, "stop");
  assert.match(a.summary, /postcondition_failed.*coll_only_matched/);
  assert.equal(book(kv).stages.collection.status, "failed");
  assert.ok(existsSync(join(kv.WFR_RUN_DIR, "STOP")));
  const g = wfr(d, kv, "gate");
  assert.equal(g.kv.WFR_GATE_STOP, "1");
  assert.equal(g.kv.WFR_GATE_ALERT, "1");
  assert.match(g.kv.WFR_GATE_ALERT_MSG, /collection.*coll_only_matched/);
  assert.equal(wfr(d, kv, "gate").kv.WFR_GATE_ALERT, "0", "同一条告警不重复报");
});

test("stage: gate fail + fail_stage（retryable）→ 工件 failed/retry、不写 STOP、不告警", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "gate-"));
  const ssh = fakeSsh(d, { qualification: FAIL_STAGE("qualification", "qual_none_pending") });
  const kv = started(d, ssh);
  wfr(d, { ...kv, PATH: ssh.PATH }, "stage", "qualification", "completed", "1", "word=A", '[{"type":"log","ref":"l"}]', '{"candidates_judged":1,"qualified":1}', "A");
  const a = art(kv, "qualification.1");
  assert.deepEqual([a.status, a.recommended_next_action], ["failed", "retry"]);
  assert.ok(!existsSync(join(kv.WFR_RUN_DIR, "STOP")));
  const g = wfr(d, kv, "gate");
  assert.deepEqual([g.kv.WFR_GATE_STOP, g.kv.WFR_GATE_ALERT], ["0", "0"]);
});

test("stage: 读回失败（ssh 不通 → 无 gate）= unknown → 工件 failed（不许假绿）但不停跑", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "gate-"));
  const ssh = fakeSsh(d);
  const kv = started(d, ssh);
  const bad = join(d, "badbin"); mkdirSync(bad); writeFileSync(join(bad, "ssh"), "#!/bin/sh\nexit 255\n"); chmodSync(join(bad, "ssh"), 0o755);
  wfr(d, { ...kv, PATH: `${bad}:${process.env.PATH}` }, "stage", "discovery", "completed", "1", "word=A", '[{"type":"log","ref":"l"}]', '{"candidates":1,"keywords_processed":1,"screens_scanned":0}', "A");
  const a = art(kv, "discovery.1");
  assert.equal(a.status, "failed");
  assert.match(a.summary, /probe_unreadable/);
  assert.ok(!existsSync(join(kv.WFR_RUN_DIR, "STOP")));
});

test("stage blocked 也读回判探针（占位不再豁免）", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "gate-"));
  const ssh = fakeSsh(d);
  const kv = started(d, ssh);
  const n0 = ssh.calls().length;
  wfr(d, { ...kv, PATH: ssh.PATH }, "stage", "delivery", "blocked", "1", "push=0 skipped", "[]", '{"leads_written":0,"videos_pushed":0,"duplicates_skipped":0,"readback_verified":0,"cursor_updates":0}');
  assert.equal(ssh.calls().length, n0 + 1);
  assert.match(ssh.calls().at(-1).at(-1), /--stage 'delivery'/);
});

test("delivery 读回全过 → readback_verified=1（不再写死 0）", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "gate-"));
  const ssh = fakeSsh(d);
  const kv = started(d, ssh);
  wfr(d, { ...kv, PATH: ssh.PATH }, "stage", "delivery", "completed", "1", "pushed", '[{"type":"log","ref":"l"}]', '{"leads_written":2,"videos_pushed":1,"duplicates_skipped":0,"readback_verified":0,"cursor_updates":0}');
  const a = art(kv, "delivery.1");
  assert.equal(a.status, "completed");
  assert.equal(a.metrics.readback_verified, 1);
});

test("finalize: 没跑到的阶段补 blocked not_run 工件并读回；lock_released 取 WFR_LOCK_RELEASED；有 STOP → 终态 failed", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "gate-"));
  const ssh = fakeSsh(d, { preflight: FAIL_STOP("preflight", "pf_lock_acquired", "retryable") });
  const kv = started(d, ssh, { LOCK_ACQUIRED: "0" });
  const f = wfr(d, { ...kv, PATH: ssh.PATH, WFR_LOCK_RELEASED: "1", WFR_CLOSE_APP_ATTEMPTS: "1", WFR_SAFE_DESKTOP_VISIBLE: "1" }, "finalize");
  const stages = ssh.calls().map((c) => /--stage '([a-z]+)'/.exec(c.at(-1))[1]);
  for (const s of ["discovery", "qualification", "collection", "scoring", "delivery", "cleanup"]) assert.ok(stages.includes(s), `${s} 没读回: ${stages}`);
  const b = book(kv);
  assert.equal(b.stages.scoring.status, "blocked");
  assert.match(b.stages.scoring.note, /not_run/);
  assert.equal(art(kv, "cleanup.1").metrics.lock_released, 1);
  assert.equal(f.kv.WFR_FINALIZE_FINAL, "failed", "预检拦截停跑的 run 终态是 failed");
  assert.match(f.kv.WFR_FINALIZE_MSG, /gate_stop=preflight/);
});

test("finalize: 未给 WFR_LOCK_RELEASED → lock_released=0（不再写死 1）", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "gate-"));
  const ssh = fakeSsh(d);
  const kv = started(d, ssh);
  wfr(d, { ...kv, PATH: ssh.PATH }, "finalize");
  assert.equal(art(kv, "cleanup.1").metrics.lock_released, 0);
});

test("outreach-run: 触达进账本——建 outreach run、写 outreach 工件（闭集四键）并读回判 gate", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "gate-"));
  const ssh = fakeSsh(d, { outreach: FAIL_STAGE("outreach", "out_no_stuck_inflight") });
  const r = wfr(d, { PATH: ssh.PATH }, "outreach-run", "out09291030", "jinoshengyuan-work", "S", "xian-m4", "tick sent=2",
    '{"orders_picked":3,"messages_sent":2,"requeued":1,"blocked_orders":0}');
  assert.equal(r.code, 0, r.err);
  const dir = join(d, "workflow-runs");
  const f = readdirSync(dir).find((n) => n.includes("social-keyword-leadgen-outreach-out09291030") && n.includes(".outreach.1."));
  assert.ok(f, readdirSync(dir).join(","));
  const a = JSON.parse(readFileSync(join(dir, f), "utf8"));
  assert.equal(a.metrics.messages_sent, 2);
  assert.equal(a.status, "failed", "悬空触达中 → 本 tick 判失败");
  assert.match(ssh.calls()[0].at(-1), /--stage 'outreach'.*--line-key 'jinoshengyuan-work'/);
  assert.equal(r.kv.WFR_GATE_STOP, "0");
});

// ── ④ batch2 / harvest-cron 按 STOP 停后续活动 ─────────────────────────────
const FAKE_HK = `#!/bin/zsh
print -r -- "$4" >> "$HOME/hk.log"
print "QUAL\\tv1\\tmatched\\tjudged"; print "QUAL\\tv2\\trejected\\tjudged"; print "QUAL\\tv3\\tpending\\tjudged"
print "VIDEO\\tv1\\thttps://v/1\\ttitle\\tw\\t1"; print "LEAD\\tnick\\tid1\\tpersonal\\tbody\\t09-01\\t上海\\ttitle\\tw\\t\\t\\thttps://v/1"
exit 0`;
const FAKE_SSH0 = `#!/bin/sh
printf '%s\\n' "$*" >> "$HOME/ssh.log"; exit 0`;
function b2(wordsList, extra = {}) {
  const home = mkdtempSync(join(tmpdir(), "b2gate-"));
  mkdirSync(join(home, "bin-harvest"), { recursive: true }); mkdirSync(join(home, ".local", "bin"), { recursive: true });
  writeFileSync(join(home, "bin-harvest", "harvest-keyword.sh"), FAKE_HK); chmodSync(join(home, "bin-harvest", "harvest-keyword.sh"), 0o755);
  for (const b of ["ssh", "scp"]) { writeFileSync(join(home, ".local", "bin", b), FAKE_SSH0); chmodSync(join(home, ".local", "bin", b), 0o755); }
  const wf = join(home, "kw.txt"); writeFileSync(wf, wordsList.join("\n") + "\n");
  const e = { ...process.env, HOME: home, WFR_HOME: join(home, ".config", "zenithjoy"), WFR_NODE: process.execPath, WFR_JQ: JQ, WFR_LEDGER_MJS: LEDGER,
    WFR: WFR, WFR_SCP_TARGET: "", WFR_PROBE_STAGES: "", WALL_REPORT: "/nonexistent", BATCH_SLEEP: "0", WFR_BRAIN_ENV: join(home, "none") };
  const kv = {};
  for (const args of [["init", "t9", "p1", wf, "1", "S", "h"], ["enter"]]) {
    const r = spawnSync("bash", [WFR, ...args], { encoding: "utf8", env: { ...e, ...kv } });
    for (const l of r.stdout.split("\n")) { const m = l.match(/^(WFR_[A-Z_]+)=(.*)$/); if (m) kv[m[1]] = m[2]; }
  }
  return { home, wf, env: { ...e, ...kv, ...extra }, kv };
}
const runB2 = (c) => spawnSync(ZSH, [join(SRC, "batch2.sh"), "p1", c.wf, "t9", "1", ""], { encoding: "utf8", env: c.env });

test("batch2: 每词写 qualification 工件（QUAL 行计数：判完 matched+rejected、合格 matched），discovery candidates=进判定的视频数", { skip: (!ZSH || !JQ) && "no zsh/jq" }, () => {
  const c = b2(["A"]);
  assert.equal(runB2(c).status, 0);
  const q = JSON.parse(readFileSync(join(c.kv.WFR_ART_DIR, "social-keyword-leadgen-crontab-t9__a1.qualification.1.worker-result.json"), "utf8"));
  assert.equal(q.status, "completed");
  assert.deepEqual([q.metrics.candidates_judged, q.metrics.qualified], [2, 1]);
  const dsc = JSON.parse(readFileSync(join(c.kv.WFR_ART_DIR, "social-keyword-leadgen-crontab-t9__a1.discovery.1.worker-result.json"), "utf8"));
  assert.equal(dsc.metrics.candidates, 3);
});

test("batch2: 账本出现 STOP（某活动后置条件 stop_run 不过）→ 不再跑后续词、不落池不分拣，打印 BATCH2_ESCALATE=gate_stop", { skip: (!ZSH || !JQ) && "no zsh/jq" }, () => {
  const c = b2(["A", "B"]);
  writeFileSync(join(c.kv.WFR_RUN_DIR, "STOP"), JSON.stringify({ stage: "collection", failed: ["coll_only_matched"] }));
  const r = runB2(c);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /BATCH2_ESCALATE=gate_stop/);
  assert.equal(existsSync(join(c.home, "hk.log")), false, "STOP 已在 → 一个词都不跑");
  const ssh = existsSync(join(c.home, "ssh.log")) ? readFileSync(join(c.home, "ssh.log"), "utf8") : "";
  assert.doesNotMatch(ssh, /push-videos|push-raw-comments|sort-comments/);
});

const HC = join(SRC, "harvest-cron.sh");
function hcLib(cmd, extra = {}) {
  const home = mkdtempSync(join(tmpdir(), "hcgate-"));
  return spawnSync(ZSH, ["-c", `HARVEST_CRON_LIB=1 source ${HC}; ${cmd}`], { encoding: "utf8", env: { ...process.env, HOME: home, ...extra } });
}
function fakeCtl(dir, script) { const p = join(dir, "ctl"); writeFileSync(p, `#!/bin/sh\n${script}\n`); chmodSync(p, 0o755); return p; }

test("harvest-cron: preflight_lock_acquire 拿到锁 → LOCK_ACQUIRED=1；被占重试用尽 → 0", { skip: !ZSH && "no zsh" }, () => {
  const d = mkdtempSync(join(tmpdir(), "hcl-"));
  const ok = fakeCtl(d, `echo "$*" >> ${d}/ok.log; echo lock=acquired owner=T`);
  const r1 = hcLib(`C=${ok} P=p TAG=auto1 PF_LOCK_WAIT=0; preflight_lock_acquire; echo "L=$LOCK_ACQUIRED"`);
  assert.match(r1.stdout, /L=1/);
  assert.match(readFileSync(join(d, "ok.log"), "utf8"), /lock-acquire auto1/);
  const busy = fakeCtl(d, `echo "$*" >> ${d}/busy.log; echo "lock is held by another run" >&2; exit 1`);
  const r2 = hcLib(`C=${busy} P=p TAG=auto1 PF_LOCK_WAIT=0 PF_LOCK_TRIES=3; preflight_lock_acquire; echo "L=$LOCK_ACQUIRED"`);
  assert.match(r2.stdout, /L=0/);
  assert.equal(readFileSync(join(d, "busy.log"), "utf8").trim().split("\n").length, 3);
});

test("harvest-cron: release_run_lock 放锁后用 lock-status 真读——free 或别人持有 → WFR_LOCK_RELEASED=1；仍是本 run → 0", { skip: !ZSH && "no zsh" }, () => {
  const d = mkdtempSync(join(tmpdir(), "hcl-"));
  const free = fakeCtl(d, `case "$3" in lock-release) echo lock=released;; lock-status) echo lock=free;; esac`);
  assert.match(hcLib(`C=${free} P=p TAG=auto1; release_run_lock; echo "R=$WFR_LOCK_RELEASED"`).stdout, /R=1/);
  const other = fakeCtl(d, `case "$3" in lock-release) exit 1;; lock-status) echo "lock=held owner=out0929 age=3s stale=false";; esac`);
  assert.match(hcLib(`C=${other} P=p TAG=auto1; release_run_lock; echo "R=$WFR_LOCK_RELEASED"`).stdout, /R=1/);
  const mine = fakeCtl(d, `case "$3" in lock-release) exit 1;; lock-status) echo "lock=held owner=auto1-w3 age=3s stale=false";; esac`);
  assert.match(hcLib(`C=${mine} P=p TAG=auto1; release_run_lock; echo "R=$WFR_LOCK_RELEASED"`).stdout, /R=0/);
});

test("接线守卫: harvest-cron 预检真读设备/通话并导出、开跑前拿锁、bootstrap 与 batch2 之后查 gate；outreach-tick 收工写账本", () => {
  const hc = readFileSync(HC, "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  assert.match(hc, /DEVICE_VERIFIED=1/);
  assert.match(hc, /CALL_STATE_IDLE=1/);
  assert.match(hc, /export ACCOUNT_VERIFIED DOUYIN_ID DEVICE_VERIFIED CALL_STATE_IDLE/);
  const iLock = hc.indexOf("preflight_lock_acquire\n"), iBoot = hc.indexOf('wfr_bootstrap "$TAG"');
  assert.ok(iLock > 0 && iLock < iBoot, "拿锁在 wfr_bootstrap(写 preflight 工件) 之前");
  const gates = [...hc.matchAll(/gate_check /g)].length;
  assert.ok(gates >= 3, `bootstrap 后/batch2 后/finalize 后都要查 gate（现 ${gates} 处）`);
  assert.match(hc, /trap '[^']*release_run_lock[^']*run_finalize'/);
  const ot = readFileSync(join(SRC, "outreach-tick.sh"), "utf8");
  assert.match(ot, /outreach-run/);
  assert.match(ot, /messages_sent/);
});

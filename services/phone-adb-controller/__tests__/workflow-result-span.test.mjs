import { seedFrozen } from './fixtures/frozen-runtime.mjs';
// 价值流建模④b（决策 3e867cad）：执行机每个 Backbone Activity 结束时向 Brain 上报一条 span。
// 事故形状：cmd09300230 批 134/134 走兜底重搜跑了 6 小时，结果探针全绿——过程指标（时长/重试/兜底）没人记。
// 契约：POST ${BRAIN_URL}/api/brain/spans（数组批量，Bearer 内部 token），字段 run_id/activity_id/started_at/ended_at/
// executor_kind/executor_id/attempts/fallback/outcome/evidence；幂等键 (run_id, activity_id|step_id|enabler_id, started_at)。
// 上报失败只 WFR_WARN，绝不影响主流程（与 brain callback 同一纪律）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");
const WFR = join(SRC, "workflow-result.sh");
const LEDGER = join(SRC, "ledger.mjs");
const JQ = spawnSync("bash", ["-lc", "command -v jq"], { encoding: "utf8" }).stdout.trim();
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
const SKIP = (!JQ && "no jq") || (!ZSH && "no zsh");
const JOURNEY = "afa6abca-53c0-4815-8594-b7fb81ca547f";
const ACT_COLLECTION = "9b8988e9-a22d-483c-a101-8091728b9e04";
const WF_ID = "b1000000-0000-4000-8000-000000000001";

function baseEnv(home) {
  return { ...process.env, HOME: home, WFR_HOME: home, WFR_NODE: process.execPath, WFR_JQ: JQ, WFR_LEDGER_MJS: LEDGER, WFR_SCP_TARGET: "",
    WFR_BRAIN_ENV: join(home, "no-brain.env"), BRAIN_URL: "", BRAIN_INTERNAL_TOKEN: "", WFR_BRAIN_TASK_ID: "", WFR_PROBE_STAGES: "" };
}
// 假 curl：记录每次 argv；GET journey_steps 回一份最小活动表（collection 挂 workflow）；其余回 {"success":true}\n200；fail 时连不上
function fakeCurl(dir, { fail = false } = {}) {
  const bin = join(dir, "bin"); mkdirSync(bin, { recursive: true });
  const calls = join(dir, "curl.calls");
  const steps = JSON.stringify([
    { id: ACT_COLLECTION, journey_id: JOURNEY, activity_key: "collection", backbone_version: "3.0", workflow_id: WF_ID, executor_kind: "code" },
    { id: "d27e18c9-709f-4c44-899c-85d6fb83671b", journey_id: JOURNEY, activity_key: "preflight", backbone_version: "3.0", workflow_id: WF_ID, executor_kind: "code" },
  ]);
  writeFileSync(join(bin, "curl"), `#!/usr/bin/env bash
python3 -c 'import json,sys; a=sys.argv[1:]; a += ["--test-stdin-json",sys.stdin.read()] if "--data-binary" in a and a[a.index("--data-binary")+1]=="@-" else []; print(json.dumps(a))' "$@" >> "${calls}"
${fail ? 'echo "curl: (7) Failed to connect to brain.test port 5221: Connection refused" >&2; exit 7' : ''}
case "$*" in *journey_steps*) printf '%s' '${steps}';; *) printf '{"success":true}\\n200';; esac
`);
  chmodSync(join(bin, "curl"), 0o755);
  return { PATH: `${bin}:${process.env.PATH}`, calls };
}
const BRAIN = { BRAIN_URL: "http://brain.test:5221", BRAIN_INTERNAL_TOKEN: "tok-brain", WFR_BRAIN_TASK_ID: "11111111-1111-4111-8111-111111111111" };
function calls(file) { return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []; }
function spanCalls(file) { return calls(file).filter((a) => a.some((x) => String(x).endsWith("/api/brain/spans"))); }
function bodyOf(args) { const i = args.indexOf("-d") >= 0 ? args.indexOf("-d") : args.indexOf("--test-stdin-json"); return JSON.parse(args[i + 1]); }
function wfr(home, extra, ...args) {
  const r = spawnSync("bash", [WFR, ...args], { encoding: "utf8", env: { ...baseEnv(home), ...extra } });
  const kv = Object.fromEntries(r.stdout.split("\n").filter((l) => /^WFR_[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
  return { code: r.status, kv, err: r.stderr };
}
function words(dir, list) { const f = join(dir, "kw.txt"); writeFileSync(f, list.join("\n") + "\n"); return f; }
function setup({ fail } = {}) {
  const d = mkdtempSync(join(tmpdir(), "wfr-span-"));
  const c = fakeCurl(d, { fail });
  const env = { ...BRAIN, PATH: c.PATH, DEVICE_VERIFIED: "1", ACCOUNT_VERIFIED: "1", CALL_STATE_IDLE: "1", LOCK_ACQUIRED: "1" };
  seedFrozen(join(d,"ledger","social-keyword-leadgen-crontab-spanA"));
  const init = wfr(d, env, "init", "spanA", "legacy", words(d, ["A"]), "1", "SER1", "xian-m4");
  assert.equal(init.code, 0, init.err);
  return { d, calls: c.calls, env: { ...env, ...init.kv, WFR_ATTEMPT: "a1" } };
}
function rescanMetricsOf(logFile) {
  const r = spawnSync(ZSH, ["-c", `BATCH2_LIB=1 source "${join(SRC, "batch2.sh")}"; word_rescan_metrics "$1" 0`, "zsh", logFile], { encoding: "utf8" });
  const [count, links, rate] = r.stdout.trim().split(/\s+/);
  return { rescan_count: Number(count), links_opened: Number(links), rescan_rate: Number(rate) };
}
const EV = '[{"type":"log","ref":"x.log"}]';
function collMetrics(m) { return JSON.stringify({ comments_collected: 3, videos_processed: m.links_opened, cursor_updates: 0, rescan_count: m.rescan_count, rescan_rate: m.rescan_rate }); }

test("init(preflight) 就上报一条 span：数组批量、Bearer、outcome=pass、executor_id=hostkey、activity_id 从冻结版本解析", { skip: SKIP }, () => {
  const { calls: cf } = setup();
  const sc = spanCalls(cf);
  assert.equal(sc.length, 1, `期望 1 次 spans 上报，实际 ${sc.length}`);
  const args = sc[0];
  assert.ok(args.includes("-H") && args.includes("Authorization: Bearer tok-brain"), "缺 Bearer 头");
  const body = bodyOf(args);
  assert.ok(Array.isArray(body) && body.length === 1, "body 必须是单元素数组");
  const s = body[0];
  assert.equal(s.run_id, "social-keyword-leadgen-crontab-spanA__a0");
  assert.equal(s.evidence.activity_key, "preflight");
  assert.equal(s.activity_id, "d27e18c9-709f-4c44-899c-85d6fb83671b");
  assert.equal(s.workflow_id, WF_ID);
  assert.equal(s.outcome, "pass"); assert.equal(s.executor_kind, "code"); assert.equal(s.executor_id, "xian-m4");
  assert.equal(s.fallback, false); assert.equal(s.attempts, 1);
  assert.match(s.started_at, /^\d{4}-\d{2}-\d{2}T/); assert.match(s.ended_at, /^\d{4}-\d{2}-\d{2}T/);
});

test("collection 用 cmd09300230 真实日志：rescan 41/41 → fallback=true、attempts=42、evidence 带 rescan；auto09292304 0/2 → fallback=false", { skip: SKIP }, () => {
  const { d, calls: cf, env } = setup();
  const red = rescanMetricsOf(join(HERE, "fixtures", "night-cmd09300230-w1.txt"));
  assert.deepEqual([red.rescan_count, red.rescan_rate], [41, 1]);
  let r = wfr(d, env, "stage", "collection", "completed", "1", "word=X", EV, collMetrics(red), "X");
  assert.equal(r.code, 0, r.err);
  let sc = spanCalls(cf); assert.equal(sc.length, 2, `init 1 + collection 1，实际 ${sc.length}`);
  let s = bodyOf(sc[1])[0];
  assert.equal(s.evidence.activity_key, "collection"); assert.equal(s.activity_id, ACT_COLLECTION);
  assert.equal(s.fallback, true); assert.equal(s.attempts, 42);
  assert.equal(s.evidence.rescan_count, 41); assert.equal(s.evidence.rescan_rate, 1); assert.equal(s.evidence.word, "X");
  const green = rescanMetricsOf(join(HERE, "fixtures", "night-auto09292304-w3.txt"));
  r = wfr(d, env, "stage", "collection", "completed", "2", "word=Y", EV, collMetrics(green), "Y");
  assert.equal(r.code, 0, r.err);
  s = bodyOf(spanCalls(cf)[2])[0];
  assert.equal(s.fallback, false); assert.equal(s.attempts, 1); assert.equal(s.evidence.rescan_count, 0);
});

test("mark-start 后 started_at 取标记时刻且同一 stage/n 重发不变（幂等键稳定）；blocked → outcome=skipped", { skip: SKIP }, () => {
  const { d, calls: cf, env } = setup();
  const m = wfr(d, env, "mark-start", "collection", "1"); assert.equal(m.code, 0, m.err);
  const marker = join(env.WFR_RUN_DIR, "span-start.a1.collection.1");
  assert.ok(existsSync(marker), "应写 span-start 标记");
  const started = readFileSync(marker, "utf8").trim();
  wfr(d, env, "stage", "collection", "blocked", "1", "word=X no_qualified", EV, collMetrics({ links_opened: 0, rescan_count: 0, rescan_rate: 0 }), "X");
  wfr(d, env, "stage", "collection", "blocked", "1", "word=X no_qualified", EV, collMetrics({ links_opened: 0, rescan_count: 0, rescan_rate: 0 }), "X");
  const sc = spanCalls(cf); assert.equal(sc.length, 2, "ack后重发不再发网络请求");
  const a = bodyOf(sc[1])[0], b = bodyOf(sc[1])[0];
  assert.equal(a.started_at, started); assert.equal(b.started_at, started);
  assert.equal(a.outcome, "skipped");
  assert.ok(a.ended_at >= a.started_at, "ended_at 不早于 started_at");
});

test("Brain 连不上：只 WFR_WARN，工件照写、退出码 0；缺 BRAIN 配置时不上报也不炸", { skip: SKIP }, () => {
  const { d, env } = setup({ fail: true });
  const r = wfr(d, env, "stage", "collection", "completed", "1", "word=X", EV, collMetrics({ links_opened: 2, rescan_count: 1, rescan_rate: 0.5 }), "X");
  assert.equal(r.code, 0);
  assert.match(r.err, /WFR_WARN.*span/);
  assert.ok(existsSync(join(env.WFR_ART_DIR, `${env.WFR_RUN_ID}__a1.collection.1.worker-result.json`)), "工件必须写成");
  const d2 = mkdtempSync(join(tmpdir(), "wfr-span-nobrain-"));
  const c2 = fakeCurl(d2);
  const init = wfr(d2, { PATH: c2.PATH, DEVICE_VERIFIED: "1", ACCOUNT_VERIFIED: "1", CALL_STATE_IDLE: "1", LOCK_ACQUIRED: "1" }, "init", "spanB", "legacy", words(d2, ["A"]), "1", "SER1", "xian-m4");
  assert.equal(init.code, 0, init.err);
  assert.equal(spanCalls(c2.calls).length, 0, "无 BRAIN 配置不应上报");
  assert.match(init.err, /span skipped/);
});

test("批次脚本接线：batch2 在词开始处 mark-start collection、delivery/scoring 段前 mark-start；init 导出 WFR_HOSTKEY", { skip: SKIP }, () => {
  const b2 = readFileSync(join(SRC, "batch2.sh"), "utf8");
  assert.match(b2, /wfr mark-start collection "\$n"/, "batch2 词开始处应 mark-start collection");
  assert.match(b2, /wfr mark-start delivery 1/, "落池前应 mark-start delivery");
  assert.match(b2, /wfr mark-start scoring 1/, "分拣前应 mark-start scoring");
  const w = readFileSync(WFR, "utf8");
  assert.match(w, /echo "WFR_HOSTKEY=\$WFR_HOSTKEY"/, "init 应导出 WFR_HOSTKEY 供 span executor_id");
});

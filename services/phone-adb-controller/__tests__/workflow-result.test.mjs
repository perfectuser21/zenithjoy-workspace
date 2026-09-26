import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WFR = join(HERE, "..", "workflow-result.sh");
const LEDGER = join(HERE, "..", "ledger.mjs");
const JQ = spawnSync("bash", ["-lc", "command -v jq"], { encoding: "utf8" }).stdout.trim();

function env(home) {
  // WFR_BRAIN_ENV 指向不存在的文件：开发机 ~/.credentials/brain.env 真实存在，不隔离会把测试工件回执到生产 Brain
  return { ...process.env, WFR_HOME: home, WFR_NODE: process.execPath, WFR_JQ: JQ, WFR_LEDGER_MJS: LEDGER, WFR_SCP_TARGET: "", WFR_BRAIN_ENV: join(home, "no-brain.env"), BRAIN_URL: "", BRAIN_INTERNAL_TOKEN: "", WFR_BRAIN_TASK_ID: "" };
}
// 假 curl：PATH 前置，把每次 argv 记成一行 JSON；默认回 body+"\n200"（对应 -w '\n%{http_code}'），fail=true 时模拟连不上（exit 7 + raw 错误）
function fakeCurl(dir, { fail = false } = {}) {
  const bin = join(dir, "bin"); mkdirSync(bin, { recursive: true });
  const calls = join(dir, "curl.calls");
  writeFileSync(join(bin, "curl"), `#!/usr/bin/env bash
python3 -c 'import json,sys;print(json.dumps(sys.argv[1:]))' "$@" >> "${calls}"
${fail ? 'echo "curl: (7) Failed to connect to brain.test port 5221: Connection refused" >&2; exit 7' : "printf '{\"success\":true}\\n200'"}
`);
  chmodSync(join(bin, "curl"), 0o755);
  return { PATH: `${bin}:${process.env.PATH}`, calls };
}
function curlCalls(calls) { return existsSync(calls) ? readFileSync(calls, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []; }
function argAfter(args, flag) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; }
const BRAIN = { BRAIN_URL: "http://brain.test:5221", BRAIN_INTERNAL_TOKEN: "tok-brain", WFR_BRAIN_TASK_ID: "11111111-1111-4111-8111-111111111111" };
function brainEnv(dir, opts) { const c = fakeCurl(dir, opts); return { env: { ...BRAIN, PATH: c.PATH }, calls: c.calls }; }
function wfr(home, extra, ...args) {
  const r = spawnSync("bash", [WFR, ...args], { encoding: "utf8", env: { ...env(home), ...extra } });
  const kv = Object.fromEntries(r.stdout.split("\n").filter((l) => /^WFR_[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
  return { code: r.status, kv, err: r.stderr };
}
function words(dir, list) { const f = join(dir, "kw.txt"); writeFileSync(f, list.join("\n") + "\n"); return f; }
function artifacts(kv) { return readdirSync(kv.WFR_ART_DIR).filter((f) => f.endsWith(".worker-result.json")).sort(); }
const IS_ROOT = typeof process.getuid === "function" && process.getuid() === 0; // root 无视权限位，chmod 000 测试对它无意义

test("hash: 同词单不同 TAG 相同；顺序无关；改一词即变；不含 SERIAL", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-"));
  const a = wfr(d, {}, "hash", "p1", words(d, ["A", "B"]), "1").kv.WFR_HASH;
  const b = wfr(d, {}, "hash", "p1", words(d, ["B", "A"]), "1").kv.WFR_HASH;
  const c = wfr(d, {}, "hash", "p1", words(d, ["A", "C"]), "1").kv.WFR_HASH;
  assert.equal(a.length, 64); assert.equal(a, b); assert.notEqual(a, c);
});

test("init: 写 preflight(completed)+qualification/scoring(blocked not_in_profile)，导出 RUN_ID/HASH/DIR", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-"));
  const r = wfr(d, {}, "init", "auto0921", "p1", words(d, ["A"]), "1", "SER1", "xian-m4");
  assert.equal(r.code, 0);
  assert.equal(r.kv.WFR_RUN_ID, "social-keyword-leadgen-crontab-auto0921");
  const files = artifacts(r.kv);
  assert.deepEqual(files, [
    "social-keyword-leadgen-crontab-auto0921__a0.preflight.1.worker-result.json",
    "social-keyword-leadgen-crontab-auto0921__a0.qualification.1.worker-result.json",
    "social-keyword-leadgen-crontab-auto0921__a0.scoring.1.worker-result.json",
  ]);
  const pf = JSON.parse(readFileSync(join(r.kv.WFR_ART_DIR, files[0]), "utf8"));
  assert.equal(pf.schema_version, 2); assert.equal(pf.status, "completed"); assert.equal(pf.recommended_next_action, "accept");
  assert.equal(pf.task_request_hash, r.kv.WFR_HASH); assert.ok(pf.evidence.length >= 1);
  for (const k of ["external_interactions", "business_reads", "business_writes", "artifact_writes", "device_verified", "account_verified", "call_state_idle", "lock_acquired"]) assert.equal(typeof pf.metrics[k], "number");
  const q = JSON.parse(readFileSync(join(r.kv.WFR_ART_DIR, files[1]), "utf8"));
  assert.equal(q.status, "blocked"); assert.equal(q.summary, "not_in_profile"); assert.equal(q.recommended_next_action, "block");
});

test("enter: 首次 a1，skip_words 空；stage 写工件并进账本 items", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-"));
  const i = wfr(d, {}, "init", "t1", "p1", words(d, ["A"]), "0", "S", "h");
  const e = wfr(d, i.kv, "enter");
  assert.equal(e.kv.WFR_ATTEMPT, "a1"); assert.equal(e.kv.WFR_SKIP_WORDS, "");
  const s = wfr(d, { ...i.kv, ...e.kv }, "stage", "discovery", "completed", "1", "word A ok",
    '[{"type":"log","ref":"night.log"}]', '{"candidates":3,"keywords_processed":1,"screens_scanned":0}', "A");
  assert.equal(s.code, 0);
  assert.ok(existsSync(join(i.kv.WFR_ART_DIR, "social-keyword-leadgen-crontab-t1__a1.discovery.1.worker-result.json")));
  const book = JSON.parse(readFileSync(join(i.kv.WFR_RUN_DIR, "ledger.json"), "utf8"));
  assert.equal(book.stages.discovery.items[0].word, "A"); assert.equal(book.stages.discovery.items[0].status, "completed");
});

test("stage: completed 但 evidence 为空 → 不落文件、exit 0、stderr 有 WFR_WARN", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-"));
  const i = wfr(d, {}, "init", "t2", "p1", words(d, ["A"]), "0", "S", "h");
  const e = wfr(d, i.kv, "enter");
  const s = wfr(d, { ...i.kv, ...e.kv }, "stage", "collection", "completed", "1", "x", "[]", '{"comments_collected":0,"videos_processed":0,"cursor_updates":0}', "A");
  assert.equal(s.code, 0); assert.match(s.err, /WFR_WARN/);
  assert.ok(!existsSync(join(i.kv.WFR_ART_DIR, "social-keyword-leadgen-crontab-t2__a1.collection.1.worker-result.json")));
});

test("stage: 目录不可写 → exit 0，stderr 含 errno 原文", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-"));
  const i = wfr(d, {}, "init", "t3", "p1", words(d, ["A"]), "0", "S", "h");
  const e = wfr(d, i.kv, "enter");
  const s = wfr(d, { ...i.kv, ...e.kv, WFR_ART_DIR: join(d, "kw.txt") /* 是文件不是目录 → ENOTDIR */ }, "stage", "discovery", "blocked", "1", "x", "[]", '{"candidates":0,"keywords_processed":1,"screens_scanned":0}', "A");
  assert.equal(s.code, 0); assert.match(s.err, /Not a directory|ENOTDIR|errno/);
});

test("finalize: 写 cleanup；工件数==已记账阶段数 → OK=1", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-"));
  const i = wfr(d, {}, "init", "t4", "p1", words(d, ["A"]), "0", "S", "h");
  const e = wfr(d, i.kv, "enter");
  const f = wfr(d, { ...i.kv, ...e.kv }, "finalize");
  assert.equal(f.kv.WFR_FINALIZE_OK, "1");
  assert.ok(artifacts(i.kv).some((x) => x.includes(".cleanup.1.")));
});

test("finalize: 记账阶段多于工件时 OK=0", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-"));
  const i = wfr(d, {}, "init", "t5", "p1", words(d, ["A"]), "0", "S", "h");
  const e = wfr(d, i.kv, "enter");
  const s = wfr(d, { ...i.kv, ...e.kv }, "stage", "discovery", "completed", "1", "word A ok",
    '[{"type":"log","ref":"night.log"}]', '{"candidates":3,"keywords_processed":1,"screens_scanned":0}', "A");
  assert.equal(s.code, 0);
  const discoveryFile = join(i.kv.WFR_ART_DIR, "social-keyword-leadgen-crontab-t5__a1.discovery.1.worker-result.json");
  assert.ok(existsSync(discoveryFile));
  rmSync(discoveryFile);
  const f = wfr(d, { ...i.kv, ...e.kv }, "finalize");
  assert.equal(f.kv.WFR_FINALIZE_OK, "0");
  assert.match(f.kv.WFR_FINALIZE_MSG, /artifact_count_mismatch/);
});

test("stage/enter/finalize 未 init 裸调 → exit 0 且 stderr 有 WFR_WARN", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-"));
  const s = wfr(d, {}, "stage", "discovery", "completed", "1", "x",
    '[{"type":"x"}]', '{"candidates":1,"keywords_processed":1,"screens_scanned":0}');
  assert.equal(s.code, 0); assert.match(s.err, /WFR_WARN/);
  const e = wfr(d, {}, "enter");
  assert.equal(e.code, 0); assert.match(e.err, /WFR_WARN/);
  const f = wfr(d, {}, "finalize");
  assert.equal(f.code, 0); assert.match(f.err, /WFR_WARN/);
  assert.equal(f.kv.WFR_FINALIZE_OK, "0");
});

test("stage: metrics 含闭集外的键 → 不落文件、exit 0、WFR_WARN", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-"));
  const i = wfr(d, {}, "init", "t6", "p1", words(d, ["A"]), "0", "S", "h");
  const e = wfr(d, i.kv, "enter");
  const s = wfr(d, { ...i.kv, ...e.kv }, "stage", "discovery", "completed", "1", "x",
    '[{"type":"log","ref":"night.log"}]', '{"candidates":1,"keywords_processed":1,"screens_scanned":0,"bogus":1}', "A");
  assert.equal(s.code, 0); assert.match(s.err, /WFR_WARN/);
  assert.ok(!existsSync(join(i.kv.WFR_ART_DIR, "social-keyword-leadgen-crontab-t6__a1.discovery.1.worker-result.json")));
});

// C2(终审必修，实测复现): 起跑前工件目录(workflow-runs)已不可写 → init/enter/finalize 全程的
// write_stage 都写不进文件，因此也都没触发 led1 set，ledger.json 从头到尾停在 fresh(全 pending)。
// 旧判据 n_files>=n_stages 算出 0>=0 成立 → 假绿 OK=1（终审员脚本实证：files=0 stages=0 → OK=1）。
// 契约下每条成功 write_stage 同时产 1 文件 + 1 items 条目，改判据为 n_items>0 && n_files>=n_items 后
// 这种"全程没写成过一个工件"的情况必须判 OK=0。
test("finalize: 起跑前工件目录不可写(chmod 000) → OK=0，不是假绿 OK=1", { skip: (!JQ && "no jq") || (IS_ROOT && "root 无视权限位") }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-"));
  const artDir = join(d, "workflow-runs");
  mkdirSync(artDir);
  chmodSync(artDir, 0o000);
  try {
    const i = wfr(d, {}, "init", "t7", "p1", words(d, ["A"]), "0", "S", "h");
    const e = wfr(d, i.kv, "enter");
    const f = wfr(d, { ...i.kv, ...e.kv }, "finalize");
    assert.equal(f.kv.WFR_FINALIZE_OK, "0");
    assert.match(f.kv.WFR_FINALIZE_MSG, /artifact_count_mismatch/);
  } finally {
    chmodSync(artDir, 0o755);
  }
});

// ── 棒1 回执线（决策 702949b6/280bd091）：工件校验通过后 best-effort POST Brain execution-callback ──
test("stage: 校验通过后 POST execution-callback（url / Bearer / body 五键），run_id=RUN__ATTEMPT.stage", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-"));
  const i = wfr(d, {}, "init", "t8", "p1", words(d, ["A"]), "0", "S", "h");
  const e = wfr(d, i.kv, "enter");
  const b = brainEnv(d);
  const s = wfr(d, { ...i.kv, ...e.kv, ...b.env }, "stage", "discovery", "completed", "1", "word A ok",
    '[{"type":"log","ref":"night.log"}]', '{"candidates":3,"keywords_processed":1,"screens_scanned":0}', "A");
  assert.equal(s.code, 0);
  const calls = curlCalls(b.calls);
  assert.equal(calls.length, 1, "恰好一次回执");
  const args = calls[0];
  assert.equal(argAfter(args, "POST"), "http://brain.test:5221/api/brain/execution-callback"); // -X POST <url>：精确相等，不做子串判断
  assert.ok(args.includes("Authorization: Bearer tok-brain"), `Bearer 头缺失: ${args}`);
  const body = JSON.parse(argAfter(args, "-d"));
  assert.equal(body.task_id, BRAIN.WFR_BRAIN_TASK_ID);
  assert.equal(body.run_id, "social-keyword-leadgen-crontab-t8__a1.discovery");
  assert.equal(body.status, "in_progress");
  assert.deepEqual(Object.keys(body.result).sort(), ["evidence", "metrics", "probes", "stage", "stage_status"]);
  assert.equal(body.result.stage, "discovery"); assert.equal(body.result.stage_status, "completed");
  assert.equal(body.result.metrics.candidates, 3); assert.equal(body.result.metrics.external_interactions, 0);
  assert.deepEqual(body.result.evidence, [{ type: "log", ref: "night.log" }]); assert.deepEqual(body.result.probes, []);
});

test("stage: 校验不过（evidence 空）→ 工件不落、也不回执", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-"));
  const i = wfr(d, {}, "init", "t9", "p1", words(d, ["A"]), "0", "S", "h");
  const e = wfr(d, i.kv, "enter");
  const b = brainEnv(d);
  const s = wfr(d, { ...i.kv, ...e.kv, ...b.env }, "stage", "collection", "completed", "1", "x", "[]", '{"comments_collected":0,"videos_processed":0,"cursor_updates":0}', "A");
  assert.equal(s.code, 0); assert.match(s.err, /WFR_WARN/);
  assert.equal(curlCalls(b.calls).length, 0);
});

test("finalize: 发终态 completed，run_id 用 cleanup 段，evidence 追加 finalize 条目", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-"));
  const i = wfr(d, {}, "init", "t10", "p1", words(d, ["A"]), "0", "S", "h");
  const e = wfr(d, i.kv, "enter");
  const b = brainEnv(d);
  const f = wfr(d, { ...i.kv, ...e.kv, ...b.env }, "finalize");
  assert.equal(f.code, 0); assert.equal(f.kv.WFR_FINALIZE_OK, "1");
  const calls = curlCalls(b.calls);
  assert.equal(calls.length, 1, "cleanup 工件只发终态一次，不再另发 in_progress");
  const body = JSON.parse(argAfter(calls[0], "-d"));
  assert.equal(body.task_id, BRAIN.WFR_BRAIN_TASK_ID);
  assert.equal(body.run_id, "social-keyword-leadgen-crontab-t10__a1.cleanup");
  assert.equal(body.status, "completed");
  assert.equal(body.result.stage, "cleanup"); assert.equal(body.result.stage_status, "completed");
  assert.equal(typeof body.result.metrics.lock_released, "number");
  assert.ok(body.result.evidence.some((x) => x.type === "finalize" && x.ok === 1), JSON.stringify(body.result.evidence));
});

test("finalize: cleanup 工件写不成（目录不可写）→ 终态 failed", { skip: (!JQ && "no jq") || (IS_ROOT && "root 无视权限位") }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-"));
  const i = wfr(d, {}, "init", "t11", "p1", words(d, ["A"]), "0", "S", "h");
  const e = wfr(d, i.kv, "enter");
  const b = brainEnv(d);
  chmodSync(i.kv.WFR_ART_DIR, 0o500);
  try {
    // init 已写成的 3 工件==3 账目,自检仍 OK=1;终态 failed 的判据是"cleanup 工件没写成",不是自检
    const f = wfr(d, { ...i.kv, ...e.kv, ...b.env }, "finalize");
    assert.equal(f.code, 0);
    const calls = curlCalls(b.calls);
    assert.equal(calls.length, 1);
    const body = JSON.parse(argAfter(calls[0], "-d"));
    assert.equal(body.status, "failed"); assert.equal(body.run_id, "social-keyword-leadgen-crontab-t11__a1.cleanup");
    assert.equal(body.result.stage, "cleanup"); assert.equal(body.result.stage_status, "failed");
    assert.ok(body.result.evidence.some((x) => x.type === "finalize"));
  } finally { chmodSync(i.kv.WFR_ART_DIR, 0o755); }
});

test("缺 BRAIN_URL / BRAIN_INTERNAL_TOKEN / WFR_BRAIN_TASK_ID 任一 → 不 POST，stderr 记 skipped，工件照写", { skip: !JQ && "no jq" }, () => {
  for (const missing of ["BRAIN_URL", "BRAIN_INTERNAL_TOKEN", "WFR_BRAIN_TASK_ID"]) {
    const d = mkdtempSync(join(tmpdir(), "wfr-"));
    const i = wfr(d, {}, "init", "t12", "p1", words(d, ["A"]), "0", "S", "h");
    const e = wfr(d, i.kv, "enter");
    const b = brainEnv(d);
    const s = wfr(d, { ...i.kv, ...e.kv, ...b.env, [missing]: "" }, "stage", "discovery", "completed", "1", "ok",
      '[{"type":"log","ref":"n.log"}]', '{"candidates":1,"keywords_processed":1,"screens_scanned":0}', "A");
    assert.equal(s.code, 0);
    assert.equal(curlCalls(b.calls).length, 0, `缺 ${missing} 仍 POST 了`);
    assert.match(s.err, /brain callback skipped/, `缺 ${missing} 没记日志`);
    assert.ok(existsSync(join(i.kv.WFR_ART_DIR, "social-keyword-leadgen-crontab-t12__a1.discovery.1.worker-result.json")));
  }
});

test("curl 失败 → stderr 含 raw 错误原文，exit 0，工件照写", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-"));
  const i = wfr(d, {}, "init", "t13", "p1", words(d, ["A"]), "0", "S", "h");
  const e = wfr(d, i.kv, "enter");
  const b = brainEnv(d, { fail: true });
  const s = wfr(d, { ...i.kv, ...e.kv, ...b.env }, "stage", "discovery", "completed", "1", "ok",
    '[{"type":"log","ref":"n.log"}]', '{"candidates":1,"keywords_processed":1,"screens_scanned":0}', "A");
  assert.equal(s.code, 0);
  assert.match(s.err, /brain callback curl failed.*Connection refused/);
  assert.ok(existsSync(join(i.kv.WFR_ART_DIR, "social-keyword-leadgen-crontab-t13__a1.discovery.1.worker-result.json")));
});

test("WFR_BRAIN_ENV 文件（~/.credentials/brain.env 读法）提供 BRAIN_URL/BRAIN_INTERNAL_TOKEN 时可回执", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-"));
  const i = wfr(d, {}, "init", "t14", "p1", words(d, ["A"]), "0", "S", "h");
  const e = wfr(d, i.kv, "enter");
  const c = fakeCurl(d);
  const envFile = join(d, "brain.env");
  writeFileSync(envFile, "BRAIN_URL=http://brain.file:5221/\nBRAIN_INTERNAL_TOKEN=tok-file\n");
  const s = wfr(d, { ...i.kv, ...e.kv, PATH: c.PATH, WFR_BRAIN_ENV: envFile, WFR_BRAIN_TASK_ID: BRAIN.WFR_BRAIN_TASK_ID }, "stage", "discovery", "completed", "1", "ok",
    '[{"type":"log","ref":"n.log"}]', '{"candidates":1,"keywords_processed":1,"screens_scanned":0}', "A");
  assert.equal(s.code, 0);
  const calls = curlCalls(c.calls);
  assert.equal(calls.length, 1);
  assert.equal(argAfter(calls[0], "POST"), "http://brain.file:5221/api/brain/execution-callback", "尾部 / 需去掉");
  assert.ok(calls[0].includes("Authorization: Bearer tok-file"));
});

// ── 棒3b-2 探针读回改经 ssh 在 MMV 跑（决策 8f38f5fd）：leadgen PG / 飞书凭据只在 MMV，执行机本地跑 verify-step 必 error ──
// 假 ssh：PATH 前置，把每次 argv 记成一行 JSON，回放 canned 到 stdout（rc 非零时模拟连不上/超时，stderr 给一行）
function fakeSsh(dir, { canned = "", rc = 0 } = {}) {
  const bin = join(dir, "sshbin"); mkdirSync(bin, { recursive: true });
  const calls = join(dir, "ssh.calls");
  const cannedFile = join(dir, "ssh.canned"); writeFileSync(cannedFile, `${canned}\n`); // 走文件回放：canned 可含多行（远端噪音 + 末行 JSON）
  writeFileSync(join(bin, "ssh"), `#!/usr/bin/env bash
python3 -c 'import json,sys;print(json.dumps(sys.argv[1:]))' "$@" >> "${calls}"
${rc ? `echo "ssh: connect to host mmv port 22: Operation timed out" >&2; exit ${rc}` : `cat "${cannedFile}"`}
`);
  chmodSync(join(bin, "ssh"), 0o755);
  return { bin, calls };
}
function sshCalls(calls) { return existsSync(calls) ? readFileSync(calls, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []; }
// 假 node：本机 node 绝不该再拉起 verify-step（它已迁到 MMV）；命中就记账并输出会被误合并的 probes
function fakeNode(dir) {
  const bin = join(dir, "nodebin"); mkdirSync(bin, { recursive: true });
  const calls = join(dir, "node.calls");
  const node = join(bin, "node");
  writeFileSync(node, `#!/usr/bin/env bash
case "$*" in
  *verify-step.mjs*)echo "$*" >> "${calls}"; printf '{"stage":"delivery","probes":[{"key":"local","observed":1,"probed_at":"x"}]}\\n';;
  *) exec "${process.execPath}" "$@";;
esac
`);
  chmodSync(node, 0o755);
  return { WFR_NODE: node, calls };
}
// 探针相关 env 全部指向不存在的路径：本机不再需要 checks YAML / 凭据文件，测试也不许碰开发机真实文件
const PROBE_ENV = (d) => ({ WFR_CHECKS_YAML: join(d, "no-checks.yaml") });
const DELIVERY_ARGS = ["delivery", "completed", "1", "pushed 2 leads", '[{"type":"log","ref":"n.log"}]', '{"leads_written":2,"duplicates_skipped":0,"readback_verified":0,"cursor_updates":0}'];
const CANNED = JSON.stringify({ stage: "delivery", probes: [{ key: "videos_readback", observed: 7, probed_at: "2026-09-26T00:00:00.000Z" }, { key: "comments_readback", observed: 22, probed_at: "2026-09-26T00:00:00.000Z" }, { key: "line_key_not_null", observed: ["jinuo"], probed_at: "2026-09-26T00:00:00.000Z" }] });
function probeRun(d, tag, profile, { ssh, node, extra = {}, stageArgs = DELIVERY_ARGS, push = "1" }) {
  const i = wfr(d, {}, "init", tag, profile, words(d, ["A"]), push, "S", "h");
  const e = wfr(d, i.kv, "enter");
  const b = brainEnv(d);
  const s = wfr(d, { ...i.kv, ...e.kv, ...b.env, ...PROBE_ENV(d), PATH: `${ssh.bin}:${b.env.PATH}`, WFR_NODE: node.WFR_NODE, ...extra }, "stage", ...stageArgs);
  return { i, s, b };
}

test("init: 额外导出 WFR_TAG / WFR_PROFILE（stage 钩子据此传 --run-tag/--line-key）", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-"));
  const i = wfr(d, {}, "init", "t15", "jinoshengyuan-work", words(d, ["A"]), "1", "S", "h");
  assert.equal(i.kv.WFR_TAG, "t15"); assert.equal(i.kv.WFR_PROFILE, "jinoshengyuan-work");
});

test("stage delivery: 经 ssh 在 MMV 跑 verify-step（形状同 batch2.sh:55 推 push-videos），probes 合进回执 result.probes；本机 node 不碰 verify-step", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-"));
  const ssh = fakeSsh(d, { canned: CANNED }); const node = fakeNode(d);
  const { s, b } = probeRun(d, "auto09252230", "jinoshengyuan-work", { ssh, node });
  assert.equal(s.code, 0);
  const calls = sshCalls(ssh.calls);
  assert.equal(calls.length, 1, "delivery 恰好一次 ssh");
  const av = calls[0];
  assert.equal(argAfter(av, "-o"), "ConnectTimeout=20", "照 batch2.sh:55 带 ConnectTimeout=20");
  assert.equal(av[av.length - 2], "mmv", "默认主机 mmv");
  const remote = av[av.length - 1];
  assert.ok(remote.startsWith("set -a; source ~/.credentials/zenithjoy-db.env 2>/dev/null; set +a; "), `远端先 source 凭据：${remote}`);
  assert.ok(remote.includes("cd ~/.openclaw/leadgen-scripts && node verify-step.mjs "), `默认目录 ~/.openclaw/leadgen-scripts：${remote}`);
  assert.match(remote, /--stage 'delivery' --run-tag 'auto09252230' --line-key 'jinoshengyuan-work' --word ''/, `参数形状：${remote}`);
  assert.ok(!remote.includes("--checks"), "checks 走 MMV 侧默认路径，不再传 --checks");
  assert.equal(sshCalls(node.calls).length, 0, "本机 node 不该再拉起 verify-step");
  const curls = curlCalls(b.calls);
  assert.equal(curls.length, 1);
  const body = JSON.parse(argAfter(curls[0], "-d"));
  assert.deepEqual(body.result.probes, JSON.parse(CANNED).probes);
  assert.equal(body.result.stage, "delivery"); assert.equal(body.result.metrics.leads_written, 2);
});

test("stage delivery: WFR_PROBE_HOST / WFR_PROBE_DIR 可覆盖主机与目录；--word 带中文与单引号照单引号包裹", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-"));
  const ssh = fakeSsh(d, { canned: CANNED }); const node = fakeNode(d);
  const { s } = probeRun(d, "t20", "yueshengyun-work", { ssh, node, extra: { WFR_PROBE_HOST: "probe-host", WFR_PROBE_DIR: "/srv/leadgen" }, stageArgs: [...DELIVERY_ARGS, "AI训练师 it's"] });
  assert.equal(s.code, 0);
  const av = sshCalls(ssh.calls)[0];
  assert.equal(av[av.length - 2], "probe-host");
  const remote = av[av.length - 1];
  assert.ok(remote.includes("cd /srv/leadgen && node verify-step.mjs "), remote);
  assert.ok(remote.includes("--line-key 'yueshengyun-work' --word 'AI训练师 it'\\''s'"), remote);
});

test("stage discovery: YAML 无该 stage 探针（本机无 YAML 时按 WFR_PROBE_STAGES 兜底闸）→ 不 ssh，probes 仍 []", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-"));
  const ssh = fakeSsh(d, { canned: '{"stage":"discovery","probes":[{"key":"bogus","observed":1,"probed_at":"x"}]}' }); const node = fakeNode(d);
  const { s, b } = probeRun(d, "t16", "p1", { ssh, node, push: "0", stageArgs: ["discovery", "completed", "1", "ok", '[{"type":"log","ref":"n.log"}]', '{"candidates":1,"keywords_processed":1,"screens_scanned":0}', "A"] });
  assert.equal(s.code, 0);
  assert.equal(sshCalls(ssh.calls).length, 0, "discovery 不该 ssh");
  assert.deepEqual(JSON.parse(argAfter(curlCalls(b.calls)[0], "-d")).result.probes, []);
});

test("stage delivery: ssh 超时/非零 / 输出非 JSON / 末行 JSON 无 probes 数组 → probes 保持 []、记 WFR_WARN、exit 0、回执照发", { skip: !JQ && "no jq" }, () => {
  const cases = [
    { name: "ssh 超时", ssh: (d) => fakeSsh(d, { rc: 255 }) },
    { name: "输出非 JSON", ssh: (d) => fakeSsh(d, { canned: "zsh: command not found: node" }) },
    { name: "无 probes 数组", ssh: (d) => fakeSsh(d, { canned: '{"stage":"delivery","probes":"nope"}' }) },
  ];
  for (const c of cases) {
    const d = mkdtempSync(join(tmpdir(), "wfr-"));
    const ssh = c.ssh(d); const node = fakeNode(d);
    const { i, s, b } = probeRun(d, "t17", "p1", { ssh, node });
    assert.equal(s.code, 0, c.name);
    assert.match(s.err, /WFR_WARN.*verify-step/, `${c.name}: 缺 WFR_WARN`);
    const calls = curlCalls(b.calls);
    assert.equal(calls.length, 1, `${c.name}: 回执仍要发`);
    assert.deepEqual(JSON.parse(argAfter(calls[0], "-d")).result.probes, [], c.name);
    assert.ok(existsSync(join(i.kv.WFR_ART_DIR, "social-keyword-leadgen-crontab-t17__a1.delivery.1.worker-result.json")), `${c.name}: 工件照写`);
  }
});

test("stage delivery: 远端 stderr 噪音夹在 stdout 前也只取末行 JSON", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-"));
  const ssh = fakeSsh(d, { canned: `line-route: jinuo base=x\n${CANNED}` }); const node = fakeNode(d);
  const { s, b } = probeRun(d, "t21", "p1", { ssh, node });
  assert.equal(s.code, 0);
  assert.deepEqual(JSON.parse(argAfter(curlCalls(b.calls)[0], "-d")).result.probes, JSON.parse(CANNED).probes);
});


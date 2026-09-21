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
  return { ...process.env, WFR_HOME: home, WFR_NODE: process.execPath, WFR_JQ: JQ, WFR_LEDGER_MJS: LEDGER, WFR_SCP_TARGET: "" };
}
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

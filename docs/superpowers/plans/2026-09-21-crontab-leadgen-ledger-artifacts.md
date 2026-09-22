# crontab 获客流水线补账本+阶段工件+续跑（基座 1/7）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让现有 crontab 获客流水线在不改生产原文件的前提下产出账本、每阶段 WORKER_RESULT 工件（带 task_request_hash）并支持断点续跑，escort 加真活复核与孤儿清扫。

**Architecture:** 侧车写手。`ledger.mjs`（node，账本）+ `workflow-result.sh`（bash，工件写手，永远 exit 0，子命令通过 stdout 打印 `KEY=VALUE` 供调用方 `eval`）；`harvest-cron-v4.sh` / `batch2-v4.sh` 是原脚本的副本加 4 处钩子；`harvest-keyword.sh` 不动。工件与账本落 `~/.config/zenithjoy/`，收工 best-effort scp 到 MMV。

**Tech Stack:** zsh（生产脚本）、bash（侧车）、node 26（账本，`node --test` 测试）、jq。

## Global Constraints

- 只新增：`services/phone-adb-controller/{ledger.mjs,workflow-result.sh,harvest-cron-v4.sh,batch2-v4.sh}`、`services/phone-adb-controller/__tests__/{ledger-resume,workflow-result,pipeline-v4-integration}.test.mjs`、README 追加段。**`harvest-cron.sh / batch2.sh / harvest-keyword.sh / douyin-phone-adb / outreach-tick.sh / push-*.js` 一字不动。**
- TDD 铁律：每个 task 先 commit failing test，再 commit 实现。
- 脚本内 node/jq 绝对路径：`/opt/homebrew/bin/node`、`/usr/bin/jq`（crontab 无 PATH），可由环境变量 `WFR_NODE` / `WFR_JQ` 覆盖（测试用）。
- 新增 `grep` 一律 `|| true` 再判变量（pipefail 假绿）。
- WORKER_RESULT：`schema_version` 数字 2；`status ∈ completed|blocked|failed`；`recommended_next_action ∈ accept|steer|retry|block|stop`（completed→accept，blocked→block，failed→retry）；completed 时 `evidence` ≥1 个对象；`metrics` 含通用 4 键 + 阶段闭集键，全为数字，禁自造键。
- `task_request_hash = sha256(profile|sorted(词单)|six_months|most_liked|unlimited|PUSH)`，不含 TAG、不含 SERIAL。
- attempt 只在 `wfr enter`（进入 batch2 前）递增。
- 工件命名 `<run_id>__<attempt>.<stage>.<n>.worker-result.json`；`run_id = social-keyword-leadgen-crontab-<TAG>`。
- 测试命令：`node --test services/phone-adb-controller/__tests__/*.test.mjs`（CI L3 已接）。
- 提交信息末尾：`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `services/phone-adb-controller/ledger.mjs` | 账本：7 阶段状态 + 每词 items + attempt 分配 + 续跑 skip_words |
| `services/phone-adb-controller/workflow-result.sh` | 工件写手：`hash / init / enter / stage / finalize`，永远 exit 0 |
| `services/phone-adb-controller/batch2-v4.sh` | 每词出口码→阶段状态，hash 一致性（fail-closed），delivery 工件 |
| `services/phone-adb-controller/harvest-cron-v4.sh` | 孤儿 escort 清扫、30s 真活复核、init/enter/finalize 钩子、续跑过滤 |
| `__tests__/ledger-resume.test.mjs` | 账本单测 |
| `__tests__/workflow-result.test.mjs` | 工件形状/hash/失败不阻塞 单测 |
| `__tests__/pipeline-v4-integration.test.mjs` | 假 harvest-keyword 驱动 batch2-v4 集成（无 zsh 则 skip） |

---

### Task 1: ledger.mjs（7 阶段 + items + 续跑）

**Files:**
- Create: `services/phone-adb-controller/ledger.mjs`
- Test: `services/phone-adb-controller/__tests__/ledger-resume.test.mjs`

**Interfaces:**
- Produces（CLI，全部以 `--run-dir <dir>` 定位 `<dir>/ledger.json`）：
  - `init --run-dir D --run-id R [--hash H] [--profile P] [--serial S] [--hostkey K]` → stdout `{"ok":true,"run_id":R,"attempt_id":null}`
  - `set --run-dir D --stage S --status completed|blocked|failed|running|pending [--note T] [--n K --word W]` → 有 `--n` 时写入 `stages[S].items[]`（按 n 去重覆盖），无 `--n` 时写阶段级状态
  - `show --run-dir D` → 整本 JSON
  - `next-attempt --run-dir D` → `{"ok":true,"attempt_id":"aN","skip_words":[...]}`；`skip_words` = discovery 与 collection 的 items 中同一 word 都 `completed` 的词；账本 JSON 损坏或不存在 → stderr 警告，重建为空本，attempt 从 a1 起（fail-open）
- 状态记录不做判断。

- [ ] **Step 1: 写失败测试**

```js
// services/phone-adb-controller/__tests__/ledger-resume.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const LEDGER = join(dirname(fileURLToPath(import.meta.url)), "..", "ledger.mjs");
function led(dir, ...args) {
  const r = spawnSync(process.execPath, [LEDGER, ...args, "--run-dir", dir], { encoding: "utf8" });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim(), json: r.stdout.trim() ? JSON.parse(r.stdout.trim().split("\n").pop()) : null };
}

test("init: 七阶段 pending，attempt 未分配", () => {
  const d = mkdtempSync(join(tmpdir(), "led-"));
  const r = led(d, "init", "--run-id", "social-keyword-leadgen-crontab-auto1", "--hash", "abc");
  assert.equal(r.code, 0);
  assert.equal(r.json.attempt_id, null);
  const book = JSON.parse(readFileSync(join(d, "ledger.json"), "utf8"));
  assert.deepEqual(Object.keys(book.stages), ["preflight", "discovery", "qualification", "collection", "scoring", "delivery", "cleanup"]);
  assert.equal(book.task_request_hash, "abc");
});

test("set --n --word 写 items 并按 n 覆盖", () => {
  const d = mkdtempSync(join(tmpdir(), "led-"));
  led(d, "init", "--run-id", "r");
  led(d, "set", "--stage", "discovery", "--status", "failed", "--n", "1", "--word", "A");
  led(d, "set", "--stage", "discovery", "--status", "completed", "--n", "1", "--word", "A");
  const book = JSON.parse(readFileSync(join(d, "ledger.json"), "utf8"));
  assert.equal(book.stages.discovery.items.length, 1);
  assert.equal(book.stages.discovery.items[0].status, "completed");
  assert.equal(book.stages.discovery.status, "completed");
});

test("next-attempt: 首次 a1，skip_words 只含 discovery+collection 都 completed 的词", () => {
  const d = mkdtempSync(join(tmpdir(), "led-"));
  led(d, "init", "--run-id", "r");
  led(d, "set", "--stage", "discovery", "--status", "completed", "--n", "1", "--word", "A");
  led(d, "set", "--stage", "collection", "--status", "completed", "--n", "1", "--word", "A");
  led(d, "set", "--stage", "discovery", "--status", "completed", "--n", "2", "--word", "B");
  led(d, "set", "--stage", "collection", "--status", "failed", "--n", "2", "--word", "B");
  const r1 = led(d, "next-attempt");
  assert.equal(r1.json.attempt_id, "a1");
  assert.deepEqual(r1.json.skip_words, ["A"]);
  const r2 = led(d, "next-attempt");
  assert.equal(r2.json.attempt_id, "a2");
});

test("坏账本 fail-open：警告并重建，attempt 从 a1", () => {
  const d = mkdtempSync(join(tmpdir(), "led-"));
  writeFileSync(join(d, "ledger.json"), "{not json");
  const r = led(d, "next-attempt");
  assert.equal(r.code, 0);
  assert.match(r.err, /ledger corrupt/);
  assert.equal(r.json.attempt_id, "a1");
  assert.deepEqual(r.json.skip_words, []);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test services/phone-adb-controller/__tests__/ledger-resume.test.mjs`
Expected: 4 个 test 全部 FAIL（`ledger.mjs` 不存在，spawn 返回非 0 / JSON 解析失败）。

- [ ] **Step 3: 提交失败测试**

```bash
git add services/phone-adb-controller/__tests__/ledger-resume.test.mjs
git commit -m "test(leadgen-ledger): 账本七阶段/items/续跑 skip_words/坏本 fail-open 失败测试

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: 实现 ledger.mjs（以种子为底，改 STAGES、加 items、改 next-attempt）**

```js
#!/usr/bin/env node
// ledger.mjs —— crontab 获客流水线账本（基座 1/7）。一个 run 一个目录，<run-dir>/ledger.json。
// 用法:
//   node ledger.mjs init --run-dir D --run-id R [--hash H] [--profile P] [--serial S] [--hostkey K]
//   node ledger.mjs set  --run-dir D --stage S --status <completed|blocked|failed|running|pending> [--note T] [--n K --word W]
//   node ledger.mjs show --run-dir D
//   node ledger.mjs next-attempt --run-dir D      # 进入 batch2 前调用：分配 attempt，导出续跑 skip_words
import fs from "fs";
import path from "path";

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      out[key] = val;
    } else out._.push(a);
  }
  return out;
}

const STAGES = ["preflight", "discovery", "qualification", "collection", "scoring", "delivery", "cleanup"];
const STATUSES = ["pending", "running", "completed", "blocked", "failed"];
const emptyStage = () => ({ status: "pending", note: "", updated_at: null, items: [] });

function ledgerPath(runDir) { return path.join(runDir, "ledger.json"); }

function freshLedger(runId, args = {}) {
  return {
    run_id: runId,
    attempt_id: null,
    task_request_hash: args.hash || "",
    run_meta: { profile: args.profile || "", serial: args.serial || "", hostkey: args.hostkey || "" },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    stages: Object.fromEntries(STAGES.map((s) => [s, emptyStage()])),
  };
}

// fail-open：不存在或损坏 → 警告 + 重建空本（判定点 544cd6a3 的反面：坏账本不能让采收停）
function loadLedgerOrFresh(runDir) {
  const p = ledgerPath(runDir);
  if (!fs.existsSync(p)) return freshLedger(path.basename(runDir));
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { console.error(`ledger corrupt at ${p} (${e.message}); rebuilding empty ledger`); return freshLedger(path.basename(runDir)); }
}

function saveLedger(runDir, ledger) {
  fs.mkdirSync(runDir, { recursive: true });
  ledger.updated_at = new Date().toISOString();
  fs.writeFileSync(ledgerPath(runDir), JSON.stringify(ledger, null, 2));
}

const args = parseArgs(process.argv.slice(2));
const cmd = process.argv[2];
const runDir = args["run-dir"];
if (!runDir) { console.error("missing --run-dir"); process.exit(2); }

if (cmd === "init") {
  const ledger = freshLedger(args["run-id"] || `run-${Date.now()}`, args);
  saveLedger(runDir, ledger);
  console.log(JSON.stringify({ ok: true, run_id: ledger.run_id, attempt_id: ledger.attempt_id }));
} else if (cmd === "set") {
  const stage = args["stage"], status = args["status"];
  if (!STAGES.includes(stage)) { console.error(`unknown stage: ${stage}`); process.exit(2); }
  if (!STATUSES.includes(status)) { console.error(`invalid status: ${status}`); process.exit(2); }
  const ledger = loadLedgerOrFresh(runDir);
  const st = ledger.stages[stage] || emptyStage();
  st.items = st.items || [];
  if (args["n"] !== undefined) {
    const n = Number(args["n"]);
    const item = { n, word: args["word"] || "", status, note: args["note"] || "", updated_at: new Date().toISOString() };
    const i = st.items.findIndex((x) => x.n === n);
    if (i >= 0) st.items[i] = item; else st.items.push(item);
  }
  st.status = status; st.note = args["note"] || st.note || ""; st.updated_at = new Date().toISOString();
  ledger.stages[stage] = st;
  saveLedger(runDir, ledger);
  console.log(JSON.stringify({ ok: true, stage, status, n: args["n"] ?? null }));
} else if (cmd === "show") {
  console.log(JSON.stringify(loadLedgerOrFresh(runDir), null, 2));
} else if (cmd === "next-attempt") {
  const ledger = loadLedgerOrFresh(runDir);
  const prev = ledger.attempt_id;
  const n = prev ? parseInt(String(prev).replace("a", ""), 10) + 1 : 1;
  const done = (stage) => new Set((ledger.stages[stage]?.items || []).filter((x) => x.status === "completed").map((x) => x.word));
  const d = done("discovery"), c = done("collection");
  const skip_words = [...d].filter((w) => c.has(w));
  ledger.attempt_id = `a${n}`;
  ledger.resumes_attempt_id = prev;
  saveLedger(runDir, ledger);
  console.log(JSON.stringify({ ok: true, attempt_id: ledger.attempt_id, resumed_from: prev, skip_words }));
} else {
  console.error("usage: ledger.mjs <init|set|show|next-attempt> --run-dir <dir> ...");
  process.exit(2);
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test services/phone-adb-controller/__tests__/ledger-resume.test.mjs`
Expected: `# pass 4`

- [ ] **Step 6: 提交实现**

```bash
git add services/phone-adb-controller/ledger.mjs
git commit -m "feat(leadgen-ledger): 账本 ledger.mjs——七阶段+每词 items+续跑 skip_words，坏本 fail-open

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: workflow-result.sh（工件写手）

**Files:**
- Create: `services/phone-adb-controller/workflow-result.sh`
- Test: `services/phone-adb-controller/__tests__/workflow-result.test.mjs`

**Interfaces:**
- Consumes：Task 1 的 `ledger.mjs` CLI。
- 环境变量（均有默认）：`WFR_HOME`（默认 `$HOME/.config/zenithjoy`）、`WFR_NODE`（`/opt/homebrew/bin/node`）、`WFR_JQ`（`/usr/bin/jq`）、`WFR_LEDGER_MJS`（`$HOME/bin-harvest/ledger.mjs`）、`WFR_SCP_TARGET`（默认 `mmv:/Users/administrator/openclaw-root/workspaces-root/clawd-work-commander/state/workflow-runs/`，空串=不传）。
- Produces（stdout 打印 `KEY=VALUE`，调用方 `eval "$(...)"`；日志到 stderr；**永远 exit 0**）：
  - `hash <profile> <wordfile> <push>` → `WFR_HASH=<sha256>`
  - `init <TAG> <profile> <wordfile> <push> <serial> <hostkey>` → `WFR_RUN_ID= WFR_HASH= WFR_RUN_DIR= WFR_ART_DIR=`；写 preflight(completed)、qualification/scoring(blocked, not_in_profile) 三个工件；账本 init
  - `enter` → `WFR_ATTEMPT= WFR_SKIP_WORDS=<用 | 连接>`（需已 `eval` 过 init 的导出）
  - `stage <stage> <status> <n> <summary> <evidence_json> <metrics_json> [<word>]` → 写工件 + 校验 + 账本 set；校验不过则删文件并 stderr 记 `WFR_WARN`
  - `finalize` → 写 cleanup；自检；scp；stdout `WFR_FINALIZE_OK=0|1 WFR_FINALIZE_MSG=...`
- 工件文件：`$WFR_ART_DIR/<run_id>__<attempt>.<stage>.<n>.worker-result.json`；账本：`$WFR_HOME/ledger/<run_id>/ledger.json`。init 阶段的三个工件 attempt 记为 `a0`（尚未 enter）。

- [ ] **Step 1: 写失败测试**

```js
// services/phone-adb-controller/__tests__/workflow-result.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test services/phone-adb-controller/__tests__/workflow-result.test.mjs`
Expected: 6 个 test FAIL（`workflow-result.sh` 不存在，bash 报 No such file，kv 为空）。若本机无 jq 则全部 skip——此时先 `brew install jq` 再继续，不允许在无 jq 环境上"通过"。

- [ ] **Step 3: 提交失败测试**

```bash
git add services/phone-adb-controller/__tests__/workflow-result.test.mjs
git commit -m "test(leadgen-wfr): 工件写手 hash/init/enter/stage 校验/失败不阻塞/finalize 失败测试

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: 实现 workflow-result.sh**

```bash
#!/usr/bin/env bash
# workflow-result.sh — crontab 获客流水线的 WORKER_RESULT 工件写手（基座 1/7）。
# 永远 exit 0，绝不阻塞主流程（照 wall-report.sh 范式）。子命令把导出变量打印到 stdout，调用方 eval。
# 用法:
#   eval "$(workflow-result.sh init <TAG> <profile> <wordfile> <push> <serial> <hostkey>)"
#   eval "$(workflow-result.sh enter)"
#   workflow-result.sh stage <stage> <completed|blocked|failed> <n> <summary> <evidence_json> <metrics_json> [<word>]
#   eval "$(workflow-result.sh finalize)"
#   workflow-result.sh hash <profile> <wordfile> <push>
# 契约: protocol.md WORKER_RESULT（schema_version=2 / evidence 非空 / metrics 闭集）；判定点 544cd6a3 判据用产物。
set -u
WFR_HOME="${WFR_HOME:-$HOME/.config/zenithjoy}"
WFR_NODE="${WFR_NODE:-/opt/homebrew/bin/node}"
WFR_JQ="${WFR_JQ:-/usr/bin/jq}"
WFR_LEDGER_MJS="${WFR_LEDGER_MJS:-$HOME/bin-harvest/ledger.mjs}"
WFR_SCP_TARGET="${WFR_SCP_TARGET-mmv:/Users/administrator/openclaw-root/workspaces-root/clawd-work-commander/state/workflow-runs/}"
warn(){ echo "WFR_WARN $(date +%m%d-%H:%M:%S) $*" >&2; }
led(){ "$WFR_NODE" "$WFR_LEDGER_MJS" "$@" --run-dir "$WFR_RUN_DIR" 2>&1 | tail -1; }

sha(){ if command -v sha256sum >/dev/null 2>&1; then sha256sum | cut -c1-64; else shasum -a 256 | cut -c1-64; fi; }
calc_hash(){ # profile wordfile push —— 不含 TAG、不含 SERIAL（请求身份与设备无关）
  { printf '%s|' "$1"; sort "$2" | grep -v '^$' | paste -sd'|' - ; printf '|six_months|most_liked|unlimited|%s' "$3"; } 2>/dev/null | sha
}

# metrics 闭集（protocol.md「metrics 封闭键集」逐字）
COMMON="external_interactions business_reads business_writes artifact_writes"
req_keys(){ case "$1" in
  preflight) echo "device_verified account_verified call_state_idle lock_acquired";;
  discovery) echo "keywords_processed screens_scanned candidates";;
  qualification) echo "candidates_judged qualified";;
  collection) echo "comments_collected videos_processed cursor_updates";;
  scoring) echo "comments_scored strong_intent weak_intent peer irrelevant spam";;
  delivery) echo "leads_written duplicates_skipped readback_verified cursor_updates";;
  cleanup) echo "close_app_attempts lock_released safe_desktop_visible";;
  *) echo "";; esac; }
next_action(){ case "$1" in completed) echo accept;; blocked) echo block;; failed) echo retry;; *) echo stop;; esac; }

# 写一个工件：stage status n summary evidence_json metrics_json [word]
write_stage(){
  local stage="$1" status="$2" n="$3" summary="$4" evidence="$5" metrics="$6" word="${7:-}"
  local attempt="${WFR_ATTEMPT:-a0}"
  local f="$WFR_ART_DIR/${WFR_RUN_ID}__${attempt}.${stage}.${n}.worker-result.json"
  local keys; keys="$COMMON $(req_keys "$stage")"
  # 通用键缺省补 0，阶段键必须由调用方给（缺了校验会拒）
  local body
  body=$("$WFR_JQ" -n --arg run "$WFR_RUN_ID" --arg att "$attempt" --arg st "$stage" --argjson n "$n" \
      --arg hash "$WFR_HASH" --arg status "$status" --arg na "$(next_action "$status")" --arg sum "$summary" \
      --argjson ev "$evidence" --argjson m "$metrics" \
      '{schema_version:2,run_id:$run,attempt_id:$att,stage_id:$st,stage_attempt:$n,task_request_hash:$hash,
        status:$status,recommended_next_action:$na,summary:$sum,evidence:$ev,artifacts:[],
        metrics:({external_interactions:0,business_reads:0,business_writes:0,artifact_writes:0}+$m),
        observed_at:(now|todate)}' 2>&1) || { warn "stage=$stage jq build failed: $body"; return 0; }
  local err
  if ! err=$(printf '%s\n' "$body" > "$f" 2>&1); then warn "stage=$stage write failed errno: $err"; return 0; fi
  [[ -s "$f" ]] || { warn "stage=$stage write produced empty file (errno: $(ls -ld "$WFR_ART_DIR" 2>&1))"; return 0; }
  # 校验：判据用产物（判定点 544cd6a3）
  local jqf='.schema_version==2 and (.status|IN("completed","blocked","failed")) and (.recommended_next_action|IN("accept","steer","retry","block","stop")) and (.evidence|type=="array") and ((.status!="completed") or (.evidence|length>=1))'
  for k in $keys; do jqf="$jqf and (.metrics.\"$k\"|type==\"number\")"; done
  if ! "$WFR_JQ" -e "$jqf" "$f" >/dev/null 2>&1; then warn "stage=$stage artifact invalid, removed: $f"; rm -f "$f"; return 0; fi
  if [[ -n "$word" ]]; then led set --stage "$stage" --status "$status" --n "$n" --word "$word" --note "$summary" >/dev/null
  else led set --stage "$stage" --status "$status" --note "$summary" >/dev/null; fi
}

cmd="${1:-}"; shift || true
case "$cmd" in
  hash) echo "WFR_HASH=$(calc_hash "$1" "$2" "$3")";;
  init)
    TAG="$1"; P="$2"; WF="$3"; PUSH="$4"; SERIAL="${5:-}"; HOSTKEY="${6:-}"
    WFR_RUN_ID="social-keyword-leadgen-crontab-$TAG"
    WFR_HASH="$(calc_hash "$P" "$WF" "$PUSH")"
    WFR_RUN_DIR="$WFR_HOME/ledger/$WFR_RUN_ID"; WFR_ART_DIR="$WFR_HOME/workflow-runs"
    mkdir -p "$WFR_RUN_DIR" "$WFR_ART_DIR" 2>/dev/null || warn "mkdir failed errno: $(mkdir -p "$WFR_RUN_DIR" "$WFR_ART_DIR" 2>&1)"
    led init --run-id "$WFR_RUN_ID" --hash "$WFR_HASH" --profile "$P" --serial "$SERIAL" --hostkey "$HOSTKEY" >/dev/null
    export WFR_RUN_ID WFR_HASH WFR_RUN_DIR WFR_ART_DIR
    write_stage preflight completed 1 "device+account preflight by harvest-cron" \
      "[{\"type\":\"preflight\",\"serial\":\"$SERIAL\",\"hostkey\":\"$HOSTKEY\"}]" \
      '{"device_verified":1,"account_verified":0,"call_state_idle":1,"lock_acquired":0}'
    write_stage qualification blocked 1 "not_in_profile" '[]' '{"candidates_judged":0,"qualified":0}'
    write_stage scoring blocked 1 "not_in_profile" '[]' '{"comments_scored":0,"strong_intent":0,"weak_intent":0,"peer":0,"irrelevant":0,"spam":0}'
    echo "WFR_RUN_ID=$WFR_RUN_ID"; echo "WFR_HASH=$WFR_HASH"; echo "WFR_RUN_DIR=$WFR_RUN_DIR"; echo "WFR_ART_DIR=$WFR_ART_DIR";;
  enter)
    out="$(led next-attempt)"
    att="$(printf '%s' "$out" | "$WFR_JQ" -r '.attempt_id // "a1"' 2>/dev/null || echo a1)"
    skip="$(printf '%s' "$out" | "$WFR_JQ" -r '(.skip_words // []) | join("|")' 2>/dev/null || true)"
    echo "WFR_ATTEMPT=$att"; echo "WFR_SKIP_WORDS=$skip";;
  stage) write_stage "$@";;
  finalize)
    write_stage cleanup completed 1 "finalize by harvest-cron trap" '[{"type":"log","ref":"harvest-cron.log"}]' '{"close_app_attempts":0,"lock_released":1,"safe_desktop_visible":0}'
    n_files=$(ls "$WFR_ART_DIR"/"${WFR_RUN_ID}"__*.worker-result.json 2>/dev/null | wc -l | tr -d ' ' || true)
    n_stages=$(led show | "$WFR_JQ" '[.stages[] | select(.status!="pending")] | length' 2>/dev/null || echo 0)
    n_items=$(led show | "$WFR_JQ" '[.stages[].items[]?] | length' 2>/dev/null || echo 0)
    expected=$(( n_stages + n_items ))
    if [[ -n "$WFR_SCP_TARGET" ]]; then
      scp -q -o ConnectTimeout=20 "$WFR_ART_DIR"/"${WFR_RUN_ID}"__*.worker-result.json "$WFR_SCP_TARGET" 2>/dev/null || warn "scp to MMV failed; artifacts kept locally"
    fi
    if (( n_files >= n_stages )); then echo "WFR_FINALIZE_OK=1"; echo "WFR_FINALIZE_MSG=artifacts=$n_files stages=$n_stages items=$n_items"
    else echo "WFR_FINALIZE_OK=0"; echo "WFR_FINALIZE_MSG=artifact_count_mismatch files=$n_files stages=$n_stages expected>=$expected"; fi;;
  *) warn "unknown subcommand: $cmd";;
esac
exit 0
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test services/phone-adb-controller/__tests__/workflow-result.test.mjs`
Expected: `# pass 6`

- [ ] **Step 6: 守卫弄坏一次（proven-to-fire，逻辑类）**

在测试文件里临时把 "evidence 为空" 那条的 `"[]"` 改成 `'[{"type":"x"}]'`，跑测试 → 那条应 **FAIL**（说明校验守卫在真判断）；改回去再跑 → PASS。不提交改坏的版本。

- [ ] **Step 7: 提交实现**

```bash
git add services/phone-adb-controller/workflow-result.sh
git commit -m "feat(leadgen-wfr): 工件写手 workflow-result.sh——hash/init/enter/stage/finalize，永远 exit 0，jq 校验闭集键

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: batch2-v4.sh（出口码→阶段状态，hash fail-closed）+ 集成测试

**Files:**
- Create: `services/phone-adb-controller/batch2-v4.sh`
- Test: `services/phone-adb-controller/__tests__/pipeline-v4-integration.test.mjs`

**Interfaces:**
- Consumes：`workflow-result.sh`（`hash`/`stage`），已 `eval` 的 `WFR_RUN_ID WFR_HASH WFR_RUN_DIR WFR_ART_DIR WFR_ATTEMPT WFR_SKIP_WORDS`。
- 环境变量：`HARVEST_KEYWORD`（默认 `~/bin-harvest/harvest-keyword.sh`）、`WFR`（默认 `~/bin-harvest/workflow-result.sh`）、`WALL_REPORT` 同原版、`PUSH_LEADS`（默认走原版 scp+ssh mmv 段；测试置 `PUSH=0` 跳过）。
- Produces：与原 batch2 相同的 `~/night-$TAG.tsv` / `.log`；每词 `discovery`/`collection` 工件（n=词序号）；push 后 `delivery` 工件；hash 不一致时写 `discovery blocked hash_mismatch`、stdout 打印 `BATCH2_ESCALATE=hash_mismatch` 并**停**。
- 出口码映射（判定点 af061588）：`0`+有 VIDEO 增量 → discovery/collection completed；`0`+无 VIDEO → discovery blocked（无卡片）；`3` → discovery blocked（锁被占）；`1` → discovery failed；其它 → discovery failed。

- [ ] **Step 1: 写失败集成测试（假 harvest-keyword，无 zsh 则 skip）**

```js
// services/phone-adb-controller/__tests__/pipeline-v4-integration.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
const JQ = spawnSync("bash", ["-lc", "command -v jq"], { encoding: "utf8" }).stdout.trim();
const SKIP = (!ZSH && "no zsh (CI: sudo apt-get install -y zsh)") || (!JQ && "no jq");

// 假 harvest-keyword.sh：按词决定行为。参数: PROFILE ENC MAXV TAG LOC
const FAKE = `#!/bin/zsh
W=$(python3 -c "import urllib.parse,sys;print(urllib.parse.unquote(sys.argv[1]))" "$2")
case "$W" in
  ok)     print "VIDEO\\t1\\thttps://v/1\\ttitle\\t$W\\t2"; print "LEAD\\tnick\\tid1\\tpersonal\\tbody\\t09-01\\t上海\\ttitle\\t$W\\t\\t\\thttps://v/1"; print "LEAD\\tnick2\\tid2\\tpersonal\\tbody\\t09-01\\t上海\\ttitle\\t$W\\t\\t\\thttps://v/1"; exit 0;;
  nocard) exit 0;;
  lock)   exit 3;;
  fail)   exit 1;;
esac`;

function setup(wordsList) {
  const home = mkdtempSync(join(tmpdir(), "b2v4-"));
  mkdirSync(join(home, "bin-harvest"), { recursive: true });
  const fake = join(home, "bin-harvest", "harvest-keyword.sh"); writeFileSync(fake, FAKE); chmodSync(fake, 0o755);
  const wf = join(home, "kw.txt"); writeFileSync(wf, wordsList.join("\n") + "\n");
  const env = { ...process.env, HOME: home, WFR_HOME: join(home, ".config", "zenithjoy"), WFR_NODE: process.execPath, WFR_JQ: JQ,
    WFR_LEDGER_MJS: join(SRC, "ledger.mjs"), WFR: join(SRC, "workflow-result.sh"), WFR_SCP_TARGET: "", HARVEST_KEYWORD: fake, WALL_REPORT: "/nonexistent", BATCH_SLEEP: "0" };
  const kv = {};
  for (const args of [["init", "t9", "p1", wf, "0", "S", "h"], ["enter"]]) {
    const r = spawnSync("bash", [join(SRC, "workflow-result.sh"), ...args], { encoding: "utf8", env: { ...env, ...kv } });
    for (const l of r.stdout.split("\n")) { const m = l.match(/^(WFR_[A-Z_]+)=(.*)$/); if (m) kv[m[1]] = m[2]; }
  }
  return { home, wf, env: { ...env, ...kv }, kv };
}
function run(ctx, wf) { return spawnSync(ZSH, [join(SRC, "batch2-v4.sh"), "p1", wf, "t9", "0", ""], { encoding: "utf8", env: ctx.env }); }
function book(ctx) { return JSON.parse(readFileSync(join(ctx.kv.WFR_RUN_DIR, "ledger.json"), "utf8")); }
function arts(ctx) { return readdirSync(ctx.kv.WFR_ART_DIR).filter((f) => f.includes("__a1.")).sort(); }

test("四种出口码 → 阶段状态映射；工件 n=词序", { skip: SKIP }, () => {
  const ctx = setup(["ok", "nocard", "lock", "fail"]);
  const r = run(ctx, ctx.wf);
  assert.equal(r.status, 0, r.stderr);
  const b = book(ctx);
  const d = Object.fromEntries(b.stages.discovery.items.map((x) => [x.word, x.status]));
  assert.deepEqual(d, { ok: "completed", nocard: "blocked", lock: "blocked", fail: "failed" });
  assert.equal(b.stages.collection.items.find((x) => x.word === "ok").status, "completed");
  const a = arts(ctx);
  assert.ok(a.includes("social-keyword-leadgen-crontab-t9__a1.discovery.1.worker-result.json"));
  assert.ok(a.includes("social-keyword-leadgen-crontab-t9__a1.collection.1.worker-result.json"));
  assert.ok(a.includes("social-keyword-leadgen-crontab-t9__a1.discovery.4.worker-result.json"));
  const c1 = JSON.parse(readFileSync(join(ctx.kv.WFR_ART_DIR, "social-keyword-leadgen-crontab-t9__a1.collection.1.worker-result.json"), "utf8"));
  assert.equal(c1.metrics.comments_collected, 2); assert.equal(c1.metrics.videos_processed, 1);
});

test("hash 不一致 → 写 blocked hash_mismatch、打印 BATCH2_ESCALATE、停跑", { skip: SKIP }, () => {
  const ctx = setup(["ok", "ok"]);
  writeFileSync(ctx.wf, "ok\ntampered\n");           // init 之后改词单
  const r = run(ctx, ctx.wf);
  assert.match(r.stdout, /BATCH2_ESCALATE=hash_mismatch/);
  const b = book(ctx);
  assert.equal(b.stages.discovery.status, "blocked");
  assert.equal(b.stages.discovery.items.length, 1);     // 只写了一条 blocked，没继续跑词
});

test("skip_words 里的词不跑", { skip: SKIP }, () => {
  const ctx = setup(["ok", "nocard"]);
  ctx.env.WFR_SKIP_WORDS = "ok";
  const r = run(ctx, ctx.wf);
  assert.equal(r.status, 0, r.stderr);
  const b = book(ctx);
  assert.deepEqual(b.stages.discovery.items.map((x) => x.word), ["nocard"]);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test services/phone-adb-controller/__tests__/pipeline-v4-integration.test.mjs`
Expected: 3 个 FAIL（`batch2-v4.sh` 不存在）。本机无 zsh/jq 则 skip——不得在 skip 状态下宣称通过。

- [ ] **Step 3: 提交失败测试**

```bash
git add services/phone-adb-controller/__tests__/pipeline-v4-integration.test.mjs
git commit -m "test(leadgen-batch2-v4): 假 harvest-keyword 驱动的出口码映射/hash fail-closed/skip_words 失败集成测试

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: 实现 batch2-v4.sh（原 batch2.sh 副本 + 钩子；原有行保持不动）**

```bash
#!/bin/zsh
# batch2-v4.sh PROFILE 词单 TAG PUSH SERIAL —— batch2.sh 的基座1/7副本：每词写 discovery/collection 工件，
# push 后写 delivery，hash 不一致即停(fail-closed)。原 batch2.sh 保持不动，影子跑 2 晚通过后再切 crontab。
# 依赖已 eval 过的 WFR_RUN_ID WFR_HASH WFR_RUN_DIR WFR_ART_DIR WFR_ATTEMPT WFR_SKIP_WORDS（harvest-cron-v4 负责）。
set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
P="$1"; WF="$2"; TAG="$3"; PUSH="${4:-0}"; SERIAL="${5:-}"
WR=${WALL_REPORT:-$HOME/bin-harvest/wall-report.sh}
wr(){ [[ -n "$SERIAL" && -x "$WR" ]] && "$WR" "$@" >/dev/null 2>&1; true }
HK=${HARVEST_KEYWORD:-$HOME/bin-harvest/harvest-keyword.sh}
WFR=${WFR:-$HOME/bin-harvest/workflow-result.sh}
SLEEP_BASE=${BATCH_SLEEP:-20}
OUT=~/night-$TAG.tsv; LOG=~/night-$TAG.log
: > $OUT
print "[$(date +%H:%M:%S)] v4批开始 profile=$P $(wc -l < $WF)词 push=$PUSH attempt=${WFR_ATTEMPT:-?}" >> $LOG
# hash 一致性：词单在 init 之后被改 = 请求身份变了，fail-closed（PrepPRD 拍板）
NOWHASH=$(bash "$WFR" hash "$P" "$WF" "$PUSH" 2>/dev/null | sed -n 's/^WFR_HASH=//p'); NOWHASH=${NOWHASH:-}
if [[ -n "${WFR_HASH:-}" && "$NOWHASH" != "$WFR_HASH" ]]; then
  print "[$(date +%H:%M:%S)] hash 不一致 init=$WFR_HASH now=$NOWHASH，停跑" >> $LOG
  bash "$WFR" stage discovery blocked 1 "hash_mismatch init=$WFR_HASH now=$NOWHASH" '[{"type":"log","ref":"'"$LOG"'"}]' '{"candidates":0,"keywords_processed":0,"screens_scanned":0}' "" >/dev/null 2>>$LOG
  print "BATCH2_ESCALATE=hash_mismatch"
  exit 0
fi
count(){ local c; c=$(grep -c "^$1" $OUT 2>/dev/null || true); print -- "${c:-0}"; }
n=0
for W in "${(f)$(cat $WF)}"; do
  [[ -z "$W" ]] && continue
  n=$((n+1))
  # 续跑：skip_words 里的词已在上一 attempt 完成
  if [[ -n "${WFR_SKIP_WORDS:-}" && "|${WFR_SKIP_WORDS}|" == *"|${W}|"* ]]; then
    print "[$(date +%H:%M:%S)] 词$n: $W 已完成(续跑跳过)" >> $LOG; continue
  fi
  if [[ -n "$SERIAL" ]]; then
    adb -s $SERIAL shell am force-stop com.ss.android.ugc.aweme 2>/dev/null
    /bin/sleep 2
    adb -s $SERIAL shell am start -n com.ss.android.ugc.aweme/com.ss.android.ugc.aweme.main.MainActivity >/dev/null 2>&1
    /bin/sleep 4
  fi
  ENC=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$W")
  print "[$(date +%H:%M:%S)] 词$n: $W" >> $LOG
  wr step "$SERIAL" 3 doing "词$n: $W"
  V0=$(count VIDEO); L0=$(count LEAD)
  rc=0; "$HK" "$P" "$ENC" 4 "$TAG-w$n" unlimited >> $OUT 2>> $LOG || rc=$?
  V1=$(count VIDEO); L1=$(count LEAD); DV=$((V1-V0)); DL=$((L1-L0))
  EV='[{"type":"log","ref":"'"$LOG"'","word":"'"$W"'","rc":'"$rc"'}]'
  case "$rc" in
    0) if (( DV > 0 )); then
         bash "$WFR" stage discovery completed "$n" "word=$W videos=$DV" "$EV" '{"candidates":'"$DV"',"keywords_processed":1,"screens_scanned":0}' "$W" >/dev/null 2>>$LOG
         bash "$WFR" stage collection completed "$n" "word=$W leads=$DL" "$EV" '{"comments_collected":'"$DL"',"videos_processed":'"$DV"',"cursor_updates":0}' "$W" >/dev/null 2>>$LOG
       else
         bash "$WFR" stage discovery blocked "$n" "word=$W no_cards" "$EV" '{"candidates":0,"keywords_processed":1,"screens_scanned":0}' "$W" >/dev/null 2>>$LOG
       fi;;
    3) bash "$WFR" stage discovery blocked "$n" "word=$W lock_busy" "$EV" '{"candidates":0,"keywords_processed":1,"screens_scanned":0}' "$W" >/dev/null 2>>$LOG;;
    *) bash "$WFR" stage discovery failed "$n" "word=$W rc=$rc" "$EV" '{"candidates":0,"keywords_processed":1,"screens_scanned":0}' "$W" >/dev/null 2>>$LOG;;
  esac
  print "[$(date +%H:%M:%S)] 词$n 完成 rc=$rc LEAD=$L1" >> $LOG
  wr note "$SERIAL" "词$n 完成 LEAD=$L1"
  (( SLEEP_BASE > 0 )) && /bin/sleep $(( SLEEP_BASE + RANDOM % 40 ))
done
NL=$(count LEAD); NV=$(count VIDEO)
print "[$(date +%H:%M:%S)] v4批完成 LEAD=$NL VIDEO=$NV" >> $LOG
if [[ "$PUSH" == "1" && -s $OUT ]]; then
  scp -o ConnectTimeout=20 $OUT mmv:/tmp/$TAG.tsv >> $LOG 2>&1
  ssh -o ConnectTimeout=20 mmv "node /Users/administrator/.openclaw/leadgen-scripts/push-videos.js /tmp/$TAG.tsv $TAG $P && node /Users/administrator/.openclaw/leadgen-scripts/push-leads.js /tmp/$TAG.tsv $P" >> $LOG 2>&1
  prc=$?
  if (( prc == 0 )); then
    bash "$WFR" stage delivery completed 1 "pushed $NL leads" '[{"type":"log","ref":"'"$LOG"'"}]' '{"leads_written":'"$NL"',"duplicates_skipped":0,"readback_verified":0,"cursor_updates":0}' >/dev/null 2>>$LOG
  else
    bash "$WFR" stage delivery failed 1 "push rc=$prc" '[{"type":"log","ref":"'"$LOG"'"}]' '{"leads_written":0,"duplicates_skipped":0,"readback_verified":0,"cursor_updates":0}' >/dev/null 2>>$LOG
  fi
  print "[$(date +%H:%M:%S)] 已落池(视频+评论) rc=$prc" >> $LOG
else
  bash "$WFR" stage delivery blocked 1 "push=$PUSH skipped" '[]' '{"leads_written":0,"duplicates_skipped":0,"readback_verified":0,"cursor_updates":0}' >/dev/null 2>>$LOG
fi
```

> 注意：push 段的 `ssh mmv "node …push-videos.js … && node …push-leads.js …"` 必须与原 batch2.sh L41 的命令**逐字一致**（实现时 `sed -n 41p services/phone-adb-controller/batch2.sh` 核对后照抄，原行在计划里被截断了）。

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test services/phone-adb-controller/__tests__/pipeline-v4-integration.test.mjs`
Expected: `# pass 3`

- [ ] **Step 6: 守卫弄坏一次（hash 守卫）**

临时把 batch2-v4.sh 里 `"$NOWHASH" != "$WFR_HASH"` 改成 `!= "never"`，跑测试 → 第 2 条应 **FAIL**；改回去 → PASS。不提交改坏版。

- [ ] **Step 7: 提交实现**

```bash
git add services/phone-adb-controller/batch2-v4.sh
git commit -m "feat(leadgen-batch2-v4): 每词出口码→discovery/collection 工件，hash 不一致 fail-closed 停跑，delivery 工件

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: harvest-cron-v4.sh（孤儿清扫、30s 真活复核、init/enter/finalize 钩子）

**Files:**
- Create: `services/phone-adb-controller/harvest-cron-v4.sh`
- Test: 复用 Task 3 集成测试目录，新增一条对 v4 脚本"续跑过滤函数"的单测（见 Step 1）

**Interfaces:**
- Consumes：Task 2 `workflow-result.sh`（init/enter/finalize），Task 3 `batch2-v4.sh`。
- Produces：与原 harvest-cron.sh 相同的 `~/harvest-cron.log` 行，另加 `escort复核命中|escort复核未命中` / `孤儿escort清理:` / `账本finalize:` 行；调用 `batch2-v4.sh` 时传过滤后的词单 `/tmp/kw-$TAG.run.txt`。
- 环境变量：`BATCH2`（默认 `~/bin-harvest/batch2-v4.sh`）、`WFR`（默认 `~/bin-harvest/workflow-result.sh`）。
- 续跑过滤放在可独立测试的函数 `filter_words <in> <out> "<skip|list>"`（`HARVEST_CRON_V4_LIB=1` 时只定义函数不执行主流程）。

- [ ] **Step 1: 写失败测试（追加到 pipeline-v4-integration.test.mjs 末尾）**

```js
test("harvest-cron-v4: filter_words 按 skip_words 过滤词单，保序", { skip: SKIP }, () => {
  const d = mkdtempSync(join(tmpdir(), "hcv4-"));
  const inF = join(d, "in.txt"), outF = join(d, "out.txt");
  writeFileSync(inF, "A\nB\nC\n");
  const r = spawnSync(ZSH, ["-c", `HARVEST_CRON_V4_LIB=1 source ${join(SRC, "harvest-cron-v4.sh")}; filter_words ${inF} ${outF} "A|C"`], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(outF, "utf8"), "B\n");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test services/phone-adb-controller/__tests__/pipeline-v4-integration.test.mjs`
Expected: 新增那条 FAIL（文件不存在）。

- [ ] **Step 3: 提交失败测试**

```bash
git add services/phone-adb-controller/__tests__/pipeline-v4-integration.test.mjs
git commit -m "test(leadgen-cron-v4): 续跑过滤 filter_words 失败测试

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: 实现 harvest-cron-v4.sh**

做法：`cp services/phone-adb-controller/harvest-cron.sh services/phone-adb-controller/harvest-cron-v4.sh`，然后做以下 6 处改动（其余行**逐字保留**）：

(a) 文件头第 2 行注释后插入库模式与过滤函数：
```zsh
# v4(基座1/7): +账本/阶段工件/续跑/escort真活复核/孤儿清扫。原 harvest-cron.sh 不动，影子跑 2 晚后切 crontab。
filter_words(){ # in out "skip|list" —— 续跑：去掉上一 attempt 已完成的词，保序
  local in="$1" out="$2" skip="${3:-}"
  : > "$out"
  while IFS= read -r w; do
    [[ -z "$w" ]] && continue
    [[ -n "$skip" && "|$skip|" == *"|$w|"* ]] && continue
    print -- "$w" >> "$out"
  done < "$in"
}
[[ "${HARVEST_CRON_V4_LIB:-0}" == "1" ]] && return 0
WFR=${WFR:-$HOME/bin-harvest/workflow-result.sh}
BATCH2=${BATCH2:-$HOME/bin-harvest/batch2-v4.sh}
```
（注意：`set -uo pipefail` 与 `P=…` 那两行仍在这段之后，保持原顺序；`return 0` 在 source 时生效，直接执行时该行之前无 `set -e`，不会误退出。）

(b) 原 L43 `ESCORT_ID=""` 之前插入孤儿清扫：
```zsh
# 孤儿 escort 清扫：上批 kill -9 时 trap 不触发，会留下 escort cron 烧额度（Agent C 错误路径）
ORPH=$(ssh -o ConnectTimeout=20 mmv "openclaw cron list" 2>>$LOG | grep -F "escort-$HOSTKEY-" | grep -v -F "escort-$HOSTKEY-$TAG" || true)
if [[ -n "$ORPH" ]]; then
  print -r -- "$ORPH" | while read -r oid _; do
    [[ -n "$oid" ]] && ssh -o ConnectTimeout=20 mmv "openclaw cron rm $oid" >>$LOG 2>&1 && log "孤儿escort清理: $oid"
  done
fi
```

(c) 原 L51 `log "escort已拉起: $ESCORT_ID"` 之后插入真活复核（判定点 4f85a74d）：
```zsh
  /bin/sleep 30
  ALIVE=$(ssh -o ConnectTimeout=20 mmv "openclaw cron list" 2>>$LOG | grep -F "escort-$HOSTKEY-$TAG" || true)
  if [[ -n "$ALIVE" ]]; then log "escort复核命中"
  else log "escort复核未命中"; escalate "escort 拉起返回 id=$ESCORT_ID 但 30s 后 cron list 未命中 escort-$HOSTKEY-$TAG，本批可能无人陪跑"; fi
```

(d) 原 L52-53 的 `escort_dismiss` + `trap` 改为同时 finalize（且**无论 escort 是否拉起都要挂 finalize trap**）——把原 `if [[ -n "$ESCORT_ID" ]]; then … else … fi` 块之后追加：
```zsh
run_finalize(){
  eval "$(bash "$WFR" finalize 2>>$LOG)" 2>/dev/null || true
  log "账本finalize: ok=${WFR_FINALIZE_OK:-?} ${WFR_FINALIZE_MSG:-}"
  [[ "${WFR_FINALIZE_OK:-0}" == "1" ]] || escalate "账本收工自检未通过: ${WFR_FINALIZE_MSG:-unknown}"
}
if [[ -n "$ESCORT_ID" ]]; then trap 'escort_dismiss; run_finalize' EXIT INT TERM; else trap run_finalize EXIT INT TERM; fi
```
（原 L53 那行 `trap escort_dismiss EXIT INT TERM` 删除，由上面统一挂。）

(e) 原 L136 `wr step "$SERIAL" 2 done; wr step "$SERIAL" 3 doing "${NWORDS}词"` 之后插入 init（不递增 attempt）：
```zsh
eval "$(bash "$WFR" init "$TAG" "$P" "$WF" "$PUSH" "$SERIAL" "$HOSTKEY" 2>>$LOG)" 2>/dev/null || true
log "账本init: run=${WFR_RUN_ID:-?} hash=${WFR_HASH:-?}"
```

(f) 原 L139 `/bin/zsh ~/bin-harvest/batch2.sh "$P" "$WF" "$TAG" "$PUSH" "$SERIAL"` 替换为 enter + 过滤 + v4：
```zsh
eval "$(bash "$WFR" enter 2>>$LOG)" 2>/dev/null || true
log "账本enter: attempt=${WFR_ATTEMPT:-?} skip=${WFR_SKIP_WORDS:-}"
WF2=/tmp/kw-$TAG.run.txt
filter_words "$WF" "$WF2" "${WFR_SKIP_WORDS:-}"
export WFR_RUN_ID WFR_HASH WFR_RUN_DIR WFR_ART_DIR WFR_ATTEMPT WFR_SKIP_WORDS
B2OUT=$(/bin/zsh "$BATCH2" "$P" "$WF2" "$TAG" "$PUSH" "$SERIAL" 2>&1 | tee -a $LOG || true)
if print -r -- "$B2OUT" | grep -q 'BATCH2_ESCALATE=hash_mismatch'; then escalate "词单在 init 后被改动(hash 不一致)，本批已停(fail-closed)"; fi
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test services/phone-adb-controller/__tests__/*.test.mjs`
Expected: 全部 pass（ledger 4 + wfr 6 + integration 4 + 既有测试）。

- [ ] **Step 6: 语法与 pipefail 假绿检查**

Run: `zsh -n services/phone-adb-controller/harvest-cron-v4.sh && zsh -n services/phone-adb-controller/batch2-v4.sh && bash -n services/phone-adb-controller/workflow-result.sh && echo SYNTAX_OK`
Expected: `SYNTAX_OK`
Run: `grep -nE 'grep -c[^|]*\| *(head|tail)' services/phone-adb-controller/{harvest-cron-v4,batch2-v4}.sh services/phone-adb-controller/workflow-result.sh || echo NO_PIPEFAIL_TRAP`
Expected: `NO_PIPEFAIL_TRAP`

- [ ] **Step 7: 提交实现**

```bash
git add services/phone-adb-controller/harvest-cron-v4.sh
git commit -m "feat(leadgen-cron-v4): 孤儿 escort 清扫、30s 真活复核、账本 init/enter/finalize 钩子、续跑过滤

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: README 部署段 + 影子跑与环境守卫手工步骤 + handoff 要点

**Files:**
- Modify: `services/phone-adb-controller/README.md`（在「部署三步」之后追加一节）

**Interfaces:** 无代码接口；产出给影子跑执行者与 handoff 的文字。

- [ ] **Step 1: 追加 README 段**

```markdown
## 基座 1/7：v4 流水线（账本 + 阶段工件 + 续跑）部署与影子跑

新增件 → 落点（xian-m4 / M1 各一遍）：
1. `scp ledger.mjs workflow-result.sh harvest-cron-v4.sh batch2-v4.sh` → `~/bin-harvest/`（`chmod +x` 三个 .sh）
2. 账本/工件目录自动建在 `~/.config/zenithjoy/{ledger,workflow-runs}/`；工件收工 best-effort scp 到 MMV `workflow-runs/`
3. 依赖：`/opt/homebrew/bin/node`、`/usr/bin/jq`、`python3`（均已在 M4）

影子跑（切 crontab 前必须 2 晚，PrepPRD 拍板）：
- crontab 加一行（与生产错开 15 分钟、`PUSH=0` 不落池）：`15 22 * * * /bin/zsh ~/bin-harvest/harvest-cron-v4.sh jinoshengyuan-work ANGYVB4227006983 AI人工智能训练师 6 0`
- 每晚验收：`~/.config/zenithjoy/ledger/social-keyword-leadgen-crontab-auto*/ledger.json` 里 preflight/discovery/collection/delivery/cleanup 为 completed（delivery 在 PUSH=0 时为 blocked，正常）、qualification/scoring 为 blocked not_in_profile；工件每个含 `task_request_hash` 且 `jq -e '.schema_version==2'`；`harvest-cron.log` 有 `escort复核命中` 与 `账本finalize: ok=1`；MMV `~/.openclaw/escort-findings.md` 当晚有新行；`night-auto*.tsv` LEAD ≥ 近 7 天均值
- 2 晚齐 → 把生产两行 `harvest-cron.sh` 指向 `harvest-cron-v4.sh`

环境守卫的 proven-to-fire（影子跑期间各做一次，记录到 PR）：
- escort 真活：拉起后手动 `ssh mmv openclaw cron rm <id>` → 30s 后 `harvest-cron.log` 出现 `escort复核未命中` 且 escalation.log 新增一行
- 工件落地：起跑前 `chmod 000 ~/.config/zenithjoy/workflow-runs` → 收工 `账本finalize: ok=0` 且 escalation 新增；恢复 `chmod 755`
- 孤儿 escort：手动 `ssh mmv openclaw cron add --name escort-xian-m4-fake …` 留一条 → 下批起跑日志出现 `孤儿escort清理: <id>`

harvest-keyword.sh 出口码契约（v4 依赖，勿改）：`3` 锁被占 / `1` open-search 失败 / `0` 正常或无卡片。

后续（不在本 PR）：`workflow-manifest.json` `orchestrator.type` n8n→commander、n8n「Social Leadgen V4」标 inactive（hk-vps，先复核发布版≠草稿）、scoring 闭集键口径修正归基座 7/7、`decisions/match` 疑似写库副作用、escalate 目标主机 us-vps 已退役需评估改 MMV。
```

- [ ] **Step 2: 提交**

```bash
git add services/phone-adb-controller/README.md
git commit -m "docs(leadgen-v4): 部署落点、影子跑 2 晚验收、环境守卫 proven-to-fire 步骤、后续事项

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 3: 全量测试 + 收尾**

Run: `node --test services/phone-adb-controller/__tests__/*.test.mjs`
Expected: 全部 pass。然后走 finishing（Option 2 push+PR），PR 标题 `feat(leadgen): 基座1/7 crontab 获客流水线补账本+阶段工件+续跑(v4 副本，未切生产)`，body 含 `GP-Anchor: line02/keyword_acquisition keep-green`、task `b4b09cdd`、6 守卫状态（3 逻辑守卫 CI 已弄坏验证；3 环境守卫待影子跑）。

---

## Self-Review

- **Spec 覆盖**：账本(T1) / 工件+hash+校验(T2) / 出口码映射+hash fail-closed+delivery(T3) / 孤儿清扫+30s 复核+init/enter/finalize+续跑(T4) / 部署+影子跑+环境守卫+后续事项(T5)。qualification/scoring not_in_profile 在 T2 init。scoring 键集旧口径只填 0，T5 记归 7/7。
- **占位扫描**：无 TBD；T3 push 段一行在计划里截断，已明示实现时 `sed -n 41p` 照抄原行。
- **类型/名称一致**：`WFR_RUN_ID/WFR_HASH/WFR_RUN_DIR/WFR_ART_DIR/WFR_ATTEMPT/WFR_SKIP_WORDS` 六个导出名在 T2 定义、T3/T4 消费一致；`filter_words` 签名 T4 定义与测试一致；`BATCH2_ESCALATE=hash_mismatch` T3 打印、T4 grep 一致；账本 `set --n --word` T1 定义、T2 `write_stage` 调用一致。

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
  assert.equal(b.stages.discovery.items[0].n, 0);       // 哨兵 n=0，不与词序号冲突
});

test("hash 不一致不覆盖上一 attempt 已完成词的 items 记录", { skip: SKIP }, () => {
  const ctx = setup(["ok", "nocard"]);
  // 预置：上一 attempt 已把词 "ok" 的 discovery/collection 记为 completed（n=1）
  for (const stage of ["discovery", "collection"]) {
    spawnSync(process.execPath, [join(SRC, "ledger.mjs"), "set", "--stage", stage, "--status", "completed", "--n", "1", "--word", "ok", "--run-dir", ctx.kv.WFR_RUN_DIR], { encoding: "utf8" });
  }
  writeFileSync(ctx.wf, "ok\ntampered\n");           // init 之后改词单，触发 hash 不一致
  const r = run(ctx, ctx.wf);
  assert.match(r.stdout, /BATCH2_ESCALATE=hash_mismatch/);
  const b = book(ctx);
  assert.equal(b.stages.discovery.items.find((x) => x.word === "ok").status, "completed"); // 未被覆盖
  assert.ok(b.stages.discovery.items.some((x) => x.n === 0 && x.status === "blocked"));
  const na = spawnSync(process.execPath, [join(SRC, "ledger.mjs"), "next-attempt", "--run-dir", ctx.kv.WFR_RUN_DIR], { encoding: "utf8" });
  const out = JSON.parse(na.stdout);
  assert.ok(out.skip_words.includes("ok"));
});

test("skip_words 里的词不跑", { skip: SKIP }, () => {
  const ctx = setup(["ok", "nocard"]);
  ctx.env.WFR_SKIP_WORDS = "ok";
  const r = run(ctx, ctx.wf);
  assert.equal(r.status, 0, r.stderr);
  const b = book(ctx);
  assert.deepEqual(b.stages.discovery.items.map((x) => x.word), ["nocard"]);
});

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

#!/usr/bin/env node
// step-judge.mjs —— 步骤 DoD 统一裁判（任务 9032cdad，决策 2a60378a：步骤 DoD 读回型、由外部统一裁判执行，agent 保持纯 skill）。
//
// 契约 product-map/contracts/keyword_acquisition.yaml 每步的 dod 由 scripts/product-map/gen-step-dod.mjs 生成 step-dod.json，
// deploy.sh 下发到执行机（~/bin-harvest/）与 mmv。workflow-result.sh 每写出一个活动工件就调本裁判一次，判 at==该活动 的步骤：
//   本机读回：metric（工件 metrics）/ evidence（douyin-phone-adb 证据目录里本词前缀的文件，可带内容正则）/
//            log（本词或本 tick 的日志段）/ tsv（采收产物行）/ ledger（账本 stage 状态与记账条数）
//   远端读回：sql / http 由 mmv 上 verify-step.mjs --steps 跑完随探针结果带回（--remote），这里只合并
//   none：契约写明读不回的原因，只记 skipped
// 结果写进工件 step_dod 与账本 step-dod.jsonl（workflow-result.sh 负责落盘）。mode=checkpoint 只记录；
// mode=hard 且不过 → hard_failed，workflow-result.sh 把该活动判 fail_stage。读不回（error）→ pass=null，不算通过也不算失败。
// 零依赖（执行机 CI 同样不装包），永远 exit 0，stdout 恰好一行 JSON {steps, hard_failed}。
import { readFileSync, readdirSync, existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const reEscape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function renderTemplate(str, vars = {}, { regex = false } = {}) {
  return String(str).replace(/\{(tag|n|word)\}/g, (_, k) => (regex ? reEscape(vars[k] ?? "") : String(vars[k] ?? "")));
}

// 同 verify-step 的 expect 口径：observed 与 value / metrics[ref] 比较；判不了（ref 缺、observed 非数值）→ null
export function evaluateExpect(expect, observed, metrics = {}) {
  if (!expect) return null;
  if (expect.op === "not_null_all") {
    const arr = Array.isArray(observed) ? observed : [observed];
    return arr.every((v) => v !== null && v !== undefined && String(v) !== "");
  }
  let want = expect.value;
  if (expect.ref !== undefined) {
    want = metrics?.[String(expect.ref).replace(/^metrics\./, "")];
    if (want === undefined) return null;
  }
  const a = Number(observed), b = Number(want);
  if (observed === null || observed === "" || Array.isArray(observed) || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (expect.op === ">=") return a >= b;
  if (expect.op === "<=") return a <= b;
  if (expect.op === "==") return a === b;
  return null;
}

const globRe = (g) => new RegExp(`^${g.split("*").map(reEscape).join(".*")}$`);

function readLocal(rb, ctx) {
  const vars = { tag: ctx.tag, n: ctx.n, word: ctx.word };
  switch (rb.type) {
    case "metric": {
      const k = rb.ref.replace(/^metrics\./, "");
      if (ctx.metrics?.[k] === undefined) throw new Error(`工件 metrics 缺 ${k}`);
      return ctx.metrics[k];
    }
    case "evidence": {
      if (!ctx.evidenceDir || !existsSync(ctx.evidenceDir)) throw new Error(`证据目录不存在: ${ctx.evidenceDir || "(未给)"}`);
      const re = globRe(renderTemplate(rb.glob, vars));
      const files = readdirSync(ctx.evidenceDir).filter((f) => re.test(f));
      if (!rb.match) return files.length;
      const m = new RegExp(renderTemplate(rb.match, vars, { regex: true }));
      return files.filter((f) => { try { return m.test(readFileSync(join(ctx.evidenceDir, f), "utf8")); } catch { return false; } }).length;
    }
    case "log": {
      if (!ctx.logFile || !existsSync(ctx.logFile)) throw new Error(`日志不存在: ${ctx.logFile || "(未给)"}`);
      const re = new RegExp(renderTemplate(rb.regex, vars, { regex: true }));
      return readFileSync(ctx.logFile, "utf8").split("\n").slice(Number(ctx.logFrom) || 0).filter((l) => re.test(l)).length;
    }
    case "tsv": {
      if (!ctx.tsvFile || !existsSync(ctx.tsvFile)) throw new Error(`采收产物不存在: ${ctx.tsvFile || "(未给)"}`);
      const re = new RegExp(renderTemplate(rb.regex, vars, { regex: true }));
      return readFileSync(ctx.tsvFile, "utf8").split("\n").filter((l) => re.test(l)).length;
    }
    case "ledger": {
      const p = join(ctx.runDir || "", "ledger.json");
      if (!ctx.runDir || !existsSync(p)) throw new Error(`账本不存在: ${p}`);
      const book = JSON.parse(readFileSync(p, "utf8"));
      if (rb.field === "items_total") return Object.values(book.stages || {}).reduce((n, s) => n + ((s && s.items) || []).length, 0);
      return (book.stages?.[rb.stage]?.status === rb.equals) ? 1 : 0;
    }
    default: throw new Error(`本机不判 ${rb.type}`);
  }
}

export function judgeSteps({ spec, stage, ctx = {}, remote = [] }) {
  const remoteBy = new Map((remote || []).map((r) => [r.key, r]));
  const steps = [];
  for (const s of (spec?.steps || []).filter((x) => (x.at || x.activity) === stage)) {
    const rb = s.readback || {};
    const base = { key: s.key, activity: s.activity, at: s.at || s.activity, mode: s.mode, type: rb.type };
    if (rb.type === "none") { steps.push({ ...base, pass: null, skipped: true, reason: s.reason || "" }); continue; }
    if (rb.type === "sql" || rb.type === "http") {
      const r = remoteBy.get(s.key);
      if (!r) steps.push({ ...base, pass: null, error: "远端读回未返回(mmv 不通或 verify-step 版本旧)" });
      else steps.push({ ...base, observed: r.observed, pass: r.error ? null : (r.pass ?? evaluateExpect(rb.expect, r.observed, ctx.metrics)), ...(r.error ? { error: r.error } : {}) });
      continue;
    }
    try {
      const observed = readLocal(rb, ctx);
      steps.push({ ...base, observed, pass: evaluateExpect(rb.expect, observed, ctx.metrics) });
    } catch (e) {
      steps.push({ ...base, pass: null, error: String((e && e.message) || e).slice(0, 200) });
    }
  }
  return { steps, hard_failed: steps.filter((x) => x.mode === "hard" && x.pass === false).map((x) => x.key) };
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) a[argv[i].slice(2)] = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[++i] : "";
  return a;
}

function main() {
  let out = { steps: [], hard_failed: [] };
  try {
    const a = parseArgs(process.argv.slice(2));
    const spec = JSON.parse(readFileSync(a.spec, "utf8"));
    let metrics = {};
    if (a["metrics-file"]) { const art = JSON.parse(readFileSync(a["metrics-file"], "utf8")); metrics = art.metrics ?? {}; }
    let remote = [];
    try { remote = a.remote ? JSON.parse(a.remote) : []; } catch { remote = []; }
    out = judgeSteps({
      spec, stage: a.stage || "", remote,
      ctx: { metrics, tag: a.tag || "", n: a.n || "", word: a.word || "", evidenceDir: a["evidence-dir"] || "",
        logFile: a.log || "", logFrom: a["log-from"] || 0, tsvFile: a.tsv || "", runDir: a["run-dir"] || "" },
    });
  } catch (e) {
    process.stderr.write(`step-judge: ${String((e && e.message) || e)}\n`);
  }
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

// 走软链(/tmp→/private/tmp、部署目录软链)时 argv[1] 与模块 URL 不同形,按真实路径比
const isMain = () => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } };
if (process.argv[1] && isMain()) main();

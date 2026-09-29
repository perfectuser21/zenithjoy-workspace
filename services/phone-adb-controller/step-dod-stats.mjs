#!/usr/bin/env node
// step-dod-stats.mjs —— 步骤 DoD 统计视图 + 升级清单（任务 9032cdad，决策 2a60378a：新步骤先 checkpoint，跑稳证明不误报再升 hard）。
//
// 数据源 = 各 run 收工 scp 到 mmv 的工件（workflow-result.sh finalize/outreach-run → WFR_SCP_TARGET），每个活动工件的 step_dod
// 是统一裁判（step-judge.mjs）当时的判定。按步骤 key 汇总：判过几次、通过/不过/读不回各几次、按时间从最近往回数的连续通过次数。
// 升级规则：mode=checkpoint 且连续通过 ≥ N（契约 dod_promotion.min_consecutive_pass，step-dod.json 的 promotion 同步）→ 列为可升 hard。
// 任何一次不过或读不回都把连续数清零（不过可能是真缺陷也可能是误报，两种都说明这条判定还没证明"稳且不误报"）。
// 升级本身 = 改契约该步 dod.mode: hard + 重跑 gen-step-dod.mjs 发 PR（契约真身在 git，决策 0834e2fb），本脚本只出清单。
// 用法: node step-dod-stats.mjs [--dir <工件目录>] [--spec step-dod.json] [--min N] [--json]
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = "/Users/administrator/openclaw-root/workspaces-root/clawd-work-commander/state/workflow-runs";

export function computeStats(records, minPass) {
  const by = new Map();
  for (const r of [...records].sort((a, b) => String(a.observed_at).localeCompare(String(b.observed_at)))) {
    if (!by.has(r.key)) by.set(r.key, []);
    by.get(r.key).push(r);
  }
  const out = [];
  for (const [key, rows] of by) {
    let streak = 0;
    for (let i = rows.length - 1; i >= 0 && rows[i].pass === true; i--) streak++;
    const mode = rows[rows.length - 1].mode;
    out.push({
      key, mode, evaluated: rows.length,
      pass: rows.filter((r) => r.pass === true).length,
      fail: rows.filter((r) => r.pass === false).length,
      unknown: rows.filter((r) => r.pass !== true && r.pass !== false).length,
      streak,
      last_observed_at: rows[rows.length - 1].observed_at,
      eligible: mode === "checkpoint" && streak >= minPass,
    });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

export function loadRecords(dir) {
  const recs = [];
  if (!existsSync(dir)) return recs;
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".worker-result.json"))) {
    let art;
    try { art = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { continue; }
    for (const s of art.step_dod || []) {
      if (s.skipped) continue;   // type=none 读不回的步骤不进统计
      recs.push({ key: s.key, mode: s.mode, pass: s.pass, observed_at: art.observed_at || "" });
    }
  }
  return recs;
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) a[argv[i].slice(2)] = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[++i] : "";
  return a;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  let min = Number(a.min);
  if (!(min > 0)) {
    try { min = JSON.parse(readFileSync(a.spec || join(HERE, "step-dod.json"), "utf8")).promotion.min_consecutive_pass; } catch { min = 20; }
  }
  const stats = computeStats(loadRecords(a.dir || DEFAULT_DIR), min);
  const eligible = stats.filter((s) => s.eligible).map((s) => s.key);
  if (a.json !== undefined) { process.stdout.write(`${JSON.stringify({ min_consecutive_pass: min, steps: stats, eligible })}\n`); return; }
  const lines = [`步骤 DoD 统计(连续通过 ≥${min} 次且仍是 checkpoint → 可升 hard)`, "步骤\t模式\t判定\t过\t不过\t读不回\t连续过\t最近"];
  for (const s of stats) lines.push([s.key, s.mode, s.evaluated, s.pass, s.fail, s.unknown, s.streak, s.last_observed_at].join("\t"));
  lines.push(`可升 hard: ${eligible.length ? eligible.join(", ") : "(无)"}`);
  process.stdout.write(`${lines.join("\n")}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

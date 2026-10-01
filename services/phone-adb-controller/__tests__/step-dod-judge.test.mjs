// 步骤 DoD 可执行化（任务 9032cdad，决策 2a60378a：步骤 DoD 读回型、外部统一裁判执行、agent 保持纯 skill；
// 新步骤先 checkpoint 只记录不拦，跑稳证明不误报再升 hard；与 skill-distill 同一套格式）。
//
// 契约 43 个步骤每步带结构化 dod {mode, readback{type,...,expect}}（none 必须写 reason）；
// 生成物 step-dod.json 随部署下发；统一裁判 = step-judge.mjs（执行机：metric/evidence/log/tsv/ledger）
// + verify-step.mjs --steps（mmv：sql/http），在每个活动工件写出时判该活动的步骤、写进工件 step_dod 与账本 step-dod.jsonl；
// checkpoint 失败只记录；hard 失败 → 该 stage 判 fail_stage；step-dod-stats.mjs 统计连续通过次数，达标列为可升 hard。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { judgeSteps, renderTemplate } from "../step-judge.mjs";
import { computeStats } from "../step-dod-stats.mjs";
import { runSteps } from "../verify-step.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");
const SPEC = JSON.parse(readFileSync(join(SRC, "step-dod.json"), "utf8"));
const JQ = spawnSync("bash", ["-lc", "command -v jq"], { encoding: "utf8" }).stdout.trim();

test("step-dod.json：44 步全覆盖、全部 checkpoint 起步、none 必带 reason、升级门槛 N 已声明", () => {
  assert.equal(SPEC.steps.length, 44);
  assert.ok(SPEC.steps.every((s) => s.mode === "checkpoint"), "新步骤一律 checkpoint 起步(决策 2a60378a)");
  for (const s of SPEC.steps) {
    assert.match(s.key, /^keyword_acquisition\.[a-z_]+\.[a-z_]+$/, "key=能力.活动.步骤");
    if (s.readback.type === "none") assert.ok(s.reason && s.reason.length >= 10, `${s.key} 读不回须写原因`);
    else assert.ok(s.readback.expect, `${s.key} 缺 expect`);
  }
  assert.ok(Number.isInteger(SPEC.promotion.min_consecutive_pass) && SPEC.promotion.min_consecutive_pass >= 10);
});

// ── 0930 决策 f425e3fd：归位（每张卡片处理完 back-to-results）成为 collection 的独立步骤，读回 metrics.rescan_rate ──
// 兜底重搜触发率 = 归位一次没做对的比例（精益 %C&A 的补）。指标由 batch2.sh 从本词日志段算出（word_rescan_metrics），
// 这里把两批真实生产日志回放给裁判：cmd09300230 词1 41 张卡 41 次兜底 → 判红；auto09292304 词3 2 张卡 0 次 → 判绿。
const RETURN_STEP = "keyword_acquisition.collection.return_to_results";
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
function rescanMetricsOf(logFile, from = 0) {
  const r = spawnSync(ZSH, ["-c", `BATCH2_LIB=1 source "${join(SRC, "batch2.sh")}"; word_rescan_metrics "$1" "$2"`, "zsh", logFile, String(from)], { encoding: "utf8" });
  const [count, links, rate] = r.stdout.trim().split(/\s+/);
  return { stdout: r.stdout, stderr: r.stderr, rescan_count: Number(count), links_opened: Number(links), rescan_rate: Number(rate) };
}

test("return_to_results 步在 collection 下，metric 读回 rescan_rate <= 0.3，checkpoint 起步", () => {
  const s = SPEC.steps.find((x) => x.key === RETURN_STEP);
  assert.ok(s, `step-dod.json 缺 ${RETURN_STEP}`);
  assert.deepEqual([s.activity, s.at, s.mode], ["collection", "collection", "checkpoint"]);
  assert.deepEqual(s.readback, { type: "metric", ref: "metrics.rescan_rate", expect: { op: "<=", value: 0.3 } });
  const judge = (rate) => judgeSteps({ spec: SPEC, stage: "collection", ctx: { metrics: { rescan_rate: rate, videos_processed: 0, comments_collected: 0 } } }).steps.find((x) => x.key === RETURN_STEP);
  assert.equal(judge(1).pass, false, "全部走兜底 → 不过");
  assert.equal(judge(0.2).pass, true, "两成以内 → 过");
  assert.equal(judgeSteps({ spec: SPEC, stage: "collection", ctx: { metrics: { videos_processed: 0 } } }).steps.find((x) => x.key === RETURN_STEP).pass, null, "工件没这个键 → 读不回,不假绿");
});

test("batch2 word_rescan_metrics：从本词日志段数兜底重搜/打开作品数，算 rescan_rate；空段 0/0/0", { skip: !ZSH && "no zsh" }, () => {
  const red = rescanMetricsOf(join(HERE, "fixtures", "night-cmd09300230-w1.txt"));
  assert.deepEqual([red.rescan_count, red.links_opened, red.rescan_rate], [41, 41, 1], red.stderr);
  const green = rescanMetricsOf(join(HERE, "fixtures", "night-auto09292304-w3.txt"));
  assert.deepEqual([green.rescan_count, green.links_opened, green.rescan_rate], [0, 2, 0], green.stderr);
  // 偏移：跳过前 14 行只剩词尾 → 0/0/0（同 batch2 每词开头记 WFR_LOG_FROM，只数本词段）
  const partial = rescanMetricsOf(join(HERE, "fixtures", "night-auto09292304-w3.txt"), 14);
  assert.deepEqual([partial.rescan_count, partial.links_opened, partial.rescan_rate], [0, 0, 0]);
});

test("proven-to-fire：cmd09300230 词1（134/134 兜底那批）回放 → return_to_results 判红；auto09292304 词3 → 判绿", { skip: !ZSH && "no zsh" }, () => {
  const red = rescanMetricsOf(join(HERE, "fixtures", "night-cmd09300230-w1.txt"));
  const rr = judgeSteps({ spec: SPEC, stage: "collection", ctx: { metrics: { rescan_rate: red.rescan_rate, rescan_count: red.rescan_count, videos_processed: 4, comments_collected: 4 } } });
  const rs = rr.steps.find((x) => x.key === RETURN_STEP);
  assert.deepEqual([rs.observed, rs.pass], [1, false]);
  assert.deepEqual(rr.hard_failed, [], "checkpoint 起步只记录不拦");
  const green = rescanMetricsOf(join(HERE, "fixtures", "night-auto09292304-w3.txt"));
  const gs = judgeSteps({ spec: SPEC, stage: "collection", ctx: { metrics: { rescan_rate: green.rescan_rate, rescan_count: green.rescan_count, videos_processed: 0, comments_collected: 0 } } }).steps.find((x) => x.key === RETURN_STEP);
  assert.deepEqual([gs.observed, gs.pass], [0, true]);
});

test("renderTemplate：{tag}{n}{word} 替换；正则场景下 word 转义", () => {
  assert.equal(renderTemplate("{tag}-w{n}-vtab.xml", { tag: "auto1", n: 3, word: "a.b" }), "auto1-w3-vtab.xml");
  assert.equal(renderTemplate("x{word}y", { word: "a.b(c)" }, { regex: true }), "xa\\.b\\(c\\)y");
});

function ctxDir() {
  const d = mkdtempSync(join(tmpdir(), "sj-"));
  const ev = join(d, "ev"); mkdirSync(ev);
  writeFileSync(join(ev, "auto1-w2-v1-oc-panel.xml"), '<node text="4条评论" />');
  writeFileSync(join(ev, "auto1-w2-v2-oc-panel.xml"), '<node text="评论区" />');
  writeFileSync(join(ev, "auto1-w1-v1-oc-panel.xml"), '<node text="9条评论" />');
  const log = join(d, "night.log");
  writeFileSync(log, "[22:00] 词1: 旧\n  视频链接解析失败\n[22:10] 词2: 新\n  作品链接: https://v/1\n  判定合格\n");
  const tsv = join(d, "night.tsv");
  writeFileSync(tsv, "LEAD\tn\tid\tp\tb\td\tr\tt\t新\t\t\turl\nLEAD\tn\tid\tp\tb\td\tr\tt\t新\t\thttps://p\turl\nLEAD\tn\tid\tp\tb\td\tr\tt\t旧\t\t\turl\n");
  return { d, ev, log, tsv };
}
const step = (key, readback, mode = "checkpoint", at) => ({ key: `keyword_acquisition.${key}`, activity: key.split(".")[0], at: at || key.split(".")[0], mode, readback });

test("judgeSteps 本地五类读回：metric / evidence(按词前缀+内容) / log(本词日志段) / tsv(带词正则) / ledger", () => {
  const { ev, log, tsv, d } = ctxDir();
  const runDir = join(d, "run"); mkdirSync(runDir);
  writeFileSync(join(runDir, "ledger.json"), JSON.stringify({ stages: { preflight: { status: "completed", items: [{ n: 1 }] }, discovery: { status: "pending", items: [] } } }));
  const spec = { steps: [
    step("preflight.acquire_device_lock", { type: "metric", ref: "metrics.lock_acquired", expect: { op: "==", value: 1 } }),
    step("collection.open_comment_section", { type: "evidence", glob: "{tag}-w{n}-v*-oc-panel.xml", match: "[0-9]+条评论", expect: { op: ">=", ref: "metrics.videos_processed" } }, "checkpoint", "collection"),
    step("discovery.resolve_video_links", { type: "log", regex: "视频链接解析失败", expect: { op: "<=", value: 0 } }, "checkpoint", "collection"),
    step("collection.resolve_profile_link", { type: "tsv", regex: "^LEAD\\t([^\\t]*\\t){7}{word}\\t[^\\t]*\\t\\t", expect: { op: "<=", value: 0 } }, "checkpoint", "collection"),
    step("preflight.open_run_ledger", { type: "ledger", stage: "preflight", field: "status", equals: "completed", expect: { op: "==", value: 1 } }, "checkpoint", "collection"),
  ] };
  const logFrom = 2;   // 本词日志段从第 3 行起(词2)
  const r = judgeSteps({ spec, stage: "collection", ctx: { metrics: { lock_acquired: 1, videos_processed: 1 }, evidenceDir: ev, tag: "auto1", n: 2, word: "新", logFile: log, logFrom, tsvFile: tsv, runDir } });
  const by = Object.fromEntries(r.steps.map((s) => [s.key.split(".").slice(1).join("."), s]));
  assert.equal(by["preflight.acquire_device_lock"], undefined, "at=preflight 的步骤不在 collection 判");
  assert.deepEqual([by["collection.open_comment_section"].observed, by["collection.open_comment_section"].pass], [1, true], "只数本词、内容命中的证据");
  assert.deepEqual([by["discovery.resolve_video_links"].observed, by["discovery.resolve_video_links"].pass], [0, true], "只读本词日志段");
  assert.deepEqual([by["collection.resolve_profile_link"].observed, by["collection.resolve_profile_link"].pass], [1, false], "本词有 1 条主页链接为空");
  assert.deepEqual([by["preflight.open_run_ledger"].observed, by["preflight.open_run_ledger"].pass], [1, true]);
  assert.deepEqual(r.hard_failed, [], "checkpoint 失败只记录不拦");
});

test("judgeSteps：hard 步骤失败进 hard_failed；none 类型记 skipped+reason；远端(sql/http)结果按 key 合并", () => {
  const spec = { steps: [
    step("discovery.x_hard", { type: "metric", ref: "metrics.candidates", expect: { op: ">=", value: 1 } }, "hard"),
    { ...step("discovery.x_none", { type: "none" }), reason: "界面瞬时状态无持久化产物" },
    step("discovery.x_sql", { type: "sql", query: "select 1 where '$RUN_TAG'=''", expect: { op: "<=", value: 0 } }),
  ] };
  const remote = [{ key: "keyword_acquisition.discovery.x_sql", observed: 3, pass: false }];
  const r = judgeSteps({ spec, stage: "discovery", ctx: { metrics: { candidates: 0 } }, remote });
  const by = Object.fromEntries(r.steps.map((s) => [s.key, s]));
  assert.deepEqual(r.hard_failed, ["keyword_acquisition.discovery.x_hard"]);
  assert.equal(by["keyword_acquisition.discovery.x_none"].pass, null);
  assert.match(by["keyword_acquisition.discovery.x_none"].reason, /界面/);
  assert.deepEqual([by["keyword_acquisition.discovery.x_sql"].observed, by["keyword_acquisition.discovery.x_sql"].pass], [3, false]);
  const r2 = judgeSteps({ spec, stage: "discovery", ctx: { metrics: { candidates: 0 } }, remote: [] });
  assert.equal(r2.steps.find((s) => s.key.endsWith("x_sql")).pass, null, "远端没回 → 读不回(null),不假绿");
});

test("verify-step runSteps：只判本 stage、只判 sql/http，占位参数化", async () => {
  const calls = [];
  const pool = { query: async (text, values) => { calls.push({ text, values }); return { rows: [{ count: "5" }], fields: [{ name: "count" }] }; } };
  const spec = { steps: [
    step("delivery.push_videos", { type: "sql", query: "SELECT count(*) FROM zenithjoy.leadgen_videos WHERE harvest_batch = '$RUN_TAG'", expect: { op: ">=", ref: "metrics.videos_pushed" } }),
    step("delivery.readback_line_key", { type: "metric", ref: "metrics.readback_verified", expect: { op: "==", value: 1 } }),
    step("discovery.persist_candidates", { type: "sql", query: "SELECT 1", expect: { op: ">=", value: 1 } }),
  ] };
  const out = await runSteps({ spec, stage: "delivery", params: { runTag: "auto1", lineKey: "jinuo", metrics: { videos_pushed: 4 } }, deps: { pool } });
  assert.deepEqual(out.map((s) => [s.key, s.observed, s.pass]), [["keyword_acquisition.delivery.push_videos", 5, true]]);
  assert.deepEqual(calls[0].values, ["auto1"]);
  assert.ok(!calls[0].text.includes("auto1"));
});

test("computeStats：按时间算连续通过次数；fail/读不回清零；checkpoint 且连续通过≥N 才列为可升 hard", () => {
  const rec = (key, pass, t, mode = "checkpoint") => ({ key, mode, pass, observed_at: `2026-09-29T0${t}:00:00Z` });
  const rows = [
    rec("a", true, 1), rec("a", false, 2), rec("a", true, 3), rec("a", true, 4), rec("a", true, 5),
    rec("b", true, 1), rec("b", true, 2), rec("b", null, 3),
    rec("c", true, 1), rec("c", true, 2), rec("c", true, 3, "hard"),
  ];
  const s = Object.fromEntries(computeStats(rows, 3).map((x) => [x.key, x]));
  assert.deepEqual([s.a.evaluated, s.a.pass, s.a.fail, s.a.streak, s.a.eligible], [5, 4, 1, 3, true]);
  assert.deepEqual([s.b.unknown, s.b.streak, s.b.eligible], [1, 0, false]);
  assert.equal(s.c.eligible, false, "已是 hard 不再列");
});

// ── 接进 workflow-result.sh：每个 stage 工件写出时统一裁判判本活动步骤，写进工件与账本 ──
const WFR = join(SRC, "workflow-result.sh");
function fakeSsh(dir, stepsOut = []) {
  const bin = join(dir, "sshbin"); mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "ssh"), `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({ stage: "x", probes: [{ key: "p", observed: 1, pass: true }], gate: { verdict: "pass", action: "continue", failed: [], unknown: [], alert: false }, steps: stepsOut })}'\n`);
  chmodSync(join(bin, "ssh"), 0o755);
  return `${bin}:${process.env.PATH}`;
}
function wfrEnv(home, extra = {}) {
  return { ...process.env, WFR_HOME: home, WFR_NODE: process.execPath, WFR_JQ: JQ, WFR_LEDGER_MJS: join(SRC, "ledger.mjs"), WFR_SCP_TARGET: "",
    WFR_BRAIN_ENV: join(home, "none"), BRAIN_URL: "", BRAIN_INTERNAL_TOKEN: "", WFR_BRAIN_TASK_ID: "", WFR_CHECKS_YAML: join(home, "no.yaml"),
    WFR_PROBE_STAGES: "preflight discovery qualification collection scoring delivery outreach cleanup",
    WFR_STEP_JUDGE: join(SRC, "step-judge.mjs"), WFR_STEP_SPEC: join(SRC, "step-dod.json"), WFR_EVIDENCE_ROOT: join(home, "ev"), ...extra };
}
function kvOf(out) { return Object.fromEntries(out.split("\n").filter((l) => /^WFR_[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; })); }

test("workflow-result: preflight 工件带 step_dod(6 步)，账本 step-dod.jsonl 追加；checkpoint 失败不改工件状态", { skip: !JQ && "no jq" }, () => {
  const home = mkdtempSync(join(tmpdir(), "wfrsj-"));
  const wf = join(home, "kw.txt"); writeFileSync(wf, "A\n");
  const r = spawnSync("bash", [WFR, "init", "auto1", "p1", wf, "1", "S", "h"], { encoding: "utf8", env: wfrEnv(home, { PATH: fakeSsh(home), DEVICE_VERIFIED: "1", ACCOUNT_VERIFIED: "1", CALL_STATE_IDLE: "1", LOCK_ACQUIRED: "0" }) });
  const kv = kvOf(r.stdout);
  const art = JSON.parse(readFileSync(join(kv.WFR_ART_DIR, "social-keyword-leadgen-crontab-auto1__a0.preflight.1.worker-result.json"), "utf8"));
  const keys = art.step_dod.map((s) => s.key);
  assert.ok(keys.includes("keyword_acquisition.preflight.acquire_device_lock"), keys.join(","));
  assert.equal(art.step_dod.find((s) => s.key.endsWith("acquire_device_lock")).pass, false, "lock_acquired=0 → 该步不过(只记录)");
  assert.equal(art.status, "completed", "checkpoint 不拦:工件状态由后置条件 gate 决定,不被步骤改动");
  const lines = readFileSync(join(kv.WFR_RUN_DIR, "step-dod.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(lines.length >= 5);
  assert.ok(lines.every((l) => l.run_id === kv.WFR_RUN_ID && l.stage === "preflight" && "pass" in l && l.observed_at));
});

test("workflow-result: hard 步骤不过 → 该 stage 判 fail_stage(工件 failed/retry)", { skip: !JQ && "no jq" }, () => {
  const home = mkdtempSync(join(tmpdir(), "wfrsj-"));
  const spec = JSON.parse(JSON.stringify(SPEC));
  spec.steps.find((s) => s.key.endsWith("preflight.acquire_device_lock")).mode = "hard";
  const specFile = join(home, "spec.json"); writeFileSync(specFile, JSON.stringify(spec));
  const wf = join(home, "kw.txt"); writeFileSync(wf, "A\n");
  const r = spawnSync("bash", [WFR, "init", "auto1", "p1", wf, "1", "S", "h"], { encoding: "utf8", env: wfrEnv(home, { PATH: fakeSsh(home), WFR_STEP_SPEC: specFile, DEVICE_VERIFIED: "1", ACCOUNT_VERIFIED: "1", CALL_STATE_IDLE: "1", LOCK_ACQUIRED: "0" }) });
  const kv = kvOf(r.stdout);
  const art = JSON.parse(readFileSync(join(kv.WFR_ART_DIR, "social-keyword-leadgen-crontab-auto1__a0.preflight.1.worker-result.json"), "utf8"));
  assert.equal(art.status, "failed");
  assert.match(art.summary, /step_dod_hard_failed.*acquire_device_lock/);
});

test("step-dod-stats CLI：读工件目录 step_dod 出统计与可升 hard 清单（--json）", () => {
  const d = mkdtempSync(join(tmpdir(), "sds-"));
  for (let i = 0; i < 3; i++) {
    writeFileSync(join(d, `r${i}__a1.preflight.1.worker-result.json`), JSON.stringify({ observed_at: `2026-09-2${i}T00:00:00Z`, step_dod: [{ key: "keyword_acquisition.preflight.acquire_device_lock", mode: "checkpoint", pass: true }] }));
  }
  const r = spawnSync(process.execPath, [join(SRC, "step-dod-stats.mjs"), "--dir", d, "--min", "3", "--json"], { encoding: "utf8" });
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.eligible, ["keyword_acquisition.preflight.acquire_device_lock"]);
  const t = spawnSync(process.execPath, [join(SRC, "step-dod-stats.mjs"), "--dir", d, "--min", "3"], { encoding: "utf8" });
  assert.match(t.stdout, /acquire_device_lock/);
  assert.match(t.stdout, /可升 hard/);
});

test("接线守卫：批次/收工/触达三处给裁判读回上下文；部署清单下发裁判与清单到执行机和 mmv", () => {
  const rd = (f) => readFileSync(join(SRC, f), "utf8");
  assert.match(rd("batch2.sh"), /export WFR_LOG_FILE=\$LOG WFR_TSV=\$OUT/);
  assert.match(rd("batch2.sh"), /WFR_LOG_FROM=\$\(log_off\)/);
  assert.match(rd("wf-run.sh"), /export WFR_LOG_FILE=~\/night-\$TAG\.log/);
  assert.match(rd("outreach-tick.sh"), /WFR_LOG_FILE=\$LOG WFR_LOG_FROM=/);
  const dep = rd("deploy.sh");
  const deviceFiles = dep.match(/DEVICE_NODE_FILES=\(([\s\S]*?)\)/)[1].trim().split(/\s+/);
  for (const file of ['ledger.mjs', 'step-judge.mjs', 'step-dod.json']) assert.ok(deviceFiles.includes(file), file);
  assert.match(dep.slice(dep.indexOf("MMV_PROBE_FILES=(")), /step-judge\.mjs step-dod\.json step-dod-stats\.mjs/);
});

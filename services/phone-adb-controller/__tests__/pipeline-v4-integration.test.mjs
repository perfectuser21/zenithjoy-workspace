// 账本钩子内建进现网 batch2.sh / harvest-cron.sh（棒3b-3，决策 2ca30c4d）的集成测试。
// 真跑 zsh 脚本：假 harvest-keyword.sh 按词回 0/1/3 并记录 argv；假 ssh/scp 放在 $HOME/.local/bin
// （batch2.sh 的 PATH 首位）记录 argv 后 exit 0；账本落在临时 HOME。fixtures/batch2-pre-wfr.sh 是并入前
// 的 batch2.sh 逐字快照（origin/main 23b0cd8a，md5 2abbb72968b4f8f1f03660425ef2dfa1；8bb3af55 先判后采时与现网同步删掉
// 落池后的 judge-video.js 块，其余逐字不动），用来断言
// WFR_DISABLED=1 时新脚本的日志/产物/子进程 argv 与旧版逐字一致。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, chmodSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");
const BATCH2 = join(SRC, "batch2.sh");
const LEGACY = join(HERE, "fixtures", "batch2-pre-wfr.sh");
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
const JQ = spawnSync("bash", ["-lc", "command -v jq"], { encoding: "utf8" }).stdout.trim();
const SKIP = (!ZSH && "no zsh (CI: sudo apt-get install -y zsh)") || (!JQ && "no jq");

// 假 harvest-keyword.sh：参数 PROFILE ENC MAXV TAG LOC LINE；argv 记到 $HOME/hk-argv.log
const FAKE_HK = `#!/bin/zsh
print -r -- "$#\t$1\t$2\t$3\t$4\t$5\t\${6:-<unset>}" >> "$HOME/hk-argv.log"
W=$(python3 -c "import urllib.parse,sys;print(urllib.parse.unquote(sys.argv[1]))" "$2")
case "$W" in
  ok)     print "VIDEO\\t1\\thttps://v/1\\ttitle\\t$W\\t2"; print "LEAD\\tnick\\tid1\\tpersonal\\tbody\\t09-01\\t上海\\ttitle\\t$W\\t\\t\\thttps://v/1"; print "LEAD\\tnick2\\tid2\\tpersonal\\tbody\\t09-01\\t上海\\ttitle\\t$W\\t\\t\\thttps://v/1"; exit 0;;
  nocard) exit 0;;
  lock)   exit 3;;
  fail)   exit 1;;
esac`;
// 假 ssh/scp：记录 argv 后 exit 0（落池/分拣/判定/探针读回全部经它）
const FAKE_SSH = `#!/bin/sh
printf '%s' "$(basename "$0")" >> "$HOME/ssh-argv.log"; for a in "$@"; do printf '\\t%s' "$a" >> "$HOME/ssh-argv.log"; done; printf '\\n' >> "$HOME/ssh-argv.log"; exit 0`;

// 带统计输出的假 ssh：命令含 push-videos.js / push-raw-comments.js / sort-comments.js 时把 env 预设的统计行打到 stdout
// （batch2.sh 把 ssh 输出追加进 $LOG）。FAKE_PUSH_RC / FAKE_SORT_RC 控制对应命令的出口码。
const FAKE_SSH_STATS = `#!/bin/sh
printf '%s' "$(basename "$0")" >> "$HOME/ssh-argv.log"; for a in "$@"; do printf '\\t%s' "$a" >> "$HOME/ssh-argv.log"; done; printf '\\n' >> "$HOME/ssh-argv.log"
case "$*" in *push-videos.js*) [ -n "$FAKE_PV" ] && echo "$FAKE_PV";; esac
case "$*" in *push-raw-comments.js*) [ -n "$FAKE_PC" ] && echo "$FAKE_PC";; esac
case "$*" in *push-videos.js*|*push-raw-comments.js*) exit \${FAKE_PUSH_RC:-0};; esac
case "$*" in *sort-comments.js*) [ -n "$FAKE_SORT" ] && echo "$FAKE_SORT"; exit \${FAKE_SORT_RC:-0};; esac
exit 0`;
const PV = 'PUSH_VIDEOS_STATS {"created":3,"dup":1,"input":4,"pg_ok":3,"pg_fail":0}';
const PC = 'PUSH_COMMENTS_STATS {"created":5,"dup":2,"input":7}';
const SORT = 'SORT_STATS {"pending":5,"judged":4,"moved":2,"duped":1,"failed":1,"parked":0,"grades":{"A":1,"B":1,"C":1,"不相关":1}}';

function setup(wordsList, { init = true, push = "0", stats = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), "b2wfr-"));
  mkdirSync(join(home, "bin-harvest"), { recursive: true });
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  const fake = join(home, "bin-harvest", "harvest-keyword.sh"); writeFileSync(fake, FAKE_HK); chmodSync(fake, 0o755);
  for (const b of ["ssh", "scp"]) { const p = join(home, ".local", "bin", b); writeFileSync(p, stats && b === "ssh" ? FAKE_SSH_STATS : FAKE_SSH); chmodSync(p, 0o755); }
  const wf = join(home, "kw.txt"); writeFileSync(wf, wordsList.join("\n") + "\n");
  const env = { ...process.env, HOME: home, WFR_HOME: join(home, ".config", "zenithjoy"), WFR_NODE: process.execPath, WFR_JQ: JQ,
    WFR_LEDGER_MJS: join(SRC, "ledger.mjs"), WFR: join(SRC, "workflow-result.sh"), WFR_SCP_TARGET: "", WFR_PROBE_STAGES: "",
    WALL_REPORT: "/nonexistent", BATCH_SLEEP: "0" };
  delete env.WFR_DISABLED; delete env.WFR_SKIP_WORDS; delete env.WFR_RUN_ID;
  const kv = {};
  if (init) {
    for (const args of [["init", "t9", "p1", wf, push, "S", "h"], ["enter"]]) {
      const r = spawnSync("bash", [join(SRC, "workflow-result.sh"), ...args], { encoding: "utf8", env: { ...env, ...kv } });
      for (const l of r.stdout.split("\n")) { const m = l.match(/^(WFR_[A-Z_]+)=(.*)$/); if (m) kv[m[1]] = m[2]; }
    }
  }
  return { home, wf, push, env: { ...env, ...kv }, kv };
}
function run(ctx, { script = BATCH2, push = ctx.push, line, env = {} } = {}) {
  const args = [script, "p1", ctx.wf, "t9", push, ""]; if (line !== undefined) args.push(line);
  return spawnSync(ZSH, args, { encoding: "utf8", env: { ...ctx.env, ...env } });
}
function book(ctx) { return JSON.parse(readFileSync(join(ctx.kv.WFR_RUN_DIR, "ledger.json"), "utf8")); }
function arts(ctx) { return readdirSync(ctx.kv.WFR_ART_DIR).filter((f) => f.includes("__a1.")).sort(); }
function art(ctx, name) { return JSON.parse(readFileSync(join(ctx.kv.WFR_ART_DIR, `social-keyword-leadgen-crontab-t9__a1.${name}.worker-result.json`), "utf8")); }
function readOr(p) { return existsSync(p) ? readFileSync(p, "utf8") : ""; }
function nightLog(ctx) { return readOr(join(ctx.home, "night-t9.log")).replace(/^\[\d\d:\d\d:\d\d\] /gm, ""); }
function outputs(ctx) {
  return { log: nightLog(ctx), tsv: readOr(join(ctx.home, "night-t9.tsv")), hk: readOr(join(ctx.home, "hk-argv.log")),
    ssh: readOr(join(ctx.home, "ssh-argv.log")).replace(/\S*t9-manifest\S*/g, "<manifest>").split(ctx.home).join("<home>") };
}
// 旧版 batch2.sh 逐词 sleep 20-60s（写死 /bin/sleep），测试里只把这一处替换成空操作，其余逐字不动
function legacyScript(ctx) {
  const src = readFileSync(LEGACY, "utf8");
  const patched = src.replace("/bin/sleep $(( 20 + RANDOM % 40 ))", ":");
  assert.notEqual(patched, src, "fixture 里找不到旧版 sleep 行（快照被改？）");
  const p = join(ctx.home, "batch2-legacy.sh"); writeFileSync(p, patched); chmodSync(p, 0o755); return p;
}

test("四种出口码 → 阶段状态映射（af061588）；工件 n=词序；collection metrics 真实计数", { skip: SKIP }, () => {
  const ctx = setup(["ok", "nocard", "lock", "fail"]);
  const r = run(ctx);
  assert.equal(r.status, 0, r.stderr);
  const b = book(ctx);
  const d = Object.fromEntries(b.stages.discovery.items.map((x) => [x.word, x.status]));
  assert.deepEqual(d, { ok: "completed", nocard: "blocked", lock: "blocked", fail: "failed" });
  assert.equal(b.stages.collection.items.find((x) => x.word === "ok").status, "completed");
  const a = arts(ctx);
  assert.ok(a.includes("social-keyword-leadgen-crontab-t9__a1.discovery.1.worker-result.json"));
  assert.ok(a.includes("social-keyword-leadgen-crontab-t9__a1.collection.1.worker-result.json"));
  assert.ok(a.includes("social-keyword-leadgen-crontab-t9__a1.discovery.4.worker-result.json"));
  const c1 = art(ctx, "collection.1");
  assert.equal(c1.metrics.comments_collected, 2); assert.equal(c1.metrics.videos_processed, 1);
  assert.match(art(ctx, "discovery.3").summary, /lock_busy/);
  assert.match(art(ctx, "discovery.4").summary, /rc=1/);
});

test("LINE 第 6 参照旧传递：显式传 devline → harvest-keyword 与落池/分拣/判定 ssh 都拿到 devline", { skip: SKIP }, () => {
  const ctx = setup(["ok"], { push: "1" });
  const r = run(ctx, { line: "devline" });
  assert.equal(r.status, 0, r.stderr);
  const hk = readFileSync(join(ctx.home, "hk-argv.log"), "utf8").trim().split("\n");
  assert.equal(hk.length, 1);
  assert.equal(hk[0], "6\tp1\tok\t4\tt9-w1\tunlimited\tdevline");   // argc=6, MAXV 默认 4, LOC=unlimited, LINE=devline
  const ssh = readFileSync(join(ctx.home, "ssh-argv.log"), "utf8");
  assert.match(ssh, /push-videos\.js \/tmp\/t9\.tsv t9 devline && node [^\n]*push-raw-comments\.js \/tmp\/t9\.tsv t9 devline/);
  assert.match(ssh, /sort-comments\.js devline/);
  // 8bb3af55 先判后采：视频判定已前移到 harvest-keyword.sh 逐视频开评论区之前(qualify-video.js)，
  // 落池之后不再跑 judge-video.js（那时评论早采完了，判了也挡不住）
  assert.doesNotMatch(ssh, /judge-video\.js/);
});

test("LINE 不传 → 回落 profile（旧默认 LINE=\"${6:-$P}\"）；MAXV 环境变量透传到第 3 参", { skip: SKIP }, () => {
  const ctx = setup(["nocard"]);
  const r = run(ctx, { env: { MAXV: "7" } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(ctx.home, "hk-argv.log"), "utf8").trim(), "6\tp1\tnocard\t7\tt9-w1\tunlimited\tp1");
});

test("delivery：PUSH=1 且落池 ssh 成功 → completed leads_written=真实 LEAD 数；PUSH=0 → blocked", { skip: SKIP }, () => {
  const ctx = setup(["ok", "ok"], { push: "1" });
  const r = run(ctx);
  assert.equal(r.status, 0, r.stderr);
  const dv = art(ctx, "delivery.1");
  assert.equal(dv.status, "completed"); assert.equal(dv.metrics.leads_written, 4);
  assert.equal(book(ctx).stages.delivery.status, "completed");
  const ctx0 = setup(["ok"], { push: "0" });
  assert.equal(run(ctx0).status, 0);
  assert.equal(art(ctx0, "delivery.1").status, "blocked");
  assert.match(art(ctx0, "delivery.1").summary, /push=0 skipped/);
});

const ZERO_SCORING = { comments_scored: 0, strong_intent: 0, weak_intent: 0, peer: 0, irrelevant: 0, spam: 0 };
const pick = (m, keys) => Object.fromEntries(keys.map((k) => [k, m[k]]));
const DELIVERY_KEYS = ["leads_written", "duplicates_skipped", "videos_pushed", "readback_verified", "cursor_updates"];

test("delivery 对账基准 = 落池脚本真实统计（PUSH_COMMENTS_STATS.created / .dup、PUSH_VIDEOS_STATS.created），不再是 TSV LEAD 行数", { skip: SKIP }, () => {
  const ctx = setup(["ok", "ok"], { push: "1", stats: true });   // TSV 里 LEAD=4
  const r = run(ctx, { env: { FAKE_PV: PV, FAKE_PC: PC, FAKE_SORT: SORT } });
  assert.equal(r.status, 0, r.stderr);
  const dv = art(ctx, "delivery.1");
  assert.equal(dv.status, "completed");
  assert.deepEqual(pick(dv.metrics, DELIVERY_KEYS), { leads_written: 5, duplicates_skipped: 2, videos_pushed: 3, readback_verified: 0, cursor_updates: 0 });
  assert.doesNotMatch(dv.summary, /no push stats/);
});

test("delivery：缺 PUSH_VIDEOS_STATS（悦升无视频池）→ videos_pushed=0，评论统计照用；两个统计都缺 → leads_written 回落 $NL、dup 0、summary 注明 no push stats", { skip: SKIP }, () => {
  const ctxA = setup(["ok", "ok"], { push: "1", stats: true });
  assert.equal(run(ctxA, { env: { FAKE_PC: PC } }).status, 0);
  const a = art(ctxA, "delivery.1");
  assert.deepEqual(pick(a.metrics, DELIVERY_KEYS), { leads_written: 5, duplicates_skipped: 2, videos_pushed: 0, readback_verified: 0, cursor_updates: 0 });
  const ctxB = setup(["ok", "ok"], { push: "1", stats: true });
  assert.equal(run(ctxB).status, 0);
  const b = art(ctxB, "delivery.1");
  assert.equal(b.status, "completed");
  assert.deepEqual(pick(b.metrics, DELIVERY_KEYS), { leads_written: 4, duplicates_skipped: 0, videos_pushed: 0, readback_verified: 0, cursor_updates: 0 });
  assert.match(b.summary, /no push stats/);
});

test("delivery：只取本次新增输出里的统计（日志里更早的旧统计行不算）", { skip: SKIP }, () => {
  const ctx = setup(["ok"], { push: "1", stats: true });
  const r = run(ctx, { env: { FAKE_PC: PC } });         // 第一次：日志里留下一行 PUSH_COMMENTS_STATS
  assert.equal(r.status, 0, r.stderr);
  assert.equal(art(ctx, "delivery.1").metrics.leads_written, 5);
  // 第二次同 TAG（日志 $LOG 是追加的）：本次 ssh 不再吐统计 → 必须回落到 $NL，而不是读到第一次遗留的旧行
  const r2 = run(ctx, { env: { FAKE_PC: "" } });
  assert.equal(r2.status, 0, r2.stderr);
  assert.ok(nightLog(ctx).includes("PUSH_COMMENTS_STATS"), "前提：日志里确有旧统计行");
  const dv = art(ctx, "delivery.1");
  assert.equal(dv.metrics.leads_written, 2, "回落 $NL（本批 TSV 的 LEAD 行数），不是旧行的 5");
  assert.match(dv.summary, /no push stats/);
});

test("delivery 落池失败（ssh 非零）→ failed，metrics 全 0（含 videos_pushed），即使输出里有统计", { skip: SKIP }, () => {
  const ctx = setup(["ok", "ok"], { push: "1", stats: true });
  const r = run(ctx, { env: { FAKE_PV: PV, FAKE_PC: PC, FAKE_SORT: SORT, FAKE_PUSH_RC: "1" } });
  assert.equal(r.status, 0, r.stderr);
  const dv = art(ctx, "delivery.1");
  assert.equal(dv.status, "failed"); assert.match(dv.summary, /push rc=1/);
  assert.deepEqual(pick(dv.metrics, DELIVERY_KEYS), { leads_written: 0, duplicates_skipped: 0, videos_pushed: 0, readback_verified: 0, cursor_updates: 0 });
});

test("scoring：分拣后写真实工件 scoring.1（completed），metrics = judged / A / B+C / 不相关；peer、spam 恒 0；覆盖 init 的 blocked 占位", { skip: SKIP }, () => {
  const ctx = setup(["ok"], { push: "1", stats: true });
  assert.equal(book(ctx).stages.scoring.status, "blocked", "前提：init 写的占位");
  const r = run(ctx, { env: { FAKE_PV: PV, FAKE_PC: PC, FAKE_SORT: SORT } });
  assert.equal(r.status, 0, r.stderr);
  const sc = art(ctx, "scoring.1");
  assert.equal(sc.status, "completed");
  assert.equal(sc.attempt_id, "a1");
  assert.deepEqual(pick(sc.metrics, Object.keys(ZERO_SCORING)), { comments_scored: 4, strong_intent: 1, weak_intent: 2, peer: 0, irrelevant: 1, spam: 0 });
  assert.ok(sc.evidence.length >= 1);
  assert.equal(book(ctx).stages.scoring.status, "completed");
  assert.equal(book(ctx).stages.scoring.items.length, 1, "n=1 覆盖占位项，不新增");
});

test("scoring：分拣无统计 / ssh 失败 → scoring.1 failed，metrics 全 0，summary 带 rc", { skip: SKIP }, () => {
  const ctxA = setup(["ok"], { push: "1", stats: true });
  assert.equal(run(ctxA, { env: { FAKE_PV: PV, FAKE_PC: PC } }).status, 0);     // 分拣 ssh 成功但没输出统计
  const a = art(ctxA, "scoring.1");
  assert.equal(a.status, "failed"); assert.match(a.summary, /no SORT_STATS rc=0/);
  assert.deepEqual(pick(a.metrics, Object.keys(ZERO_SCORING)), ZERO_SCORING);
  const ctxB = setup(["ok"], { push: "1", stats: true });
  assert.equal(run(ctxB, { env: { FAKE_PV: PV, FAKE_PC: PC, FAKE_SORT_RC: "255" } }).status, 0);
  const b = art(ctxB, "scoring.1");
  assert.equal(b.status, "failed"); assert.match(b.summary, /no SORT_STATS rc=255/);
});

test("scoring：有待分拣但一条没判成（judged=0 pending>0，模型/鉴权整批挂了）→ failed，不得记 completed", { skip: SKIP }, () => {
  const ctx = setup(["ok"], { push: "1", stats: true });
  const allFailed = 'SORT_STATS {"pending":5,"judged":0,"moved":0,"duped":0,"failed":5,"parked":0,"grades":{"A":0,"B":0,"C":0,"不相关":0}}';
  assert.equal(run(ctx, { env: { FAKE_PV: PV, FAKE_PC: PC, FAKE_SORT: allFailed } }).status, 0);
  const sc = art(ctx, "scoring.1");
  assert.equal(sc.status, "failed");
  assert.match(sc.summary, /judged=0 pending=5/);
  assert.equal(book(ctx).stages.scoring.status, "failed");
  // 对照：没有待分拣（pending=0 judged=0）是正常的空批，仍 completed
  const ctx0 = setup(["ok"], { push: "1", stats: true });
  const empty = 'SORT_STATS {"pending":0,"judged":0,"moved":0,"duped":0,"failed":0,"parked":0,"grades":{"A":0,"B":0,"C":0,"不相关":0}}';
  assert.equal(run(ctx0, { env: { FAKE_PV: PV, FAKE_PC: PC, FAKE_SORT: empty } }).status, 0);
  assert.equal(art(ctx0, "scoring.1").status, "completed");
});

test("scoring：PUSH=0 不分拣 → 不写 scoring.1 工件（占位仍在）", { skip: SKIP }, () => {
  const ctx = setup(["ok"], { push: "0", stats: true });
  assert.equal(run(ctx).status, 0);
  assert.ok(!arts(ctx).some((f) => f.includes(".scoring.")));
  assert.equal(book(ctx).stages.scoring.status, "blocked");
});

test("WFR_DISABLED=1 + 假 ssh 吐统计行：日志/产物/子进程 argv 仍与并入前逐字一致（解析代码不写 $LOG、不多发 ssh）", { skip: SKIP }, () => {
  const env = { WFR_DISABLED: "1", FAKE_PV: PV, FAKE_PC: PC, FAKE_SORT: SORT };
  const ctxNew = setup(["ok", "nocard"], { push: "1", stats: true });
  const rNew = run(ctxNew, { line: "devline", env });
  assert.equal(rNew.status, 0, rNew.stderr);
  assert.equal(rNew.stdout, "");
  assert.ok(!arts(ctxNew).some((f) => /scoring\.1|delivery/.test(f) && f.includes("__a1.")), "不该写 a1 工件");
  const ctxOld = setup(["ok", "nocard"], { init: false, push: "1", stats: true });
  const rOld = run(ctxOld, { script: legacyScript(ctxOld), line: "devline", env });
  assert.equal(rOld.status, 0, rOld.stderr);
  const a = outputs(ctxNew), b = outputs(ctxOld);
  assert.ok(a.log.includes("PUSH_COMMENTS_STATS"), "前提：统计行确实进了日志");
  assert.equal(a.log, b.log); assert.equal(a.tsv, b.tsv); assert.equal(a.hk, b.hk); assert.equal(a.ssh, b.ssh);
});

for (const [name, env] of [["WFR_DISABLED=1", { WFR_DISABLED: "1" }], ["workflow-result.sh 不存在", { WFR: "/nonexistent/workflow-result.sh" }]]) {
  test(`${name}：不写账本，且日志/产物/子进程 argv 与并入前 batch2.sh 逐字一致`, { skip: SKIP }, () => {
    const ctxNew = setup(["ok", "nocard", "lock", "fail"], { push: "1" });
    const rNew = run(ctxNew, { line: "devline", env });
    assert.equal(rNew.status, 0, rNew.stderr);
    assert.equal(rNew.stdout, "", "no-op 模式不该往 stdout 打任何东西(旧版也不打)");
    assert.equal(book(ctxNew).stages.discovery.items.length, 0, "账本不该有 discovery 记录");
    assert.equal(arts(ctxNew).filter((f) => /discovery|collection|delivery/.test(f)).length, 0, "不该写任何词级/落池工件");
    const ctxOld = setup(["ok", "nocard", "lock", "fail"], { init: false, push: "1" });
    const rOld = run(ctxOld, { script: legacyScript(ctxOld), line: "devline" });
    assert.equal(rOld.status, 0, rOld.stderr);
    assert.equal(rNew.stdout, rOld.stdout);
    const a = outputs(ctxNew), b = outputs(ctxOld);
    assert.ok(a.log.includes("v2批开始"), a.log);
    assert.equal(a.log, b.log); assert.equal(a.tsv, b.tsv); assert.equal(a.hk, b.hk); assert.equal(a.ssh, b.ssh);
  });
}

test("hash 不一致 → 写 blocked hash_mismatch、打印 BATCH2_ESCALATE、停跑（fail-closed）", { skip: SKIP }, () => {
  const ctx = setup(["ok", "ok"]);
  writeFileSync(ctx.wf, "ok\ntampered\n");           // init 之后改词单
  const r = run(ctx);
  assert.match(r.stdout, /BATCH2_ESCALATE=hash_mismatch/);
  assert.equal(readOr(join(ctx.home, "hk-argv.log")), "", "停跑后不该再调 harvest-keyword");
  const b = book(ctx);
  assert.equal(b.stages.discovery.status, "blocked");
  assert.equal(b.stages.discovery.items.length, 1);
  assert.equal(b.stages.discovery.items[0].n, 0);       // 哨兵 n=0，不与词序号冲突
});

test("hash 不一致不覆盖上一 attempt 已完成词的 items 记录", { skip: SKIP }, () => {
  const ctx = setup(["ok", "nocard"]);
  for (const stage of ["discovery", "collection"]) {
    spawnSync(process.execPath, [join(SRC, "ledger.mjs"), "set", "--stage", stage, "--status", "completed", "--n", "1", "--word", "ok", "--run-dir", ctx.kv.WFR_RUN_DIR], { encoding: "utf8" });
  }
  writeFileSync(ctx.wf, "ok\ntampered\n");
  const r = run(ctx);
  assert.match(r.stdout, /BATCH2_ESCALATE=hash_mismatch/);
  const b = book(ctx);
  assert.equal(b.stages.discovery.items.find((x) => x.word === "ok").status, "completed");
  assert.ok(b.stages.discovery.items.some((x) => x.n === 0 && x.status === "blocked"));
  const na = spawnSync(process.execPath, [join(SRC, "ledger.mjs"), "next-attempt", "--run-dir", ctx.kv.WFR_RUN_DIR], { encoding: "utf8" });
  assert.ok(JSON.parse(na.stdout).skip_words.includes("ok"));
});

test("WFR_SKIP_WORDS 里的词不跑（续跑）", { skip: SKIP }, () => {
  const ctx = setup(["ok", "nocard"]);
  const r = run(ctx, { env: { WFR_SKIP_WORDS: "ok" } });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(book(ctx).stages.discovery.items.map((x) => x.word), ["nocard"]);
  assert.equal(readFileSync(join(ctx.home, "hk-argv.log"), "utf8").trim().split("\n").length, 1);
});

// ── harvest-cron.sh 库块（HARVEST_CRON_LIB=1 source 只装函数不跑主体）──
const HC = join(SRC, "harvest-cron.sh");
function lib(cmd, env) { return spawnSync(ZSH, ["-c", `HARVEST_CRON_LIB=1 source ${HC}; ${cmd}`], { encoding: "utf8", env }); }
function libEnv(extra = {}) {
  const home = mkdtempSync(join(tmpdir(), "hcwfr-"));
  const env = { ...process.env, HOME: home, WFR_HOME: join(home, ".config", "zenithjoy"), WFR_NODE: process.execPath, WFR_JQ: JQ,
    WFR_LEDGER_MJS: join(SRC, "ledger.mjs"), WFR: join(SRC, "workflow-result.sh"), WFR_SCP_TARGET: "", ...extra };
  for (const k of ["WFR_RUN_ID", "WFR_DISABLED"]) if (!(k in extra)) delete env[k];
  return { home, env };
}

test("harvest-cron: wfr_on 三态——脚本在且未禁用为真；WFR_DISABLED=1 为假；脚本缺失为假", { skip: SKIP }, () => {
  assert.equal(lib("wfr_on", libEnv().env).status, 0);
  assert.notEqual(lib("wfr_on", libEnv({ WFR_DISABLED: "1" }).env).status, 0);
  assert.notEqual(lib("wfr_on", libEnv({ WFR: "/nonexistent/workflow-result.sh" }).env).status, 0);
});

test("harvest-cron: finalize_needed 只在 wfr init 跑过（WFR_RUN_ID 已导出）且未禁用时为真", { skip: SKIP }, () => {
  assert.notEqual(lib("finalize_needed", libEnv().env).status, 0);
  assert.equal(lib("finalize_needed", libEnv({ WFR_RUN_ID: "social-keyword-leadgen-crontab-t" }).env).status, 0);
  assert.notEqual(lib("finalize_needed", libEnv({ WFR_RUN_ID: "social-keyword-leadgen-crontab-t", WFR_DISABLED: "1" }).env).status, 0);
});

// C1(终审必修): init→eval 出的变量未 export 就紧接 `bash "$WFR" enter`——子进程走 not_initialized，
// 账本 attempt_id 永远 null。wfr_bootstrap 把"init → export → enter → export"接成一个库函数堵住这个洞。
test("harvest-cron: wfr_bootstrap 后账本 attempt_id=a1（export 早于 enter），并导出 WFR_TAG/WFR_PROFILE", { skip: SKIP }, () => {
  const { home, env } = libEnv();
  const wf = join(home, "kw.txt"); writeFileSync(wf, "A\nB\n");
  const r = lib(`wfr_bootstrap t7 p1 ${wf} 0 S h; echo "WFR_ATTEMPT=$WFR_ATTEMPT"; echo "WFR_RUN_DIR=$WFR_RUN_DIR"; env | grep -E '^WFR_(TAG|PROFILE)=' | sort`, env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /WFR_ATTEMPT=a1/);
  assert.match(r.stdout, /^WFR_PROFILE=p1$/m); assert.match(r.stdout, /^WFR_TAG=t7$/m);
  const runDir = r.stdout.split("\n").find((l) => l.startsWith("WFR_RUN_DIR=")).slice("WFR_RUN_DIR=".length);
  assert.equal(JSON.parse(readFileSync(join(runDir, "ledger.json"), "utf8")).attempt_id, "a1");
});

test("harvest-cron: WFR_DISABLED=1 时 wfr_bootstrap 不建账本、不导出 WFR_RUN_ID", { skip: SKIP }, () => {
  const { home, env } = libEnv({ WFR_DISABLED: "1" });
  const wf = join(home, "kw.txt"); writeFileSync(wf, "A\n");
  const r = lib(`wfr_bootstrap t7 p1 ${wf} 0 S h; echo "RUN=\${WFR_RUN_ID:-none}"`, env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /RUN=none/);
  assert.equal(existsSync(join(home, ".config", "zenithjoy", "ledger")), false);
});

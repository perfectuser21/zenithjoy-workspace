// douyin-phone-adb 对外动作账 / 锁回执证据 / tap-evidence 取证超时 单元测试（1010，Brain 任务 d1b395c7）。
//
// 背景：技能工厂样板「试跑 抖音·视频发布」(48b623db) 执行成功，但独立核验 (314b51ed) 判 fail：
//   1)「发布按钮只触发一次」没有可独立回读的凭据（核验员不采信执行者自述）；
//   2)「原 run 锁已释放并回读 free」没有证据 ID；
//   3) tap-evidence 等 5681ms 超过 5000 上限——点击已发生却报参数错误退出，按退出码判断会误以为没点而重复发布。
// 契约：
//   --outward <动作名>  持锁 run 下，点击前后截图 + 向 <run>-outward-ledger.jsonl 只追加记账；
//                       同 run 同动作第二次默认拒绝（--allow-repeat 放行），拒绝也记账；
//   outward-ledger RUN  只读输出账本（JSON），供核验员独立读取；
//   lock-acquire / lock-release  回执 + 随后 lock-status 回读写成 <run>-lock-acquire.json / <run>-lock-release.json；
//   tap-evidence        WAIT_MS 在点击前校验（上限可配，默认 15000）；点击后取证超时 → 退出码 3 + tapped=yes evidence=timeout。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, chmodSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT = new URL("../douyin-phone-adb", import.meta.url).pathname;
const RUN = "skill-factory-douyin-publish-1010";
const PYTHON = spawnSync("sh", ["-c", "command -v python3"], { encoding: "utf8" }).stdout.trim();

// 假 adb：状态在 STATE_DIR。tapped 文件 = 已发生的点击；FAKE_HANG_AFTER_TAP=1 时点击后的截图卡死（模拟取证超时）。
const FAKE_ADB = `#!/usr/bin/env node
const fs = require("fs"), path = require("path");
const S = process.env.STATE_DIR;
const argv = process.argv.slice(2);
fs.appendFileSync(path.join(S, "calls.log"), JSON.stringify(argv) + "\\n");
let a = argv;
if (a[0] === "-s") a = a.slice(2);
const out = (s) => process.stdout.write(s);
const tapped = () => fs.existsSync(path.join(S, "tapped"));
if (a[0] === "get-state") { out("device\\n"); process.exit(0); }
if (a[0] === "pull") { fs.writeFileSync(a[2], "PNGDATA"); process.exit(0); }
if (a[0] === "exec-out") { out("PNGDATA"); process.exit(0); }
if (a[0] !== "shell") process.exit(0);
const sh = a.slice(1);
const cmd = sh.join(" ");
if (cmd.startsWith("getprop ro.product.model")) { out("ANY-MODEL\\n"); process.exit(0); }
if (sh[0] === "input" && sh[1] === "tap") { fs.appendFileSync(path.join(S, "tapped"), sh[2] + "," + sh[3] + "\\n"); process.exit(0); }
if (sh[0] === "screencap" && process.env.FAKE_HANG_AFTER_TAP === "1" && tapped()) { setTimeout(() => process.exit(0), 30000); }
else process.exit(0);
`;

const FAKE_SIPS = `#!/bin/sh
# 假 sips：把最后一个参数当输出路径写个占位 jpg。
for last; do :; done
printf jpg > "$last"
`;

const FAKE_LOCATE = `print("321 654")
`;

function setup({ lockOwner = RUN } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "outward-"));
  const state = join(dir, "state");
  mkdirSync(state, { recursive: true });
  writeFileSync(join(state, "calls.log"), "");
  const reg = join(dir, "r.tsv");
  writeFileSync(reg, "legacy\tSER1\tANY-MODEL\t1199\t2663\n");
  const adb = join(dir, "fake-adb");
  writeFileSync(adb, FAKE_ADB); chmodSync(adb, 0o755);
  const sips = join(dir, "fake-sips");
  writeFileSync(sips, FAKE_SIPS); chmodSync(sips, 0o755);
  const locate = join(dir, "fake-locate.py");
  writeFileSync(locate, FAKE_LOCATE);
  const keyFile = join(dir, "openrouter.env");
  writeFileSync(keyFile, "OPENROUTER_API_KEY=test\n");
  const tmpRoot = join(dir, "tmp");
  const lock = join(tmpRoot, "locks", "SER1.lock");
  if (lockOwner) {
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, "owner"), lockOwner + "\n");
    writeFileSync(join(lock, "acquired_at"), String(Math.floor(Date.now() / 1000) - 10) + "\n");
  }
  const evidence = join(tmpRoot, "evidence", "legacy");
  return { dir, state, reg, adb, sips, locate, keyFile, tmpRoot, lock, evidence };
}

function run(ctx, args, extraEnv = {}, { owner = RUN } = {}) {
  const pre = owner ? ["--lock-owner", owner] : [];
  return new Promise((resolve) => {
    const p = spawn("zsh", [SCRIPT, "--profile", "legacy", ...pre, ...args], {
      env: {
        ...process.env, STATE_DIR: ctx.state, DOUYIN_PHONE_REGISTRY: ctx.reg, DOUYIN_ADB_BIN: ctx.adb,
        DOUYIN_PHONE_TMP_ROOT: ctx.tmpRoot, DOUYIN_PYTHON_BIN: PYTHON, DOUYIN_SIPS_BIN: ctx.sips,
        DOUYIN_LOCATE_SCRIPT: ctx.locate, DOUYIN_LOCATE_KEY_FILE: ctx.keyFile, ...extraEnv,
      },
    });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("close", (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}

const taps = (ctx) => (existsSync(join(ctx.state, "tapped")) ? readFileSync(join(ctx.state, "tapped"), "utf8").trim().split("\n").filter(Boolean) : []);
const ledgerPath = (ctx, r = RUN) => join(ctx.evidence, `${r}-outward-ledger.jsonl`);
const ledger = (ctx, r = RUN) => readFileSync(ledgerPath(ctx, r), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const lineWith = (out, key) => out.split("\n").find((l) => l.startsWith(key + "=")) || "";
const parse = (line) => Object.fromEntries(line.split(" ").filter((t) => t.includes("=")).map((t) => [t.slice(0, t.indexOf("=")), t.slice(t.indexOf("=") + 1)]));

test("前置：zsh 与 python3 可用", () => {
  assert.equal(spawnSync("zsh", ["-c", "exit 0"]).error, undefined, "没有 zsh");
  assert.ok(PYTHON, "没有 python3");
});

// ── 对外动作账 ─────────────────────────────────────────────────────────

test("tap-evidence --outward：前后截图 + 账本记 attempt/result 两行，stdout 打印 outward=ok", async () => {
  const ctx = setup();
  const eid = `${RUN}-07-publish`;
  const r = await run(ctx, ["tap-evidence", "600", "2400", eid, "--outward", "publish"]);
  assert.equal(r.code, 0, `err=${r.err}`);
  assert.deepEqual(taps(ctx), ["600,2400"], "只点一次");
  const kv = parse(lineWith(r.out, "outward"));
  assert.equal(kv.outward, "ok");
  assert.equal(kv.action, "publish");
  assert.equal(kv.tapped, "yes");
  assert.equal(kv.evidence, "ok");
  assert.equal(kv.action_seq, "1");
  assert.equal(kv.before_evidence_id, `${eid}-before`);
  assert.equal(kv.after_evidence_id, eid);
  assert.equal(kv.ledger_evidence_id, `${RUN}-outward-ledger`);
  assert.ok(existsSync(join(ctx.evidence, `${eid}-before.png`)), "点击前截图必须落盘");
  assert.ok(existsSync(join(ctx.evidence, `${eid}.png`)), "点击后截图必须落盘");
  const rows = ledger(ctx);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].event, "attempt");
  assert.equal(rows[0].run_id, RUN);
  assert.equal(rows[0].action, "publish");
  assert.equal(rows[0].action_seq, 1);
  assert.equal(rows[0].seq, 1);
  assert.equal(rows[0].x, 600);
  assert.equal(rows[0].y, 2400);
  assert.equal(rows[0].before_evidence_id, `${eid}-before`);
  assert.ok(rows[0].at && rows[0].at_epoch_ms > 0, "必须带时间");
  assert.equal(rows[1].event, "result");
  assert.equal(rows[1].attempt_seq, 1);
  assert.equal(rows[1].tapped, "yes");
  assert.equal(rows[1].evidence, "ok");
  assert.equal(rows[1].after_evidence_id, eid);
});

test("同 run 同动作第二次 → 默认拒绝不点击，拒绝也记账，且账本只追加（前文字节不变）", async () => {
  const ctx = setup();
  const first = await run(ctx, ["tap-evidence", "600", "2400", `${RUN}-07-publish`, "--outward", "publish"]);
  assert.equal(first.code, 0, `err=${first.err}`);
  const before = readFileSync(ledgerPath(ctx), "utf8");
  const r = await run(ctx, ["tap-evidence", "600", "2400", `${RUN}-08-publish`, "--outward", "publish"]);
  assert.equal(r.code, 2, "重复对外动作必须失败退出");
  assert.match(r.out, /^outward=fail class=fatal reason=repeat_refused action=publish prior_attempts=1 tapped=no/m);
  assert.deepEqual(taps(ctx), ["600,2400"], "第二次绝不能点击");
  const after = readFileSync(ledgerPath(ctx), "utf8");
  assert.ok(after.startsWith(before), "账本只追加：已有内容不得被改写");
  const rows = ledger(ctx);
  assert.equal(rows.length, 3);
  assert.equal(rows[2].event, "refused");
  assert.equal(rows[2].reason, "repeat_refused");
  assert.deepEqual(rows[2].prior_attempt_seqs, [1]);
  assert.ok(!existsSync(join(ctx.evidence, `${RUN}-08-publish-before.png`)), "被拒时不碰设备");
});

test("--allow-repeat 显式放行第二次，action_seq=2，且 attempt 行标明 allow_repeat", async () => {
  const ctx = setup();
  await run(ctx, ["tap-evidence", "600", "2400", `${RUN}-07-publish`, "--outward", "publish"]);
  const r = await run(ctx, ["tap-evidence", "--outward", "publish", "--allow-repeat", "610", "2410", `${RUN}-09-publish`]);
  assert.equal(r.code, 0, `err=${r.err}`);
  assert.equal(parse(lineWith(r.out, "outward")).action_seq, "2");
  assert.equal(taps(ctx).length, 2);
  const attempts = ledger(ctx).filter((x) => x.event === "attempt");
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1].allow_repeat, true);
  assert.equal(attempts[1].action_seq, 2);
});

test("不同动作互不影响：publish 之后 like 照常放行", async () => {
  const ctx = setup();
  await run(ctx, ["tap-evidence", "600", "2400", `${RUN}-07-publish`, "--outward", "publish"]);
  const r = await run(ctx, ["tap-evidence", "100", "200", `${RUN}-10-like`, "--outward", "like"]);
  assert.equal(r.code, 0, `err=${r.err}`);
  assert.equal(taps(ctx).length, 2);
});

test("同一 run 的不同 attempt 后缀（-a2-retry-1）共用一本账：重试不能绕过去重", async () => {
  const ctx = setup();
  await run(ctx, ["tap-evidence", "600", "2400", `${RUN}-07-publish`, "--outward", "publish"]);
  const r = await run(ctx, ["tap-evidence", "600", "2400", `${RUN}-08-publish`, "--outward", "publish"], {}, { owner: `${RUN}-a2-retry-1` });
  assert.equal(r.code, 2);
  assert.match(r.out, /reason=repeat_refused/);
  assert.equal(taps(ctx).length, 1);
});

test("--outward 未带 --lock-owner → lock_owner_required，不点击", async () => {
  const ctx = setup();
  const r = await run(ctx, ["tap-evidence", "600", "2400", `${RUN}-07-publish`, "--outward", "publish"], {}, { owner: null });
  assert.equal(r.code, 2);
  assert.match(r.out, /^outward=fail class=fatal reason=lock_owner_required/m);
  assert.equal(taps(ctx).length, 0);
});

test("--outward 锁被别的 run 持有 → lock_not_held，不点击", async () => {
  const ctx = setup({ lockOwner: "other-run-123" });
  const r = await run(ctx, ["tap-evidence", "600", "2400", `${RUN}-07-publish`, "--outward", "publish"]);
  assert.equal(r.code, 2);
  assert.match(r.out, /reason=lock_not_held/);
  assert.equal(taps(ctx).length, 0);
});

test("证据 ID 带发布语义（<run>-NN-publish）却没标 --outward → 拒绝，不点击", async () => {
  const ctx = setup();
  const r = await run(ctx, ["tap-evidence", "600", "2400", `${RUN}-07-publish`], {}, { owner: null });
  assert.equal(r.code, 2);
  assert.match(r.out, /reason=outward_flag_required/);
  assert.equal(taps(ctx).length, 0);
});

test("tap / tap-snapshot 不接受 --outward（对外动作必须留前后证据）", async () => {
  const ctx = setup();
  for (const cmd of ["tap", "tap-snapshot"]) {
    const r = await run(ctx, [cmd, "600", "2400", "--outward", "publish"]);
    assert.equal(r.code, 2, cmd);
    assert.match(r.out, /reason=outward_requires_evidence/, cmd);
  }
  assert.equal(taps(ctx).length, 0);
});

test("locate-tap --outward：账本记录控件描述与定位坐标", async () => {
  const ctx = setup();
  const desc = Buffer.from("底部红色「发布」按钮").toString("base64");
  const r = await run(ctx, ["locate-tap", desc, `${RUN}-11-send`, "--outward", "send"]);
  assert.equal(r.code, 0, `err=${r.err}`);
  assert.deepEqual(taps(ctx), ["321,654"]);
  const att = ledger(ctx).find((x) => x.event === "attempt");
  assert.equal(att.command, "locate-tap");
  assert.equal(att.control, "底部红色「发布」按钮");
  assert.equal(att.x, 321);
  assert.equal(att.y, 654);
  assert.equal(parse(lineWith(r.out, "outward")).outward, "ok");
});

test("outward-ledger RUN 只读输出账本 JSON（含 sha256 与按动作汇总），不需要持锁、不碰设备", async () => {
  const ctx = setup();
  await run(ctx, ["tap-evidence", "600", "2400", `${RUN}-07-publish`, "--outward", "publish"]);
  await run(ctx, ["tap-evidence", "600", "2400", `${RUN}-08-publish`, "--outward", "publish"]);
  const callsBefore = readFileSync(join(ctx.state, "calls.log"), "utf8");
  const r = await run(ctx, ["outward-ledger", RUN], {}, { owner: null });
  assert.equal(r.code, 0, `err=${r.err}`);
  const doc = JSON.parse(r.out);
  assert.equal(doc.run_id, RUN);
  assert.equal(doc.exists, true);
  assert.equal(doc.evidence_id, `${RUN}-outward-ledger`);
  assert.equal(doc.entries.length, 3);
  assert.equal(doc.summary.attempts_by_action.publish, 1);
  assert.equal(doc.summary.refused_by_action.publish, 1);
  assert.match(doc.sha256, /^[0-9a-f]{64}$/);
  assert.equal(readFileSync(join(ctx.state, "calls.log"), "utf8"), callsBefore, "只读命令不得调用 adb");
});

test("outward-ledger 账本不存在 → exists=false，退出码 0", async () => {
  const ctx = setup();
  const r = await run(ctx, ["outward-ledger", "never-ran-run"], {}, { owner: null });
  assert.equal(r.code, 0, `err=${r.err}`);
  const doc = JSON.parse(r.out);
  assert.equal(doc.exists, false);
  assert.deepEqual(doc.entries, []);
});

// ── tap-evidence 等待上限 / 取证超时 ───────────────────────────────────

test("tap-evidence WAIT_MS=5681（旧上限 5000）现在正常完成，不再报参数错误", async () => {
  const ctx = setup();
  const r = await run(ctx, ["tap-evidence", "600", "2400", "probe-wait-1", "5681"], {}, { owner: null });
  assert.equal(r.code, 0, `err=${r.err}`);
  assert.equal(taps(ctx).length, 1);
  assert.match(r.out, /probe-wait-1\.png/);
});

test("WAIT_MS 超过可配置上限 → 点击前就拒绝（tapped=no），绝不先点后报错", async () => {
  const ctx = setup();
  const r = await run(ctx, ["tap-evidence", "600", "2400", "probe-wait-2", "400"], { DOUYIN_TAP_WAIT_MAX_MS: "300" }, { owner: null });
  assert.equal(r.code, 2);
  assert.match(r.out, /^tap_evidence=fail class=fatal reason=wait_over_limit tapped=no/m);
  assert.equal(taps(ctx).length, 0, "参数错误必须发生在点击之前");
});

test("点击已发生、取证超时 → 退出码 3 + tapped=yes evidence=timeout，并已记入对外动作账", async () => {
  const ctx = setup();
  const eid = `${RUN}-07-publish`;
  const t0 = Date.now();
  const r = await run(ctx, ["tap-evidence", "600", "2400", eid, "100", "--outward", "publish"], {
    FAKE_HANG_AFTER_TAP: "1", DOUYIN_TAP_EVIDENCE_TIMEOUT_MS: "1500",
  });
  assert.ok(Date.now() - t0 < 20000, "取证超时必须有界返回");
  assert.equal(r.code, 3, `out=${r.out} err=${r.err}`);
  const kv = parse(lineWith(r.out, "tap_evidence"));
  assert.equal(kv.tap_evidence, "partial");
  assert.equal(kv.tapped, "yes");
  assert.equal(kv.evidence, "timeout");
  assert.match(r.err, /failure_class=evidence_timeout/);
  assert.equal(taps(ctx).length, 1);
  const rows = ledger(ctx);
  assert.equal(rows[0].event, "attempt");
  assert.equal(rows[1].event, "result");
  assert.equal(rows[1].tapped, "yes");
  assert.equal(rows[1].evidence, "timeout");
  // 执行者若再按退出码重试，账本挡住重复发布
  const again = await run(ctx, ["tap-evidence", "600", "2400", `${RUN}-08-publish`, "--outward", "publish"]);
  assert.equal(again.code, 2);
  assert.equal(taps(ctx).length, 1, "取证超时后重试绝不能再点一次");
});

test("非对外 tap-evidence 取证超时同样退出码 3 + tapped=yes evidence=timeout（不再是参数错误）", async () => {
  const ctx = setup();
  const r = await run(ctx, ["tap-evidence", "600", "2400", "probe-hang-1", "100"], {
    FAKE_HANG_AFTER_TAP: "1", DOUYIN_TAP_EVIDENCE_TIMEOUT_MS: "1500",
  }, { owner: null });
  assert.equal(r.code, 3, `out=${r.out} err=${r.err}`);
  assert.match(r.out, /^tap_evidence=partial tapped=yes evidence=timeout/m);
});

// ── 锁回执证据 ─────────────────────────────────────────────────────────

test("lock-acquire 成功：写 <run>-lock-acquire.json（时间/owner/回读原文），stdout 首行不变并打印证据 ID", async () => {
  const ctx = setup({ lockOwner: null });
  const r = await run(ctx, ["lock-acquire", RUN], {}, { owner: null });
  assert.equal(r.code, 0, `err=${r.err}`);
  assert.equal(r.out.split("\n")[0], `lock=acquired owner=${RUN}`, "首行保持原样（leadgen-workflow 按首行判）");
  const kv = parse(lineWith(r.out, "lock_evidence_id"));
  assert.equal(kv.lock_evidence_id, `${RUN}-lock-acquire`);
  const doc = JSON.parse(readFileSync(join(ctx.evidence, `${RUN}-lock-acquire.json`), "utf8"));
  assert.equal(doc.evidence_id, `${RUN}-lock-acquire`);
  assert.equal(doc.kind, "acquire");
  assert.equal(doc.run_id, RUN);
  const ev = doc.events.at(-1);
  assert.equal(ev.result, "ok");
  assert.equal(ev.rc, 0);
  assert.equal(ev.receipt, `lock=acquired owner=${RUN}`);
  assert.match(ev.readback, new RegExp(`^lock=held owner=${RUN} `));
  assert.equal(ev.readback_state, "held");
  assert.equal(ev.readback_owner, RUN);
  assert.ok(ev.at && ev.at_epoch_ms > 0);
});

test("lock-release 成功：写 <run>-lock-release.json，回读原文 lock=free", async () => {
  const ctx = setup();
  const r = await run(ctx, ["lock-release", RUN], {}, { owner: null });
  assert.equal(r.code, 0, `err=${r.err}`);
  assert.ok(r.out.startsWith(`lock=released owner=${RUN}`), r.out);
  assert.equal(parse(lineWith(r.out, "lock_evidence_id")).lock_evidence_id, `${RUN}-lock-release`);
  const ev = JSON.parse(readFileSync(join(ctx.evidence, `${RUN}-lock-release.json`), "utf8")).events.at(-1);
  assert.equal(ev.result, "ok");
  assert.equal(ev.readback, "lock=free");
  assert.equal(ev.readback_state, "free");
});

test("lock-acquire 失败（被别的 run 持有）也写回执：result=fail + 回读到真实持有者", async () => {
  const ctx = setup({ lockOwner: "other-run-123" });
  const r = await run(ctx, ["lock-acquire", RUN], {}, { owner: null });
  assert.notEqual(r.code, 0);
  assert.equal(parse(lineWith(r.out, "lock_evidence_id")).lock_evidence_id, `${RUN}-lock-acquire`);
  const ev = JSON.parse(readFileSync(join(ctx.evidence, `${RUN}-lock-acquire.json`), "utf8")).events.at(-1);
  assert.equal(ev.result, "fail");
  assert.notEqual(ev.rc, 0);
  assert.match(ev.stderr, /held by another run/);
  assert.equal(ev.readback_owner, "other-run-123");
});

test("同一 run 多次拿锁 → 回执事件追加，不覆盖前一次", async () => {
  const ctx = setup({ lockOwner: null });
  await run(ctx, ["lock-acquire", RUN], {}, { owner: null });
  await run(ctx, ["lock-acquire", RUN], {}, { owner: null });
  const doc = JSON.parse(readFileSync(join(ctx.evidence, `${RUN}-lock-acquire.json`), "utf8"));
  assert.equal(doc.events.length, 2);
  assert.equal(doc.events[0].seq, 1);
  assert.equal(doc.events[1].seq, 2);
  assert.match(doc.events[1].receipt, /idempotent=true/);
});

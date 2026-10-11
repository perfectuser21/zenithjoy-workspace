// 旁路报警执行机侧（派发总闸 H，Brain 任务 865b502c）回归测试。
// 契约：动手机的公共入口 douyin-phone-adb 在①领锁成功 ②对外动作（--outward）点击前，旁路调用 bypass-report.sh
//      把「谁（run/持有者）在哪台手机做了什么」上报 Brain；是否关联 Brain 任务由 Brain 侧判定，只记旁路。
//      上报在后台跑、Brain 不可用/没配置一律吞掉，绝不阻塞或改变原命令结果（先只告警不拦截）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, chmodSync, mkdirSync, readFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const HERE = new URL(".", import.meta.url).pathname;
const SCRIPT = new URL("../douyin-phone-adb", import.meta.url).pathname;
const REPORTER = new URL("../bypass-report.sh", import.meta.url).pathname;
const RUN = "manual-bypass-probe-1012";
const PYTHON = spawnSync("sh", ["-c", "command -v python3"], { encoding: "utf8" }).stdout.trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FAKE_ADB = `#!/usr/bin/env node
const fs = require("fs"), path = require("path");
const S = process.env.STATE_DIR;
let a = process.argv.slice(2);
if (a[0] === "-s") a = a.slice(2);
const out = (s) => process.stdout.write(s);
if (a[0] === "get-state") { out("device\\n"); process.exit(0); }
if (a[0] === "pull") { fs.writeFileSync(a[2], "PNGDATA"); process.exit(0); }
if (a[0] !== "shell") process.exit(0);
const sh = a.slice(1);
if (sh.join(" ").startsWith("getprop ro.product.model")) { out("ANY-MODEL\\n"); process.exit(0); }
if (sh[0] === "input" && sh[1] === "tap") fs.appendFileSync(path.join(S, "tapped"), sh[2] + "," + sh[3] + "\\n");
process.exit(0);
`;
const FAKE_SIPS = `#!/bin/sh
for last; do :; done
printf jpg > "$last"
`;
// 假上报器：把参数逐行写进 STATE_DIR/reports.log
const FAKE_REPORTER = `#!/bin/bash
printf '%s\\n' "$*" >> "$STATE_DIR/reports.log"
`;

function setup({ lockOwner = RUN } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bypass-"));
  const state = join(dir, "state");
  mkdirSync(state, { recursive: true });
  const reg = join(dir, "r.tsv");
  writeFileSync(reg, "legacy\tSER1\tANY-MODEL\t1199\t2663\n");
  const adb = join(dir, "fake-adb"); writeFileSync(adb, FAKE_ADB); chmodSync(adb, 0o755);
  const sips = join(dir, "fake-sips"); writeFileSync(sips, FAKE_SIPS); chmodSync(sips, 0o755);
  const reporter = join(dir, "fake-reporter.sh"); writeFileSync(reporter, FAKE_REPORTER); chmodSync(reporter, 0o755);
  const tmpRoot = join(dir, "tmp");
  if (lockOwner) {
    const lock = join(tmpRoot, "locks", "SER1.lock");
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, "owner"), lockOwner + "\n");
    writeFileSync(join(lock, "acquired_at"), String(Math.floor(Date.now() / 1000) - 10) + "\n");
  }
  return { dir, state, reg, adb, sips, reporter, tmpRoot };
}

function run(ctx, args, { owner = RUN, env = {} } = {}) {
  const pre = owner ? ["--lock-owner", owner] : [];
  return new Promise((resolve) => {
    const p = spawn("zsh", [SCRIPT, "--profile", "legacy", ...pre, ...args], {
      env: {
        ...process.env, STATE_DIR: ctx.state, DOUYIN_PHONE_REGISTRY: ctx.reg, DOUYIN_ADB_BIN: ctx.adb,
        DOUYIN_PHONE_TMP_ROOT: ctx.tmpRoot, DOUYIN_PYTHON_BIN: PYTHON, DOUYIN_SIPS_BIN: ctx.sips,
        DOUYIN_BYPASS_REPORT_BIN: ctx.reporter, ...env,
      },
    });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("close", (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}

async function reports(ctx, want = 1) {
  const p = join(ctx.state, "reports.log");
  for (let i = 0; i < 50; i++) {
    if (existsSync(p)) {
      const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
      if (lines.length >= want) return lines;
    }
    await sleep(100);
  }
  return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean) : [];
}

test("前置：zsh 与 python3 可用", () => {
  assert.equal(spawnSync("zsh", ["-c", "exit 0"]).error, undefined, "没有 zsh");
  assert.ok(PYTHON, "没有 python3");
});

test("tap-evidence --outward：点击前上报 phone_outward（设备/持有者 run/动作/命令），原命令结果不变", async () => {
  const ctx = setup();
  const r = await run(ctx, ["tap-evidence", "600", "2400", `${RUN}-07-publish`, "--outward", "publish"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /outward=ok action=publish/);
  const lines = await reports(ctx);
  assert.deepEqual(lines, [`phone_outward SER1 ${RUN} publish tap-evidence`]);
});

test("非对外 tap-evidence 不上报", async () => {
  const ctx = setup();
  const r = await run(ctx, ["tap-evidence", "600", "2400", `${RUN}-03-open`]);
  assert.equal(r.code, 0, r.err);
  await sleep(500);
  assert.equal(existsSync(join(ctx.state, "reports.log")), false);
});

test("lock-acquire 成功：上报 phone_lock（持有者 = 归一后的 run）", async () => {
  const ctx = setup({ lockOwner: null });
  const r = await run(ctx, ["lock-acquire", `${RUN}:a1`], { owner: null });
  assert.equal(r.code, 0, r.err);
  const lines = await reports(ctx);
  assert.deepEqual(lines, [`phone_lock SER1 ${RUN} lock-acquire lock-acquire`]);
});

test("lock-acquire 被别的 run 持有：不上报（没动到手机）", async () => {
  const ctx = setup({ lockOwner: "other-run-1012" });
  const r = await run(ctx, ["lock-acquire", RUN], { owner: null });
  assert.notEqual(r.code, 0);
  await sleep(500);
  assert.equal(existsSync(join(ctx.state, "reports.log")), false);
});

test("上报器缺失或被关（DOUYIN_BYPASS_REPORT=off）：原命令照常成功", async () => {
  const ctx = setup();
  const r1 = await run(ctx, ["tap-evidence", "600", "2400", `${RUN}-07-publish`, "--outward", "publish"], { env: { DOUYIN_BYPASS_REPORT_BIN: "/nonexistent/bypass-report.sh" } });
  assert.equal(r1.code, 0, r1.err);
  const ctx2 = setup();
  const r2 = await run(ctx2, ["tap-evidence", "600", "2400", `${RUN}-07-publish`, "--outward", "publish"], { env: { DOUYIN_BYPASS_REPORT: "off" } });
  assert.equal(r2.code, 0, r2.err);
  await sleep(500);
  assert.equal(existsSync(join(ctx2.state, "reports.log")), false);
});

// ── bypass-report.sh 本体 ─────────────────────────────────────────────

function reporterEnv() {
  const home = mkdtempSync(join(tmpdir(), "bpr-"));
  const bin = join(home, "bin"); mkdirSync(bin);
  const brain = join(home, "brain"); mkdirSync(brain);
  copyFileSync(join(HERE, "fixtures", "fake-brain-curl.sh"), join(bin, "curl")); chmodSync(join(bin, "curl"), 0o755);
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, FAKE_BRAIN_DIR: brain,
    BRAIN_URL: "http://brain.test", BRAIN_INTERNAL_TOKEN: "tok", BRAIN_LOCK_ENV: "/nonexistent" };
  const calls = () => { const p = join(brain, "calls.log"); return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean) : []; };
  return { env, brain, calls };
}

test("bypass-report.sh：POST /api/brain/bypass-actions/report，带 kind/设备/持有者/动作/命令/主机/鉴权与环境里的 Brain 任务号", () => {
  const c = reporterEnv();
  const r = spawnSync("/bin/bash", [REPORTER, "phone_outward", "SER1", RUN, "publish", "tap-evidence"],
    { encoding: "utf8", env: { ...c.env, BRAIN_TASK_ID: "865b502c-ea72-45e6-b00f-d60fe8c922f2", BRAIN_RUN_ID: "qiumi-865b502c-1791400000000" } });
  assert.equal(r.status, 0, r.stderr);
  const [line] = c.calls();
  assert.ok(line, "必须发出一次上报");
  const [verb, auth, body] = line.split("\t");
  assert.equal(verb, "bypass-report");
  assert.equal(auth, "Authorization: Bearer tok");
  const j = JSON.parse(body);
  assert.equal(j.kind, "phone_outward");
  assert.equal(j.device, "SER1");
  assert.equal(j.owner, RUN);
  assert.equal(j.action, "publish");
  assert.equal(j.command, "tap-evidence");
  assert.equal(j.task_id, "865b502c-ea72-45e6-b00f-d60fe8c922f2");
  assert.equal(j.run_id, "qiumi-865b502c-1791400000000");
  assert.equal(j.source, "phone-adb-controller");
  assert.ok(j.host, "带主机名");
});

test("bypass-report.sh：Brain 连不上 / 没配 BRAIN_URL → 静默退出 0（绝不影响调用方）", () => {
  const c = reporterEnv();
  writeFileSync(join(c.brain, "down"), "");
  const r1 = spawnSync("/bin/bash", [REPORTER, "phone_lock", "SER1", RUN, "lock-acquire", "lock-acquire"], { encoding: "utf8", env: c.env });
  assert.equal(r1.status, 0);
  const r2 = spawnSync("/bin/bash", [REPORTER, "phone_lock", "SER1", RUN, "lock-acquire", "lock-acquire"], { encoding: "utf8", env: { ...c.env, BRAIN_URL: "" } });
  assert.equal(r2.status, 0);
  assert.equal(c.calls().length, 0);
});

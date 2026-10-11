// brain-lock.sh / harvest-fallback.sh 回归测试（派发总闸D「止血」，Brain 任务 dd7767b8）。
// 背景：xian-m4 crontab 的触达 tick 与采收保底只认本机 mkdir 锁 / pgrep，Brain 派下来的手机活看不见它们，
//       它们也看不见 Brain 的设备锁——同一台手机可能被两路同时操作。
// 本测试钉死：①领锁/放锁协议（owner 必带、只放自己的锁）②被占 → 不起命令 ③Brain 不可用 → 降级放行（不停业务）
//            ④run 包装器无论正常结束、命令失败还是被 TERM，都必须放锁 ⑤采收保底以 Brain 锁为准、pgrep 留第二道。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, chmodSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
const PY = spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).stdout.trim();
const SKIP = (!ZSH && "no zsh (CI: sudo apt-get install -y zsh)") || (!PY && "no python3");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setup() {
  const home = mkdtempSync(join(tmpdir(), "bdl-"));
  const bin = join(home, ".local", "bin");
  const brain = join(home, "brain");
  const app = join(home, "bin-harvest");
  for (const d of [bin, brain, app]) mkdirSync(d, { recursive: true });
  copyFileSync(join(HERE, "fixtures", "fake-brain-curl.sh"), join(bin, "curl"));
  chmodSync(join(bin, "curl"), 0o755);
  for (const f of ["brain-lock.sh", "harvest-fallback.sh"]) {
    if (existsSync(join(SRC, f))) { copyFileSync(join(SRC, f), join(app, f)); chmodSync(join(app, f), 0o755); }
  }
  const env = {
    ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, FAKE_BRAIN_DIR: brain,
    BRAIN_URL: "http://brain.test", BRAIN_INTERNAL_TOKEN: "tok", BRAIN_LOCK_ENV: "/nonexistent",
  };
  const calls = () => { const p = join(brain, "calls.log"); return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean) : []; };
  const lock = (...args) => spawnSync("/bin/bash", [join(app, "brain-lock.sh"), ...args], { encoding: "utf8", env, timeout: 30000 });
  return { home, bin, brain, app, env, calls, lock };
}

test("acquire 领到锁：退出 0、输出 BRAIN_LOCK=acquired，请求带 owner/TTL/鉴权", { skip: SKIP }, () => {
  const c = setup();
  const r = c.lock("acquire", "SER1", "outreach-tick:m4:20261011T2100:123", "15");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /BRAIN_LOCK=acquired/);
  assert.deepEqual(c.calls(), ["acquire SER1 outreach-tick:m4:20261011T2100:123 15 Authorization: Bearer tok"]);
});

test("acquire 被别的 run 持有：退出 1、报出持有者，不抢锁", { skip: SKIP }, () => {
  const c = setup();
  writeFileSync(join(c.brain, "busy-SER1"), "6f1c2d3e-0000-4000-8000-000000000001");
  const r = c.lock("acquire", "SER1", "outreach-tick:x", "15");
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /BRAIN_LOCK=busy/);
  assert.match(r.stdout, /BRAIN_LOCK_HOLDER=6f1c2d3e-0000-4000-8000-000000000001/);
});

test("Brain 连不上 / 设备未注册 / 没配 BRAIN_URL：退出 2（调用方降级放行，不停业务）", { skip: SKIP }, () => {
  const c = setup();
  writeFileSync(join(c.brain, "down"), "");
  let r = c.lock("acquire", "SER1", "o", "15");
  assert.equal(r.status, 2); assert.match(r.stdout, /BRAIN_LOCK=unavailable/);
  const c2 = setup();
  writeFileSync(join(c2.brain, "unknown-SER9"), "");
  r = c2.lock("acquire", "SER9", "o", "15");
  assert.equal(r.status, 2); assert.match(r.stdout, /BRAIN_LOCK=unavailable/); assert.match(r.stdout, /404/);
  const c3 = setup();
  r = spawnSync("/bin/bash", [join(c3.app, "brain-lock.sh"), "acquire", "SER1", "o"], { encoding: "utf8", env: { ...c3.env, BRAIN_URL: "" } });
  assert.equal(r.status, 2); assert.match(r.stdout, /BRAIN_LOCK=unavailable/);
  assert.deepEqual(c3.calls(), [], "没配 BRAIN_URL 不发请求");
});

test("release 只放自己的锁：本 owner → 0；别人的锁 → 1（不接管）", { skip: SKIP }, () => {
  const c = setup();
  assert.equal(c.lock("acquire", "SER1", "me", "15").status, 0);
  const other = c.lock("release", "SER1", "someone-else");
  assert.equal(other.status, 1); assert.match(other.stdout, /BRAIN_LOCK=not_held/);
  assert.ok(existsSync(join(c.brain, "held-SER1")), "别人 release 不得放掉");
  const mine = c.lock("release", "SER1", "me");
  assert.equal(mine.status, 0); assert.match(mine.stdout, /BRAIN_LOCK=released/);
  assert.ok(!existsSync(join(c.brain, "held-SER1")));
});

test("acquire 缺参数：退出 64，不发请求", { skip: SKIP }, () => {
  const c = setup();
  assert.equal(c.lock("acquire", "SER1").status, 64);
  assert.deepEqual(c.calls(), []);
});

test("run 包装：领到锁 → 执行命令 → 结束放锁；命令退出码原样透传", { skip: SKIP }, () => {
  const c = setup();
  const r = c.lock("run", "SER1", "harvest-fallback:t", "--ttl", "15", "--interval", "60", "--", "/bin/sh", "-c", `echo ran > ${c.home}/ran; exit 3`);
  assert.equal(r.status, 3, r.stderr + r.stdout);
  assert.ok(existsSync(join(c.home, "ran")));
  const calls = c.calls();
  assert.match(calls[0], /^acquire SER1 harvest-fallback:t 15/);
  assert.match(calls.at(-1), /^release SER1 harvest-fallback:t/);
  assert.ok(!existsSync(join(c.brain, "held-SER1")), "锁必须放掉");
});

test("run 包装：锁被占 → 不执行命令、退出 0（本轮跳过）", { skip: SKIP }, () => {
  const c = setup();
  writeFileSync(join(c.brain, "busy-SER1"), "outreach-tick:m4:x");
  const r = c.lock("run", "SER1", "harvest-fallback:t", "--", "/bin/sh", "-c", `echo ran > ${c.home}/ran`);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(join(c.home, "ran")), "被占时不得动手机");
  assert.match(r.stdout + r.stderr, /被占/);
  assert.ok(!c.calls().some((l) => l.startsWith("release")), "没领到锁不调 release");
});

test("run 包装：Brain 不可用 → 降级照跑（不停业务）", { skip: SKIP }, () => {
  const c = setup();
  writeFileSync(join(c.brain, "down"), "");
  const r = c.lock("run", "SER1", "harvest-fallback:t", "--", "/bin/sh", "-c", `echo ran > ${c.home}/ran`);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(c.home, "ran")));
});

test("run 包装：--skip-if-pgrep 命中（第二道判重）→ 不执行命令，并放掉刚领的锁", { skip: SKIP }, () => {
  const c = setup();
  const sleeper = spawn("/bin/sh", ["-c", "sleep 30; : bdl-pgrep-marker-777"], { stdio: "ignore" });
  try {
    const r = c.lock("run", "SER1", "harvest-fallback:t", "--skip-if-pgrep", "bdl-pgrep-marker-777", "--", "/bin/sh", "-c", `echo ran > ${c.home}/ran`);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!existsSync(join(c.home, "ran")));
    assert.match(c.calls().at(-1), /^release SER1 harvest-fallback:t/);
  } finally { sleeper.kill("SIGKILL"); }
});

test("run 包装：被 TERM 异常退出也必须放锁（trap），并把信号转给子命令", { skip: SKIP }, async () => {
  const c = setup();
  const child = spawn("/bin/bash", [join(c.app, "brain-lock.sh"), "run", "SER1", "harvest-fallback:t", "--interval", "1", "--", "/bin/sh", "-c", `echo $$ > ${c.home}/child.pid; exec sleep 30`], { env: c.env, stdio: "ignore" });
  for (let i = 0; i < 100 && !existsSync(join(c.home, "child.pid")); i++) await sleep(100);
  assert.ok(existsSync(join(c.brain, "held-SER1")), "运行中持有锁");
  child.kill("SIGTERM");
  await new Promise((r) => child.on("exit", r));
  assert.ok(!existsSync(join(c.brain, "held-SER1")), "TERM 后锁必须放掉");
  const pid = Number(readFileSync(join(c.home, "child.pid"), "utf8"));
  let alive = true;
  for (let i = 0; i < 30 && alive; i++) { try { process.kill(pid, 0); await sleep(100); } catch { alive = false; } }
  assert.equal(alive, false, "子命令应随包装器一起收掉，不能无锁裸跑");
});

test("run 包装：长跑期间心跳续租（同 owner 重复 acquire 刷新 TTL），放锁在最后", { skip: SKIP }, () => {
  const c = setup();
  const r = c.lock("run", "SER1", "harvest-fallback:t", "--ttl", "15", "--interval", "1", "--", "/bin/sh", "-c", "sleep 3");
  assert.equal(r.status, 0, r.stderr);
  const acquires = c.calls().filter((l) => l.startsWith("acquire SER1 harvest-fallback:t"));
  assert.ok(acquires.length >= 2, `应有心跳续租，实际 acquire 次数=${acquires.length}`);
  assert.match(c.calls().at(-1), /^release SER1 harvest-fallback:t/);
  assert.ok(!existsSync(join(c.brain, "held-SER1")));
});

test("harvest-fallback.sh：以 Brain 锁为准——锁被占不起采收；领到锁才起采收并在结束放锁", { skip: SKIP }, () => {
  const c = setup();
  writeFileSync(join(c.app, "harvest-cron.sh"), `#!/bin/zsh\necho "$@" >> ${c.home}/harvest-args\n`);
  chmodSync(join(c.app, "harvest-cron.sh"), 0o755);
  writeFileSync(join(c.brain, "busy-ANGYVB4227006983"), "qiumi-task-uuid");
  const run = () => spawnSync(ZSH, [join(c.app, "harvest-fallback.sh"), "jinoshengyuan-work", "ANGYVB4227006983", "AI人工智能训练师", "6", "1"], { encoding: "utf8", env: c.env, timeout: 30000 });
  let r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(join(c.home, "harvest-args")), "锁被占不得起采收");
  assert.match(readFileSync(join(c.home, "harvest-cron.log"), "utf8"), /保底.*跳过/);
  rmSync(join(c.brain, "busy-ANGYVB4227006983"));
  r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(c.home, "harvest-args"), "utf8").trim(), "jinoshengyuan-work ANGYVB4227006983 AI人工智能训练师 6 1");
  const calls = c.calls();
  assert.ok(calls.some((l) => /^acquire ANGYVB4227006983 harvest-fallback:/.test(l)));
  assert.match(calls.at(-1), /^release ANGYVB4227006983 harvest-fallback:/);
});

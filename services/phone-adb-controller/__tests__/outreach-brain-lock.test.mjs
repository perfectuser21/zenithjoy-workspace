// outreach-tick.sh × Brain 设备锁回归测试（派发总闸D「止血」，Brain 任务 dd7767b8）。
// 事故面：触达 tick 每 30 分钟在 xian-m4 真机给真实客户发抖音私信，只认本机 mkdir 锁，Brain 派下来的手机活
//        （秋米任务/调度单）看不见它，它也看不见 Brain 的锁——同一台手机两路同时操作。
// 钉死：①动手机前按手机领 Brain 锁（owner=outreach-tick:<机器>:<时间>:<pid>）②某台被占 → 本轮不选它（--exclude）
//      ③全部被占 → 本轮跳过：不取单、不动手机，并在 Brain 执行记录里留 skip 证据 ④收工/异常退出（TERM）都放锁
//      ⑤Brain 不可用 → 降级照发（不停业务，本机锁仍生效）⑥执行记录（发私信 span）带锁领取/释放证据。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, chmodSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
const PY = spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).stdout.trim();
const SKIP = (!ZSH && "no zsh (CI: sudo apt-get install -y zsh)") || (!PY && "no python3");
const S_WORK = "ANGYVB4227006983";
const S_LEGACY = "ANGYVB4402004137";

const FAKE_SSH = `#!/bin/sh
printf '%s\\n' "$*" >> "$HOME/ssh-calls.log"
case "$*" in
  *notify-bark.js*) echo BARK_OK;;
  *"next-outreach.js next"*)
    if [ -f "$HOME/kill-on-next" ]; then kill -TERM "$(cat "$OUTREACH_TICK_LOCK/pid")"; sleep 1; fi
    echo NO_PENDING;;
  *"next-outreach.js done"*) echo "MARKED ok";;
esac
exit 0`;
const FAKE_ADB = `#!/bin/sh
echo "$*" >> "$HOME/adb-calls.log"
exit 0`;
const FAKE_WFR = `#!/bin/bash
printf '%s\\n' "$8" >> "$HOME/wfr-counts.log"
echo WFR_RUN_ID=fake`;

function setup() {
  const home = mkdtempSync(join(tmpdir(), "obl-"));
  const bin = join(home, ".local", "bin");
  const brain = join(home, "brain");
  const tick = join(home, "tick");
  for (const d of [bin, brain, join(tick, "config"), join(tick, "state")]) mkdirSync(d, { recursive: true });
  for (const f of ["outreach-tick.sh", "dm-daily-cap.js", "dm-rate-ramp-lib.js", "brain-lock.sh"]) {
    if (existsSync(join(SRC, f))) copyFileSync(join(SRC, f), join(tick, f));
  }
  if (existsSync(join(tick, "brain-lock.sh"))) chmodSync(join(tick, "brain-lock.sh"), 0o755);
  writeFileSync(join(tick, "config", "dm-rate-ramp.json"), "{}");
  writeFileSync(join(bin, "ssh"), FAKE_SSH); chmodSync(join(bin, "ssh"), 0o755);
  writeFileSync(join(bin, "douyin-phone-adb"), FAKE_ADB); chmodSync(join(bin, "douyin-phone-adb"), 0o755);
  copyFileSync(join(HERE, "fixtures", "fake-brain-curl.sh"), join(bin, "curl")); chmodSync(join(bin, "curl"), 0o755);
  writeFileSync(join(home, "wfr.sh"), FAKE_WFR); chmodSync(join(home, "wfr.sh"), 0o755);
  const registry = join(home, "profiles.tsv");
  writeFileSync(registry, [
    "#registry_version 2",
    "#profile\tserial\tmodel\twidth\theight\tnickname\thost\towner\trole\twechat\tenabled",
    `jinoshengyuan-work\t${S_WORK}\tMAA-AN00\t1200\t2664\t小蓝\txian-m4\t金诺\t生产\t-\ttrue`,
    `legacy\t${S_LEGACY}\tMAA-AN00\t1200\t2664\t小黄\txian-m4\t金诺\t研发\t-\ttrue`,
  ].join("\n") + "\n");
  const env = {
    ...process.env, HOME: home, OUTREACH_TICK_TESTING: "1", OUTREACH_TICK_LOCK: join(home, "tick.lock"), WALL_REPORT: "/nonexistent",
    DOUYIN_PHONE_REGISTRY: registry, FAKE_BRAIN_DIR: brain, BRAIN_URL: "http://brain.test", BRAIN_INTERNAL_TOKEN: "tok",
    BRAIN_LOCK_ENV: "/nonexistent", WFR: join(home, "wfr.sh"),
  };
  delete env.OUTREACH_TICK_SOURCED;
  const lines = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean) : []);
  return {
    home, brain, tick, env,
    tickRun() { return spawnSync(ZSH, [join(tick, "outreach-tick.sh")], { encoding: "utf8", env, timeout: 60000 }); },
    calls: () => lines(join(brain, "calls.log")),
    ssh: () => lines(join(home, "ssh-calls.log")),
    adb: () => lines(join(home, "adb-calls.log")),
    counts: () => lines(join(home, "wfr-counts.log")).map((l) => JSON.parse(l)),
    log: () => (existsSync(join(home, "outreach.log")) ? readFileSync(join(home, "outreach.log"), "utf8") : ""),
  };
}
const nextCalls = (c) => c.ssh().filter((l) => l.includes("next-outreach.js next"));

test("动手机前按手机领 Brain 锁，owner 写明 outreach-tick+机器+时间；收工两台都放锁", { skip: SKIP }, () => {
  const c = setup();
  const r = c.tickRun();
  assert.equal(r.status, 0, r.stderr);
  const calls = c.calls();
  const acq = calls.filter((l) => l.startsWith("acquire"));
  assert.equal(acq.length, 2, calls.join("\n"));
  assert.ok(acq.some((l) => l.startsWith(`acquire ${S_WORK} outreach-tick:`)));
  assert.ok(acq.some((l) => l.startsWith(`acquire ${S_LEGACY} outreach-tick:`)));
  const owner = acq[0].split(" ")[2];
  assert.match(owner, /^outreach-tick:[^:]+:\d{8}T\d{6}:\d+$/);
  assert.ok(calls.includes(`release ${S_WORK} ${owner} - Authorization: Bearer tok`));
  assert.ok(calls.includes(`release ${S_LEGACY} ${owner} - Authorization: Bearer tok`));
  assert.ok(!existsSync(join(c.brain, `held-${S_WORK}`)) && !existsSync(join(c.brain, `held-${S_LEGACY}`)), "收工后 Brain 锁必须全部放掉");
  assert.equal(nextCalls(c).length, 1, "领到锁照常取单");
});

test("执行记录带锁证据：每台手机 acquired→released、owner", { skip: SKIP }, () => {
  const c = setup();
  c.tickRun();
  const [counts] = c.counts();
  assert.ok(counts, "收工必须写一条执行记录");
  assert.equal(counts.brain_lock.profiles["jinoshengyuan-work"], "acquired_released");
  assert.equal(counts.brain_lock.profiles.legacy, "acquired_released");
  assert.match(counts.brain_lock.owner, /^outreach-tick:/);
});

test("一台被别的 run 占用 → 本轮不选它（--exclude），另一台照发；不放别人的锁", { skip: SKIP }, () => {
  const c = setup();
  writeFileSync(join(c.brain, `busy-${S_WORK}`), "9a8b7c6d-0000-4000-8000-00000000abcd");
  const r = c.tickRun();
  assert.equal(r.status, 0, r.stderr);
  const [next] = nextCalls(c);
  assert.ok(next, "另一台空闲时仍要取单");
  assert.match(next, /--exclude jinoshengyuan-work/);
  assert.ok(!c.calls().some((l) => l.startsWith(`release ${S_WORK}`)), "不得放别人的锁");
  assert.ok(c.calls().some((l) => l.startsWith(`release ${S_LEGACY}`)));
  assert.match(c.log(), /Brain设备锁被占.*jinoshengyuan-work.*9a8b7c6d/);
  assert.equal(c.counts()[0].brain_lock.profiles["jinoshengyuan-work"], "busy");
});

test("两台都被占 → 本轮跳过：不取单、不动手机、不放别人的锁，执行记录留 skip 证据", { skip: SKIP }, () => {
  const c = setup();
  writeFileSync(join(c.brain, `busy-${S_WORK}`), "test-owner-acceptance");
  writeFileSync(join(c.brain, `busy-${S_LEGACY}`), "test-owner-acceptance");
  const r = c.tickRun();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(nextCalls(c).length, 0, "锁被占不得取单（取单会预写触达中）");
  assert.deepEqual(c.adb(), [], "锁被占不得动手机");
  assert.ok(!c.calls().some((l) => l.startsWith("release")));
  assert.match(c.log(), /本轮跳过/);
  const [counts] = c.counts();
  assert.equal(counts.orders_picked, 0);
  assert.equal(counts.brain_lock.skip_reason, "brain_lock_busy");
  assert.equal(counts.brain_lock.profiles.legacy, "busy");
});

test("Brain 不可用 → 降级照发（不停业务），日志写明降级", { skip: SKIP }, () => {
  const c = setup();
  writeFileSync(join(c.brain, "down"), "");
  const r = c.tickRun();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(nextCalls(c).length, 1);
  assert.match(c.log(), /降级/);
  assert.equal(c.counts()[0].brain_lock.profiles.legacy, "unavailable");
});

test("tick 被 TERM 异常退出 → trap 放掉 Brain 锁和本机 tick 锁", { skip: SKIP }, () => {
  const c = setup();
  writeFileSync(join(c.home, "kill-on-next"), "");
  c.tickRun();
  assert.ok(c.calls().some((l) => l.startsWith(`release ${S_WORK}`)), c.calls().join("\n") + c.log());
  assert.ok(c.calls().some((l) => l.startsWith(`release ${S_LEGACY}`)));
  assert.ok(!existsSync(join(c.brain, `held-${S_WORK}`)) && !existsSync(join(c.brain, `held-${S_LEGACY}`)));
  assert.ok(!existsSync(join(c.home, "tick.lock")), "本机 tick 锁也要清掉");
});

test("熔断中的号不领锁（它本轮本来就不发）", { skip: SKIP }, () => {
  const c = setup();
  writeFileSync(join(c.tick, "state", "dm-paused-legacy.flag"), "manual");
  c.tickRun();
  assert.ok(!c.calls().some((l) => l.startsWith(`acquire ${S_LEGACY}`)));
  assert.ok(c.calls().some((l) => l.startsWith(`acquire ${S_WORK}`)));
});

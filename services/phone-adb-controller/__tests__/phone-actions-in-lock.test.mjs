import { seedRunner, HISTORICAL_ENGINE_PLAN_DIR } from './fixtures/frozen-runtime.mjs';
// 碰手机的动作全部进设备锁内(任务 40f02c5e,决策 3c98fb36 阶段1 / 77ad8635)。
// 09-29 夜两次事故: batch2 词间「归位清场」(force-stop 重开抖音)不拿设备锁,把同机持锁任务(对标发现/触达)的现场清掉;
// wf-run 收尾 close-app/return-safe-desktop 排在 release_run_lock 之后,下一批一拿到锁就被上一批清场;
// 预检的唤醒/清场/读号也全在 preflight_lock_acquire 之前。
// 修法: ①batch2 清场前以 TAG-wN 限时 lock-acquire(同 run 幂等),拿不到 → 跳过清场记日志(harvest-keyword 自己再等锁);
//       ②wf-run 收尾清场挪到放锁之前且先 lock-acquire TAG 确认锁是本 run 的,拿不到 → 跳过并记日志;
//       ③预检拿锁提前到唤醒/清场/读号之前,拿不到锁不碰手机、本批不开采。
// 假控制器用 $HOME/lock 目录真实现锁(owner 前缀同 run 幂等),adb/ctl 都记进同一份 actions.log 以断言先后顺序。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");
const WR = join(SRC, "wf-run.sh");
const BATCH2 = join(SRC, "batch2.sh");
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
const JQ = spawnSync("bash", ["-lc", "command -v jq"], { encoding: "utf8" }).stdout.trim();
const SKIP = (!ZSH && "no zsh (CI: sudo apt-get install -y zsh)") || (!JQ && "no jq");

const FAKE_ADB = `#!/bin/sh
echo "adb $*" >> "$HOME/actions.log"
case "$*" in
  *"get-state"*) exit 0;;
  *"dumpsys power"*) echo "  mWakefulness=Asleep"; exit 0;;
  *"dumpsys telephony.registry"*) echo "  mCallState=0"; exit 0;;
esac
exit 0`;
const FAKE_SSH = `#!/bin/sh
echo "$*" >> "$HOME/ssh.log"
case "$*" in
  *"cron list --json"*) printf '{"jobs":[{"id":"cmdr-abc","name":"escort-%s-%s"}]}\\n' "$(hostname -s | tr '[:upper:]' '[:lower:]')" "$FAKE_TAG";;
  *"kpi-gate.js"*) printf '{"verdict":"go","reason":"缺口 5","words":2}\\n';;
  *"next-keywords.js"*) printf '词一\\n词二\\n';;
esac
exit 0`;
const FAKE_SCP = `#!/bin/sh
exit 0`;
// 假控制器: 锁 = $HOME/lock 目录(owner 同 run 前缀幂等,别人持有 → 失败),其余子命令最短成功回话;全部记进 actions.log
const FAKE_CTL = `#!/bin/sh
shift; shift
echo "ctl $*" >> "$HOME/actions.log"
case "$1" in
  lock-acquire) if mkdir "$HOME/lock" 2>/dev/null; then echo "$2" > "$HOME/lock/owner"; echo "lock=acquired owner=$2"; exit 0; fi
                o=$(cat "$HOME/lock/owner"); case "$2" in "$o"|"$o"-*) echo "lock=held owner=$o idempotent=true"; exit 0;; esac
                case "$o" in "$2"-*) echo "lock=held owner=$o idempotent=true"; exit 0;; esac
                echo "lock is held by another run: $o" >&2; exit 1;;
  lock-release) [ -d "$HOME/lock" ] || { echo "lock=free"; exit 0; }
                o=$(cat "$HOME/lock/owner"); case "$2" in "$o"|"$o"-*) rm -rf "$HOME/lock"; echo "lock=released owner=$2"; exit 0;; esac
                case "$o" in "$2"-*) rm -rf "$HOME/lock"; echo "lock=released owner=$2"; exit 0;; esac
                echo "refusing to release lock owned by another run: $o" >&2; exit 1;;
  lock-status) if [ -d "$HOME/lock" ]; then echo "lock=held owner=$(cat "$HOME/lock/owner") age=1s stale=false ttl=1800s"; else echo "lock=free"; fi; exit 0;;
  account-current) echo "douyin_id=dy001"; exit 0;;
  close-app) echo "foreground=launcher"; exit 0;;
  return-safe-desktop) echo "launcher=com.x.launcher"; exit 0;;
esac
exit 0`;
// 假 harvest-keyword: 像真的一样以 TAG-wN 拿锁、采完放锁;LOCK_STEAL_AFTER=1 时放锁后立刻被"另一批"抢走(模拟收尾时锁已易主)
const FAKE_HK = `#!/bin/zsh
C=$HOME/.local/bin/douyin-phone-adb
W=$(python3 -c "import urllib.parse,sys;print(urllib.parse.unquote(sys.argv[1]))" "$2")
print -r -- "$W" >> "$HOME/hk.log"
$C --profile "$1" lock-acquire "$4" >/dev/null 2>&1 || { print -u2 "锁被占"; exit 3 }
print "VIDEO\\tv1\\thttps://v/1\\ttitle\\t$W\\t1"
print "LEAD\\tnick\\tid1\\tpersonal\\tbody\\t09-01\\t上海\\ttitle\\t$W\\t\\t\\thttps://v/1"
$C --profile "$1" lock-release "$4" >/dev/null 2>&1
if [ -n "$LOCK_STEAL_AFTER" ]; then mkdir -p "$HOME/lock"; echo otherrun > "$HOME/lock/owner"; fi
exit 0`;
const FAKE_DATE = `#!/bin/sh
if [ "$1" = "+%H" ]; then echo 23; exit 0; fi
exec /bin/date "$@"`;

function setup(tag, extra = {}) {
  const home = mkdtempSync(join(tmpdir(), "inlock-"));
  const bin = join(home, ".local", "bin");
  mkdirSync(bin, { recursive: true });
  for (const [n, body] of [["adb", FAKE_ADB], ["ssh", FAKE_SSH], ["scp", FAKE_SCP], ["douyin-phone-adb", FAKE_CTL], ["date", FAKE_DATE]]) {
    writeFileSync(join(bin, n), body); chmodSync(join(bin, n), 0o755);
  }
  const hk = join(home, "hk-fake.sh"); writeFileSync(hk, FAKE_HK); chmodSync(hk, 0o755);
  mkdirSync(join(home, ".config", "openclaw"), { recursive: true });
  writeFileSync(join(home, ".config", "openclaw", "douyin-account-routes.tsv"), "p1\tdy001\n");
  const env = {
    ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`,
    WF_PLAN_DIR: HISTORICAL_ENGINE_PLAN_DIR, WFR: join(SRC, "workflow-result.sh"), BATCH2, HARVEST_KEYWORD: hk,
    WALL_REPORT: join(home, "no-wall"), BATCH_SLEEP: "0", PF_LOCK_WAIT: "0", PF_LOCK_TRIES: "2", CLEAR_LOCK_WAIT: "0", WF_TESTING: "1",
    WFR_HOME: join(home, "wfr"), WFR_NODE: process.execPath, WFR_JQ: JQ, WFR_LEDGER_MJS: join(SRC, "ledger.mjs"),
    WFR_SCP_TARGET: "", WFR_PROBE_STAGES: "", WFR_BRAIN_ENV: join(home, "no-brain.env"), BRAIN_URL: "", BRAIN_INTERNAL_TOKEN: "",
    FAKE_TAG: tag, ...extra,
  };
  for (const k of ["WFR_DISABLED", "WF_RUN_START_TS", "WF_NOW_TS", "BATCH2_NOW_HOUR"]) delete env[k];
  return { home, env };
}
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const holdLockBy = (home, owner) => { mkdirSync(join(home, "lock"), { recursive: true }); writeFileSync(join(home, "lock", "owner"), owner + "\n"); };
const runWf = (env, tag) => {
  const args = ["keyword_acquisition", "p1", "SER1", "biz", "2", "1", "--commander", "cmdr-abc", "--tag", tag];
  seedRunner(env, args);
  return spawnSync(ZSH, [WR, ...args], { encoding: "utf8", env, timeout: 90000 });
};
const runB2 = (home, env, words) => {
  const wf = join(home, "kw.txt"); writeFileSync(wf, words.join("\n") + "\n");
  return spawnSync(ZSH, [BATCH2, "p1", wf, "t9", "0", "SER1"], { encoding: "utf8", env: { ...env, WFR_DISABLED: "1" }, timeout: 60000 });
};

// ── ① batch2 词间清场 ───────────────────────────────────────────────────────
test("batch2: 锁被同机另一批持有 → 词间不清场(无 force-stop),记「锁被占,跳过清场」,词照常交给 harvest-keyword", { skip: SKIP }, () => {
  const { home, env } = setup("t9");
  holdLockBy(home, "otherrun");
  const r = runB2(home, env, ["a", "b"]);
  assert.equal(r.status, 0, r.stderr);
  const acts = read(join(home, "actions.log"));
  assert.doesNotMatch(acts, /adb .*am force-stop/, "持锁方现场不得被清: " + acts);
  assert.doesNotMatch(acts, /adb .*am start/);
  const log = read(join(home, "night-t9.log"));
  assert.equal((log.match(/锁被占,跳过清场/g) || []).length, 2, log);
  assert.deepEqual(read(join(home, "hk.log")).trim().split("\n"), ["a", "b"]);
  assert.equal(read(join(home, "lock", "owner")).trim(), "otherrun", "别人的锁不能被动");
});

test("batch2: 锁空闲 → 先以 TAG-wN 拿锁再清场,清场在拿锁之后;harvest-keyword 同 run 幂等续用", { skip: SKIP }, () => {
  const { home, env } = setup("t9");
  const r = runB2(home, env, ["a"]);
  assert.equal(r.status, 0, r.stderr);
  const lines = read(join(home, "actions.log")).split("\n");
  const iLock = lines.findIndex((l) => /^ctl lock-acquire t9-w1$/.test(l));
  const iStop = lines.findIndex((l) => /^adb .*am force-stop/.test(l));
  assert.ok(iLock >= 0, "清场前必须拿锁: " + lines.join("|"));
  assert.ok(iStop > iLock, `force-stop(${iStop}) 必须在 lock-acquire(${iLock}) 之后`);
  assert.doesNotMatch(read(join(home, "night-t9.log")), /跳过清场/);
  assert.ok(!existsSync(join(home, "lock")), "词采完 harvest-keyword 放锁,锁应 free");
});

// ── ② wf-run 收尾清场进锁 ───────────────────────────────────────────────────
test("wf-run: 收尾时锁已被另一批拿走 → 不 close-app/不回桌面,记「锁被占,跳过收尾清场」,别人的锁不动", { skip: SKIP }, () => {
  const { home, env } = setup("cmd09301500", { LOCK_STEAL_AFTER: "1" });
  const r = runWf(env, "cmd09301500");
  assert.equal(r.status, 0, r.stderr.slice(-3000));
  const acts = read(join(home, "actions.log"));
  assert.doesNotMatch(acts, /^ctl close-app$/m, "持锁方现场不得被清: " + acts);
  assert.doesNotMatch(acts, /^ctl return-safe-desktop$/m);
  const log = read(join(home, "harvest-cron.log"));
  assert.match(log, /锁被占,跳过收尾清场/);
  assert.equal(read(join(home, "lock", "owner")).trim(), "otherrun");
  assert.match(log, /账本finalize: ok=1 .*lock_released=1/, "锁已是别人的 → 本 run 视为已放");
});

test("wf-run: 正常收尾 → close-app/回桌面都在放锁之前", { skip: SKIP }, () => {
  const { home, env } = setup("cmd09301501");
  const r = runWf(env, "cmd09301501");
  assert.equal(r.status, 0, r.stderr.slice(-3000));
  const lines = read(join(home, "actions.log")).split("\n");
  const iClose = lines.findIndex((l) => l === "ctl close-app");
  const iDesk = lines.findIndex((l) => l === "ctl return-safe-desktop");
  const iRel = lines.findIndex((l) => l === "ctl lock-release cmd09301501");
  assert.ok(iClose >= 0 && iDesk > iClose, lines.join("|"));
  assert.ok(iRel > iDesk, `收尾放锁(${iRel}) 必须在 close-app(${iClose})/回桌面(${iDesk}) 之后`);
  assert.ok(!existsSync(join(home, "lock")), "收尾后锁 free");
  assert.match(read(join(home, "harvest-cron.log")), /账本finalize: ok=1 final=completed lock_released=1/);
});

// ── ③ 预检拿锁提前 ─────────────────────────────────────────────────────────
test("wf-run: 预检时锁被另一批持有 → 不唤醒/不清场/不读号,本批不开采,exit 0", { skip: SKIP }, () => {
  const { home, env } = setup("cmd09301502");
  holdLockBy(home, "otherrun");
  const r = runWf(env, "cmd09301502");
  assert.equal(r.status, 0, r.stderr.slice(-3000));
  const acts = read(join(home, "actions.log"));
  assert.doesNotMatch(acts, /KEYCODE_WAKEUP/, "拿不到锁不得唤醒手机: " + acts);
  assert.doesNotMatch(acts, /svc power stayon/);
  assert.doesNotMatch(acts, /am force-stop/);
  assert.doesNotMatch(acts, /^ctl account-current/m);
  assert.doesNotMatch(acts, /^ctl close-app$/m);
  assert.equal(read(join(home, "hk.log")), "", "本批不开采");
  const log = read(join(home, "harvest-cron.log"));
  assert.match(log, /预检拿锁失败\(锁被占\),本批不碰手机/);
  assert.equal(read(join(home, "lock", "owner")).trim(), "otherrun");
});

test("wf-run: 预检拿锁在唤醒之前(锁空闲时唤醒/清场/读号都在 lock-acquire 之后)", { skip: SKIP }, () => {
  const { home, env } = setup("cmd09301503");
  const r = runWf(env, "cmd09301503");
  assert.equal(r.status, 0, r.stderr.slice(-3000));
  const lines = read(join(home, "actions.log")).split("\n");
  const iLock = lines.findIndex((l) => l === "ctl lock-acquire cmd09301503");
  const iWake = lines.findIndex((l) => /KEYCODE_WAKEUP/.test(l));
  const iStop = lines.findIndex((l) => /am force-stop/.test(l));
  const iAcct = lines.findIndex((l) => /^ctl account-current/.test(l));
  assert.ok(iLock >= 0, lines.join("|"));
  assert.ok(iWake > iLock && iStop > iLock && iAcct > iLock, `lock=${iLock} wake=${iWake} stop=${iStop} acct=${iAcct}`);
  rmSync(home, { recursive: true, force: true });
});

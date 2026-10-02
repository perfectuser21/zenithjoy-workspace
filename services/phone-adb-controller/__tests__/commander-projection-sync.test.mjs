import { seedRunner } from './fixtures/frozen-runtime.mjs';
// Commander 投影与三档权限对齐 + 平滑收工正规入口（Brain 任务 2fc3b6fc，决策 3c98fb36 阶段 2 补 / 018e4e84 同权 / ce4849e0）。
// #2043 只把真身 COMMANDER.md 改成三档（自动做 / Bark 请示 / 只报不做），三份投影（escort SOP / stream 哨兵 SOP / 分身唤起词）
// 仍写「无杀权 / 绝不终止 run」，escort、哨兵、分身照旧宪法行事；而「平滑收工」在真身里只有定义没有入口——Commander 想停只能
// kill（手机现场不清、锁不放、账本 lost）。这里钉两件事：
//   ① 三份投影：不得再含「无杀权」「绝不终止」；必含「三档」「平滑收工」「.stop」；平滑收工写明 touch ~/wf-runs/<TAG>.stop、禁止 kill -9；
//      Bark 请示写明命令；保留帮不拦 / 先动手后汇报 / 读不到就说读不到 / 注销权 / 心跳条款。
//   ② stop 文件机制：wf-run 起跑 export WF_STOP_FILE=~/wf-runs/<TAG>.stop；batch2 词边界、harvest-keyword 等锁与视频边界
//      检测到即按 deadline 同路径平滑收工（已采落池分拣、放锁），账本 finalize partial reason=commander_stop；无 stop 文件行为不变。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FAKE_SSH_QUAL, FAKE_SCP } from "./qual-fakes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");
const read = (p) => readFileSync(join(SRC, p), "utf8");
const readOr = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
const JQ = spawnSync("bash", ["-lc", "command -v jq"], { encoding: "utf8" }).stdout.trim();
const SKIP = !ZSH && "no zsh (CI: sudo apt-get install -y zsh)";
const SKIP_E2E = (!ZSH && "no zsh (CI: sudo apt-get install -y zsh)") || (!JQ && "no jq");

const PROJECTIONS = ["cmdr-escort.txt", "cmdr-stream.txt", "escort-claude-escalation.sh"];

// ── ① 投影文本守卫 ──
test("三份投影：删「无杀权」「绝不终止」，必含「三档」「平滑收工」「.stop」与三档名", () => {
  for (const p of PROJECTIONS) {
    const txt = read(p);
    assert.doesNotMatch(txt, /无杀权/, `${p} 仍写「无杀权」（与决策 018e4e84 冲突）`);
    assert.doesNotMatch(txt, /绝不终止/, `${p} 仍写「绝不终止」`);
    assert.match(txt, /三档/, `${p} 缺「三档」`);
    assert.match(txt, /平滑收工/, `${p} 缺「平滑收工」`);
    assert.match(txt, /\.stop/, `${p} 缺 stop 文件约定`);
    for (const tier of ["自动做", "Bark 请示", "只报不做"]) assert.match(txt, new RegExp(tier), `${p} 三档缺「${tier}」`);
  }
});

test("三份投影：平滑收工 = touch ~/wf-runs/<TAG>.stop，禁止 kill", () => {
  for (const p of PROJECTIONS) {
    const txt = read(p);
    assert.match(txt, /touch ~\/wf-runs\/<TAG>\.stop/, `${p} 平滑收工必须写明 touch ~/wf-runs/<TAG>.stop`);
    assert.match(txt, /禁止 kill/, `${p} 必须写明禁止 kill`);
    assert.match(txt, /kill -9/, `${p} 必须点名 kill -9 是禁区`);
  }
});

test("三份投影：Bark 请示写明命令（source bark.env → POST api.day.app/$BARK_TOKEN），禁把凭据文件内容重定向", () => {
  for (const p of PROJECTIONS) {
    const txt = read(p);
    assert.match(txt, /source ~\/\.credentials\/bark\.env/, `${p} Bark 请示缺 source bark.env`);
    assert.match(txt, /api\.day\.app\/\$BARK_TOKEN/, `${p} Bark 请示缺 POST 地址`);
    assert.match(txt, /主理人回复前不动手|回复前不动手/, `${p} Bark 请示缺「回复前不动手」`);
  }
});

test("三份投影：保留帮不拦（不判 FAIL 不扣格子）/ 先动手后汇报 / 读不到就说读不到 / 改代码只报不做", () => {
  for (const p of PROJECTIONS) {
    const txt = read(p);
    assert.match(txt, /帮不拦/, `${p} 缺帮不拦`);
    assert.match(txt, /不判 ?FAIL|绝不判 ?FAIL/, `${p} 帮不拦必须保留「不判 FAIL」`);
    assert.match(txt, /先动手后汇报/, `${p} 缺先动手后汇报`);
    assert.match(txt, /读不到/, `${p} 缺读不到就说读不到`);
    assert.match(txt, /改代码/, `${p} 只报不做档必须点名改代码`);
  }
});

test("cmdr-escort.txt：注销权只归 run 收尾 + 心跳条款仍在；cmdr-stream.txt 分身描述不再写「同样无杀权」", () => {
  const sop = read("cmdr-escort.txt");
  assert.match(sop, /本 TAG/, "注销条款：只认本 TAG 批完成");
  assert.match(sop, /commander-heartbeat/, "心跳条款必须保留");
  assert.match(sop, /禁止 openclaw cron rm/, "日志停滞≠收工禁令必须保留");
  const stream = read("cmdr-stream.txt");
  assert.doesNotMatch(stream, /同样无杀权/);
  assert.match(stream, /三档/);
  const esc = read("escort-claude-escalation.sh");
  assert.match(esc, /救活权/, "分身唤起词必须保留救活权例外");
  assert.match(esc, /docker inspect/, "救活权三前提（取证）必须保留");
  assert.equal(spawnSync(ZSH || "zsh", ["-n", join(SRC, "escort-claude-escalation.sh")], { encoding: "utf8" }).status, 0, "唤起词脚本必须过 zsh -n");
});

test("真身同步：COMMANDER.md / AGENTS.md / SKILL.md 平滑收工带 stop 文件写法", () => {
  const law = read("COMMANDER.md");
  assert.match(law, /wf-runs\/<TAG>\.stop/, "宪法平滑收工定义必须写明 stop 文件入口");
  assert.match(law, /平滑收工[^\n]*(放锁)[^\n]*(落池)[^\n]*(回桌面)[^\n]*(finalize)/, "四步定义行保持不动（commander-positioning 守卫）");
  assert.match(read("commander/AGENTS.md"), /\.stop/, "AGENTS.md 三档表平滑收工带 stop 写法");
  assert.match(read("commander/skills/workflow-commander/SKILL.md"), /\.stop/, "SKILL.md 三档行平滑收工带 stop 写法");
});

// ── ② stop 文件机制 ──
const LIB = join(SRC, "wf-limits.sh");
const lib = (cmd, env = {}) => spawnSync(ZSH, ["-c", `source ${LIB} || exit 99; ${cmd}`], { encoding: "utf8", env: { ...process.env, ...env }, timeout: 15000 });

test("wf_stop_requested / wf_stop_reason：stop 文件存在 → rc 0 / commander_stop；缺 WF_STOP_FILE 或文件不存在 → rc 1 / 空；到点优先报 deadline", { skip: SKIP }, () => {
  const home = mkdtempSync(join(tmpdir(), "wfstop-"));
  const stop = join(home, "t.stop");
  const base = { ...process.env }; delete base.WF_STOP_FILE; delete base.WF_RUN_START_TS; delete base.WF_NOW_TS;
  const noFile = spawnSync(ZSH, ["-c", `source ${LIB} || exit 99; wf_stop_requested; echo rc=$?; wf_stop_reason; echo`], { encoding: "utf8", env: base });
  assert.equal(noFile.stdout, "rc=1\n\n", "未设 WF_STOP_FILE 恒不停");
  const absent = lib("wf_stop_requested; echo rc=$?", { WF_STOP_FILE: stop });
  assert.equal(absent.stdout, "rc=1\n");
  writeFileSync(stop, "");
  const present = lib("wf_stop_requested; echo rc=$?; wf_stop_reason", { WF_STOP_FILE: stop });
  assert.equal(present.stdout, "rc=0\ncommander_stop\n", present.stderr);
  const both = lib("wf_stop_reason", { WF_STOP_FILE: stop, WF_RUN_START_TS: "1000", WF_NOW_TS: "99999", WF_RUN_MAX_SECONDS: "10" });
  assert.equal(both.stdout, "deadline\n", "到点与 stop 同时成立时报 deadline（总时限是硬上限）");
  const dl = lib("wf_stop_reason", { WF_RUN_START_TS: "1000", WF_NOW_TS: "99999", WF_RUN_MAX_SECONDS: "10" });
  assert.equal(dl.stdout, "deadline\n");
});

// batch2：假 harvest-keyword 采完第 1 个词就 touch stop 文件（模拟 Commander 在这个词跑的时候请求收工）
const FAKE_HK_B2 = `#!/bin/zsh
W=$(python3 -c "import urllib.parse,sys;print(urllib.parse.unquote(sys.argv[1]))" "$2")
print -r -- "$W" >> "$HOME/hk.log"
print "VIDEO\\t1\\thttps://v/1\\ttitle\\t$W\\t1"
print "LEAD\\tnick\\tid1\\tpersonal\\tbody\\t09-01\\t上海\\ttitle\\t$W\\t\\t\\thttps://v/1"
[ -n "$TOUCH_STOP" ] && touch "$WF_STOP_FILE"
exit 0`;
const FAKE_SSH_LOG = `#!/bin/sh
echo "$*" >> "$HOME/ssh.log"; exit 0`;

function setupBatch2(words, extra = {}) {
  const home = mkdtempSync(join(tmpdir(), "b2stop-"));
  const bin = join(home, ".local", "bin");
  mkdirSync(bin, { recursive: true });
  for (const [n, body] of [["ssh", FAKE_SSH_LOG], ["scp", FAKE_SSH_LOG]]) { writeFileSync(join(bin, n), body); chmodSync(join(bin, n), 0o755); }
  const hk = join(home, "hk-fake.sh"); writeFileSync(hk, FAKE_HK_B2); chmodSync(hk, 0o755);
  const wf = join(home, "kw.txt"); writeFileSync(wf, words.join("\n") + "\n");
  mkdirSync(join(home, "wf-runs"));
  const env = { ...process.env, HOME: home, HARVEST_KEYWORD: hk, WFR_DISABLED: "1", BATCH_SLEEP: "0", WALL_REPORT: "/nonexistent",
    BATCH2_NOW_HOUR: "23", WF_STOP_FILE: join(home, "wf-runs", "t9.stop") };
  for (const k of ["WF_RUN_START_TS", "WF_RUN_MAX_SECONDS", "WF_NOW_TS", "TOUCH_STOP"]) delete env[k];
  Object.assign(env, extra);
  return { home, wf, env };
}
const runBatch2 = (c) => spawnSync(ZSH, [join(SRC, "batch2.sh"), "p1", c.wf, "t9", "1", ""], { encoding: "utf8", env: c.env, timeout: 30000 });

test("batch2：采第 1 个词时 stop 文件出现 → 不开第 2 个词，记「Commander 请求收工」，已采落池+分拣，stdout 报 BATCH2_STOP_REASON=commander_stop", { skip: SKIP }, () => {
  const c = setupBatch2(["词一", "词二", "词三"], { TOUCH_STOP: "1" });
  const r = runBatch2(c);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readOr(join(c.home, "hk.log")).trim(), "词一", "stop 后不应再开新词");
  const log = readOr(join(c.home, "night-t9.log"));
  assert.match(log, /Commander 请求收工\([^)]*t9\.stop\),采收收工\(词2: 词二 起未开跑\)/);
  const ssh = readOr(join(c.home, "ssh.log"));
  assert.match(ssh, /push-videos\.js/, "已采到的线索必须落池");
  assert.match(ssh, /push-raw-comments\.js/);
  assert.match(ssh, /sort-comments\.js/, "落池后照常分拣");
  assert.match(r.stdout, /^BATCH2_STOP_REASON=commander_stop$/m);
  assert.doesNotMatch(r.stdout, /BATCH2_STOP_REASON=deadline/);
});

test("batch2：起跑前 stop 文件已在 → 第 1 个词都不开，不落池，仍报 commander_stop；无 stop 文件 → 全部照跑", { skip: SKIP }, () => {
  const a = setupBatch2(["a", "b"]);
  writeFileSync(a.env.WF_STOP_FILE, "");
  const ra = runBatch2(a);
  assert.equal(ra.status, 0, ra.stderr);
  assert.equal(readOr(join(a.home, "hk.log")), "");
  assert.doesNotMatch(readOr(join(a.home, "ssh.log")), /push-videos\.js/);
  assert.match(ra.stdout, /^BATCH2_STOP_REASON=commander_stop$/m);
  const b = setupBatch2(["a", "b"]);
  const rb = runBatch2(b);
  assert.equal(rb.status, 0, rb.stderr);
  assert.deepEqual(readOr(join(b.home, "hk.log")).trim().split("\n"), ["a", "b"]);
  assert.doesNotMatch(rb.stdout, /BATCH2_STOP_REASON/);
});

// harvest-keyword：假控制器 tap-evidence（开始处理一个视频）时 touch stop 文件
const FAKE_CTL_HK = `#!/bin/sh
shift; shift
echo "$*" >> "$HOME/ctl.log"
case "$1" in
  lock-acquire) printf 'lock=acquired owner=T\\n'; exit 0;;
  lock-release) printf 'lock=released owner=T\\n'; exit 0;;
  lock-refresh) printf 'lock=refreshed owner=T ttl=1800s\\n'; exit 0;;
  tap-evidence) [ -n "$TOUCH_STOP" ] && touch "$WF_STOP_FILE"; exit 0;;
  current-video-link) printf 'excluded_non_video=true\\n'; exit 0;;
  back-to-results) printf 'back_to_results=1 recovered_via=back\\n'; exit 0;;
esac
exit 0`;
const FAKE_DISCOVER = `#!/bin/sh
k=1; while [ $k -le 4 ]; do printf '%s\\t%s\\t00:30\\t标题%s\\n' $((k*100)) $((k*200)) $k; k=$((k+1)); done
exit 0`;

function setupHK(extra = {}) {
  const home = mkdtempSync(join(tmpdir(), "hkstop-"));
  const bin = join(home, ".local", "bin");
  mkdirSync(bin, { recursive: true });
  for (const [n, body] of [["douyin-phone-adb", FAKE_CTL_HK], ["ssh", FAKE_SSH_QUAL], ["scp", FAKE_SCP]]) { writeFileSync(join(bin, n), body); chmodSync(join(bin, n), 0o755); }
  const disc = join(home, "discover-fake.sh"); writeFileSync(disc, FAKE_DISCOVER); chmodSync(disc, 0o755);
  mkdirSync(join(home, "wf-runs"));
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, HARVEST_KEYWORD_TESTING: "1", DISCOVER_CMD: disc,
    WF_STOP_FILE: join(home, "wf-runs", "T.stop") };
  for (const k of ["WF_SOURCE_KIND", "WF_RUN_START_TS", "WF_RUN_MAX_SECONDS", "WF_NOW_TS", "TOUCH_STOP"]) delete env[k];
  Object.assign(env, extra);
  return { home, env };
}
const runHK = (env) => spawnSync(ZSH, [join(SRC, "harvest-keyword.sh"), "P", encodeURIComponent("关键词"), "4", "T-w1", "unlimited", "line"], { encoding: "utf8", env, timeout: 20000 });
const taps = (log) => log.match(/^tap-evidence .*$/gm) || [];

test("harvest-keyword：处理第 1 个视频时 stop 文件出现 → 不开第 2 个视频，锁照常释放，rc=0", { skip: SKIP }, () => {
  const { home, env } = setupHK({ TOUCH_STOP: "1" });
  const r = runHK(env);
  assert.equal(r.status, 0, r.stderr.slice(-2000));
  const log = readOr(join(home, "ctl.log"));
  assert.equal(taps(log).length, 1, "stop 后不该再点下一张卡: " + log);
  assert.match(r.stderr, /Commander 请求收工,本词剩余候选不采/);
  assert.match(log, /lock-release T-w1/, "收工也要放锁");
});

test("harvest-keyword：拿锁前 stop 文件已在 → 不拿锁、不发现，直接收工 rc=0；无 stop 文件 → 4 张卡全处理", { skip: SKIP }, () => {
  const a = setupHK();
  writeFileSync(a.env.WF_STOP_FILE, "");
  const ra = runHK(a.env);
  assert.equal(ra.status, 0, ra.stderr.slice(-2000));
  assert.doesNotMatch(readOr(join(a.home, "ctl.log")), /lock-acquire/);
  assert.match(ra.stderr, /Commander 请求收工,本词不开跑/);
  const b = setupHK();
  const rb = runHK(b.env);
  assert.equal(rb.status, 0, rb.stderr.slice(-2000));
  assert.equal(taps(readOr(join(b.home, "ctl.log"))).length, 4);
  assert.doesNotMatch(rb.stderr, /Commander 请求收工/);
});

// wf-run 假机整链：账本真跑，假 harvest-keyword 采完第 1 个词 touch ~/wf-runs/<TAG>.stop（Commander 在执行机上做的动作）
const FAKE_ADB = `#!/bin/sh
echo "adb $*" >> "$HOME/adb.log"
case "$*" in
  *"dumpsys power"*) echo "  mWakefulness=Awake"; exit 0;;
  *"dumpsys telephony.registry"*) echo "  mCallState=0"; exit 0;;
esac
exit 0`;
const FAKE_SSH_E2E = `#!/bin/sh
echo "$*" >> "$HOME/ssh.log"
case "$*" in
  *"cron list --json"*) printf '{"jobs":[{"id":"cmdr-abc","name":"escort-%s-%s"}]}\\n' "$(hostname -s | tr '[:upper:]' '[:lower:]')" "$FAKE_TAG";;
  *"kpi-gate.js"*) printf '{"verdict":"go","reason":"缺口 5","words":2}\\n';;
  *"next-keywords.js"*) printf '词一\\n词二\\n';;
esac
exit 0`;
const FAKE_CTL_E2E = `#!/bin/sh
shift; shift
echo "$*" >> "$HOME/ctl.log"
case "$1" in
  lock-acquire) if mkdir "$HOME/lock" 2>/dev/null; then echo "$2" > "$HOME/lock/owner"; echo "lock=acquired owner=$2"; exit 0; fi
                o=$(cat "$HOME/lock/owner"); case "$2" in "$o"|"$o"-*) echo "lock=held owner=$o idempotent=true"; exit 0;; esac
                echo "lock is held by another run: $o" >&2; exit 1;;
  lock-release) rm -rf "$HOME/lock"; echo "lock=released owner=$2"; exit 0;;
  lock-status) if [ -d "$HOME/lock" ]; then echo "lock=held owner=$(cat "$HOME/lock/owner") age=1s stale=false ttl=1800s"; else echo "lock=free"; fi; exit 0;;
  account-current) echo "douyin_id=dy001"; exit 0;;
  close-app) echo "foreground=launcher"; exit 0;;
  return-safe-desktop) echo "launcher=com.x.launcher"; exit 0;;
esac
exit 0`;
const FAKE_HK_E2E = `#!/bin/zsh
W=$(python3 -c "import urllib.parse,sys;print(urllib.parse.unquote(sys.argv[1]))" "$2")
print -r -- "$W" >> "$HOME/hk.log"
print "VIDEO\\tv1\\thttps://v/1\\ttitle\\t$W\\t1"
print "LEAD\\tnick\\tid1\\tpersonal\\tbody\\t09-01\\t上海\\ttitle\\t$W\\t\\t\\thttps://v/1"
[ -n "$TOUCH_STOP" ] && touch "$HOME/wf-runs/$FAKE_TAG.stop"
exit 0`;
// 假 date：+%H 固定 23（采收时段，wf-run 白天退让守卫），其余透传
const FAKE_DATE = `#!/bin/sh
if [ "$1" = "+%H" ]; then echo 23; exit 0; fi
exec /bin/date "$@"`;

function setupE2E(tag) {
  const home = mkdtempSync(join(tmpdir(), "wfstop-e2e-"));
  const bin = join(home, ".local", "bin");
  mkdirSync(bin, { recursive: true });
  for (const [n, body] of [["adb", FAKE_ADB], ["ssh", FAKE_SSH_E2E], ["scp", FAKE_SCP], ["douyin-phone-adb", FAKE_CTL_E2E], ["date", FAKE_DATE]]) {
    writeFileSync(join(bin, n), body); chmodSync(join(bin, n), 0o755);
  }
  const hk = join(home, "hk-fake.sh"); writeFileSync(hk, FAKE_HK_E2E); chmodSync(hk, 0o755);
  mkdirSync(join(home, ".config", "openclaw"), { recursive: true });
  writeFileSync(join(home, ".config", "openclaw", "douyin-account-routes.tsv"), "p1\tdy001\n");
  const env = {
    ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`,
    WF_PLAN_DIR: join(SRC, "plans"), WFR: join(SRC, "workflow-result.sh"), BATCH2: join(SRC, "batch2.sh"), HARVEST_KEYWORD: hk,
    WALL_REPORT: join(home, "no-wall"), BATCH_SLEEP: "0", PF_LOCK_WAIT: "0", WF_TESTING: "1",
    WFR_HOME: join(home, "wfr"), WFR_NODE: process.execPath, WFR_JQ: JQ, WFR_LEDGER_MJS: join(SRC, "ledger.mjs"),
    WFR_SCP_TARGET: "", WFR_PROBE_STAGES: "", WFR_BRAIN_ENV: join(home, "no-brain.env"), BRAIN_URL: "", BRAIN_INTERNAL_TOKEN: "",
    FAKE_TAG: tag, TOUCH_STOP: "1",
  };
  for (const k of ["WFR_DISABLED", "WF_RUN_START_TS", "WF_NOW_TS", "WF_RUN_MAX_SECONDS", "BATCH2_NOW_HOUR", "WF_STOP_FILE"]) delete env[k];
  return { home, env };
}

test("wf-run 假机整链：Commander touch ~/wf-runs/<TAG>.stop → 第 2 个词不开、已采落池、锁 free、账本 final=partial reason=commander_stop、escort 注销、stop 文件收工后清除", { skip: SKIP_E2E }, () => {
  const TAG = "cmd09301800";
  const { home, env } = setupE2E(TAG);
  seedRunner(env,["keyword_acquisition","--tag",TAG]);
  const r = spawnSync(ZSH, [join(SRC, "wf-run.sh"), "keyword_acquisition", "p1", "SER1", "biz", "2", "1", "--commander", "cmdr-abc", "--tag", TAG], { encoding: "utf8", env, timeout: 90000 });
  assert.notEqual(r.status, null, "wf-run 90 秒内没退出");
  assert.equal(r.status, 0, r.stderr.slice(-3000));
  const log = readOr(join(home, "harvest-cron.log"));
  assert.match(log, new RegExp(`收工入口=.*wf-runs/${TAG}\\.stop`), "起跑要记 stop 文件约定，Commander 才知道往哪 touch");
  assert.equal(readOr(join(home, "hk.log")).trim(), "词一", "stop 后第 2 个词不开");
  assert.match(readOr(join(home, `night-${TAG}.log`)), /Commander 请求收工\([^)]*\.stop\),采收收工\(词2: 词二 起未开跑\)/);
  assert.match(log, /Commander 请求收工,平滑收工/);
  const tsv = readOr(join(home, `night-${TAG}.tsv`));
  assert.equal((tsv.match(/^LEAD\t/gm) || []).length, 1);
  const ssh = readOr(join(home, "ssh.log"));
  assert.match(ssh, new RegExp(`push-videos\\.js /tmp/${TAG}\\.tsv ${TAG} p1`));
  assert.match(ssh, /sort-comments\.js/);
  assert.match(ssh, /update-keyword-stats\.js 'biz'/, "已采线索仍要回写词赛马");
  assert.ok(!existsSync(join(home, "lock")), "设备锁必须 free");
  const ctl = readOr(join(home, "ctl.log"));
  assert.match(ctl, new RegExp(`lock-release ${TAG}`));
  assert.match(ctl, /close-app/);
  assert.match(ctl, /return-safe-desktop/);
  assert.doesNotMatch(ssh, /openclaw cron rm/, "finalize不能取消仍在做售后的tick");
  assert.match(log, /escort售后(?:已交接|保留)/, "必须请求售后或保留现场并说明原因");
  assert.match(log, /账本finalize: ok=1 final=partial lock_released=1 .*reason=commander_stop/);
  assert.ok(!existsSync(join(home, "wf-runs", `${TAG}.stop`)), "收工后 stop 文件应清除（下一批同 TAG 不受影响）");
  const art = readdirSync(join(home, "wfr", "workflow-runs"));
  assert.ok(art.some((f) => /cleanup\.1\.worker-result\.json$/.test(f)), "cleanup 工件要写成: " + art.join(","));
});

test("wf-run.sh 源码接线：起跑 export WF_STOP_FILE 并清残留；commander_stop 与 deadline 同路径记 WFR_FINAL_REASON", () => {
  const src = read("wf-run.sh");
  assert.match(src, /export WF_STOP_FILE="?\$HOME\/wf-runs\/\$TAG\.stop"?/, "起跑必须 export WF_STOP_FILE=~/wf-runs/<TAG>.stop");
  assert.match(src, /rm -f "\$WF_STOP_FILE"/, "起跑清残留 / 收工清除");
  assert.match(src, /WFR_FINAL_REASON=\$?\{?B2_STOP_REASON|WFR_FINAL_REASON="\$B2_STOP_REASON"/, "终态原因取 batch2 报的 STOP_REASON（deadline / commander_stop 同路径）");
  for (const f of ["batch2.sh", "harvest-keyword.sh"]) {
    const s = read(f) + (f === "harvest-keyword.sh" ? read("harvest-keyword-lib.sh") : "");
    assert.match(s, /wf_stop_requested/, `${f} 必须在边界判 stop 文件`);
    assert.match(s, /wf_stop_requested\(\)\{ return 1 \}/, `${f} 旧部署缺库时的兜底桩必须恒不停`);
  }
});

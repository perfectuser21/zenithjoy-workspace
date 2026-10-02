// 整批总时限验收(任务 7d150e33,PRD 阶段1「人为制造死循环,4h 内自收工,账本 final=partial,锁 free,线索已落池」):
// 全假机整链——adb/ssh/scp/douyin-phone-adb/date 全假、harvest-keyword 假(采完第 1 个词就把时钟拨过总时限),
// 账本(workflow-result.sh + ledger.mjs)真跑。断言: 进程 60 秒内自收工 rc=0;第 2 个词不开;已采 TSV 被 scp+落池+分拣;
// 设备锁 free;账本 finalize 写 final=partial(原因 deadline);escort 照常注销;效果回写照常。
// 真机 proven-to-fire 由主会话用短时限安排,本测试不碰手机。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");
const WR = join(SRC, "wf-run.sh");
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
const JQ = spawnSync("bash", ["-lc", "command -v jq"], { encoding: "utf8" }).stdout.trim();
const SKIP = (!ZSH && "no zsh (CI: sudo apt-get install -y zsh)") || (!JQ && "no jq");

const FAKE_ADB = `#!/bin/sh
echo "adb $*" >> "$HOME/adb.log"
case "$*" in
  *"get-state"*) exit 0;;
  *"dumpsys power"*) echo "  mWakefulness=Awake"; exit 0;;
  *"dumpsys telephony.registry"*) echo "  mCallState=0"; exit 0;;
esac
exit 0`;
// cron list --json 回放的 escort 名按本机 HOSTKEY（wf-run 默认分支 = 小写 hostname）+ 本批 TAG 拼——#2035 起注销要核 name 才肯 rm
const FAKE_SSH = `#!/bin/sh
echo "$*" >> "$HOME/ssh.log"
case "$*" in
  *"cron list --json"*) printf '{"jobs":[{"id":"cmdr-abc","name":"escort-%s-%s"}]}\\n' "$(hostname -s | tr '[:upper:]' '[:lower:]')" "$FAKE_TAG";;
  *"kpi-gate.js"*) printf '{"verdict":"go","reason":"缺口 5","words":2}\\n';;
  *"next-keywords.js"*) printf '词一\\n词二\\n';;
esac
exit 0`;
const FAKE_SCP = `#!/bin/sh
echo "$*" >> "$HOME/scp.log"; exit 0`;
// 假控制器: 设备锁用 $HOME/lock 目录真实现(acquire=mkdir / release=rm / status 真读),其余子命令给最短成功回话
const FAKE_CTL = `#!/bin/sh
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
// 假 harvest-keyword: 吐 VIDEO+LEAD,采完把时钟拨到 $NOW_AFTER(模拟这个词跑过了总时限)
const FAKE_HK = `#!/bin/zsh
W=$(python3 -c "import urllib.parse,sys;print(urllib.parse.unquote(sys.argv[1]))" "$2")
print -r -- "$W" >> "$HOME/hk.log"
print "VIDEO\\tv1\\thttps://v/1\\ttitle\\t$W\\t1"
print "LEAD\\tnick\\tid1\\tpersonal\\tbody\\t09-01\\t上海\\ttitle\\t$W\\t\\t\\thttps://v/1"
print -r -- "$NOW_AFTER" > "$HOME/now"
exit 0`;
// 假 date: +%s 读 $HOME/now;+%H 固定 23(采收时段);其余透传
const FAKE_DATE = `#!/bin/sh
if [ "$1" = "+%s" ]; then cat "$HOME/now"; exit 0; fi
if [ "$1" = "+%H" ]; then echo 23; exit 0; fi
exec /bin/date "$@"`;

function setup() {
  const home = mkdtempSync(join(tmpdir(), "wfe2e-"));
  const bin = join(home, ".local", "bin");
  mkdirSync(bin, { recursive: true });
  for (const [n, body] of [["adb", FAKE_ADB], ["ssh", FAKE_SSH], ["scp", FAKE_SCP], ["douyin-phone-adb", FAKE_CTL], ["date", FAKE_DATE]]) {
    writeFileSync(join(bin, n), body); chmodSync(join(bin, n), 0o755);
  }
  const hk = join(home, "hk-fake.sh"); writeFileSync(hk, FAKE_HK); chmodSync(hk, 0o755);
  writeFileSync(join(home, "now"), "1000\n");
  mkdirSync(join(home, ".config", "openclaw"), { recursive: true });
  writeFileSync(join(home, ".config", "openclaw", "douyin-account-routes.tsv"), "p1\tdy001\n");
  const env = {
    ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`,
    WF_PLAN_DIR: join(SRC, "plans"), WFR: join(SRC, "workflow-result.sh"), BATCH2: join(SRC, "batch2.sh"), HARVEST_KEYWORD: hk,
    WALL_REPORT: join(home, "no-wall"), BATCH_SLEEP: "0", PF_LOCK_WAIT: "0", WF_TESTING: "1",
    // 账本真跑,但不连 mmv/Brain: 探针关、scp 关、Brain 凭据指向不存在的文件
    WFR_HOME: join(home, "wfr"), WFR_NODE: process.execPath, WFR_JQ: JQ, WFR_LEDGER_MJS: join(SRC, "ledger.mjs"),
    WFR_SCP_TARGET: "", WFR_PROBE_STAGES: "", WFR_BRAIN_ENV: join(home, "no-brain.env"), BRAIN_URL: "", BRAIN_INTERNAL_TOKEN: "",
    WF_RUN_MAX_SECONDS: "60", NOW_AFTER: "1100", FAKE_TAG: "cmd09301400",
  };
  for (const k of ["WFR_DISABLED", "WF_RUN_START_TS", "WF_NOW_TS", "BATCH2_NOW_HOUR"]) delete env[k];
  return { home, env };
}
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

test("WF_RUN_MAX_SECONDS=60 假机整链: 60 秒内自收工、锁 free、已采 TSV 落池、账本 final=partial、escort 注销", { skip: SKIP }, () => {
  const { home, env } = setup();
  const t0 = Date.now();
  const r = spawnSync(ZSH, [WR, "keyword_acquisition", "p1", "SER1", "biz", "2", "1", "--commander", "cmdr-abc", "--tag", "cmd09301400"], { encoding: "utf8", env, timeout: 90000 });
  const elapsed = Date.now() - t0;
  assert.notEqual(r.status, null, "wf-run 90 秒内没退出");
  assert.equal(r.status, 0, r.stderr.slice(-3000));
  assert.ok(elapsed < 60000, `应在 60 秒内自收工,实际 ${elapsed}ms`);
  assert.match(r.stdout, /^WF_RUN_STARTED tag=cmd09301400 cap=keyword_acquisition serial=SER1$/m);
  const log = read(join(home, "harvest-cron.log"));
  assert.match(log, /总时限=60s/, "起跑要记总时限");
  assert.equal(read(join(home, "hk.log")).trim(), "词一", "到点后第 2 个词不开");
  assert.match(read(join(home, "night-cmd09301400.log")), /整批总时限到\(60s\),采收收工\(词2: 词二 起未开跑\)/);
  assert.match(log, /总时限到,平滑收工/);
  // 已采线索落池+分拣+效果回写照常
  const tsv = read(join(home, "night-cmd09301400.tsv"));
  assert.equal((tsv.match(/^LEAD\t/gm) || []).length, 1, "TSV 里应有第 1 个词采到的 1 条 LEAD");
  assert.match(read(join(home, "scp.log")), /night-cmd09301400\.tsv mmv:\/tmp\/cmd09301400\.tsv/, "TSV 要 scp 到 mmv");
  const ssh = read(join(home, "ssh.log"));
  assert.match(ssh, /push-videos\.js \/tmp\/cmd09301400\.tsv cmd09301400 p1/);
  assert.match(ssh, /push-raw-comments\.js/);
  assert.match(ssh, /sort-comments\.js/);
  assert.match(ssh, /update-keyword-stats\.js 'biz'/, "已采线索仍要回写词赛马");
  assert.match(log, /批完成: 1 LEAD/);
  // 收工: 放锁、回桌面、escort 注销、账本 finalize partial
  assert.ok(!existsSync(join(home, "lock")), "设备锁必须 free");
  const ctl = read(join(home, "ctl.log"));
  assert.match(ctl, /lock-release cmd09301400/);
  assert.match(ctl, /close-app/);
  assert.match(ctl, /return-safe-desktop/);
  assert.doesNotMatch(ssh, /openclaw cron rm/, "finalize不能取消在途售后tick");
  assert.match(log, /escort售后(?:已交接|保留)/, "收尾必须交接售后或留痕保留陪跑");
  assert.match(log, /账本finalize: ok=1 final=partial lock_released=1 .*reason=deadline/);
  const art = readdirSync(join(home, "wfr", "workflow-runs"));
  assert.ok(art.some((f) => /cleanup\.1\.worker-result\.json$/.test(f)), "cleanup 工件要写成: " + art.join(","));
});

test("未到点(时钟不动)→ 两个词全跑,账本 final=completed", { skip: SKIP }, () => {
  const { home, env } = setup();
  env.NOW_AFTER = "1001"; env.FAKE_TAG = "cmd09301401";
  const r = spawnSync(ZSH, [WR, "keyword_acquisition", "p1", "SER1", "biz", "2", "1", "--commander", "cmdr-abc", "--tag", "cmd09301401"], { encoding: "utf8", env, timeout: 90000 });
  assert.equal(r.status, 0, r.stderr.slice(-3000));
  assert.deepEqual(read(join(home, "hk.log")).trim().split("\n"), ["词一", "词二"]);
  const log = read(join(home, "harvest-cron.log"));
  assert.doesNotMatch(log, /总时限到/);
  assert.match(log, /账本finalize: ok=1 final=completed/);
  assert.ok(!existsSync(join(home, "lock")));
});

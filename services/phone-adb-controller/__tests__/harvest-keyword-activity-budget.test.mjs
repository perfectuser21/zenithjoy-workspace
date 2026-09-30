// 每活动超时读契约预算(任务 7d150e33,决策 3c98fb36 阶段1)在 harvest-keyword.sh 的两个活动段:
//   发现段: DISCOVER_CMD(子进程,杀了不留手机现场)按 WF_BUDGET_discovery 封顶——超时按契约分类: retryable 重跑 1 次,
//           仍超 → 记「发现超预算」exit 4(batch2 记账 discovery failed budget_exceeded 后进入下一个词),锁照常释放;
//   采集段: 自发现结束起累计时长 ≥ WF_BUDGET_qualification+WF_BUDGET_collection → 在视频边界判,剩余候选作废(记账),rc=0。
// 手机侧动作不 kill;未设预算(0)= 不限,行为不变。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FAKE_SSH_QUAL, FAKE_SCP } from "./qual-fakes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const HK = join(HERE, "..", "harvest-keyword.sh");
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
const SKIP = !ZSH && "no zsh (CI: sudo apt-get install -y zsh)";

// 假控制器: 每张卡都是图文帖;tap-evidence 时把"当前时刻"往后拨 $TAP_ADVANCE 秒(模拟每个视频耗时)
const FAKE_CTL = `#!/bin/sh
shift; shift
echo "$*" >> "$HOME/ctl.log"
case "$1" in
  lock-acquire) printf 'lock=acquired owner=T\\n'; exit 0;;
  lock-release) printf 'lock=released owner=T\\n'; exit 0;;
  lock-refresh) printf 'lock=refreshed owner=T ttl=1800s\\n'; exit 0;;
  tap-evidence) if [ -n "$TAP_ADVANCE" ]; then n=$(cat "$HOME/now"); echo $((n + TAP_ADVANCE)) > "$HOME/now"; fi; exit 0;;
  current-video-link) printf 'excluded_non_video=true\\n'; exit 0;;
  back-to-results) printf 'back_to_results=1 recovered_via=back\\n'; exit 0;;
esac
exit 0`;
// 假发现: 每次被调记一行;$DISC_SLEEP 秒后才吐 4 张卡(模拟发现段卡住)
const FAKE_DISCOVER = `#!/bin/sh
echo "called $*" >> "$HOME/disc.log"
[ -n "$DISC_SLEEP" ] && sleep "$DISC_SLEEP"
k=1; while [ $k -le 4 ]; do printf '%s\\t%s\\t00:30\\t标题%s\\n' $((k*100)) $((k*200)) $k; k=$((k+1)); done
exit 0`;
const FAKE_DATE = `#!/bin/sh
if [ "$1" = "+%s" ]; then cat "$HOME/now"; exit 0; fi
exec /bin/date "$@"`;

function setup(extra = {}) {
  const home = mkdtempSync(join(tmpdir(), "hkbud-"));
  const bin = join(home, ".local", "bin");
  mkdirSync(bin, { recursive: true });
  for (const [n, body] of [["douyin-phone-adb", FAKE_CTL], ["ssh", FAKE_SSH_QUAL], ["scp", FAKE_SCP], ["date", FAKE_DATE]]) {
    writeFileSync(join(bin, n), body); chmodSync(join(bin, n), 0o755);
  }
  const disc = join(home, "discover-fake.sh");
  writeFileSync(disc, FAKE_DISCOVER); chmodSync(disc, 0o755);
  writeFileSync(join(home, "now"), "1000\n");
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, HARVEST_KEYWORD_TESTING: "1", DISCOVER_CMD: disc, WF_BOUNDED_POLL: "0.1" };
  for (const k of Object.keys(env)) if (/^WF_(BUDGET|TIMEOUT_CLASS|RUN_START_TS|RUN_MAX_SECONDS|NOW_TS|SOURCE_KIND)/.test(k)) delete env[k];
  Object.assign(env, extra);
  return { home, env };
}
const readOr = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const ctl = (home) => readOr(join(home, "ctl.log"));
const disc = (home) => readOr(join(home, "disc.log")).trim().split("\n").filter(Boolean);
const run = (env) => spawnSync(ZSH, [HK, "P", encodeURIComponent("关键词"), "4", "T-w1", "unlimited", "line"], { encoding: "utf8", env, timeout: 30000 });
const taps = (log) => log.match(/^tap-evidence .*$/gm) || [];

test("发现段超 WF_BUDGET_discovery(分类 record)→ 不等它跑完,记「发现超预算」exit 4,锁照常释放", { skip: SKIP }, () => {
  const { home, env } = setup({ DISC_SLEEP: "4", WF_BUDGET_discovery: "1", WF_TIMEOUT_CLASS_discovery: "record" });
  const t0 = Date.now();
  const r = run(env);
  assert.equal(r.status, 4, r.stderr.slice(-2000));
  assert.ok(Date.now() - t0 < 4000, "1s 预算就该返回,实际 " + (Date.now() - t0) + "ms");
  assert.equal(disc(home).length, 1, "record 分类不重试");
  assert.match(r.stderr, /发现超预算\(1s\),本词作废\(记账\)/);
  assert.match(ctl(home), /lock-release T-w1/);
  assert.equal(taps(ctl(home)).length, 0, "没拿到卡片就不该点任何东西");
});

test("发现段超预算且契约分类 retryable → 重跑 1 次;仍超 → exit 4", { skip: SKIP }, () => {
  const { home, env } = setup({ DISC_SLEEP: "4", WF_BUDGET_discovery: "1", WF_TIMEOUT_CLASS_discovery: "retryable" });
  const r = run(env);
  assert.equal(r.status, 4, r.stderr.slice(-2000));
  assert.equal(disc(home).length, 2, "retryable 恰好重试 1 次");
  assert.match(r.stderr, /发现超预算\(1s\),契约 retryable 重试 1 次/);
});

test("发现段在预算内完成 → 照常处理 4 张卡,rc=0", { skip: SKIP }, () => {
  const { home, env } = setup({ WF_BUDGET_discovery: "10" });
  const r = run(env);
  assert.equal(r.status, 0, r.stderr.slice(-2000));
  assert.equal(taps(ctl(home)).length, 4);
  assert.doesNotMatch(r.stderr, /超预算/);
});

test("采集段累计超 WF_BUDGET_qualification+WF_BUDGET_collection → 视频边界停,剩余候选作废(记账),rc=0", { skip: SKIP }, () => {
  const { home, env } = setup({ TAP_ADVANCE: "100", WF_BUDGET_qualification: "20", WF_BUDGET_collection: "30" });
  const r = run(env);
  assert.equal(r.status, 0, r.stderr.slice(-2000));
  assert.equal(taps(ctl(home)).length, 1, "第 1 个视频耗了 100s > 50s 预算,第 2 个不开");
  assert.match(r.stderr, /采集段超预算\(50s\),本词剩余候选作废\(记账\)/);
  assert.match(ctl(home), /lock-release T-w1/);
});

test("未设预算(0)→ 不限时,视频再慢也全处理", { skip: SKIP }, () => {
  const { home, env } = setup({ TAP_ADVANCE: "100000" });
  const r = run(env);
  assert.equal(r.status, 0, r.stderr.slice(-2000));
  assert.equal(taps(ctl(home)).length, 4);
  assert.doesNotMatch(r.stderr, /超预算/);
});

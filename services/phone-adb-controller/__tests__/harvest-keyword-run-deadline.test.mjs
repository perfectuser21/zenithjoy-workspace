// 整批总时限(任务 7d150e33,决策 3c98fb36 阶段1)在 harvest-keyword.sh 的视频边界判:
// wf-run.sh 起跑 export WF_RUN_START_TS/WF_RUN_MAX_SECONDS,逐视频循环每个视频开头判到点——到点不开新视频,
// 正在采的视频采完,trap 照常放锁,rc=0(已采的 LEAD 行照常交给 batch2 落池)。拿锁等待循环里也判,到点不再开本词。
// 没有 WF_RUN_START_TS(单独手跑)→ 永不到点,行为不变。不 kill。
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

// 假控制器: 每张卡都是图文帖(最短分支);back-to-results 直接归位成功(不触发重扫);
// tap-evidence(点开一张卡 = 开始处理一个视频)时把"当前时刻"拨到 $NOW_AFTER,模拟这个视频跑过了总时限
const FAKE_CTL = `#!/bin/sh
shift; shift
echo "$*" >> "$HOME/ctl.log"
case "$1" in
  lock-acquire) printf 'lock=acquired owner=T\\n'; exit 0;;
  lock-release) printf 'lock=released owner=T\\n'; exit 0;;
  lock-refresh) printf 'lock=refreshed owner=T ttl=1800s\\n'; exit 0;;
  tap-evidence) [ -n "$NOW_AFTER" ] && echo "$NOW_AFTER" > "$HOME/now"; exit 0;;
  current-video-link) printf 'excluded_non_video=true\\n'; exit 0;;
  back-to-results) printf 'back_to_results=1 recovered_via=back\\n'; exit 0;;
esac
exit 0`;
const FAKE_DISCOVER = `#!/bin/sh
k=1; while [ $k -le 4 ]; do printf '%s\\t%s\\t00:30\\t标题%s\\n' $((k*100)) $((k*200)) $k; k=$((k+1)); done
exit 0`;
// 假 date: 接管 +%s(读 $HOME/now),其余原样交给系统 date(日志时间戳)
const FAKE_DATE = `#!/bin/sh
if [ "$1" = "+%s" ]; then cat "$HOME/now"; exit 0; fi
exec /bin/date "$@"`;

function setup(now, extra = {}) {
  const home = mkdtempSync(join(tmpdir(), "hkdl-"));
  const bin = join(home, ".local", "bin");
  mkdirSync(bin, { recursive: true });
  for (const [n, body] of [["douyin-phone-adb", FAKE_CTL], ["ssh", FAKE_SSH_QUAL], ["scp", FAKE_SCP], ["date", FAKE_DATE]]) {
    writeFileSync(join(bin, n), body); chmodSync(join(bin, n), 0o755);
  }
  const disc = join(home, "discover-fake.sh");
  writeFileSync(disc, FAKE_DISCOVER); chmodSync(disc, 0o755);
  writeFileSync(join(home, "now"), now + "\n");
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, HARVEST_KEYWORD_TESTING: "1", DISCOVER_CMD: disc };
  for (const k of ["WF_SOURCE_KIND", "WF_RUN_START_TS", "WF_RUN_MAX_SECONDS", "WF_NOW_TS"]) delete env[k];
  Object.assign(env, extra);
  return { home, env };
}
const ctl = (home) => (existsSync(join(home, "ctl.log")) ? readFileSync(join(home, "ctl.log"), "utf8") : "");
const run = (env) => spawnSync(ZSH, [HK, "P", encodeURIComponent("关键词"), "4", "T-w1", "unlimited", "line"], { encoding: "utf8", env, timeout: 20000 });
const taps = (log) => log.match(/^tap-evidence .*$/gm) || [];

test("处理第 1 个视频时总时限已到 → 不开第 2 个视频,记日志,锁照常释放,rc=0", { skip: SKIP }, () => {
  const { home, env } = setup("1010", { WF_RUN_START_TS: "1000", WF_RUN_MAX_SECONDS: "100", NOW_AFTER: "1100" });
  const r = run(env);
  assert.equal(r.status, 0, r.stderr.slice(-2000));
  const log = ctl(home);
  assert.equal(taps(log).length, 1, "到点后不该再点下一张卡: " + log);
  assert.match(r.stderr, /整批总时限到\(100s\),本词剩余候选不采/);
  assert.match(log, /lock-release T-w1/, "到点收工也要放锁");
});

test("拿锁前就已到点 → 不拿锁、不发现,直接收工 rc=0", { skip: SKIP }, () => {
  const { home, env } = setup("5000", { WF_RUN_START_TS: "1000", WF_RUN_MAX_SECONDS: "100" });
  const r = run(env);
  assert.equal(r.status, 0, r.stderr.slice(-2000));
  assert.doesNotMatch(ctl(home), /lock-acquire/);
  assert.match(r.stderr, /整批总时限到\(100s\),本词不开跑/);
});

test("没有 WF_RUN_START_TS(单独手跑)→ 永不到点,4 张卡全处理", { skip: SKIP }, () => {
  const { home, env } = setup("99999999999", { NOW_AFTER: "99999999999" });
  const r = run(env);
  assert.equal(r.status, 0, r.stderr.slice(-2000));
  assert.equal(taps(ctl(home)).length, 4);
  assert.doesNotMatch(r.stderr, /整批总时限到/);
});

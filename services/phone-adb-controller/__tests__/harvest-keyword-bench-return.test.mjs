// 对标流逐视频归位(决策 7f842d12,bench 代理 PR#2016 约定):对标发现的卡片在对标账号主页网格上,
// 归位必须回主页(douyin-phone-adb back-to-profile 5:一路 back 到 UserProfileActivity,见 feed/splash 立即返回 1),
// 不能用 back-to-results——它只认 SearchResultActivity,recovered_via=research 兜底会拿 KWTXT(此时是主页链接)
// 重新搜索,人漂到别处。源类型由 wf-run.sh 经 env WF_SOURCE_KIND 传下来;不设 = keyword,行为不变。
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

// 假控制器: 每张卡都是图文帖(走最短的归位分支);BTP_FAIL=1 时 back-to-profile 失败(看见 feed)
const FAKE_CTL = `#!/bin/sh
shift; shift
echo "$*" >> "$HOME/ctl.log"
case "$1" in
  lock-acquire) exit 0;;
  lock-release) printf 'lock=released owner=T\\n'; exit 0;;
  lock-refresh) printf 'lock=refreshed owner=T ttl=1800s\\n'; exit 0;;
  current-video-link) printf 'excluded_non_video=true\\n'; exit 0;;
  back-to-profile) [ "$BTP_FAIL" = "1" ] && exit 1; printf 'recovered=profile\\n'; exit 0;;
  back-to-results) printf 'recovered_via=back\\n'; exit 0;;
esac
exit 0`;
// 假发现: 主页网格两张卡(DUR/TITLE 为空——主页网格读不到)
// DISC_EMPTY_AFTER_FIRST=1: 首次之后(重开主页)扫不到卡片
const FAKE_DISCOVER = `#!/bin/sh
echo "$*" >> "$HOME/disc.log"
n=$(wc -l < "$HOME/disc.log" | tr -d ' ')
[ "$DISC_EMPTY_AFTER_FIRST" = "1" ] && [ "$n" -gt 1 ] && exit 0
printf '100\\t200\\t\\t\\n300\\t400\\t\\t\\n'
exit 0`;

function setup(extra = {}) {
  const home = mkdtempSync(join(tmpdir(), "hkbench-"));
  const bin = join(home, ".local", "bin");
  mkdirSync(bin, { recursive: true });
  for (const [n, body] of [["douyin-phone-adb", FAKE_CTL], ["ssh", FAKE_SSH_QUAL], ["scp", FAKE_SCP]]) {
    writeFileSync(join(bin, n), body); chmodSync(join(bin, n), 0o755);
  }
  const disc = join(home, "discover-fake.sh");
  writeFileSync(disc, FAKE_DISCOVER); chmodSync(disc, 0o755);
  return { home, env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, HARVEST_KEYWORD_TESTING: "1", DISCOVER_CMD: disc, ...extra } };
}
const ctl = (home) => (existsSync(join(home, "ctl.log")) ? readFileSync(join(home, "ctl.log"), "utf8") : "");
const run = (env) => spawnSync(ZSH, [HK, "P", "https%3A%2F%2Fv.douyin.com%2Fx", "4", "T-w1", "unlimited", "line"], { encoding: "utf8", env, timeout: 30000 });

test("对标流(WF_SOURCE_KIND=benchmark): 逐视频归位走 back-to-profile 5,绝不调 back-to-results", { skip: SKIP }, () => {
  const { home, env } = setup({ WF_SOURCE_KIND: "benchmark" });
  const r = run(env);
  assert.equal(r.status, 0, r.stderr);
  const log = ctl(home);
  assert.equal((log.match(/^back-to-profile 5$/gm) || []).length, 2, log);
  assert.doesNotMatch(log, /back-to-results/);
  assert.equal((log.match(/^tap-evidence /gm) || []).length, 2);
});

test("对标流回主页失败(取链接用 deep link 重开过视频,栈里是 feed) → 用对标链接重开主页重扫,从下一张继续", { skip: SKIP }, () => {
  // 0930 00:59 真机实证(cmd09290953 视频1): 取链接后 back 退到 feed,旧逻辑直接作废剩余 3 张卡
  const { home, env } = setup({ WF_SOURCE_KIND: "benchmark", BTP_FAIL: "1" });
  const r = run(env);
  assert.equal(r.status, 0, r.stderr);
  const log = ctl(home);
  assert.equal((log.match(/^tap-evidence /gm) || []).length, 2, "两张卡都应处理到: " + log);
  const disc = readFileSync(join(home, "disc.log"), "utf8").trim().split("\n");
  assert.equal(disc.length, 3, "首次发现 + 每张卡后各重开一次主页");
  assert.match(disc[1], /https%3A%2F%2Fv\.douyin\.com%2Fx/, "重开用的是本对标源链接");
  assert.match(r.stderr, /重开主页/);
  assert.doesNotMatch(log, /back-to-results/);
  assert.match(log, /lock-release T-w1/);
});

test("对标流重开主页也扫不到卡片 → 本源剩余候选作废,正常收工放锁", { skip: SKIP }, () => {
  const { home, env } = setup({ WF_SOURCE_KIND: "benchmark", BTP_FAIL: "1", DISC_EMPTY_AFTER_FIRST: "1" });
  const r = run(env);
  assert.equal(r.status, 0, r.stderr);
  const log = ctl(home);
  assert.equal((log.match(/^tap-evidence /gm) || []).length, 1, log);
  assert.match(r.stderr, /本对标源剩余候选到此为止/);
  assert.match(log, /lock-release T-w1/);
});

test("关键词流(不设 WF_SOURCE_KIND): 归位仍走 back-to-results,不调 back-to-profile", { skip: SKIP }, () => {
  const { home, env } = setup();
  const r = run(env);
  assert.equal(r.status, 0, r.stderr);
  const log = ctl(home);
  assert.match(log, /^back-to-results 4 /m);
  assert.doesNotMatch(log, /back-to-profile/);
});

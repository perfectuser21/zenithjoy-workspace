// 0930 夜间事故回归: 关键词流 back-to-results 命中兜底重搜(recovered_via=research)后重扫卡片成功,
// 旧代码执行 `CARD_ARR=(新卡片); i=0` 把进度清零从头处理。#2017(重扫前补切视频 tab)让重扫从
// "永远扫到 0 张(本词提前结束)"变成"能扫到 4 张",于是死循环: 处理视频 1 → 取链接(deep link 重开)
// 后 back 回不到结果页 → 重搜 → 重扫 → i=0 → 又是视频 1。真机 09-30 02:00~08:15 三部手机各重扫
// 116~160 次,卡在第 1/2 个词 6 小时,一直占到 8 点后的触达时窗。
// 修法: 重扫成功保留 i 从下一张继续(同一搜索词+同筛选,列表顺序稳定);每词重扫次数封顶,超限本词剩余候选作废。
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

// 假控制器: 每张卡都是图文帖(最短归位分支);back-to-results 每次都只能靠兜底重搜归位;
// search-video-cards 每次都返回同样的 $NCARDS 张卡(坐标 100*k, 200*k)
const FAKE_CTL = `#!/bin/sh
shift; shift
echo "$*" >> "$HOME/ctl.log"
case "$1" in
  lock-acquire) exit 0;;
  lock-release) printf 'lock=released owner=T\\n'; exit 0;;
  lock-refresh) printf 'lock=refreshed owner=T ttl=1800s\\n'; exit 0;;
  current-video-link) printf 'excluded_non_video=true\\n'; exit 0;;
  back-to-results) printf 'back_to_results=1 recovered_via=research\\n'; exit 0;;
  search-video-cards) k=1; while [ $k -le \${NCARDS:-4} ]; do printf '%s\\t%s\\t00:30\\t标题%s\\n' $((k*100)) $((k*200)) $k; k=$((k+1)); done; exit 0;;
esac
exit 0`;
// 假发现: 与重扫同一份列表(同一搜索词+同筛选,顺序稳定)
const FAKE_DISCOVER = `#!/bin/sh
k=1; while [ $k -le \${NCARDS:-4} ]; do printf '%s\\t%s\\t00:30\\t标题%s\\n' $((k*100)) $((k*200)) $k; k=$((k+1)); done
exit 0`;

function setup(extra = {}) {
  const home = mkdtempSync(join(tmpdir(), "hkrescan-"));
  const bin = join(home, ".local", "bin");
  mkdirSync(bin, { recursive: true });
  for (const [n, body] of [["douyin-phone-adb", FAKE_CTL], ["ssh", FAKE_SSH_QUAL], ["scp", FAKE_SCP]]) {
    writeFileSync(join(bin, n), body); chmodSync(join(bin, n), 0o755);
  }
  const disc = join(home, "discover-fake.sh");
  writeFileSync(disc, FAKE_DISCOVER); chmodSync(disc, 0o755);
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, HARVEST_KEYWORD_TESTING: "1", DISCOVER_CMD: disc, ...extra };
  delete env.WF_SOURCE_KIND;
  return { home, env };
}
const ctl = (home) => (existsSync(join(home, "ctl.log")) ? readFileSync(join(home, "ctl.log"), "utf8") : "");
const run = (env, maxv = "4") => spawnSync(ZSH, [HK, "P", encodeURIComponent("关键词"), maxv, "T-w1", "unlimited", "line"], { encoding: "utf8", env, timeout: 20000 });
const taps = (log) => log.match(/^tap-evidence .*$/gm) || [];

test("兜底重搜后重扫成功 → 从下一张继续,每张卡最多处理一次,有限时间内退出(不再 i=0 死循环)", { skip: SKIP }, () => {
  const { home, env } = setup({ NCARDS: "4" });
  const r = run(env);
  assert.notEqual(r.status, null, "harvest-keyword.sh 20 秒内没退出——重扫后进度清零死循环复现");
  assert.equal(r.status, 0, r.stderr.slice(-2000));
  const log = ctl(home);
  const t = taps(log);
  assert.ok(t.length <= 4, `tap-evidence ${t.length} 次 > 卡片数 4,同一张卡被反复处理`);
  assert.deepEqual(t.map((l) => l.split(" ").slice(1, 3).join(",")), ["100,200", "200,400", "300,600", "400,800"],
    "应按 1→2→3→4 顺序各点一次: " + t.join(" | "));
  assert.ok((log.match(/^search-video-cards /gm) || []).length <= 3, "每词重扫不得超过上限 3 次");
  assert.doesNotMatch(r.stderr, /从头处理/);
  assert.match(log, /lock-release T-w1/);
});

test("重扫次数超上限(默认 3) → 本词剩余候选作废并打日志,必然终止", { skip: SKIP }, () => {
  const { home, env } = setup({ NCARDS: "8" });
  const r = run(env, "8");
  assert.notEqual(r.status, null, "20 秒内没退出");
  assert.equal(r.status, 0, r.stderr.slice(-2000));
  const log = ctl(home);
  assert.equal((log.match(/^search-video-cards /gm) || []).length, 3, "重扫恰好 3 次后不再重扫");
  assert.equal(taps(log).length, 4, "第 4 次兜底重搜时超限: 处理过 4 张后本词收工");
  assert.match(r.stderr, /重扫次数超限/);
});

test("重扫上限可经 HARVEST_RESCAN_MAX 调整", { skip: SKIP }, () => {
  const { home, env } = setup({ NCARDS: "8", HARVEST_RESCAN_MAX: "1" });
  const r = run(env, "8");
  assert.equal(r.status, 0, r.stderr.slice(-2000));
  const log = ctl(home);
  assert.equal((log.match(/^search-video-cards /gm) || []).length, 1);
  assert.equal(taps(log).length, 2);
});

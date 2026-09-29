// discover-keyword.sh —— 从 harvest-keyword.sh 原样抽出的「发现」(决策 7f842d12 契约组装执行)。
// 发现接口(与对标发现共用,别改): discover-<variant>.sh PROFILE SOURCE_ENC MAXV TAG LOC
//   stdout 每行 X\tY\tDUR\tTITLE(最多 MAXV 行);无卡片 exit 0 空输出;失败 exit 1;日志走 stderr。
// harvest-keyword.sh 经 env DISCOVER_CMD 换发现实现,锁/seen-videos/trap 仍留在 harvest-keyword.sh。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FAKE_SSH_QUAL, FAKE_SCP } from "./qual-fakes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DK = join(HERE, "..", "discover-keyword.sh");
const HK = join(HERE, "..", "harvest-keyword.sh");
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
const SKIP = !ZSH && "no zsh (CI: sudo apt-get install -y zsh)";

// 假控制器: 子命令+参数记到 $HOME/ctl.log; OPEN_SEARCH_FAIL / FILTER_FAIL 控制失败; 卡片 3 张 + 一行噪声
const FAKE_CTL = `#!/bin/sh
shift; shift
echo "$*" >> "$HOME/ctl.log"
CMD="$1"
case "$CMD" in
  lock-acquire) exit 0;;
  lock-release) printf 'lock=released owner=TAG\\n'; exit 0;;
  open-search) [ "$OPEN_SEARCH_FAIL" = "1" ] && exit 1; exit 0;;
  search-time-layer) [ "$FILTER_FAIL" = "1" ] && exit 1; exit 0;;
  search-video-cards)
    [ "$NO_CARDS" = "1" ] && exit 0
    printf 'cards=3\\n100\\t200\\t0:15\\t标题一\\n110\\t210\\t1:02\\t标题二\\n120\\t220\\t0:40\\t标题三\\n'; exit 0;;
esac
exit 0`;

function setup(extra = {}) {
  const home = mkdtempSync(join(tmpdir(), "disc-"));
  const bin = join(home, ".local", "bin");
  mkdirSync(bin, { recursive: true });
  for (const [n, body] of [["douyin-phone-adb", FAKE_CTL], ["ssh", FAKE_SSH_QUAL], ["scp", FAKE_SCP]]) {
    writeFileSync(join(bin, n), body); chmodSync(join(bin, n), 0o755);
  }
  return { home, env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, HARVEST_KEYWORD_TESTING: "1", ...extra } };
}
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

test("discover-keyword: 与原 84-92 行同序列(打开App→搜索→视频tab→筛选→取卡),stdout 只出前 MAXV 张卡", { skip: SKIP }, () => {
  const { home, env } = setup();
  const r = spawnSync(ZSH, [DK, "P", "kw%E8%AF%8D", "2", "TAG-w1", "same_city"], { encoding: "utf8", env });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "100\t200\t0:15\t标题一\n110\t210\t1:02\t标题二\n");
  assert.deepEqual(read(join(home, "ctl.log")).trim().split("\n"), [
    "open-app",
    "open-search kw%E8%AF%8D",
    "search-video-tab TAG-w1-vtab",
    "search-time-layer six_months TAG-w1-filter most_liked unlimited unlimited same_city",
    "search-video-cards TAG-w1-cards",
  ]);
});

test("discover-keyword: 无卡片 → exit 0 空输出", { skip: SKIP }, () => {
  const { env } = setup({ NO_CARDS: "1" });
  const r = spawnSync(ZSH, [DK, "P", "kw", "4", "T", "unlimited"], { encoding: "utf8", env });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
});

test("discover-keyword: open-search/筛选失败 → exit 1,原日志措辞走 stderr", { skip: SKIP }, () => {
  const a = spawnSync(ZSH, [DK, "P", "kw", "4", "T", "unlimited"], { encoding: "utf8", env: setup({ OPEN_SEARCH_FAIL: "1" }).env });
  assert.equal(a.status, 1);
  assert.match(a.stderr, /open-search失败/);
  assert.equal(a.stdout, "");
  const b = spawnSync(ZSH, [DK, "P", "kw", "4", "T", "unlimited"], { encoding: "utf8", env: setup({ FILTER_FAIL: "1" }).env });
  assert.equal(b.status, 1);
  assert.match(b.stderr, /筛选失败/);
});

test("harvest-keyword: DISCOVER_CMD 注入 → 以 PROFILE SOURCE_ENC MAXV TAG LOC 调用,无卡片正常收工且放锁", { skip: SKIP }, () => {
  const { home, env } = setup();
  const fake = join(home, "discover-fake.sh");
  writeFileSync(fake, `#!/bin/sh\necho "$*" > "$HOME/disc-argv.log"\nexit 0\n`); chmodSync(fake, 0o755);
  const r = spawnSync(ZSH, [HK, "P", "https%3A%2F%2Fv.douyin.com%2Fx", "5", "TAG-w1", "unlimited", "line"], { encoding: "utf8", env: { ...env, DISCOVER_CMD: fake } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(join(home, "disc-argv.log")).trim(), "P https%3A%2F%2Fv.douyin.com%2Fx 5 TAG-w1 unlimited");
  assert.match(r.stderr, /无卡片/);
  const ctl = read(join(home, "ctl.log"));
  assert.match(ctl, /lock-acquire TAG-w1/);
  assert.match(ctl, /lock-release TAG-w1/);
  assert.doesNotMatch(ctl, /open-search/, "注入了发现实现就不该再走关键词搜索");
});

test("harvest-keyword: 发现失败(exit 1) → harvest-keyword exit 1(与改前 open-search 失败同出口码)", { skip: SKIP }, () => {
  const { home, env } = setup();
  const fake = join(home, "discover-fail.sh");
  writeFileSync(fake, `#!/bin/sh\nexit 1\n`); chmodSync(fake, 0o755);
  const r = spawnSync(ZSH, [HK, "P", "kw", "4", "T"], { encoding: "utf8", env: { ...env, DISCOVER_CMD: fake } });
  assert.equal(r.status, 1);
  assert.match(read(join(home, "ctl.log")), /lock-release T/);
});

test("harvest-keyword: 不设 DISCOVER_CMD → 默认走同目录 discover-keyword.sh(关键词路径不变)", { skip: SKIP }, () => {
  const { home, env } = setup({ NO_CARDS: "1" });
  const r = spawnSync(ZSH, [HK, "P", "kw", "4", "T"], { encoding: "utf8", env });
  assert.equal(r.status, 0, r.stderr);
  assert.match(read(join(home, "ctl.log")), /open-search kw\nsearch-video-tab T-vtab\nsearch-time-layer six_months T-filter most_liked unlimited unlimited same_city\nsearch-video-cards T-cards/);
  assert.match(r.stderr, /无卡片/);
});

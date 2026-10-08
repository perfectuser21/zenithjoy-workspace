// services/phone-adb-controller/__tests__/discovery-v2.test.mjs
//
// 获客产量恢复 A 段(Brain 任务 9a8784b7)·发现改造,只对 config/discovery-v2.profiles 里的号生效(先试 jinoshengyuan-work):
// 10-07/08 金诺 work 号整批 0 LEAD——搜索按「最多点赞」+ 每词只取前 4 张,同一个词天天拿到同样 4 个老视频,
// 点开取链接才发现「视频已处理过」(视频库 jinuo 342 条),一批 12 词白跑 40 分钟。
// 改后: 按「最新」排序;每词往下翻屏取到 20 张;点开之前先按 标题 对库里历史去重、按 标题+作者 本轮去重、
// 跳过自家号作者;剩下的才点开取链接,取到链接后仍按 video_id 复核(原有 seen-videos 一道不动)。
// 其他号(legacy/悦升)行为不变。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FAKE_SCP } from "./qual-fakes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");
const DPA = join(SRC, "douyin-phone-adb");
const DK = join(SRC, "discover-keyword.sh");
const HK = join(SRC, "harvest-keyword.sh");
const LIB = join(SRC, "discovery-v2-lib.sh");
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
const SKIP = !ZSH && "no zsh (CI: sudo apt-get install -y zsh)";
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

test("卡片解析带出作者列(真机网格 fixture): X Y DUR 标题 作者", { skip: SKIP }, () => {
  const dir = mkdtempSync(join(tmpdir(), "dv2-xml-"));
  const reg = join(dir, "profiles.tsv");
  writeFileSync(reg, "legacy\tSER1\tANY-MODEL\t1199\t2663\n");
  const r = spawnSync(ZSH, [DPA, "--profile", "legacy", "video-cards-from-xml", join(HERE, "fixtures", "real-search-results-grid.xml")],
    { encoding: "utf8", env: { ...process.env, DOUYIN_PHONE_REGISTRY: reg } });
  assert.equal(r.status, 0, r.stderr);
  const rows = r.stdout.trim().split("\n").map((l) => l.split("\t"));
  assert.equal(rows.length, 4, r.stdout);
  for (const row of rows) assert.equal(row.length, 5, `应为 5 列: ${row.join(" | ")}`);
  const authorOf = (prefix) => rows.find((row) => row[3].startsWith(prefix))?.[4];
  assert.equal(authorOf("AI反向操作"), "陈乔维Justin");
  assert.equal(authorOf("接连发生AI失控事件"), "央视财经");
  assert.equal(authorOf("《0.004》"), "横空出世（AIGC）");
  assert.equal(authorOf("普通人如何学习AI"), "冤种小徐");
  assert.deepEqual(rows[0].slice(0, 3), ["303", "1459", "00:40"], "前 4 列与原格式一致");
});

test("开关: 环境变量优先,未设读 config/discovery-v2.profiles;只有名单内的号开 v2", { skip: SKIP }, () => {
  const probe = (profile, extra = {}) => {
    const env = { ...process.env, ...extra };
    if (!("DISCOVERY_V2_PROFILES" in extra)) delete env.DISCOVERY_V2_PROFILES;
    return spawnSync(ZSH, ["-c", `source ${LIB}; discovery_v2_on ${profile} && print on || print off`], { encoding: "utf8", env }).stdout.trim();
  };
  assert.equal(probe("jinoshengyuan-work"), "on", "仓库配置默认只开金诺 work 号");
  assert.equal(probe("legacy"), "off");
  assert.equal(probe("yuesheng-m1"), "off");
  assert.equal(probe("legacy", { DISCOVERY_V2_PROFILES: "legacy,other" }), "on");
  assert.equal(probe("jinoshengyuan-work", { DISCOVERY_V2_PROFILES: "" }), "off", "显式置空 = 全关(回滚开关)");
  assert.match(read(join(SRC, "config", "discovery-v2.profiles")), /^jinoshengyuan-work$/m);
});

// 假控制器: 网格分屏,每屏 4 张卡;search-grid-scroll up/down 改当前屏号(存 $HOME/screen);
// 第 n 屏卡片 = 标题n-1..n-4,且第 n 屏(n>0)第 1 张重复上一屏最后一张(翻屏有重叠,必须按标题去重)。
// back-to-results: BTR_RESEARCH=1 → 兜底重搜(屏号归 0),否则原地返回(屏号不变)。
const FAKE_GRID_CTL = `#!/bin/sh
shift; shift
echo "$*" >> "$HOME/ctl.log"
S=$(cat "$HOME/screen" 2>/dev/null || echo 0)
cards(){ n=$1; k=1; while [ $k -le 4 ]; do
  if [ "$n" -gt 0 ] && [ $k -eq 1 ]; then t="标题$((n-1))-4"; else t="标题$n-$k"; fi
  a="作者$n-$k"; [ "$t" = "标题0-3" ] && a="躺赢AI学姐"
  printf '%s\\t%s\\t00:30\\t%s\\t%s\\n' $((k*100)) $((n*1000+k*10)) "$t" "$a"; k=$((k+1)); done; }
case "$1" in
  lock-acquire) exit 0;;
  lock-release) printf 'lock=released owner=T\\n'; exit 0;;
  lock-refresh) printf 'lock=refreshed owner=T ttl=1800s\\n'; exit 0;;
  open-search) echo 0 > "$HOME/screen"; exit 0;;
  search-grid-scroll) if [ "$3" = down ]; then [ "$S" -gt 0 ] && S=$((S-1)); else S=$((S+1)); fi; echo $S > "$HOME/screen"; exit 0;;
  search-video-cards) [ "$S" -ge \${NSCREENS:-9} ] && exit 0; cards "$S"; exit 0;;
  current-video-link) printf 'excluded_non_video=true\\n'; exit 0;;
  back-to-results) if [ "$BTR_RESEARCH" = 1 ]; then echo 0 > "$HOME/screen"; printf 'back_to_results=1 recovered_via=research\\n'; else printf 'back_to_results=1 backs=1\\n'; fi; exit 0;;
esac
exit 0`;
// 假 ssh: fetch-seen-titles 回历史标题(第 0 屏第 2 张见过);其他 ssh 静默
const FAKE_SSH_TITLES = `#!/bin/sh
echo "$*" >> "$HOME/ssh.log"
case "$*" in
  *fetch-seen-titles.js*) printf '标题0-2\\n';;
esac
exit 0`;

function setup(extra = {}) {
  const home = mkdtempSync(join(tmpdir(), "dv2-"));
  const bin = join(home, ".local", "bin");
  mkdirSync(bin, { recursive: true });
  for (const [n, body] of [["douyin-phone-adb", FAKE_GRID_CTL], ["ssh", FAKE_SSH_TITLES], ["scp", FAKE_SCP]]) {
    writeFileSync(join(bin, n), body); chmodSync(join(bin, n), 0o755);
  }
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, HARVEST_KEYWORD_TESTING: "1", DISCOVERY_V2_PROFILES: "P", ...extra };
  delete env.WF_SOURCE_KIND;
  delete env.DISCOVER_CMD;
  return { home, env };
}
const ctlLines = (home) => read(join(home, "ctl.log")).trim().split("\n").filter(Boolean);

test("v2 发现: 按「最新」筛选,往下翻屏按标题去重取满 20 张,输出带作者+屏号,收尾翻回顶部", { skip: SKIP }, () => {
  const { home, env } = setup();
  const r = spawnSync(ZSH, [DK, "P", "kw", "4", "T-w1", "unlimited"], { encoding: "utf8", env });
  assert.equal(r.status, 0, r.stderr);
  const rows = r.stdout.trim().split("\n").map((l) => l.split("\t"));
  assert.equal(rows.length, 20, "MAXV=4 在 v2 下不再截断,取满 20 张:\n" + r.stdout);
  assert.equal(new Set(rows.map((x) => x[3])).size, 20, "翻屏重叠的卡按标题去重");
  for (const row of rows) assert.equal(row.length, 6, row.join(" | "));
  assert.deepEqual(rows[0], ["100", "10", "00:30", "标题0-1", "作者0-1", "0"]);
  assert.equal(rows[4][3], "标题1-2", "第 1 屏第 1 张是上一屏重复,跳过");
  assert.equal(rows[4][5], "1");
  const log = ctlLines(home);
  assert.ok(log.includes("search-time-layer six_months T-w1-filter latest unlimited unlimited unlimited"), log.join("\n"));
  assert.ok(!log.some((l) => / most_liked /.test(l)), "v2 不再按最多点赞");
  const ups = log.filter((l) => /^search-grid-scroll .* up$/.test(l)).length;
  const downs = log.filter((l) => /^search-grid-scroll .* down$/.test(l)).length;
  assert.equal(ups, 6, "20 张需要翻到第 6 屏(每屏新 3 张)");
  assert.ok(downs >= ups, "收尾翻回顶部,后续按屏号定位从 0 屏算起");
  assert.equal(read(join(home, "screen")).trim(), "0");
});

test("v2 发现: 翻到底(没有新卡)提前收手,不空翻", { skip: SKIP }, () => {
  const { home, env } = setup({ NSCREENS: "2" });
  const r = spawnSync(ZSH, [DK, "P", "kw", "4", "T-w1", "unlimited"], { encoding: "utf8", env });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim().split("\n").length, 7);
  const ups = ctlLines(home).filter((l) => /^search-grid-scroll .* up$/.test(l)).length;
  assert.equal(ups, 2, "第 2 屏扫不到新卡即停");
});

test("名单外的号: discover-keyword 原样(最多点赞 + head MAXV,不翻屏)", { skip: SKIP }, () => {
  const { home, env } = setup({ DISCOVERY_V2_PROFILES: "jinoshengyuan-work" });
  const r = spawnSync(ZSH, [DK, "legacy", "kw", "4", "T-w1", "unlimited"], { encoding: "utf8", env });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim().split("\n").length, 4);
  const log = ctlLines(home);
  assert.ok(log.includes("search-time-layer six_months T-w1-filter most_liked unlimited unlimited unlimited"));
  assert.ok(!log.some((l) => l.startsWith("search-grid-scroll")));
});

const runHK = (env, profile = "P") =>
  spawnSync(ZSH, [HK, profile, encodeURIComponent("关键词"), "4", "T-w1", "unlimited", "jinuo"], { encoding: "utf8", env, timeout: 30000 });
const tappedTitles = (home) => {
  // 每次 tap-evidence 前最后一次 search-video-cards 定位;直接用 tap 坐标反查: y = 屏号*1000 + k*10
  return ctlLines(home).filter((l) => l.startsWith("tap-evidence ")).map((l) => {
    const [, x, y] = l.split(" ");
    const n = Math.floor(Number(y) / 1000), k = Number(x) / 100;
    return n > 0 && k === 1 ? `标题${n - 1}-4` : `标题${n}-${k}`;
  });
};

test("v2 采收: 点开之前先去重——历史标题/自家号/本轮重复都不点,漏斗计数进日志", { skip: SKIP }, () => {
  const { home, env } = setup({ NSCREENS: "2" });
  const r = runHK(env);
  assert.equal(r.status, 0, r.stderr.slice(-3000));
  const t = tappedTitles(home);
  assert.ok(!t.includes("标题0-2"), "库里见过的标题不点");
  assert.ok(!t.includes("标题0-3"), "自家号作者的卡不点");
  assert.deepEqual(t, ["标题0-1", "标题0-4", "标题1-2", "标题1-3", "标题1-4"], t.join(","));
  assert.match(r.stderr, /发现漏斗: 卡片=7 历史已见=1 本轮重复=0 自家号=1 待点=5/);
  assert.match(read(join(home, "ssh.log")), /fetch-seen-titles\.js 'jinuo'/);
});

test("v2 采收: 第 1 屏的卡先翻屏再按标题重新定位坐标;兜底重搜后重设「最新」、屏号归 0,不受旧 3 次重扫上限截断", { skip: SKIP }, () => {
  const { home, env } = setup({ NSCREENS: "2", BTR_RESEARCH: "1" });
  const r = runHK(env);
  assert.equal(r.status, 0, r.stderr.slice(-3000));
  assert.deepEqual(tappedTitles(home), ["标题0-1", "标题0-4", "标题1-2", "标题1-3", "标题1-4"]);
  const log = ctlLines(home);
  assert.ok(log.filter((l) => / -rescan-filter latest /.test(l)).length >= 4, "重搜后筛选重设为最新");
  assert.ok(!log.some((l) => / most_liked /.test(l)));
  assert.doesNotMatch(r.stderr, /重扫次数超限/);
});

test("v2 采收: 同一批里前面词已点过的标题,后面词不再点(本轮跨词去重)", { skip: SKIP }, () => {
  const { home, env } = setup({ NSCREENS: "1", HARVEST_BATCH: "B1" });
  runHK(env);
  const first = tappedTitles(home);
  assert.deepEqual(first, ["标题0-1", "标题0-4"]);
  writeFileSync(join(home, "ctl.log"), "");
  const r2 = runHK({ ...env });
  assert.equal(r2.status, 0, r2.stderr.slice(-3000));
  assert.deepEqual(tappedTitles(home), [], "第二个词同样的卡已在本批处理过");
  assert.match(r2.stderr, /本轮重复=2/);
});

test("v2 采收: 每词限时(HARVEST_V2_WORD_SECONDS)到点不开下一个视频", { skip: SKIP }, () => {
  const { home, env } = setup({ NSCREENS: "2", HARVEST_V2_WORD_SECONDS: "0" });
  const r = runHK(env);
  assert.equal(r.status, 0, r.stderr.slice(-3000));
  assert.deepEqual(tappedTitles(home), []);
  assert.match(r.stderr, /本词限时\(0s\)到/);
});

test("fetch-seen-titles: 按业务线查视频库已有标题,去空白去空值", async () => {
  const { createRequire } = await import("node:module");
  const { seenTitles } = createRequire(import.meta.url)("../fetch-seen-titles.js");
  const calls = [];
  const pool = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [{ title: " 标题 一\n第二行 " }, { title: "" }, { title: null }, { title: "标题二" }] }; } };
  assert.deepEqual(await seenTitles(pool, "jinuo"), ["标题 一 第二行", "标题二"]);
  assert.match(calls[0].sql, /FROM zenithjoy\.leadgen_videos/);
  assert.deepEqual(calls[0].params, ["jinuo"]);
});

test("名单外的号: harvest-keyword 不拉历史标题、不预去重", { skip: SKIP }, () => {
  const { home, env } = setup({ NSCREENS: "1", DISCOVERY_V2_PROFILES: "jinoshengyuan-work" });
  const r = runHK(env, "legacy");
  assert.equal(r.status, 0, r.stderr.slice(-3000));
  assert.doesNotMatch(read(join(home, "ssh.log")), /fetch-seen-titles/);
  assert.doesNotMatch(r.stderr, /发现漏斗/);
  assert.equal(ctlLines(home).filter((l) => l.startsWith("tap-evidence ")).length, 4);
});

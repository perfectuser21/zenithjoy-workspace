// 0930 夜间事故回归: 采收卡在重扫死循环里一直跑到 8 点后,占住了触达时窗(8–22 点是触达的地盘)。
// wf-run.sh 只在开跑前预检一次时窗,跑起来之后没人管。修法: batch2.sh 每个词开头按同一口径
// (date +%H, 8 <= H < 22)判时窗,到点不再开新词,记「触达时窗到,采收收工」后跳出循环,
// 照常走落池/分拣——已采到的线索必须落池,不能丢。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BATCH2 = join(HERE, "..", "batch2.sh");
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
const SKIP = !ZSH && "no zsh (CI: sudo apt-get install -y zsh)";

// 假 harvest-keyword.sh: 记录被调的词,吐一条 VIDEO + LEAD;采完第一个词后把"当前小时"拨到 $HOUR_AFTER
const FAKE_HK = `#!/bin/zsh
W=$(python3 -c "import urllib.parse,sys;print(urllib.parse.unquote(sys.argv[1]))" "$2")
print -r -- "$W" >> "$HOME/hk.log"
print "VIDEO\\t1\\thttps://v/1\\ttitle\\t$W\\t1"
print "LEAD\\tnick\\tid1\\tpersonal\\tbody\\t09-01\\t上海\\ttitle\\t$W\\t\\t\\thttps://v/1"
[ -n "$HOUR_AFTER" ] && print -r -- "$HOUR_AFTER" > "$HOME/hour"
exit 0`;
// 假 date: 只接管 +%H(读 $HOME/hour),其余原样交给系统 date(日志时间戳)
const FAKE_DATE = `#!/bin/sh
if [ "$1" = "+%H" ]; then cat "$HOME/hour"; exit 0; fi
exec /bin/date "$@"`;
const FAKE_SSH = `#!/bin/sh
echo "$*" >> "$HOME/ssh.log"; exit 0`;

function setup(words, startHour, extra = {}) {
  const home = mkdtempSync(join(tmpdir(), "b2win-"));
  const bin = join(home, ".local", "bin");
  mkdirSync(bin, { recursive: true });
  for (const [n, body] of [["date", FAKE_DATE], ["ssh", FAKE_SSH], ["scp", FAKE_SSH]]) {
    writeFileSync(join(bin, n), body); chmodSync(join(bin, n), 0o755);
  }
  const hk = join(home, "hk-fake.sh"); writeFileSync(hk, FAKE_HK); chmodSync(hk, 0o755);
  writeFileSync(join(home, "hour"), startHour + "\n");
  const wf = join(home, "kw.txt"); writeFileSync(wf, words.join("\n") + "\n");
  const env = { ...process.env, HOME: home, HARVEST_KEYWORD: hk, WFR_DISABLED: "1", BATCH_SLEEP: "0", WALL_REPORT: "/nonexistent", ...extra };
  delete env.BATCH2_NOW_HOUR;
  return { home, wf, env };
}
const readOr = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const run = (c) => spawnSync(ZSH, [BATCH2, "p1", c.wf, "t9", "1", ""], { encoding: "utf8", env: c.env, timeout: 30000 });

test("夜里开跑、采完第 1 个词时已到 8 点 → 不再开新词,记「触达时窗到,采收收工」,已采线索照常落池+分拣", { skip: SKIP }, () => {
  const c = setup(["词一", "词二", "词三"], "07", { HOUR_AFTER: "08" });
  const r = run(c);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readOr(join(c.home, "hk.log")).trim(), "词一", "8 点后不应再开新词");
  const log = readOr(join(c.home, "night-t9.log"));
  assert.match(log, /触达时窗到,采收收工/);
  const ssh = readOr(join(c.home, "ssh.log"));
  assert.match(ssh, /push-videos\.js/, "已采到的线索必须落池");
  assert.match(ssh, /push-raw-comments\.js/);
  assert.match(ssh, /sort-comments\.js/, "落池后照常分拣");
});

test("22 点起(含 22 点)是采收时段 → 词全部照跑", { skip: SKIP }, () => {
  const c = setup(["a", "b"], "22");
  const r = run(c);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readOr(join(c.home, "hk.log")).trim().split("\n"), ["a", "b"]);
  assert.doesNotMatch(readOr(join(c.home, "night-t9.log")), /触达时窗到/);
});

test("白天 21 点开跑 → 第 1 个词都不开,不落池空文件", { skip: SKIP }, () => {
  const c = setup(["a", "b"], "21");
  const r = run(c);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readOr(join(c.home, "hk.log")), "");
  assert.match(readOr(join(c.home, "night-t9.log")), /触达时窗到,采收收工/);
  assert.doesNotMatch(readOr(join(c.home, "ssh.log")), /push-videos\.js/);
});

test("BATCH2_NOW_HOUR 可覆盖当前小时(测试/演练用)", { skip: SKIP }, () => {
  const c = setup(["a"], "03", { BATCH2_NOW_HOUR: "10" });
  const r = run(c);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readOr(join(c.home, "hk.log")), "");
});

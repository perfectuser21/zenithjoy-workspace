// 整批总时限(任务 7d150e33,决策 3c98fb36 阶段1): wf-run.sh 起跑 export WF_RUN_START_TS/WF_RUN_MAX_SECONDS(默认 14400),
// batch2.sh 每个词开头判到点——到点不再开新词,记「整批总时限到,采收收工」后跳出循环,已采线索照常落池+分拣(不能丢),
// 末尾向 stdout 打 BATCH2_STOP_REASON=deadline 供 wf-run.sh 把账本终态记成 partial。不 kill、不打断正在采的词。
// 没有 WF_RUN_START_TS(脚本被单独手跑)→ 永不到点,行为与并入前一致。
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

// 假 harvest-keyword.sh: 记录被调的词,吐一条 VIDEO + LEAD;采完一个词后把"当前时刻"拨到 $NOW_AFTER(模拟这个词跑过了总时限)
const FAKE_HK = `#!/bin/zsh
W=$(python3 -c "import urllib.parse,sys;print(urllib.parse.unquote(sys.argv[1]))" "$2")
print -r -- "$W" >> "$HOME/hk.log"
print "VIDEO\\t1\\thttps://v/1\\ttitle\\t$W\\t1"
print "LEAD\\tnick\\tid1\\tpersonal\\tbody\\t09-01\\t上海\\ttitle\\t$W\\t\\t\\thttps://v/1"
[ -n "$NOW_AFTER" ] && print -r -- "$NOW_AFTER" > "$HOME/now"
exit 0`;
// 假 date: 接管 +%s(读 $HOME/now)与 +%H(固定 23 点,采收时段),其余原样交给系统 date(日志时间戳)
const FAKE_DATE = `#!/bin/sh
if [ "$1" = "+%s" ]; then cat "$HOME/now"; exit 0; fi
if [ "$1" = "+%H" ]; then echo 23; exit 0; fi
exec /bin/date "$@"`;
const FAKE_SSH = `#!/bin/sh
echo "$*" >> "$HOME/ssh.log"; exit 0`;

function setup(words, now, extra = {}) {
  const home = mkdtempSync(join(tmpdir(), "b2dl-"));
  const bin = join(home, ".local", "bin");
  mkdirSync(bin, { recursive: true });
  for (const [n, body] of [["date", FAKE_DATE], ["ssh", FAKE_SSH], ["scp", FAKE_SSH]]) {
    writeFileSync(join(bin, n), body); chmodSync(join(bin, n), 0o755);
  }
  const hk = join(home, "hk-fake.sh"); writeFileSync(hk, FAKE_HK); chmodSync(hk, 0o755);
  writeFileSync(join(home, "now"), now + "\n");
  const wf = join(home, "kw.txt"); writeFileSync(wf, words.join("\n") + "\n");
  const env = { ...process.env, HOME: home, HARVEST_KEYWORD: hk, WFR_DISABLED: "1", BATCH_SLEEP: "0", WALL_REPORT: "/nonexistent" };
  delete env.BATCH2_NOW_HOUR; delete env.WF_RUN_START_TS; delete env.WF_RUN_MAX_SECONDS; delete env.WF_NOW_TS;
  Object.assign(env, extra);
  return { home, wf, env };
}
const readOr = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const run = (c) => spawnSync(ZSH, [BATCH2, "p1", c.wf, "t9", "1", ""], { encoding: "utf8", env: c.env, timeout: 30000 });

test("采完第 1 个词时总时限已到 → 不再开新词,记「整批总时限到」,已采线索照常落池+分拣,stdout 报 BATCH2_STOP_REASON=deadline", { skip: SKIP }, () => {
  const c = setup(["词一", "词二", "词三"], "1010", { WF_RUN_START_TS: "1000", WF_RUN_MAX_SECONDS: "100", NOW_AFTER: "1100" });
  const r = run(c);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readOr(join(c.home, "hk.log")).trim(), "词一", "到点后不应再开新词");
  const log = readOr(join(c.home, "night-t9.log"));
  assert.match(log, /整批总时限到\(100s\),采收收工\(词2: 词二 起未开跑\)/);
  const ssh = readOr(join(c.home, "ssh.log"));
  assert.match(ssh, /push-videos\.js/, "已采到的线索必须落池");
  assert.match(ssh, /push-raw-comments\.js/);
  assert.match(ssh, /sort-comments\.js/, "落池后照常分拣");
  assert.match(r.stdout, /^BATCH2_STOP_REASON=deadline$/m);
});

test("未到点 → 词全部照跑,不报 STOP_REASON", { skip: SKIP }, () => {
  const c = setup(["a", "b"], "1010", { WF_RUN_START_TS: "1000", WF_RUN_MAX_SECONDS: "14400", NOW_AFTER: "1020" });
  const r = run(c);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readOr(join(c.home, "hk.log")).trim().split("\n"), ["a", "b"]);
  assert.doesNotMatch(readOr(join(c.home, "night-t9.log")), /整批总时限到/);
  assert.doesNotMatch(r.stdout, /BATCH2_STOP_REASON/);
});

test("没有 WF_RUN_START_TS(单独手跑 batch2)→ 永不到点,行为不变", { skip: SKIP }, () => {
  const c = setup(["a", "b"], "99999999999", { NOW_AFTER: "99999999999" });
  const r = run(c);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readOr(join(c.home, "hk.log")).trim().split("\n"), ["a", "b"]);
  assert.doesNotMatch(r.stdout, /BATCH2_STOP_REASON/);
});

test("起跑时就已到点 → 第 1 个词都不开,不落池空文件,仍报 deadline", { skip: SKIP }, () => {
  const c = setup(["a"], "5000", { WF_RUN_START_TS: "1000", WF_RUN_MAX_SECONDS: "100" });
  const r = run(c);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readOr(join(c.home, "hk.log")), "");
  assert.doesNotMatch(readOr(join(c.home, "ssh.log")), /push-videos\.js/);
  assert.match(r.stdout, /^BATCH2_STOP_REASON=deadline$/m);
});

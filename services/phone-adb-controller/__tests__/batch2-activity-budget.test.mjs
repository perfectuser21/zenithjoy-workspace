// 每活动超时读契约预算(任务 7d150e33,决策 3c98fb36 阶段1): wf-plan 把契约 budget.max_duration_s 编进 .plan
// (WF_BUDGET_<key>),wf-run.sh export 给 batch2。batch2 的落池段(delivery)/分拣段(scoring)是 ssh 远程调用,
// 用 wf_run_bounded 封顶;超时按契约 failure 分类: delivery 的 retryable 含「scp/ssh 失败」→ 重试 1 次,
// scoring 没有 → 记账进入下一单元。任何超时都不得让整批崩(出口 0、该落的账照落)。
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

const FAKE_HK = `#!/bin/zsh
print "VIDEO\\t1\\thttps://v/1\\ttitle\\tw\\t1"
print "LEAD\\tnick\\tid1\\tpersonal\\tbody\\t09-01\\t上海\\ttitle\\tw\\t\\t\\thttps://v/1"
exit 0`;
// 假 ssh: 落池命令睡 $SSH_PUSH_SLEEP 秒、分拣命令睡 $SSH_SORT_SLEEP 秒(模拟远端卡住),每次调用记一行
const FAKE_SSH = `#!/bin/sh
echo "$*" >> "$HOME/ssh.log"
case "$*" in
  *push-videos.js*) [ -n "$SSH_PUSH_SLEEP" ] && sleep "$SSH_PUSH_SLEEP";;
  *sort-comments.js*) [ -n "$SSH_SORT_SLEEP" ] && sleep "$SSH_SORT_SLEEP";;
esac
exit 0`;

function setup(extra = {}) {
  const home = mkdtempSync(join(tmpdir(), "b2bud-"));
  const bin = join(home, ".local", "bin");
  mkdirSync(bin, { recursive: true });
  for (const [n, body] of [["ssh", FAKE_SSH], ["scp", "#!/bin/sh\nexit 0"]]) { writeFileSync(join(bin, n), body); chmodSync(join(bin, n), 0o755); }
  const hk = join(home, "hk-fake.sh"); writeFileSync(hk, FAKE_HK); chmodSync(hk, 0o755);
  const wf = join(home, "kw.txt"); writeFileSync(wf, "a\n");
  const env = { ...process.env, HOME: home, HARVEST_KEYWORD: hk, WFR_DISABLED: "1", BATCH_SLEEP: "0", WALL_REPORT: "/nonexistent", BATCH2_NOW_HOUR: "23", WF_BOUNDED_POLL: "0.1" };
  for (const k of Object.keys(env)) if (/^WF_(BUDGET|TIMEOUT_CLASS)_/.test(k)) delete env[k];
  Object.assign(env, extra);
  return { home, wf, env };
}
const readOr = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const count = (s, re) => (s.match(re) || []).length;
const run = (c) => spawnSync(ZSH, [BATCH2, "p1", c.wf, "t9", "1", ""], { encoding: "utf8", env: c.env, timeout: 40000 });

test("落池超 WF_BUDGET_delivery 且契约分类 retryable → 记「落池超预算」并重试 1 次,批不崩、分拣照跑", { skip: SKIP }, () => {
  const c = setup({ SSH_PUSH_SLEEP: "2", WF_BUDGET_delivery: "1", WF_TIMEOUT_CLASS_delivery: "retryable" });
  const t0 = Date.now();
  const r = run(c);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(Date.now() - t0 < 8000, "两次各 1s 预算就该返回,不能等远端睡完");
  const ssh = readOr(join(c.home, "ssh.log"));
  assert.equal(count(ssh, /push-videos\.js/g), 2, "超时后按 retryable 重试恰好 1 次: " + ssh);
  assert.equal(count(ssh, /sort-comments\.js/g), 1, "落池两次都超时也照常进入分拣");
  const log = readOr(join(c.home, "night-t9.log"));
  assert.match(log, /落池超预算\(1s\),契约 retryable 重试 1 次/);
  assert.match(log, /落池超预算\(1s\),重试仍超时,记账进入下一单元/);
});

test("分拣超 WF_BUDGET_scoring 且分类 record → 记「分拣超预算」不重试,出口 0", { skip: SKIP }, () => {
  const c = setup({ SSH_SORT_SLEEP: "2", WF_BUDGET_scoring: "1", WF_TIMEOUT_CLASS_scoring: "record" });
  const r = run(c);
  assert.equal(r.status, 0, r.stderr);
  const ssh = readOr(join(c.home, "ssh.log"));
  assert.equal(count(ssh, /sort-comments\.js/g), 1);
  assert.equal(count(ssh, /push-videos\.js/g), 1, "落池未超时不重试");
  assert.match(readOr(join(c.home, "night-t9.log")), /分拣超预算\(1s\),记账进入下一单元/);
});

test("未设预算(计划没给/单独手跑)→ 不限时,远端慢也等它跑完,不重试", { skip: SKIP }, () => {
  const c = setup({ SSH_PUSH_SLEEP: "1" });
  const r = run(c);
  assert.equal(r.status, 0, r.stderr);
  const ssh = readOr(join(c.home, "ssh.log"));
  assert.equal(count(ssh, /push-videos\.js/g), 1);
  assert.doesNotMatch(readOr(join(c.home, "night-t9.log")), /超预算/);
});

test("harvest-keyword 出口码 4(发现段超预算)→ 词记账 failed budget_exceeded,批继续下一个词", { skip: SKIP }, () => {
  const c = setup();
  const hk4 = join(c.home, "hk4.sh");
  writeFileSync(hk4, `#!/bin/zsh
W=$(python3 -c "import urllib.parse,sys;print(urllib.parse.unquote(sys.argv[1]))" "$2")
print -r -- "$W" >> "$HOME/hk.log"
[[ "$W" == a ]] && exit 4
print "LEAD\\tnick\\tid1\\tpersonal\\tbody\\t09-01\\t上海\\ttitle\\t$W\\t\\t\\thttps://v/1"
exit 0`); chmodSync(hk4, 0o755);
  writeFileSync(c.wf, "a\nb\n");
  c.env.HARVEST_KEYWORD = hk4;
  const r = run(c);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readOr(join(c.home, "hk.log")).trim().split("\n"), ["a", "b"], "超预算的词不拦后面的词");
  assert.match(readOr(join(c.home, "night-t9.log")), /词1 完成 LEAD=0/);
  assert.match(readOr(join(c.home, "ssh.log")), /push-videos\.js/, "b 采到的线索照常落池");
});

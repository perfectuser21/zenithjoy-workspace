// log-bridge-liveness.sh 行为测试——MMV 日志桥活性守卫(任务 975aa6ec)。
// 事故: 日志桥断了 12 天没人知道(09-18→09-30),escort 一直读死文件。守卫装在 MMV launchd 每 10 分钟跑:
// 有 run 在跑(Brain workflow_run in_progress 含该机器,或 ssh 该机 pgrep 到执行链进程)且 <host>-live.log
// 超 30 分钟没更新 → Bark 一次/小时;没 run 在跑的停更是正常空闲,不吵。
// 做法: PATH 前置假 curl(Brain 查询回放 $FAKE/brain.json;api.day.app 调用记到 bark-calls.log)+假 ssh(pgrep 按
//       $FAKE/hosts/<host>/running 回放);文件新鲜度用 utimes 造。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, mkdirSync, existsSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");
const SCRIPT = join(SRC, "log-bridge-liveness.sh");
const PLIST = join(SRC, "launchd", "com.zenithjoy.logbridge-liveness.plist");

const FAKE_CURL = `#!/bin/bash
# 记全部 argv;按 URL 分流: Brain → 回放 brain.json;api.day.app → 记 bark 调用并回 200
printf '%s\\n' "$*" >> "$FAKE/curl-calls.log"
url=""; data=""
while [ $# -gt 0 ]; do case "$1" in -d|--data|--data-binary) data="$2"; shift 2;; -m|-X|-H|-o) shift 2;; -*) shift;; *) url="$1"; shift;; esac; done
case "$url" in
  *api.day.app*) printf '%s\\t%s\\n' "$url" "$data" >> "$FAKE/bark-calls.log"; [ -f "$FAKE/bark-fail" ] && exit 7; echo '{"code":200,"message":"success"}';;
  *api/brain/tasks*) [ -f "$FAKE/brain-down" ] && exit 7; cat "$FAKE/brain.json";;
  *) exit 1;;
esac
`;
const FAKE_SSH = `#!/bin/bash
while [ $# -gt 0 ]; do case "$1" in -o|-p|-i|-l) shift 2;; -*) shift;; *) break;; esac; done
host="$1"; shift
printf '%s\\t%s\\n' "$host" "$*" >> "$FAKE/ssh-calls.log"
[ -f "$FAKE/hosts/$host/UNREACHABLE" ] && exit 255
case "$*" in *pgrep*) [ -f "$FAKE/hosts/$host/running" ] && exit 0; exit 1;; esac
exit 0
`;

function setup() {
  const fake = mkdtempSync(join(tmpdir(), "lbl-"));
  const bin = join(fake, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "curl"), FAKE_CURL); chmodSync(join(bin, "curl"), 0o755);
  writeFileSync(join(bin, "ssh"), FAKE_SSH); chmodSync(join(bin, "ssh"), 0o755);
  const logs = join(fake, "m4-logs");
  mkdirSync(logs);
  for (const h of ["xian-m4", "xian-m1"]) mkdirSync(join(fake, "hosts", h), { recursive: true });
  writeFileSync(join(fake, "brain.json"), '{"tasks":[]}');
  writeFileSync(join(fake, "bark.env"), "export BARK_TOKEN=tok_TEST_SECRET\n");
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    FAKE: fake,
    LB_LOG_DIR: logs,
    LB_STATE_DIR: join(fake, "state"),
    LB_BARK_ENV: join(fake, "bark.env"),
    LB_BRAIN_URL: "http://brain.test:5221",
  };
  const setAge = (host, ageSec) => {
    const p = join(logs, `${host}-live.log`);
    if (!existsSync(p)) writeFileSync(p, `[${host}] line\n`);
    const t = new Date(Date.now() - ageSec * 1000);
    utimesSync(p, t, t);
  };
  return {
    fake, env, setAge,
    brainRun(host) { writeFileSync(join(fake, "brain.json"), JSON.stringify({ tasks: [{ id: "t1", task_type: "workflow_run", status: "in_progress", title: `[run] 关键词获客@${host}`, payload: { machine: host } }] })); },
    pgrepRun(host) { writeFileSync(join(fake, "hosts", host, "running"), "1"); },
    run(extra = {}) { return spawnSync("bash", [SCRIPT], { encoding: "utf8", env: { ...env, ...extra }, timeout: 30000 }); },
    barks() { const p = join(fake, "bark-calls.log"); return existsSync(p) ? readFileSync(p, "utf8").trim().split("\n").filter(Boolean) : []; },
    cleanup() { rmSync(fake, { recursive: true, force: true }); },
  };
}

test("两份 live.log 都新鲜 → OK,不发 Bark,exit 0", () => {
  const s = setup();
  s.setAge("xian-m4", 60); s.setAge("xian-m1", 120);
  s.brainRun("xian-m4");
  const r = s.run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /LOGBRIDGE_LIVENESS OK/);
  assert.equal(s.barks().length, 0);
  s.cleanup();
});

test("停更 2h 但没 run 在跑(Brain 空 + pgrep 空) → IDLE,不发 Bark", () => {
  const s = setup();
  s.setAge("xian-m4", 7200); s.setAge("xian-m1", 7200);
  const r = s.run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /xian-m4 .*IDLE/);
  assert.match(r.stdout, /LOGBRIDGE_LIVENESS OK/);
  assert.equal(s.barks().length, 0);
  s.cleanup();
});

test("Brain 有该机 workflow_run in_progress 且 live.log 停更 >30min → STALE + Bark(POST api.day.app/<token>,标题带机器,正文带分钟数)", () => {
  const s = setup();
  s.setAge("xian-m4", 3000); s.setAge("xian-m1", 10);
  s.brainRun("xian-m4");
  const r = s.run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /xian-m4 .*STALE/);
  assert.match(r.stdout, /LOGBRIDGE_LIVENESS STALE/);
  const b = s.barks();
  assert.equal(b.length, 1, `期望 1 条 Bark: ${JSON.stringify(b)}`);
  const [url, data] = b[0].split("\t");
  assert.match(url, /^https:\/\/api\.day\.app\/tok_TEST_SECRET\/?$/);
  assert.match(data, /xian-m4/);
  assert.match(data, /50 ?分钟/);
  assert.doesNotMatch(r.stdout + r.stderr, /tok_TEST_SECRET/, "token 不得出现在输出");
  s.cleanup();
});

test("同一机器 1 小时内只 Bark 一次;超过间隔再次告警", () => {
  const s = setup();
  s.setAge("xian-m4", 3000); s.setAge("xian-m1", 10);
  s.brainRun("xian-m4");
  assert.equal(s.run().status, 0);
  assert.equal(s.run().status, 0);
  assert.equal(s.barks().length, 1, "第二次运行不该重复 Bark");
  // 把去重 marker 里的时间戳改旧 → 再告警
  const marker = join(s.env.LB_STATE_DIR, "barked-xian-m4");
  writeFileSync(marker, String(Math.floor(Date.now() / 1000) - 4000));
  const r = s.run();
  assert.match(r.stdout, /STALE/);
  assert.equal(s.barks().length, 2);
  s.cleanup();
});

test("Brain 查不到(或不可达)但 ssh 该机 pgrep 到执行链进程 → 仍算在跑 → Bark", () => {
  const s = setup();
  s.setAge("xian-m1", 5000); s.setAge("xian-m4", 10);
  writeFileSync(join(s.fake, "brain-down"), "1");
  s.pgrepRun("xian-m1");
  const r = s.run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /xian-m1 .*STALE/);
  assert.equal(s.barks().length, 1);
  assert.match(s.barks()[0], /xian-m1/);
  const ssh = readFileSync(join(s.fake, "ssh-calls.log"), "utf8");
  assert.match(ssh, /^xian-m1\t.*pgrep/m);
  assert.match(ssh, /\[w\]f-run\.sh/, "pgrep 模式必须用 [w] 括号法,否则匹配到 ssh 自己的 sh -c");
  s.cleanup();
});

test("live.log 不存在 + 该机在跑 → 视为停更告警;另一台机器不可达也不崩(exit 0)", () => {
  const s = setup();
  s.setAge("xian-m1", 10);
  s.brainRun("xian-m4"); // xian-m4-live.log 不存在
  writeFileSync(join(s.fake, "hosts", "xian-m1", "UNREACHABLE"), "1");
  const r = s.run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /xian-m4 .*STALE/);
  assert.equal(s.barks().length, 1);
  s.cleanup();
});

test("Bark 发送失败 → 不记 marker,下次再试;LB_TITLE_PREFIX 进标题(proven-to-fire 用 [测试])", () => {
  const s = setup();
  s.setAge("xian-m4", 3000); s.setAge("xian-m1", 10);
  s.brainRun("xian-m4");
  writeFileSync(join(s.fake, "bark-fail"), "1");
  let r = s.run({ LB_TITLE_PREFIX: "[测试]" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /bark=failed/);
  assert.ok(!existsSync(join(s.env.LB_STATE_DIR, "barked-xian-m4")), "发送失败不得记 marker");
  rmSync(join(s.fake, "bark-fail"));
  r = s.run({ LB_TITLE_PREFIX: "[测试]" });
  assert.match(r.stdout, /bark=sent/);
  assert.equal(s.barks().length, 2);
  assert.match(s.barks()[1], /\[测试\]/);
  s.cleanup();
});

test("bark.env 缺失 → 记 bark=no-token 不崩(exit 0),仍打 STALE", () => {
  const s = setup();
  s.setAge("xian-m4", 3000); s.setAge("xian-m1", 10);
  s.brainRun("xian-m4");
  const r = s.run({ LB_BARK_ENV: join(s.fake, "nope.env") });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /STALE/);
  assert.match(r.stdout, /bark=no-token/);
  assert.equal(s.barks().length, 0);
  s.cleanup();
});

test("launchd 模板: 每 600s 跑 ~/bin/log-bridge-liveness.sh;deploy.sh 把守卫与分身 watcher 落 mmv:~/bin/ 并在推流脚本换版后重载执行机 launchd", () => {
  assert.ok(existsSync(PLIST), "缺 launchd/com.zenithjoy.logbridge-liveness.plist");
  const plist = readFileSync(PLIST, "utf8");
  assert.match(plist, /<string>com\.zenithjoy\.logbridge-liveness<\/string>/);
  assert.match(plist, /<key>StartInterval<\/key>\s*<integer>600<\/integer>/);
  assert.match(plist, /\/Users\/administrator\/bin\/log-bridge-liveness\.sh/);
  const deploy = readFileSync(join(SRC, "deploy.sh"), "utf8");
  const m = deploy.match(/^MMV_BIN_FILES=\(([\s\S]*?)\)/m);
  assert.ok(m, "deploy.sh 缺 MMV_BIN_FILES 组");
  const files = m[1].split("\n").map((l) => l.replace(/#.*/, "")).join(" ").split(/\s+/).filter(Boolean);
  assert.ok(files.includes("log-bridge-liveness.sh"), files.join(","));
  assert.ok(files.includes("escort-claude-escalation.sh"), files.join(","));
  assert.match(deploy, /kickstart -k gui\/\\?\$\(id -u\)\/com\.zenithjoy\.logstreampush/, "推流脚本换版后必须重载执行机 launchd,否则跑的仍是旧 inode");
});

// drift-check.sh 回归测试(0929 防漂移守卫)。
// 事故: deploy.sh 只能人工触发且无对账,09-27 只手拷了 xian-m4,xian-m1 跑了一天旧版无人发现。
// 做法: 临时 git 仓库当"origin/main"(DRIFT_REF=HEAD + DRIFT_SKIP_FETCH=1),PATH 前置假 ssh——
//       假 ssh 把 <host> 映射到 $FAKE/hosts/<host> 当 HOME,本地真跑远端命令(stdin 透传),
//       notify-bark.js 调用只记日志并回 BARK_OK。清单解析直接吃仓库里真实的 deploy.sh。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, mkdirSync, existsSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");
const SCRIPT = join(SRC, "drift-check.sh");

const FAKE_SSH = `#!/bin/bash
# 跳过 -o xxx 等选项,第一个非选项参数是 host,其余是远端命令
while [ $# -gt 0 ]; do
  case "$1" in
    -o|-p|-i|-l) shift 2;;
    -*) shift;;
    *) break;;
  esac
done
host="$1"; shift
printf '%s %s\\n' "$host" "$*" >> "$FAKE/ssh-calls.log"
case "$*" in
  *notify-bark.js*) [ -f "$FAKE/bark-fail" ] && exit 0; echo BARK_OK; exit 0;;
esac
[ -e "$FAKE/hosts/$host/UNREACHABLE" ] && { echo "ssh: connect to host $host: timed out" >&2; exit 255; }
export HOME="$FAKE/hosts/$host"
cd "$HOME" || exit 255
exec sh -c "$*"
`;

// 最小 deploy.sh: 数组形状与真实 deploy.sh 一致(多行 + 单行 + 注释)
const MINI_DEPLOY = `#!/bin/bash
MMV_JS_FILES=(
  a.js b.js  # 注释里的 fake.js 不算
)
MMV_TOPLEVEL_FILES=(sop.txt)
DEVICE_CTL_FILES=(
  ctl
)
DEVICE_CTL_DIRS=(bin-harvest .local/bin)
DEVICE_SH_FILES=(
  run.sh
)
DEVICE_NODE_FILES=(led.mjs)
`;
const FILES = { "a.js": "A1\n", "b.js": "B1\n", "sop.txt": "SOP\n", ctl: "CTL\n", "run.sh": "RUN\n", "led.mjs": "LED\n" };

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function setup() {
  const fake = mkdtempSync(join(tmpdir(), "drift-"));
  const repo = join(fake, "repo");
  const d = join(repo, "services", "phone-adb-controller");
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "deploy.sh"), MINI_DEPLOY);
  for (const [f, c] of Object.entries(FILES)) writeFileSync(join(d, f), c);
  git(repo, "init", "-q");
  git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "add", "-A");
  git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  const bin = join(fake, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "ssh"), FAKE_SSH);
  chmodSync(join(bin, "ssh"), 0o755);
  const put = (host, rel, content) => {
    const p = join(fake, "hosts", host, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  };
  // 三台全部部署成一致状态
  for (const f of ["a.js", "b.js"]) put("mmv", `.openclaw/leadgen-scripts/${f}`, FILES[f]);
  put("mmv", ".openclaw/sop.txt", FILES["sop.txt"]);
  for (const h of ["xian-m4", "xian-m1"]) {
    for (const f of ["run.sh", "led.mjs", "ctl"]) put(h, `bin-harvest/${f}`, FILES[f]);
    put(h, ".local/bin/ctl", FILES.ctl);
  }
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    FAKE: fake,
    DRIFT_REPO: repo,
    DRIFT_REF: "HEAD",
    DRIFT_SKIP_FETCH: "1",
    DRIFT_STATE_DIR: join(fake, "state"),
    DRIFT_DATE: "20260929",
  };
  return {
    fake, repo, env, put,
    run(extraEnv = {}, args = []) { return spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8", env: { ...env, ...extraEnv }, timeout: 60000 }); },
    barks() {
      const p = join(fake, "ssh-calls.log");
      if (!existsSync(p)) return [];
      return readFileSync(p, "utf8").split("\n").filter((l) => l.includes("notify-bark.js")).map((l) => {
        const m = l.match(/notify-bark\.js (\S+) (\S+)/);
        return { host: l.split(" ")[0], title: Buffer.from(m[1], "base64").toString(), body: Buffer.from(m[2], "base64").toString() };
      });
    },
    cleanup() { rmSync(fake, { recursive: true, force: true }); },
  };
}

test("--list: 从真实 deploy.sh 解析出全部部署目标(两个控制器目录/账本/SOP 都在)", () => {
  const r = spawnSync("bash", [SCRIPT, "--list"], {
    encoding: "utf8",
    env: { ...process.env, DRIFT_REPO: join(SRC, "..", ".."), DRIFT_REF: "HEAD", DRIFT_SKIP_FETCH: "1" },
  });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.split("\n").filter(Boolean);
  const deploy = readFileSync(join(SRC, "deploy.sh"), "utf8");
  const arr = (name) => {
    const m = deploy.match(new RegExp(`^${name}=\\(([\\s\\S]*?)\\)`, "m"));
    return m[1].split("\n").map((l) => l.replace(/#.*/, "")).join(" ").split(/\s+/).filter(Boolean);
  };
  const expected = arr("MMV_JS_FILES").length + arr("MMV_TOPLEVEL_FILES").length
    + 2 * (arr("DEVICE_SH_FILES").length + arr("DEVICE_NODE_FILES").length + arr("DEVICE_CTL_FILES").length * arr("DEVICE_CTL_DIRS").length);
  assert.equal(lines.length, expected);
  for (const want of [
    "mmv .openclaw/leadgen-scripts/notify-bark.js notify-bark.js",
    "mmv .openclaw/cmdr-escort.txt cmdr-escort.txt",
    "xian-m4 bin-harvest/ledger.mjs ledger.mjs",
    "xian-m1 bin-harvest/harvest-cron.sh harvest-cron.sh",
    "xian-m1 .local/bin/douyin-phone-adb douyin-phone-adb",
    "xian-m4 bin-harvest/douyin-phone-adb douyin-phone-adb",
  ]) assert.ok(lines.includes(want), `缺 ${want}\n${r.stdout}`);
});

test("--list: 注释里的文件名不算,单行数组也能解析", () => {
  const c = setup();
  try {
    const r = c.run({}, ["--list"]);
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.split("\n").filter(Boolean);
    assert.equal(lines.length, 3 + 2 * 4);
    assert.ok(!r.stdout.includes("fake.js"));
    assert.ok(lines.includes("mmv .openclaw/sop.txt sop.txt"));
    assert.ok(lines.includes("xian-m1 .local/bin/ctl ctl"));
  } finally { c.cleanup(); }
});

test("三台一致: exit 0,不告警", () => {
  const c = setup();
  try {
    const r = c.run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /DRIFT_CHECK OK/);
    assert.equal(c.barks().length, 0);
  } finally { c.cleanup(); }
});

test("不一致+缺失: exit 1,列出文件,只经 mmv 告警一次", () => {
  const c = setup();
  try {
    c.put("xian-m1", "bin-harvest/run.sh", "RUN-OLD\n");
    rmSync(join(c.fake, "hosts", "xian-m4", ".local", "bin", "ctl"));
    const r = c.run();
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /DRIFT xian-m1:bin-harvest\/run\.sh/);
    assert.match(r.stdout, /MISSING xian-m4:\.local\/bin\/ctl/);
    assert.doesNotMatch(r.stdout, /xian-m4:bin-harvest\/run\.sh/);
    const b = c.barks();
    assert.equal(b.length, 1);
    assert.equal(b[0].host, "mmv");
    assert.match(b[0].title, /漂移/);
    assert.match(b[0].body, /xian-m1:bin-harvest\/run\.sh/);
    assert.match(b[0].body, /xian-m4:\.local\/bin\/ctl/);
  } finally { c.cleanup(); }
});

test("同日同一组不一致不重复告警;不一致集合变化或换日再告警", () => {
  const c = setup();
  try {
    c.put("xian-m1", "bin-harvest/run.sh", "RUN-OLD\n");
    assert.equal(c.run().status, 1);
    assert.equal(c.run().status, 1);
    assert.equal(c.barks().length, 1, "同日同组只告警一次");
    c.put("mmv", ".openclaw/leadgen-scripts/a.js", "A-OLD\n");
    assert.equal(c.run().status, 1);
    assert.equal(c.barks().length, 2, "不一致集合变了要再告警");
    assert.equal(c.run({ DRIFT_DATE: "20260930" }).status, 1);
    assert.equal(c.barks().length, 3, "换日再告警");
  } finally { c.cleanup(); }
});

test("告警发送失败不记 marker,下次重试", () => {
  const c = setup();
  try {
    c.put("xian-m1", "bin-harvest/run.sh", "RUN-OLD\n");
    writeFileSync(join(c.fake, "bark-fail"), "");
    assert.equal(c.run().status, 1);
    rmSync(join(c.fake, "bark-fail"));
    assert.equal(c.run().status, 1);
    assert.equal(c.run().status, 1);
    assert.equal(c.barks().length, 2, "失败那次 + 成功那次,之后去重");
  } finally { c.cleanup(); }
});

test("机器连不上: 记 UNREACHABLE 并告警", () => {
  const c = setup();
  try {
    writeFileSync(join(c.fake, "hosts", "xian-m1", "UNREACHABLE"), "");
    const r = c.run();
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /UNREACHABLE xian-m1/);
    assert.equal(c.barks().length, 1);
  } finally { c.cleanup(); }
});

// log-stream-push.sh 行为测试——MMV 日志桥重接(任务 975aa6ec,决策 1220810b)。
// 事故: 09-21 网关迁 MMV 后 escort/stream 哨兵读 MMV ~/.openclaw/m4-logs/<host>-live.log,而执行机 launchd
// 推流仍往 us-vps /opt/openclaw/state/m4-logs/ 写——MMV 那份停在 09-18 快照,escort 据死文件判"日志停滞"自杀 58 次。
// 做法: PATH 前置假 ssh(记 argv;远端命令本地真跑,目标目录经 LSP_TARGET_DIR 指到临时目录),后台起脚本,
//       往源日志追加一行,等它经"ssh mmv"落到目标文件;默认目标必须是 mmv + /Users/administrator/.openclaw/m4-logs。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, appendFileSync, readFileSync, chmodSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");
const SCRIPT = join(SRC, "log-stream-push.sh");
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
const SKIP = !ZSH && "no zsh (CI: sudo apt-get install -y zsh)";

// 假 ssh: 跳过 -o 等选项,首个非选项参数是 host;argv 记日志;远端命令本地 sh -c 真跑(stdin 透传给 cat >>)
const FAKE_SSH = `#!/bin/bash
while [ $# -gt 0 ]; do case "$1" in -o|-p|-i|-l) shift 2;; -*) shift;; *) break;; esac; done
host="$1"; shift
printf '%s\\t%s\\n' "$host" "$*" >> "$HOME/ssh-argv.log"
[ "$LSP_FAKE_EXEC" = "1" ] || exit 0
exec sh -c "$*"
`;

function setup() {
  const home = mkdtempSync(join(tmpdir(), "lsp-"));
  const bin = join(home, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "ssh"), FAKE_SSH);
  chmodSync(join(bin, "ssh"), 0o755);
  const target = join(home, "mmv-m4-logs");
  mkdirSync(target);
  writeFileSync(join(home, "harvest-cron.log"), "[0930-00:00:00] 旧行\n");
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, LSP_HOST: "xian-m4", LSP_RETRY_SLEEP: "1" };
  return { home, target, env };
}
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 后台跑脚本(独立进程组,收尾整组杀),等谓词成立
async function runUntil(env, pred, ms = 15000) {
  const { __append, ...cleanEnv } = env;
  const child = spawn(ZSH, [SCRIPT], { env: cleanEnv, detached: true, stdio: "ignore" });
  const t0 = Date.now();
  try {
    await sleep(1500); // 等 tail -F 挂上
    if (__append) appendFileSync(__append[0], __append[1]);
    while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(300); }
    return false;
  } finally {
    try { process.kill(-child.pid, "SIGKILL"); } catch {}
  }
}

test("源日志新增一行 → 带 [xian-m4] 标签经 ssh mmv 追加到 <目标目录>/xian-m4-live.log", { skip: SKIP }, async () => {
  const { home, target, env } = setup();
  const line = "[0930-18:00:00] [cmd09301800] 词#1 开采\n";
  const ok = await runUntil({ ...env, LSP_TARGET_DIR: target, LSP_FAKE_EXEC: "1", __append: [join(home, "harvest-cron.log"), line] },
    () => read(join(target, "xian-m4-live.log")).includes("[xian-m4] [0930-18:00:00] [cmd09301800] 词#1 开采"));
  assert.ok(ok, `目标文件没收到推流:\n${read(join(target, "xian-m4-live.log"))}\nssh: ${read(join(home, "ssh-argv.log"))}`);
  assert.doesNotMatch(read(join(target, "xian-m4-live.log")), /旧行/, "-n0 起 tail,不得把历史行重推");
  const ssh = read(join(home, "ssh-argv.log"));
  assert.match(ssh, /^mmv\t/m, "推送目标 host 必须是 mmv");
  assert.doesNotMatch(ssh, /us-vps/);
});

test("默认目标 = mmv:/Users/administrator/.openclaw/m4-logs/<host>-live.log(不再指 us-vps)", { skip: SKIP }, async () => {
  const { home, env } = setup();
  const ok = await runUntil({ ...env, LSP_HOST: "xian-m1" }, () => /^mmv\t/m.test(read(join(home, "ssh-argv.log"))));
  assert.ok(ok, `没看到 ssh mmv 调用: ${read(join(home, "ssh-argv.log"))}`);
  const ssh = read(join(home, "ssh-argv.log"));
  assert.match(ssh, /cat >> \/Users\/administrator\/\.openclaw\/m4-logs\/xian-m1-live\.log/);
  assert.doesNotMatch(ssh, /us-vps|\/opt\/openclaw\/state/);
});

test("源码守卫: 推流脚本不再出现 us-vps / /opt/openclaw/state 目标", () => {
  const src = readFileSync(SCRIPT, "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n"); // 注释里的病史可以提 us-vps
  assert.doesNotMatch(src, /us-vps/);
  assert.doesNotMatch(src, /\/opt\/openclaw\/state/);
});

// escort-claude-escalation.sh(MMV 分身 watcher)行为测试——升级链统一到 MMV 本机文件(任务 975aa6ec)。
// 事故: escort(跑在 MMV 网关)把升级行写到 MMV ~/.openclaw/m4-logs/escalation.log,而 watcher 却 ssh us-vps
// tail 宿主文件——两边各写各读,MMV 上 09-27~09-29 的升级行没有任何分身接管。
// 做法: PATH 前置假 claude(argv 记文件)+假 ssh(一旦被调用即记录,断言零调用);后台起 watcher,往本地
//       escalation.log 追加一行,等假 claude 被唤起且提示词含该行;宪法里报告落点必须是本机文件。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, appendFileSync, readFileSync, chmodSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");
const SCRIPT = join(SRC, "escort-claude-escalation.sh");
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
const SKIP = !ZSH && "no zsh (CI: sudo apt-get install -y zsh)";

const FAKE_CLAUDE = `#!/bin/bash
printf '%s\\n---\\n' "$*" >> "$HOME/claude-argv.log"
echo "分身已处置"
`;
const FAKE_SSH = `#!/bin/bash
printf '%s\\n' "$*" >> "$HOME/ssh-argv.log"
exit 0
`;
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function setup() {
  const home = mkdtempSync(join(tmpdir(), "esc-"));
  const bin = join(home, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "claude"), FAKE_CLAUDE); chmodSync(join(bin, "claude"), 0o755);
  writeFileSync(join(bin, "ssh"), FAKE_SSH); chmodSync(join(bin, "ssh"), 0o755);
  const logs = join(home, "m4-logs");
  mkdirSync(logs);
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, ESC_LOG_DIR: logs, ESC_LOCK: join(home, "lock"), ESC_RECONNECT_SLEEP: "1", ESC_COOLDOWN: "0" };
  return { home, logs, env };
}

test("本地 escalation.log 追加一行 → 唤起 claude 分身,提示词含该行;全程零 ssh;报告落点=本机 escalation-reports.log", { skip: SKIP }, async () => {
  const { home, logs, env } = setup();
  const child = spawn(ZSH, [SCRIPT], { env, detached: true, stdio: "ignore" });
  try {
    await sleep(1500);
    appendFileSync(join(logs, "escalation.log"), "[0930-18:10][xian-m4][采收cmd09301800] 设备离线,本批无法起跑\n");
    const t0 = Date.now();
    while (Date.now() - t0 < 15000 && !read(join(home, "claude-argv.log")).includes("设备离线")) await sleep(300);
  } finally {
    try { process.kill(-child.pid, "SIGKILL"); } catch {}
  }
  const argv = read(join(home, "claude-argv.log"));
  assert.match(argv, /\[0930-18:10\]\[xian-m4\]\[采收cmd09301800\] 设备离线/, `分身没被唤起或没拿到事件行:\n${argv}`);
  assert.match(argv, new RegExp(`${esc(logs)}/escalation-reports\\.log`), "宪法里报告落点必须是本机 m4-logs 目录");
  assert.doesNotMatch(argv, /us-vps/);
  assert.equal(read(join(home, "ssh-argv.log")), "", "watcher 不该再 ssh 任何机器读升级文件");
  assert.match(read(join(home, "escort-escalation.log")), /唤起分身/);
});

test("源码守卫: watcher/wf-run/SOP/COMMANDER 的升级与日志路径全部指 MMV 本机,不再有 us-vps 宿主路径或 /root 容器路径", () => {
  const watcher = readFileSync(SCRIPT, "utf8");
  assert.doesNotMatch(watcher, /us-vps/);
  assert.doesNotMatch(watcher, /\/opt\/openclaw\/state/);
  const wfrun = readFileSync(join(SRC, "wf-run.sh"), "utf8");
  const at = wfrun.indexOf("escalate() {");
  const body = wfrun.slice(at, at + 600);
  assert.match(body, /ssh [^\n]*\bmmv\b[^\n]*\/Users\/administrator\/\.openclaw\/m4-logs\/escalation\.log/, "wf-run escalate() 必须 ssh mmv 写 MMV 文件");
  assert.doesNotMatch(body, /us-vps/);
  for (const f of ["cmdr-escort.txt", "cmdr-stream.txt", "COMMANDER.md"]) {
    const t = readFileSync(join(SRC, f), "utf8");
    assert.doesNotMatch(t, /\/root\/\.openclaw\/m4-logs/, `${f} 仍写 us-vps 容器路径 /root/.openclaw/m4-logs`);
    assert.match(t, /\/Users\/administrator\/\.openclaw\/m4-logs/, `${f} 应指向 MMV 路径`);
  }
  assert.doesNotMatch(readFileSync(join(SRC, "cmdr-escort.txt"), "utf8"), /日志桥每小时同步一次/, "live.log 现在是实时推流,SOP 不能再说每小时");
});

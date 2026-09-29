// wf-run.sh —— 契约组装执行的通用驱动（决策 7f842d12：Commander 当入口 + 契约组装执行）。
// harvest-cron.sh 已退成薄壳 `exec wf-run.sh keyword_acquisition "$@"`（现网 crontab 一字不改），
// 计划由 scripts/product-map/wf-plan.mjs 从契约生成、提交在 plans/<能力>.plan。
// 这里钉：①计划缺失/无实现拒跑（且拒跑发生在拉 escort 之前）②对标源文件读取 ③--commander 跳过自拉 escort
// ④发现入口经 DISCOVER_CMD 注入 ⑤harvest-cron.sh 薄壳把能力名传对、库模式照常可 source。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");
const WR = join(SRC, "wf-run.sh");
const HC = join(SRC, "harvest-cron.sh");
const PLANS = join(SRC, "plans");
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
const SKIP = !ZSH && "no zsh (CI: sudo apt-get install -y zsh)";

// 假 ssh/adb：argv 记日志；adb get-state 恒失败（设备离线 → 在触达时窗判断之前就退出，测试与当前钟点无关）
const FAKE_SSH = `#!/bin/sh
printf 'ssh' >> "$HOME/ssh-argv.log"; for a in "$@"; do printf '\\t%s' "$a" >> "$HOME/ssh-argv.log"; done; printf '\\n' >> "$HOME/ssh-argv.log"
exit 0`;
const FAKE_ADB = `#!/bin/sh
echo "adb $*" >> "$HOME/adb-argv.log"
exit 1`;

function setup() {
  const home = mkdtempSync(join(tmpdir(), "wfrun-"));
  const bin = join(home, ".local", "bin");
  mkdirSync(bin, { recursive: true });
  for (const [n, body] of [["ssh", FAKE_SSH], ["adb", FAKE_ADB]]) { writeFileSync(join(bin, n), body); chmodSync(join(bin, n), 0o755); }
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, WALL_REPORT: join(home, "no-wall"), WFR_DISABLED: "1", WF_PLAN_DIR: PLANS };
  return { home, env };
}
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const run = (script, args, env) => spawnSync(ZSH, [script, ...args], { encoding: "utf8", env, timeout: 30000 });
const lib = (cmd, env) => spawnSync(ZSH, ["-c", `WF_RUN_LIB=1 source ${WR}; ${cmd}`], { encoding: "utf8", env });

test("计划文件缺失 → exit 1 拒跑,不拉 escort", { skip: SKIP }, () => {
  const { home, env } = setup();
  const r = run(WR, ["no_such_cap", "p1", "SER1", "biz"], env);
  assert.equal(r.status, 1, r.stderr);
  assert.match(read(join(home, "harvest-cron.log")), /无执行计划.*no_such_cap\.plan/);
  assert.doesNotMatch(read(join(home, "ssh-argv.log")), /cron add/);
});

// 对标发现四步已实现(338e3ec7),提交的计划 WF_MISSING 已清空;这里用临时计划把一步标回未实现,守「无实现不得跑」。
function missingPlanDir(home) {
  const d = join(home, "plans-missing");
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "benchmark_link_acquisition.plan"),
    readFileSync(join(PLANS, "benchmark_link_acquisition.plan"), "utf8").replace(/^WF_MISSING=.*$/m, "WF_MISSING='discovery.open_benchmark_profile'"));
  return d;
}

test("对标获客发现未实现 → 默认拒跑(无实现不得跑),不拉 escort", { skip: SKIP }, () => {
  const { home, env } = setup();
  const r = run(WR, ["benchmark_link_acquisition", "p1", "SER1", "biz", "--sources", "/nonexistent"], { ...env, WF_PLAN_DIR: missingPlanDir(home) });
  assert.equal(r.status, 1, r.stderr);
  const log = read(join(home, "harvest-cron.log"));
  assert.match(log, /拒跑.*未实现.*discovery\.open_benchmark_profile/);
  assert.doesNotMatch(read(join(home, "ssh-argv.log")), /cron add/);
});

test("--commander 给了 → 跳过自拉 escort(Commander 已登记),其余照旧(设备离线升级分身)", { skip: SKIP }, () => {
  const { home, env } = setup();
  const r = run(WR, ["keyword_acquisition", "p1", "SER1", "biz", "--commander", "cmdr-abc"], env);
  assert.equal(r.status, 0, r.stderr);
  const log = read(join(home, "harvest-cron.log"));
  assert.match(log, /由 Commander 发起\(cmdr-abc\)/);
  assert.match(log, /设备离线/);
  const ssh = read(join(home, "ssh-argv.log"));
  assert.doesNotMatch(ssh, /cron add/);
  assert.match(ssh, /us-vps/); // escalate 通路不变
});

test("harvest-cron.sh 薄壳: 以 keyword_acquisition 调 wf-run.sh(参数原样透传)", { skip: SKIP }, () => {
  const { home, env } = setup();
  const r = run(HC, ["p1", "SER1", "biz"], { ...env, WF_PLAN_DIR: join(home, "empty-plans") });
  assert.equal(r.status, 1);
  assert.match(read(join(home, "harvest-cron.log")), /无执行计划.*keyword_acquisition\.plan/);
});

test("harvest-cron.sh 库模式仍可 source,wf-run 的函数随之可用", { skip: SKIP }, () => {
  const r = spawnSync(ZSH, ["-c", `HARVEST_CRON_LIB=1 source ${HC}; whence -w wfr_on escort_alive account_registered lease_heartbeat_start wf_parse_args wf_read_sources`], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(r.stdout.trim().split("\n").length, 6);
});

test("wf_parse_args: 位置参数 + --sources/--commander/--allow-missing 任意位置", { skip: SKIP }, () => {
  const r = lib(`wf_parse_args benchmark_link_acquisition p1 --sources /tmp/s.txt SER1 biz 8 --commander tagX 0 --allow-missing; print -r -- "$WF_ARG_CAP|$P|$SERIAL|$BIZ|$N|$PUSH|$WF_SOURCES|$WF_COMMANDER|$WF_ALLOW_MISSING"`, process.env);
  assert.equal(r.stdout.trim(), "benchmark_link_acquisition|p1|SER1|biz|8|0|/tmp/s.txt|tagX|1", r.stderr);
  const d = lib(`wf_parse_args keyword_acquisition p1 SER1; print -r -- "$BIZ|$N|$PUSH|$WF_SOURCES|$WF_COMMANDER|$WF_ALLOW_MISSING"`, process.env);
  assert.equal(d.stdout.trim(), "AI人工智能训练师|6|1|||0", d.stderr);
});

test("wf_read_sources: 去空行/注释,每行一个对标链接或 sec_uid;文件缺失或全空 → rc=1", { skip: SKIP }, () => {
  const dir = mkdtempSync(join(tmpdir(), "wfsrc-"));
  const src = join(dir, "s.txt");
  writeFileSync(src, "# 对标清单\nhttps://v.douyin.com/abc/\n\n  \nMS4wLjABAAAAxyz\n");
  const out = join(dir, "out.txt");
  const r = lib(`wf_read_sources ${src} ${out}; echo rc=$?`, process.env);
  assert.match(r.stdout, /rc=0/, r.stderr);
  assert.equal(readFileSync(out, "utf8"), "https://v.douyin.com/abc/\nMS4wLjABAAAAxyz\n");
  writeFileSync(src, "# 只有注释\n\n");
  assert.match(lib(`wf_read_sources ${src} ${out}; echo rc=$?`, process.env).stdout, /rc=1/);
  assert.match(lib(`wf_read_sources ${join(dir, "nope")} ${out}; echo rc=$?`, process.env).stdout, /rc=1/);
});

test("wf_load_plan + wf_discover_cmd: 计划里的发现入口解析到 wf-run.sh 同目录", { skip: SKIP }, () => {
  const env = { ...process.env, WF_PLAN_DIR: PLANS };
  const k = lib(`wf_load_plan keyword_acquisition; echo rc=$? kind=$WF_SOURCE_KIND; wf_discover_cmd`, env);
  assert.match(k.stdout, /rc=0 kind=keyword/, k.stderr);
  assert.ok(k.stdout.trim().endsWith(`${SRC}/discover-keyword.sh`), k.stdout);
  const ba = lib(`wf_load_plan benchmark_link_acquisition; echo rc=$? kind=$WF_SOURCE_KIND; wf_discover_cmd`, env);
  assert.match(ba.stdout, /rc=0 kind=benchmark/, ba.stderr);
  assert.ok(ba.stdout.trim().endsWith(`${SRC}/discover-benchmark.sh`), ba.stdout);
  const home = mkdtempSync(join(tmpdir(), "wfplan-"));
  const b = lib(`wf_load_plan benchmark_link_acquisition; echo rc=$?`, { ...env, WF_PLAN_DIR: missingPlanDir(home) });
  assert.match(b.stdout, /rc=2/);
  const bm = lib(`WF_ALLOW_MISSING=1; wf_load_plan benchmark_link_acquisition; echo rc=$?`, { ...env, WF_PLAN_DIR: missingPlanDir(home) });
  assert.match(bm.stdout, /rc=0/);
});

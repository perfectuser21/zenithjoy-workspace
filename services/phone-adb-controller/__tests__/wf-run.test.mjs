import { seedRunner } from './fixtures/frozen-runtime.mjs';
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
// cron list --json 回放的 escort 名按本机 HOSTKEY（wf-run 默认分支 = 小写 hostname）+ 固定 TAG cmd09292330 拼——
// 1ebaeb00 起 escort_dismiss 核 name 全等才 cron rm，用例必须带 --tag cmd09292330 才会真注销
const FAKE_SSH = `#!/bin/sh
printf 'ssh' >> "$HOME/ssh-argv.log"; for a in "$@"; do printf '\\t%s' "$a" >> "$HOME/ssh-argv.log"; done; printf '\\n' >> "$HOME/ssh-argv.log"
case "$*" in *"cron list --json"*) printf '{"jobs":[{"id":"cmdr-abc","name":"escort-%s-cmd09292330"}]}\\n' "$(hostname -s | tr '[:upper:]' '[:lower:]')";; esac
exit 0`;
const FAKE_ADB = `#!/bin/sh
echo "adb $*" >> "$HOME/adb-argv.log"
exit 1`;

function setup() {
  const home = mkdtempSync(join(tmpdir(), "wfrun-"));
  const bin = join(home, ".local", "bin");
  mkdirSync(bin, { recursive: true });
  for (const [n, body] of [["ssh", FAKE_SSH], ["adb", FAKE_ADB]]) { writeFileSync(join(bin, n), body); chmodSync(join(bin, n), 0o755); }
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, WALL_REPORT: join(home, "no-wall"), WFR_DISABLED: "1", WFR: join(SRC,"workflow-result.sh"), WFR_NODE: process.execPath, WF_PLAN_DIR: PLANS };
  return { home, env };
}
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const run = (script, args, env) => { if (existsSync(join(env.WF_PLAN_DIR,"keyword_acquisition.plan")) && !/^WF_MISSING='[^']+'/m.test(read(join(env.WF_PLAN_DIR,`${args[0]}.plan`)))) seedRunner(env,args); return spawnSync(ZSH, [script, ...args], { encoding: "utf8", env, timeout: 30000 }); };
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

test("--commander <escort cron id> → 不自拉,把它当 ESCORT_ID:按 id 复核、退出 trap 注销;设备离线照旧升级", { skip: SKIP }, () => {
  const { home, env } = setup();
  const r = run(WR, ["keyword_acquisition", "p1", "SER1", "biz", "--tag", "cmd09292330", "--commander", "cmdr-abc"], env);
  assert.equal(r.status, 0, r.stderr);
  const log = read(join(home, "harvest-cron.log"));
  assert.match(log, /由 Commander 发起,escort=cmdr-abc/);
  assert.match(log, /escort复核命中\(id=cmdr-abc\)/);
  assert.match(log, /设备离线/);
  const ssh = read(join(home, "ssh-argv.log"));
  assert.doesNotMatch(ssh, /cron add/);
  assert.match(ssh, /openclaw cron list --json/);
  assert.match(ssh, /openclaw cron rm cmdr-abc/);
  assert.match(ssh, /mmv\t[^\n]*\/Users\/administrator\/\.openclaw\/m4-logs\/escalation\.log/); // escalate 通路: 0930 起写 MMV 本机文件(任务 975aa6ec)
});

test("--commander 的 escort 复核未命中 → 升级分身(本批可能无人陪跑),不阻塞", { skip: SKIP }, () => {
  const { home, env } = setup();
  const r = run(WR, ["keyword_acquisition", "p1", "SER1", "biz", "--commander", "cmdr-gone"], env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(read(join(home, "harvest-cron.log")), /escort复核未命中\(id=cmdr-gone\)/);
  assert.match(read(join(home, "ssh-argv.log")), /mmv\t[^\n]*escort id=cmdr-gone[^\n]*\/Users\/administrator\/\.openclaw\/m4-logs\/escalation\.log/);
});

test("--tag 覆盖 TAG;起跑向 stdout 打 WF_RUN_STARTED 一行", { skip: SKIP }, () => {
  const { home, env } = setup();
  const r = run(WR, ["keyword_acquisition", "p1", "SER1", "biz", "--tag", "cmd09292330", "--commander", "cmdr-abc"], env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^WF_RUN_STARTED tag=cmd09292330 cap=keyword_acquisition serial=SER1$/m);
  assert.match(read(join(home, "harvest-cron.log")), /\[cmd09292330\]/);
});

test("不给 --tag → TAG 仍是 autoMMDDHHMM", { skip: SKIP }, () => {
  const { env } = setup();
  const r = run(WR, ["keyword_acquisition", "p1", "SER1", "biz", "--commander", "cmdr-abc"], env);
  assert.match(r.stdout, /^WF_RUN_STARTED tag=auto\d{8} cap=keyword_acquisition serial=SER1$/m);
});

test("计划拒跑时不打 WF_RUN_STARTED", { skip: SKIP }, () => {
  const { env } = setup();
  const r = run(WR, ["no_such_cap", "p1", "SER1", "biz"], env);
  assert.doesNotMatch(r.stdout, /WF_RUN_STARTED/);
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
  const r = lib(`wf_parse_args benchmark_link_acquisition p1 --sources /tmp/s.txt SER1 biz 8 --commander tagX 0 --tag cmd01 --allow-missing; print -r -- "$WF_ARG_CAP|$P|$SERIAL|$BIZ|$N|$PUSH|$WF_SOURCES|$WF_COMMANDER|$WF_TAG|$WF_ALLOW_MISSING"`, process.env);
  assert.equal(r.stdout.trim(), "benchmark_link_acquisition|p1|SER1|biz|8|0|/tmp/s.txt|tagX|cmd01|1", r.stderr);
  const d = lib(`wf_parse_args keyword_acquisition p1 SER1; print -r -- "$BIZ|$N|$PUSH|$WF_SOURCES|$WF_COMMANDER|$WF_TAG|$WF_ALLOW_MISSING"`, process.env);
  assert.equal(d.stdout.trim(), "AI人工智能训练师|6|1||||0", d.stderr);
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

// 7d150e33（阶段1）：预检段按契约 preflight 预算封顶——拿锁重试循环(PF_LOCK_TRIES×PF_LOCK_WAIT 默认 10 分钟)不得超过预算
test("preflight_lock_acquire: 锁一直被占时受 WF_BUDGET_preflight 封顶,不等满 PF_LOCK_TRIES 轮", { skip: SKIP }, () => {
  const home = mkdtempSync(join(tmpdir(), "wfpf-"));
  const ctl = join(home, "ctl-busy");
  writeFileSync(ctl, "#!/bin/sh\necho x >> \"$HOME/tries\"\nexit 1\n"); chmodSync(ctl, 0o755);
  const t0 = Date.now();
  const r = lib(`C=${ctl} P=p1 TAG=t WF_BUDGET_preflight=1 PF_LOCK_WAIT=1 PF_LOCK_TRIES=10 preflight_lock_acquire; echo acquired=$LOCK_ACQUIRED`, { ...process.env, HOME: home });
  assert.match(r.stdout, /acquired=0/, r.stderr);
  assert.ok(Date.now() - t0 < 4000, "1s 预算下最多再等 1 轮,实际 " + (Date.now() - t0) + "ms");
  assert.ok(read(join(home, "tries")).split("x").length - 1 <= 2, "预算内最多试 2 次");
});

// 7d150e33（阶段1）：计划里的每活动预算/超时分类必须 export——batch2/harvest-keyword 是子进程，不 export 等于没编进去
test("wf_load_plan: WF_BUDGET_*/WF_TIMEOUT_CLASS_* 随计划装入并 export 给子进程", { skip: SKIP }, () => {
  const env = { ...process.env, WF_PLAN_DIR: PLANS };
  const r = lib(`wf_load_plan keyword_acquisition; zsh -c 'echo b=$WF_BUDGET_preflight/$WF_BUDGET_collection c=$WF_TIMEOUT_CLASS_delivery/$WF_TIMEOUT_CLASS_scoring'`, env);
  assert.match(r.stdout, /b=300\/7200 c=retryable\/record/, r.stdout + r.stderr);
});

test("wf_load_plan + wf_discover_cmd: 计划里的发现入口解析到 wf-run.sh 同目录", { skip: SKIP }, () => {
  const env = { ...process.env, WF_PLAN_DIR: PLANS };
  const k = lib(`wf_load_plan keyword_acquisition; echo rc=$? kind=$WF_SOURCE_KIND; zsh -c 'echo child_kind=$WF_SOURCE_KIND'; wf_discover_cmd`, env);
  assert.match(k.stdout, /child_kind=keyword/, "WF_SOURCE_KIND 须 export 给 batch2/harvest-keyword 子进程(对标流归位靠它)");
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

test('自动TAG冻结后跨分钟exec：继续原run，不重新生成TAG或创建第二个run', { skip: SKIP },()=>{
 const {home,env}=setup();
 const date=join(home,'.local/bin/date');
 writeFileSync(date,`#!/bin/sh
if [ "$1" = '+%m%d%H%M' ]; then
  if [ -f "$HOME/tag-generated" ]; then echo 10021900; else touch "$HOME/tag-generated"; echo 10021859; fi
  exit 0
fi
exec /bin/date "$@"
`,{mode:0o755});
 seedRunner(env,['keyword_acquisition','--tag','auto10021859']);
 const r=spawnSync(ZSH,[WR,'keyword_acquisition','p1','SER1','biz','--commander','cmdr-abc'],{encoding:'utf8',env,timeout:30000});
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/WF_RUN_STARTED tag=auto10021859 /);
 assert.equal(existsSync(join(home,'.config/zenithjoy/ledger/social-keyword-leadgen-crontab-auto10021900')),false);
});
test('同cap/tag续跑先用已登记运行快照，全局最新plan缺失不得阻断旧run', { skip: SKIP },()=>{
 const {home,env}=setup();const args=['keyword_acquisition','p1','SER1','biz','--tag','resume-old','--commander','cmdr-abc'];
 seedRunner(env,args);
 env.WF_PLAN_DIR=join(home,'new-deployment-plans');mkdirSync(env.WF_PLAN_DIR);
 const r=spawnSync(ZSH,[WR,...args],{encoding:'utf8',env,timeout:30000});
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/WF_RUN_STARTED tag=resume-old /);
});
test('同cap/tag但profile或设备不符：明确拒绝，不能借索引续错run', { skip: SKIP },()=>{
 const {home,env}=setup();seedRunner(env,['keyword_acquisition','p1','SER1','biz','--tag','identity']);
 for(const pair of [['p2','SER1'],['p1','SER2']]){
  const r=spawnSync(ZSH,[WR,'keyword_acquisition',...pair,'biz','--tag','identity'],{encoding:'utf8',env,timeout:30000});
  assert.equal(r.status,1);assert.match(r.stderr,/运行身份不匹配/);assert.doesNotMatch(r.stdout,/WF_RUN_STARTED/);
 }
 assert.equal(existsSync(join(home,'adb-argv.log')),false);
});

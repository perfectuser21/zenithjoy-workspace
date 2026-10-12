// codex_agent 形态 workflow（任务 c0fe7e30；决策 2186700a / 26df670a）：
//   wf-launch.sh 按合同清单分形态 → MMV 本机 nohup wf-agent-run.sh（共享外壳准备 → Codex 业务块 → 共享外壳收尾）→ delivery.json。
// 假 ssh 模拟手机控制器（锁状态落 $HOME/lock，证据清单 $HOME/host-files.txt），假 openclaw 模拟业务块，假 curl 回 Brain 任务正文。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CMD = join(HERE, "..", "commander");
const LAUNCH = join(CMD, "wf-launch.sh");
const STATUS = join(CMD, "wf-status.sh");
const RUNNER = join(CMD, "wf-agent-run.sh");
const LIB = join(CMD, "wf-agent-lib.py");
const RUN = "wfd-1234abcd-1760000000000";
const TASK = "1234abcd-0000-4000-8000-000000000001";
const SERIAL = "ANGYVB4311010223";

const FAKE_SSH = `#!/bin/sh
host="$5"; cmd="$6"
printf '%s\\t%s\\n' "$host" "$cmd" >> "$HOME/ssh-argv.log"
case "$cmd" in
  *"ls -1 /private/tmp/openclaw-phone/evidence/"*) cat "$HOME/host-files.txt" 2>/dev/null; exit 0;;
  *"pgrep -fl"*) exit 0;;
  *" preflight"*) [ "$STUB_PHONE" = "offline" ] && { echo "error: device offline" >&2; exit 1; }; echo "profile=xiaolongxia"; echo "serial=${SERIAL}"; echo "state=device"; exit 0;;
  *" lock-status"*) if [ -f "$HOME/lock" ]; then echo "lock=held owner=$(cat "$HOME/lock") age=3s stale=false"; else echo "lock=free"; fi; exit 0;;
  *" lock-acquire "*) o="\${cmd##* }"; echo "$o" > "$HOME/lock"; echo "$o-lock-acquire.json" >> "$HOME/host-files.txt"; echo "lock=acquired owner=$o"; exit 0;;
  *" lock-release "*) o="\${cmd##* }"; [ "$(cat "$HOME/lock" 2>/dev/null)" = "$o" ] && rm -f "$HOME/lock"; echo "$o-lock-release.json" >> "$HOME/host-files.txt"; echo "lock=released owner=$o"; exit 0;;
  *" lock-refresh "*) echo "lock=refreshed"; exit 0;;
  *" open-app"*) echo "foreground=com.ss.android.ugc.aweme"; exit 0;;
  *" account-current "*) if [ -n "$STUB_NICK" ]; then echo "nickname=$STUB_NICK"; echo "douyin_id=90915521618"; exit 0; fi; echo "die: standalone account entry is unverified; navigation refused" >&2; exit 2;;
  *" close-app"*) echo "close-app" >> "$HOME/closed.log"; echo "foreground=launcher"; exit 0;;
  *" outward-ledger "*) printf '{"schema":"outward_ledger_v1","run_id":"x","entries":[],"summary":{"attempts_by_action":{"publish":%s}}}\\n' "\${STUB_PUBLISH:-0}"; exit 0;;
esac
exit 0`;

// 业务块：STUB_AGENT=ok 正常交付并「留」三份读回证据；=nodelivery 不交付；=hang 卡住（测超时与 TERM）
const FAKE_OC = `#!/bin/sh
printf '%s\\n' "$*" >> "$HOME/oc-argv.log"
[ "$1" = "agent" ] || exit 0
case "$STUB_AGENT" in
  hang) sleep 30; exit 0;;
  nodelivery) echo "agent crashed"; exit 1;;
esac
for a in prepare publish verify; do echo "${RUN}-$a-original.xml" >> "$HOME/host-files.txt"; done
echo "${RUN}-outward-ledger.jsonl" >> "$HOME/host-files.txt"
echo "work log"
echo 'WF_DELIVERY {"claimed_result":"success","fail_reason":null,"side_effects":[{"action":"publish","reversible":false}],"readback":{"private_before":3,"private_after":4,"visibility":"私密","first_title":"午后","first_date":"2026-10-12","publish_attempts":9,"lock_status":"held"},"final_evidence":["${RUN}-12-caption"],"activities":{"prepare":{"evidence_ids":["${RUN}-prepare-original"]},"publish":{"evidence_ids":["${RUN}-publish-original"]},"verify":{"evidence_ids":["${RUN}-verify-original","${RUN}-not-there"]}}}'
exit 0`;

const FAKE_CURL = `#!/bin/sh
printf '%s\\n' "$*" >> "$HOME/curl-argv.log"
[ "$STUB_BRAIN" = "down" ] && exit 7
printf '%s\\n' '{"id":"${TASK}","title":"技能工厂 验证 抖音","description":"【执行参数】\\n使用 skill：android-douyin-private-video@1.0.8"}'
exit 0`;

function setup(stub = {}) {
  const home = mkdtempSync(join(tmpdir(), "wfagent-"));
  const bin = join(home, "bin"); mkdirSync(bin);
  for (const [n, body] of [["ssh", FAKE_SSH], ["openclaw", FAKE_OC], ["curl", FAKE_CURL]]) {
    const p = join(bin, n); writeFileSync(p, body); chmodSync(p, 0o755);
  }
  if (stub.lockedBy) writeFileSync(join(home, "lock"), `${stub.lockedBy}\n`);
  const env = {
    ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`,
    WF_START_WAIT: "1", WF_ESCORT_RETRY_SLEEP: "0", WF_AGENT_POLL_S: "1", WF_LOCK_REFRESH_S: "1",
    WF_AGENT_TIMEOUT_S: stub.timeout ?? "60", WF_BRAIN_URL: "http://brain.test:5221",
    STUB_PHONE: stub.phone ?? "online", STUB_NICK: stub.nick ?? "Ai办公室", STUB_AGENT: stub.agent ?? "ok",
    STUB_PUBLISH: stub.publish ?? "1", STUB_BRAIN: stub.brain ?? "up",
  };
  return { home, env };
}
const read = (home, f) => (existsSync(join(home, f)) ? readFileSync(join(home, f), "utf8") : "");
const runDir = (home) => join(home, "wf-agent-runs", RUN);
const delivery = (home) => JSON.parse(read(home, `wf-agent-runs/${RUN}/delivery.json`));
const ARGS = ["douyin_video_publish", "xian-m4", "xiaolongxia", SERIAL, "Ai办公室", "--tag", "cmd10121200", "--run-id", RUN, "--task-id", TASK];
const runner = (env, args = ARGS) => spawnSync("bash", [RUNNER, ...args], { encoding: "utf8", env, timeout: 60000 });

test("wf-agent-lib：合同清单分形态，codex_agent 才走外壳 runner", () => {
  const p = (cap) => spawnSync("python3", [LIB, "profile", join(CMD, "workflow-contracts.json"), cap], { encoding: "utf8" });
  assert.equal(p("douyin_video_publish").stdout.trim(), "codex_agent");
  assert.equal(p("keyword_acquisition").status, 1);
});

test("wf-agent-lib parse-delivery：取最后一个 WF_DELIVERY，兼容 openclaw --json 包裹转义", () => {
  const home = mkdtempSync(join(tmpdir(), "wfparse-"));
  const f = join(home, "a.log");
  writeFileSync(f, JSON.stringify({ result: { payloads: [{ text: 'x\nWF_DELIVERY {"claimed_result":"blocked","fail_reason":"旧稿弹层"}' }] } }));
  const r = spawnSync("python3", [LIB, "parse-delivery", f], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(r.stdout), { claimed_result: "blocked", fail_reason: "旧稿弹层" });
  writeFileSync(f, "无交付\n");
  assert.deepEqual(JSON.parse(spawnSync("python3", [LIB, "parse-delivery", f], { encoding: "utf8" }).stdout), {});
});

test("正常一轮：外壳领锁查号 → 业务块 → 收尾关 App 放锁回读 free；delivery 系统读回覆盖自报、五活动证据齐", () => {
  const { home, env } = setup();
  const r = runner(env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /WF_RUN_STARTED tag=cmd10121200 run_id=wfd-1234abcd/);
  assert.match(r.stdout, /preflight ok/);
  assert.match(r.stdout, /WF_RUN_FINISHED/);
  const d = delivery(home);
  assert.equal(d.run_id, RUN);
  assert.equal(d.workflow_key, "douyin_video_publish.android");
  assert.equal(d.claimed_result, "success");
  assert.equal(d.lock_released, true);
  assert.equal(d.readback.lock_status, "free", "锁状态取外壳回读，不采信自报 held");
  assert.equal(d.readback.publish_attempts, 1, "对外动作次数取 outward-ledger 系统账，不采信自报 9");
  assert.equal(d.readback.private_after, 4);
  assert.deepEqual(d.commander_skill, { name: "wf-douyin_video_publish", version: "0.1.0" });
  assert.deepEqual(d.activities.map((a) => [a.key, a.evidence_files.length]), [["preflight", 1], ["prepare", 1], ["publish", 1], ["verify", 1], ["cleanup", 1]]);
  assert.equal(d.activities.find((a) => a.key === "publish").readback.glob, "*publish*original.json");
  for (const id of [`${RUN}-lock-acquire`, `${RUN}-lock-release`, `${RUN}-outward-ledger`]) assert.ok(d.final_evidence.includes(id), id);
  const verify = JSON.parse(readFileSync(join(runDir(home), "evidence", `${RUN}-verify-original.json`), "utf8"));
  assert.deepEqual(verify.verified_host_files, [`${RUN}-verify-original.xml`], "不存在的证据 ID 不算");
  assert.equal(read(home, "lock"), "", "锁已放");
  assert.match(read(home, "closed.log"), /close-app/);
  const msg = read(home, `wf-agent-runs/${RUN}/msg.txt`);
  assert.match(msg, /不要 lock-acquire \/ lock-release/);
  assert.match(msg, /android-douyin-private-video@1\.0\.8/, "业务块消息带 Brain 任务正文");
  assert.match(read(home, "oc-argv.log"), new RegExp(`agent --agent skill-factory --session-id wfa-${RUN}`));
  const ssh = read(home, "ssh-argv.log");
  assert.match(ssh, new RegExp(`--lock-owner ${RUN} account-current ${RUN}-preflight-account`));
});

test("长会话：业务块在跑期间外壳按间隔续租控制器锁", () => {
  const { home, env } = setup({ agent: "hang" });
  runner({ ...env, WF_AGENT_TIMEOUT_S: "-116" });
  assert.match(read(home, "ssh-argv.log"), /lock-refresh/);
});

test("手机被别的 run 占锁：不抢锁、不起业务块、不放别人的锁，交付 blocked", () => {
  const { home, env } = setup({ lockedBy: "sf3-other-run" });
  const r = runner(env);
  assert.equal(r.status, 0, r.stderr);
  const d = delivery(home);
  assert.equal(d.claimed_result, "blocked");
  assert.match(d.fail_reason, /lock_busy/);
  assert.equal(read(home, "oc-argv.log"), "", "不起业务块");
  assert.equal(read(home, "lock").trim(), "sf3-other-run", "别人的锁原样保留");
  assert.doesNotMatch(read(home, "ssh-argv.log"), /lock-acquire|lock-release|close-app/);
  assert.equal(d.lock_released, false);
  assert.deepEqual(d.activities.flatMap((a) => a.evidence_files), [], "准备没做成不留读回");
});

test("账号对不上：外壳 blocked 不切号，收尾照样放锁", () => {
  const { home, env } = setup({ nick: "别人的号" });
  runner(env);
  const d = delivery(home);
  assert.equal(d.claimed_result, "blocked");
  assert.match(d.fail_reason, /account_mismatch/);
  assert.equal(read(home, "oc-argv.log"), "");
  assert.equal(d.lock_released, true);
});

test("账号读不到（弹层挡住）：不拦，交业务块核号并在消息里写明", () => {
  const { home, env } = setup({ nick: "" });
  runner(env);
  assert.match(read(home, `wf-agent-runs/${RUN}/msg.txt`), /外壳未能读到账号.*自行核对本人账号/);
  assert.equal(delivery(home).shell.preflight.account_verified, false);
});

test("业务块崩了没交付：failed + agent_delivery_missing，收尾放锁", () => {
  const { home, env } = setup({ agent: "nodelivery", publish: "0" });
  runner(env);
  const d = delivery(home);
  assert.equal(d.claimed_result, "failed");
  assert.match(d.fail_reason, /agent_delivery_missing exit=1/);
  assert.equal(d.lock_released, true);
  assert.equal(read(home, "lock"), "");
});

test("业务块超时：外壳杀会话、failed agent_timeout、照样收尾放锁", () => {
  const { home, env } = setup({ agent: "hang" });
  // 超时判定 = timeout + 120s 宽限；WF_AGENT_TIMEOUT_S=-118 让宽限后为 2s
  const r = runner({ ...env, WF_AGENT_TIMEOUT_S: "-118" });
  assert.equal(r.status, 0, r.stderr);
  const d = delivery(home);
  assert.match(d.fail_reason, /agent_timeout/);
  assert.equal(d.lock_released, true);
});

test("被 TERM：trap 收尾仍关 App、放锁、写 delivery", async () => {
  const { home, env } = setup({ agent: "hang" });
  const child = spawn("bash", [RUNNER, ...ARGS], { env, stdio: "ignore" });
  for (let i = 0; i < 100 && !read(home, "oc-argv.log"); i++) await new Promise((r) => setTimeout(r, 100));
  child.kill("SIGTERM");
  await new Promise((r) => child.on("exit", r));
  const d = delivery(home);
  assert.match(d.fail_reason, /interrupted/);
  assert.equal(d.lock_released, true);
  assert.equal(read(home, "lock"), "");
});

test("wf-launch：codex_agent 合同缺 --run-id/--task-id 退 2；带了就本机 nohup runner，输出 host=mmv", () => {
  const { home, env } = setup();
  const base = ["douyin_video_publish", "xian-m4", "xiaolongxia", SERIAL, "Ai办公室"];
  assert.equal(spawnSync("bash", [LAUNCH, ...base], { encoding: "utf8", env }).status, 2);
  const fake = join(home, "bin", "fake-runner");
  writeFileSync(fake, `#!/bin/sh\necho "WF_RUN_STARTED $*"\necho "$*" >> "$HOME/runner-argv.log"\n`); chmodSync(fake, 0o755);
  const r = spawnSync("bash", [LAUNCH, ...base, "--run-id", RUN, "--task-id", TASK], { encoding: "utf8", env: { ...env, WF_AGENT_RUNNER: fake } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout.trim().split("\n").pop(), new RegExp(`^WF_LAUNCHED tag=cmd\\d{8} host=mmv cap=douyin_video_publish serial=${SERIAL} escort=none run_id=${RUN} profile=codex_agent`));
  assert.match(read(home, "runner-argv.log"), new RegExp(`douyin_video_publish xian-m4 xiaolongxia ${SERIAL} Ai办公室 --tag cmd\\d{8} --run-id ${RUN} --task-id ${TASK}`));
  assert.equal(read(home, "oc-argv.log"), "", "codex_agent 不起 escort cron");
  const dry = spawnSync("bash", [LAUNCH, ...base, "--run-id", RUN, "--task-id", TASK, "--dry-run"], { encoding: "utf8", env: { ...env, WF_AGENT_RUNNER: fake } });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /DRY_RUN host=mmv profile=codex_agent/);
});

test("wf-launch：获客 wf-run 形态接受 Brain 派发单带的 --run-id/--task-id（不再退 2）", () => {
  const { env } = setup();
  const r = spawnSync("bash", [LAUNCH, "keyword_acquisition", "xian-m4", "legacy", "ANGYVB4402004137", "biz", "--run-id", RUN, "--task-id", TASK, "--dry-run"], { encoding: "utf8", env });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DRY_RUN host=xian-m4/);
});

test("wf-status mmv：读本机 runner 日志，FINISHED 标记即 finished", () => {
  const { home, env } = setup();
  mkdirSync(join(home, "wf-logs"));
  writeFileSync(join(home, "wf-logs", "cmd10121200.out"), "WF_RUN_STARTED\nWF_RUN_RESULT {}\nWF_RUN_FINISHED tag=cmd10121200\n");
  const r = spawnSync("bash", [STATUS, "mmv", "cmd10121200"], { encoding: "utf8", env });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout.trim().split("\n").pop(), /^WF_STATUS state=finished$/);
  assert.equal(read(home, "ssh-argv.log"), "", "mmv 本机不经 ssh");
});

test("deploy.sh：Commander 入口下发 runner/lib/合同清单与全部 commander skills，白名单只增不删，可 --commander-only 单独部署", () => {
  const deploy = readFileSync(join(HERE, "..", "deploy.sh"), "utf8");
  assert.match(deploy, /for f in wf-launch\.sh wf-status\.sh wf-agent-run\.sh wf-agent-lib\.py workflow-contracts\.json/);
  assert.match(deploy, /commander\/skills\/\*\/SKILL\.md/);
  assert.match(deploy, /openclaw config set agents\.entries\.work-commander\.skills/);
  assert.match(deploy, /--commander-only[\s\S]*deploy_commander/);
});

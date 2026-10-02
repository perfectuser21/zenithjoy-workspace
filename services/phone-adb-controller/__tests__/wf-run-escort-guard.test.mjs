// wf-run.sh escort 在途保护（Brain 任务 1ebaeb00，决策 3c98fb36 阶段 1·稳 / fd2a22f4）。
// 0930 02:54 实证：escort d417a34c 是被 escort 自己（media agent）在 run 在途时 `openclaw cron rm` 删掉的——
// 它读到 MMV 上 0918 起就死掉的日志桥文件，判「日志停滞」后把自己当成「已收工」注销，run 随后死循环 5 小时无人陪跑。
// 这里钉三层：①escort_dismiss 只删「id 在表且 name 全等 escort-<机器>-<TAG>」的 cron，其余只记日志
//            ②看门狗：在途发现 escort 不在表 → 同名同会话重拉，新 id 写 ESCORT_ID_FILE，注销跟着用新 id
//            ③SOP 真身/投影带「本 TAG 批完成 / 进程已退」条款，禁止凭日志停滞注销。
// 假 ssh 放 PATH 首位：cron list --json 回放 $HOME/stub-jobs.json（STUB_JSON=unsupported 时改回放表格 stub-table.txt），
// cron add 回 $STUB_NEW_ID，cron rm/其它一律记 argv 到 $HOME/ssh-argv.log。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");
const WR = join(SRC, "wf-run.sh");
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
const SKIP = !ZSH && "no zsh (CI: sudo apt-get install -y zsh)";

const HOSTKEY = "xian-m4";
const TAG = "cmd09300230";
const WANT = `escort-${HOSTKEY}-${TAG}`;
const MINE = "d417a34c-5e2a-41df-8c7d-29fbe5987c60";
const OTHER = "1a62933e-0293-408c-bb17-91c2d95cf369";
const NEW_ID = "9f1e2d3c-4b5a-4c6d-8e7f-0a1b2c3d4e5f";
const jobs = (list) => JSON.stringify({ jobs: list }, null, 2);
const BOTH = jobs([{ id: MINE, name: WANT }, { id: OTHER, name: `escort-${HOSTKEY}-auto09300200` }]);
const ONLY_OTHER = jobs([{ id: OTHER, name: `escort-${HOSTKEY}-auto09300200` }]);

const FAKE_SSH = `#!/bin/sh
printf 'ssh' >> "$HOME/ssh-argv.log"; for a in "$@"; do printf '\\t%s' "$a" >> "$HOME/ssh-argv.log"; done; printf '\\n' >> "$HOME/ssh-argv.log"
case "$*" in
  *"cron list --json"*)
    [ "$STUB_JSON" = "unsupported" ] && { echo "error: unknown option '--json'" >&2; exit 1; }
    [ "$STUB_JSON" = "down" ] && { echo "connect: gateway down" >&2; exit 255; }
    cat "$HOME/stub-jobs.json"; exit 0;;
  *"cron list"*)
    [ "$STUB_JSON" = "down" ] && { echo "connect: gateway down" >&2; exit 255; }
    cat "$HOME/stub-table.txt"; exit 0;;
  *"cron add"*) printf '{\\n  "id": "%s",\\n  "name": "x"\\n}\\n' "$STUB_NEW_ID"; exit 0;;
  *"cron rm"*) echo removed; exit 0;;
esac
exit 0`;

function setup({ stub = BOTH, json = "ok", table = "" } = {}) {
  const home = mkdtempSync(join(tmpdir(), "wfesc-"));
  const bin = join(home, "bin"); mkdirSync(bin);
  const ssh = join(bin, "ssh"); writeFileSync(ssh, FAKE_SSH); chmodSync(ssh, 0o755);
  writeFileSync(join(home, "stub-jobs.json"), stub);
  writeFileSync(join(home, "stub-table.txt"), table);
  const env = {
    ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, STUB_JSON: json, STUB_NEW_ID: NEW_ID,
    LOG: join(home, "log"), ESCORT_WATCH_INTERVAL: "1",
  };
  return { home, env };
}
// 库模式只装函数：log/escalate 定义在主体段，这里给最小替身（写同一个 $LOG）
const PRELUDE = `WF_RUN_LIB=1 source ${WR}; HOSTKEY=${HOSTKEY}; TAG=${TAG}; SERIAL=S1; P=legacy;
  ESCORT_ID_FILE="$HOME/wf-escort-${TAG}.id"; ESCORT_START_HM=02:30;
  log(){ print -- "[$TAG] $*" >> $LOG }; escalate(){ print -- "[$TAG] 升级分身: $*" >> $LOG };`;
const lib = (cmd, env) => spawnSync(ZSH, ["-c", `${PRELUDE} ${cmd}`], { encoding: "utf8", env, timeout: 20000 });
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const sshLog = (home) => read(join(home, "ssh-argv.log"));
const runLog = (home) => read(join(home, "log"));
const rmLines = (home) => sshLog(home).split("\n").filter((l) => /cron rm/.test(l));

test("停看门狗先暂停循环：杀sleep不能抢先唤醒一轮重拉", { skip: SKIP }, () => {
  const { home, env } = setup({ stub: ONLY_OTHER });
  env.ESCORT_WATCH_INTERVAL = '60';
  const result = lib(`ESCORT_ID=${MINE};
    pkill(){ command pkill "$@"; /bin/sleep 0.3; }
    escort_watch_start; /bin/sleep 0.2; escort_watch_stop; print stopped`, env);
  assert.match(result.stdout, /stopped/);
  assert.doesNotMatch(sshLog(home), /cron add/, 'stop不能变成最后一次重拉');
});

test("Brain 接班已存在唯一同名陪跑：本地看门狗收养新 ID，不再拉第三个", { skip: SKIP }, () => {
  const { home, env } = setup({ stub: jobs([{ id: NEW_ID, name: WANT }, { id: OTHER, name: "other-run" }]) });
  const result = lib(`ESCORT_ID=${MINE}; print -r -- $ESCORT_ID > $ESCORT_ID_FILE; escort_watch_tick`, env);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(sshLog(home), /cron add/, "已接班时不得重复创建");
  assert.equal(read(join(home, `wf-escort-${TAG}.id`)).trim(), NEW_ID);
  assert.match(runLog(home), /escort已接班.*收养/);
});

test("finalize 后即使本地 ID 过期，也注销唯一同名的新陪跑", { skip: SKIP }, () => {
  const { home, env } = setup({ stub: jobs([{ id: NEW_ID, name: WANT }, { id: OTHER, name: "other-run" }]) });
  lib(`ESCORT_ID=${MINE}; print -r -- $ESCORT_ID > $ESCORT_ID_FILE; escort_dismiss`, env);
  assert.equal(rmLines(home).length, 1);
  assert.match(rmLines(home)[0], new RegExp(`cron rm ${NEW_ID}$`));
  assert.ok(!existsSync(join(home, `wf-escort-${TAG}.id`)));
});

test("同名陪跑不唯一：不再创建、不猜测删除并保留本地 ID 以便对账", { skip: SKIP }, () => {
  const { home, env } = setup({ stub: jobs([{ id: NEW_ID, name: WANT }, { id: OTHER, name: WANT }]) });
  lib(`ESCORT_ID=${MINE}; print -r -- $ESCORT_ID > $ESCORT_ID_FILE; escort_watch_tick; escort_dismiss`, env);
  assert.doesNotMatch(sshLog(home), /cron add|cron rm/);
  assert.equal(read(join(home, `wf-escort-${TAG}.id`)).trim(), MINE);
  assert.match(runLog(home), /同名陪跑不唯一/);
});

test("注销时网关未知：保留本地 ID，不能把未确认下岗抹掉", { skip: SKIP }, () => {
  const { home, env } = setup({ json: "down" });
  lib(`ESCORT_ID=${MINE}; print -r -- $ESCORT_ID > $ESCORT_ID_FILE; escort_dismiss`, env);
  assert.equal(rmLines(home).length, 0);
  assert.equal(read(join(home, `wf-escort-${TAG}.id`)).trim(), MINE);
});

test("执行器自拉陪跑也先通过 SSH 读取网关 SOP", { skip: SKIP }, () => {
  const { home, env } = setup();
  const result = lib("escort_add", env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(sshLog(home), /--message '先执行 ssh -o BatchMode=yes -o ConnectTimeout=10 administrator@100\.71\.151\.105 cat \/Users\/administrator\/\.openclaw\/cmdr-escort\.txt/);
});

test('执行器重拉相同能力的陪跑时要求读取专属skill', { skip: SKIP }, () => {
  const { home, env } = setup();
  const result = lib('WF_ARG_CAP=keyword_acquisition; escort_add', env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(sshLog(home), /wf-keyword_acquisition\/SKILL.md/);
  assert.match(sshLog(home), /专属skill/);
  assert.match(sshLog(home), /心跳JSON必须带cap=keyword_acquisition/);
  for (const file of ['COMMANDER.md', 'cmdr-escort.txt']) assert.match(readFileSync(join(SRC, file), 'utf8'), /"cap":"<能力>"/);
});

test("宪法与 SOP 明确网关读写路由，心跳不能在跑场本机访问 localhost", () => {
  const law = readFileSync(join(SRC, "COMMANDER.md"), "utf8");
  const sop = readFileSync(join(SRC, "cmdr-escort.txt"), "utf8");
  for (const text of [law, sop]) assert.match(text, /SOP、日志、findings、openclaw CLI.*网关/);
  assert.match(sop, /ssh -o BatchMode=yes -o ConnectTimeout=10 administrator@100\.71\.151\.105/);
  assert.match(sop, /心跳.*网关.*执行/);
});

test("陪跑自行下岗也必须读回本 TAG finalize 成功，批完成日志不是收尾证明", () => {
  for (const file of ["COMMANDER.md", "cmdr-escort.txt"]) {
    const text = readFileSync(join(SRC, file), "utf8");
    assert.match(text, /\[<TAG>\] 账本finalize: ok=1/, `${file} 必须核对同批账本收尾`);
    assert.match(text, /批完成.*(?:早于|不代表).*finalize/, `${file} 不能凭主链结束下岗`);
  }
});

// 执行生产脚本的 trap 声明，隔离设备/账本边界，观察真实 shell 的退出顺序。
for (const finalizeStatus of [0, 1]) {
  test(`退出时先 finalize；finalize ${finalizeStatus === 0 ? "成功才下岗" : "失败保留陪跑"}`, { skip: SKIP }, () => {
    const source = readFileSync(WR, "utf8");
    const wiring = source.split("\n").find((line) => line.startsWith('if [[ -n "$ESCORT_ID" ]]; then trap '));
    assert.ok(wiring, "必须找到生产退出接线");
    const result = spawnSync(ZSH, ["-c", `
      ESCORT_ID=mine
      lease_heartbeat_stop(){ print lease_stop; }
      escort_watch_stop(){ print watch_stop; }
      escort_aftercare(){ print aftercare_requested; }
      run_finalize(){ print finalize; return ${finalizeStatus}; }
      ${wiring}
      exit 0
    `], { encoding: "utf8" });
    assert.deepEqual(result.stdout.trim().split("\n"), finalizeStatus === 0
      ? ["lease_stop", "watch_stop", "finalize", "aftercare_requested"]
      : ["lease_stop", "watch_stop", "finalize"]);
  });
}

test("finalize 自检失败必须返回失败，收工闸检查不能把失败抹成成功", { skip: SKIP }, () => {
  const source = readFileSync(WR, "utf8");
  const fn = source.match(/run_finalize\(\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(fn);
  const { home, env } = setup();
  const receipt = join(home, "receipt.sh");
  writeFileSync(receipt, 'echo "WFR_FINALIZE_OK=0; WFR_FINALIZE_MSG=storage_failed"\n');
  const result = spawnSync(ZSH, ["-c", `
    device_cleanup_in_lock(){ :; }; release_run_lock(){ :; }
    wfr_on(){ return 0; }; finalize_needed(){ return 0; }
    log(){ :; }; escalate(){ :; }; gate_check(){ return 0; }
    WFR=${receipt}; LOG=${join(home, "finalize.log")}; TAG=test
    ${fn}
    run_finalize
  `], { env, encoding: "utf8" });
  assert.equal(result.status, 1, "账本失败必须阻止下岗");
});

test("escort_owned：id 在表且 name 全等 → match；name 是别的 run → mismatch:<name>；id 不在表 → absent", { skip: SKIP }, () => {
  const { env } = setup();
  assert.equal(lib(`escort_owned ${MINE} ${WANT}`, env).stdout.trim(), "match");
  assert.equal(lib(`escort_owned ${OTHER} ${WANT}`, env).stdout.trim(), `mismatch:escort-${HOSTKEY}-auto09300200`);
  assert.equal(lib(`escort_owned ${NEW_ID} ${WANT}`, env).stdout.trim(), "absent");
});

test("escort_owned：网关不可达（json 与表格都失败）→ unknown，不把读不到当成不在表", { skip: SKIP }, () => {
  const { env } = setup({ json: "down" });
  assert.equal(lib(`escort_owned ${MINE} ${WANT}`, env).stdout.trim(), "unknown");
});

test("escort_owned：--json 不可用退回表格——首列 id 命中且 Name 列截断后是期望名前缀 → match，别的 run → mismatch", { skip: SKIP }, () => {
  const table = `ID                                   Declaration              Name                     Schedule
${MINE} -                        escort-xian-m4-cmd093... every 10m
${OTHER} -                        escort-xian-m4-auto09... every 10m
`;
  const { env } = setup({ json: "unsupported", table });
  assert.equal(lib(`escort_owned ${MINE} ${WANT}`, env).stdout.trim(), "match");
  assert.equal(lib(`escort_owned ${OTHER} ${WANT}`, env).stdout.trim(), "mismatch:escort-xian-m4-auto09");
  assert.equal(lib(`escort_owned ${NEW_ID} ${WANT}`, env).stdout.trim(), "absent");
});

test("escort_dismiss：拿到的 id 是别的 run 的 escort → 不发 cron rm，日志记「escort注销拒绝」（回归主断言）", { skip: SKIP }, () => {
  const { home, env } = setup();
  const r = lib(`ESCORT_ID=${OTHER}; escort_dismiss`, env);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(rmLines(home).length, 0, "name 不符不得删");
  assert.match(runLog(home), /escort注销拒绝: id=1a62933e[^\n]*非本run/);
});

test("escort_dismiss：id 已不在 cron 表 → 不发 cron rm，日志记「escort注销跳过」", { skip: SKIP }, () => {
  const { home, env } = setup({ stub: ONLY_OTHER });
  lib(`ESCORT_ID=${MINE}; escort_dismiss`, env);
  assert.equal(rmLines(home).length, 0);
  assert.match(runLog(home), /escort注销跳过: id=d417a34c[^\n]*已不在 cron 表/);
});

test("escort_dismiss：id 在表且 name 全等 → cron rm <id>，日志「escort已注销」，先 list 后 rm", { skip: SKIP }, () => {
  const { home, env } = setup();
  lib(`ESCORT_ID=${MINE}; escort_dismiss`, env);
  const lines = rmLines(home);
  assert.equal(lines.length, 1);
  assert.match(lines[0], new RegExp(`\\tmmv\\topenclaw cron rm ${MINE}$`));
  assert.match(runLog(home), /escort已注销/);
  const all = sshLog(home).split("\n");
  assert.ok(all.findIndex((l) => /cron list --json/.test(l)) < all.findIndex((l) => /cron rm/.test(l)), "必须先核对再删");
});

test("escort_dismiss：网关不可达 → 不盲删（记「escort注销跳过」），不再像旧逻辑那样直接 rm", { skip: SKIP }, () => {
  const { home, env } = setup({ json: "down" });
  lib(`ESCORT_ID=${MINE}; escort_dismiss`, env);
  assert.equal(rmLines(home).length, 0);
  assert.match(runLog(home), /escort注销跳过: id=d417a34c[^\n]*cron list 不可达/);
});

test("escort_dismiss：优先用 ESCORT_ID_FILE 里看门狗重拉后的新 id，注销完删文件", { skip: SKIP }, () => {
  const { home, env } = setup({ stub: jobs([{ id: NEW_ID, name: WANT }]) });
  writeFileSync(join(home, `wf-escort-${TAG}.id`), `${NEW_ID}\n`);
  lib(`ESCORT_ID=${MINE}; escort_dismiss`, env);
  assert.match(rmLines(home)[0] ?? "", new RegExp(`cron rm ${NEW_ID}$`));
  assert.ok(!existsSync(join(home, `wf-escort-${TAG}.id`)), "注销后 id 文件应删除");
});

test("escort_watch_tick：escort 在途被移除（id 不在表）→ 同名同会话重拉，新 id 写文件，日志「已重拉」+ 升级", { skip: SKIP }, () => {
  const { home, env } = setup({ stub: ONLY_OTHER });
  const r = lib(`ESCORT_ID=${MINE}; print -r -- $ESCORT_ID > $ESCORT_ID_FILE; escort_watch_tick`, env);
  assert.equal(r.status, 0, r.stderr);
  const add = sshLog(home).split("\n").filter((l) => /cron add/.test(l));
  assert.equal(add.length, 1, "应重拉一次");
  assert.match(add[0], new RegExp(`--name '${WANT}' --agent media --session 'session:${WANT}'`), "重拉必须同名同会话（跨轮记忆不断）");
  assert.equal(read(join(home, `wf-escort-${TAG}.id`)).trim(), NEW_ID);
  assert.match(runLog(home), new RegExp(`escort在途被移除\\(id=${MINE}\\),已重拉: 新id=${NEW_ID}`));
  assert.match(runLog(home), /升级分身: escort/);
});

test("escort_watch_tick：escort 还在表 → 不动；网关不可达 → 不重拉（防止 list 抖动拉出两个陪跑）", { skip: SKIP }, () => {
  const a = setup();
  lib(`ESCORT_ID=${MINE}; print -r -- $ESCORT_ID > $ESCORT_ID_FILE; escort_watch_tick`, a.env);
  assert.equal(sshLog(a.home).split("\n").filter((l) => /cron add/.test(l)).length, 0);
  const b = setup({ json: "down" });
  lib(`ESCORT_ID=${MINE}; print -r -- $ESCORT_ID > $ESCORT_ID_FILE; escort_watch_tick`, b.env);
  assert.equal(sshLog(b.home).split("\n").filter((l) => /cron add/.test(l)).length, 0);
  assert.equal(read(join(b.home, `wf-escort-${TAG}.id`)).trim(), MINE, "读不到不能换 id");
});

test("escort_watch_start/stop：后台循环按 ESCORT_WATCH_INTERVAL 轮询，被移除后自动重拉；stop 后不再有循环进程", { skip: SKIP }, () => {
  const { home, env } = setup({ stub: ONLY_OTHER });
  // 全量并行跑测试时机器负载高，不用固定 3 秒：最多等 15 秒直到看门狗把 id 换掉
  const r = lib(`ESCORT_ID=${MINE}; escort_watch_start; pid=$ESCORT_WATCH_PID;
    for i in {1..30}; do [[ "$(cat $ESCORT_ID_FILE)" == "${NEW_ID}" ]] && break; /bin/sleep 0.5; done
    escort_watch_stop; cat $ESCORT_ID_FILE; kill -0 $pid 2>/dev/null && echo STILL_ALIVE; true`, env);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), NEW_ID, "15 秒内应完成至少一轮并换成新 id");
  assert.doesNotMatch(r.stdout, /STILL_ALIVE/);
  assert.match(runLog(home), /已重拉/);
});

test("wf-run.sh 源码接线：escort 确认后启动看门狗，退出 trap 先停看门狗再注销，注销经 escort_owned 核 name", () => {
  const src = readFileSync(WR, "utf8");
  assert.match(src, /escort_watch_start\b/, "必须启动看门狗");
  // 40f02c5e: 放锁并入 run_finalize(锁内清场 → 放锁 → 账本),trap 不再单列 release_run_lock
  assert.match(src, /trap 'lease_heartbeat_stop; escort_watch_stop; run_finalize && escort_aftercare' EXIT INT TERM/);
  assert.match(src, /escort_owned "\$id" "\$want"/, "escort_dismiss 必须先核 name");
  assert.match(src, /openclaw cron rm \$id/, "注销按核对过的 id");
});

test("SOP 真身与投影：自杀条款只认本 TAG 批完成 / 进程已退，禁止凭日志停滞注销", () => {
  const sop = readFileSync(join(SRC, "cmdr-escort.txt"), "utf8");
  const law = readFileSync(join(SRC, "COMMANDER.md"), "utf8");
  for (const [name, txt] of [["cmdr-escort.txt", sop], ["COMMANDER.md", law]]) {
    assert.match(txt, /本 TAG/, `${name} 缺「本 TAG」判据`);
    assert.match(txt, /pgrep -f ["']?wf-run\.sh\.\*--tag/, `${name} 缺进程级复核`);
    assert.match(txt, /日志(读不到|停滞)[^\n]*(≠|不等于|不算)\s*收工/, `${name} 缺「日志停滞≠收工」禁令`);
    assert.match(txt, /cron list --json/, `${name} 注销前必须 --json 按 name 全等取 id`);
  }
  assert.doesNotMatch(sop, /日志出现"批完成"或起跑已超4小时→exec 跑 openclaw cron list 按消息里给的完整escort名/, "旧的宽松自杀条款必须删除");
});

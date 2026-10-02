// harvest-cron.sh escort 30s 复核（判定点 4f85a74d）回归测试——决策 711ca6cf。
// 0927 00:00/06:00 两批实证：`openclaw cron list` 表格 Name 列定宽截断，escort-xian-m4-auto09270600
// 显示为 escort-xian-m4-auto09...，旧逻辑 `grep -F "escort-$HOSTKEY-$TAG"` 全名匹配必然未命中 → 每批误升级分身，
// 而 MMV 上该 id 明明活着。修法：复核只按拉起时拿到的 ESCORT_ID 精确判——优先 `cron list --json` 取 .jobs[].id，
// --json 不可用退回表格首列 awk 精确匹配；永远不碰 name 列。
// 假 ssh 放 PATH 首位：按命令是否含 --json 回放 canned 输出（JSON 模式由 $STUB_JSON 控制：ok / unsupported），argv 记到 $HOME/ssh-argv.log。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");
const HC = join(SRC, "harvest-cron.sh");
// 7f842d12: harvest-cron.sh 已退成薄壳(exec wf-run.sh keyword_acquisition),源码接线守卫改查实现 wf-run.sh
const HC_IMPL = join(SRC, "wf-run.sh");
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
const SKIP = !ZSH && "no zsh (CI: sudo apt-get install -y zsh)";

const ALIVE_ID = "ff94199f-78f0-4d25-a950-60945a9d6dc3";
const FULL_NAME = "escort-xian-m4-auto09270600";
// MMV 真机 0927 06:00 抄录：Name 列被截成 escort-xian-m4-auto09...，首列 id 完整
const TABLE = `ID                                   Declaration              Name                     Schedule     Next   Last   Status  Target    Delivery
ee4ba818-4642-4d7d-9761-f679bf3417c3 heartbeat:main           Heartbeat (main)         every 1h     in 1m  59m ago ok     main      not requested
${ALIVE_ID} -                        escort-xian-m4-auto09... every 10m    in 3m  -      idle    sessio... announce -> feishu:oc_ef60d6e3f199d90dd695b6ecc213d662 (expli...
a9654769-fedb-4a84-a408-a9421bea74ea enterprise-context-sy... 悦升云端企业资料同步     every 30m    in 6m  24m ago ok     isolated  announce -> feishu:oc_ef60d6e3f199d90dd695b6ecc213d662 (expli...
`;
const JSON_OUT = JSON.stringify({ jobs: [
  { id: "ee4ba818-4642-4d7d-9761-f679bf3417c3", name: "heartbeat-main", enabled: true },
  { id: ALIVE_ID, name: FULL_NAME, enabled: true },
] }, null, 2);

const FAKE_SSH = `#!/bin/sh
printf 'ssh' >> "$HOME/ssh-argv.log"; for a in "$@"; do printf '\\t%s' "$a" >> "$HOME/ssh-argv.log"; done; printf '\\n' >> "$HOME/ssh-argv.log"
case "$*" in
  *"cron list --json"*)
    if [ "$STUB_JSON" = "ok" ]; then cat "$HOME/stub-json.txt"; exit 0; fi
    echo "error: unknown option '--json'" >&2; exit 1;;
  *"cron list"*) cat "$HOME/stub-table.txt"; exit 0;;
esac
exit 0`;

function setup({ json = "unsupported", table = TABLE, jsonOut = JSON_OUT } = {}) {
  const home = mkdtempSync(join(tmpdir(), "hcesc-"));
  const bin = join(home, "bin"); mkdirSync(bin);
  const ssh = join(bin, "ssh"); writeFileSync(ssh, FAKE_SSH); chmodSync(ssh, 0o755);
  writeFileSync(join(home, "stub-table.txt"), table);
  writeFileSync(join(home, "stub-json.txt"), jsonOut);
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, STUB_JSON: json, LOG: join(home, "log") };
  return { home, env };
}
function lib(cmd, env) { return spawnSync(ZSH, ["-c", `HARVEST_CRON_LIB=1 source ${HC}; ${cmd}`], { encoding: "utf8", env }); }
function sshLog(home) { return readFileSync(join(home, "ssh-argv.log"), "utf8"); }

test("旧逻辑对照：截断表格上 grep -F 全名必然为空（这就是 0927 两批假阳性的形状）", { skip: SKIP }, () => {
  const r = spawnSync("bash", ["-c", `grep -F "${FULL_NAME}" || true`], { input: TABLE, encoding: "utf8" });
  assert.equal(r.stdout, "", "全名在截断表格里 grep 不到——说明按 name 复核天然不可靠");
});

test("escort_alive：--json 不可用 + 表格 Name 截断 → 按首列 id 精确命中（回归主断言）", { skip: SKIP }, () => {
  const { home, env } = setup({ json: "unsupported" });
  const r = lib(`escort_alive ${ALIVE_ID}`, env);
  assert.equal(r.status, 0, `应命中活着的 escort，stderr=${r.stderr}`);
  const log = sshLog(home);
  assert.match(log, /cron list --json/, "应先尝试 --json");
  assert.match(log, /\tmmv\t/, "复核应走 mmv 网关");
  assert.doesNotMatch(log, new RegExp(FULL_NAME), "复核命令不得带 escort 名字（禁按 name 匹配）");
});

test("escort_alive：--json 不可用 + 表格里没有该 id → 未命中", { skip: SKIP }, () => {
  const { env } = setup({ json: "unsupported" });
  assert.notEqual(lib("escort_alive 06988f2e-6b41-4f2e-8732-a894fe83df26", env).status, 0);
});

test("escort_alive：--json 可用 → 按 .jobs[].id 精确判，在则命中、不在则未命中，且不再回退拉表格", { skip: SKIP }, () => {
  const a = setup({ json: "ok" });
  assert.equal(lib(`escort_alive ${ALIVE_ID}`, a.env).status, 0);
  assert.equal(sshLog(a.home).split("\n").filter((l) => /cron list/.test(l) && !/--json/.test(l)).length, 0, "--json 命中后不该再拉表格");
  const b = setup({ json: "ok" });
  assert.notEqual(lib("escort_alive 06988f2e-6b41-4f2e-8732-a894fe83df26", b.env).status, 0);
});

test("escort_alive：--json 回了非 JSON 垃圾（rc=0）→ 退回表格首列判，不把垃圾当未命中", { skip: SKIP }, () => {
  const { env } = setup({ json: "ok", jsonOut: "gateway restarting, try again\n" });
  assert.equal(lib(`escort_alive ${ALIVE_ID}`, env).status, 0);
});

test("escort_alive：空 id → 未命中（拉起失败时不该误报活着）", { skip: SKIP }, () => {
  assert.notEqual(lib('escort_alive ""', setup().env).status, 0);
});

test("harvest-cron.sh 源码：复核与注销都按 ESCORT_ID，不再按 escort 名字 grep", () => {
  const src = readFileSync(HC_IMPL, "utf8");
  assert.ok(!/grep -F "escort-\$HOSTKEY-\$TAG"/.test(src), "旧的按名字 grep -F 复核必须删除");
  assert.ok(/escort_alive "\$ESCORT_ID"/.test(src), "复核主体必须调用 escort_alive 按 id 判");
  // 1ebaeb00 起注销经 escort_dismiss 核过 name 后按 $id 删（$id = escort_current_id 取回的 ESCORT_ID / 看门狗重拉的新 id）
  assert.match(src, /^source "\$WF_HOME\/wf-run-lib\.sh" \|\| exit 1$/m);
  const libSource = readFileSync(new URL("../wf-run-lib.sh", import.meta.url), "utf8");
  assert.ok(/openclaw cron rm \$(id|ESCORT_ID)\b/.test(libSource), "注销按 id");
});

// commander/wf-launch.sh —— Commander 发起 run 的启动器（决策 7f842d12：Commander 当入口）。
// 假 ssh / 假 openclaw 放 PATH 首位：ssh 按远端命令关键词回放（STUB_* 控制），argv 记到 $HOME/ssh-argv.log；
// openclaw cron add 回一个固定 id，cron rm 记到 $HOME/oc-argv.log。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LAUNCH = join(HERE, "..", "commander", "wf-launch.sh");
const STATUS = join(HERE, "..", "commander", "wf-status.sh");
const ESCORT_ID = "d76fe21a-eb6e-4aac-a84a-c219c7e2e606";

const FAKE_SSH = `#!/bin/sh
host="$5"; cmd="$6"
printf '%s\\t%s\\n' "$host" "$cmd" >> "$HOME/ssh-argv.log"
case "$cmd" in
  *"test -r ~/bin-harvest/plans/"*) [ "$STUB_DEPLOYED" = "no" ] && exit 1; exit 0;;
  *"pgrep -fl"*) [ "$STUB_BUSY" = "yes" ] && echo "123 /bin/zsh wf-run.sh keyword_acquisition legacy ANGYVB4402004137"; exit 0;;
  *"cat > ~/wf-sources/"*) cat > "$HOME/sources-received.txt"; exit 0;;
  *"nohup /bin/zsh ~/bin-harvest/wf-run.sh"*) echo "PID=4242"; exit 0;;
  *"grep -q WF_RUN_STARTED"*) [ "$STUB_STARTED" = "no" ] && exit 1; exit 0;;
  *"tail -n 5"*) echo "wf-plan: discovery 缺 runtime，拒跑"; exit 0;;
esac
exit 0`;
const FAKE_OC = `#!/bin/sh
printf '%s\\n' "$*" >> "$HOME/oc-argv.log"
case "$1 $2" in
  "cron add") printf '{\\n  "id": "${ESCORT_ID}",\\n  "name": "x"\\n}\\n';;
esac
exit 0`;

function setup(stub = {}) {
  const home = mkdtempSync(join(tmpdir(), "wflaunch-"));
  const bin = join(home, "bin"); mkdirSync(bin);
  for (const [n, body] of [["ssh", FAKE_SSH], ["openclaw", FAKE_OC]]) {
    const p = join(bin, n); writeFileSync(p, body); chmodSync(p, 0o755);
  }
  const env = {
    ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`,
    WF_START_WAIT: "0", WF_ESCORT_RETRY_SLEEP: "0",
    STUB_DEPLOYED: stub.deployed ?? "yes", STUB_BUSY: stub.busy ?? "no", STUB_STARTED: stub.started ?? "yes",
  };
  return { home, env };
}
const run = (args, env) => spawnSync("bash", [LAUNCH, ...args], { encoding: "utf8", env });
const read = (home, f) => (existsSync(join(home, f)) ? readFileSync(join(home, f), "utf8") : "");
const BASE = ["keyword_acquisition", "xian-m4", "legacy", "ANGYVB4402004137", "AI人工智能训练师"];

test("参数校验：未知 host / 非法 capability 直接退 2，不碰 ssh", () => {
  const { home, env } = setup();
  assert.equal(run(["keyword_acquisition", "us-vps", "legacy", "S1", "biz"], env).status, 2);
  assert.equal(run(["Bad-Cap;rm", "xian-m4", "legacy", "S1", "biz"], env).status, 2);
  assert.equal(read(home, "ssh-argv.log"), "", "参数错不应发起任何 ssh");
});

test("能力未部署到执行机 → 退 4，不登记 escort", () => {
  const { home, env } = setup({ deployed: "no" });
  const r = run(BASE, env);
  assert.equal(r.status, 4, r.stderr);
  assert.equal(read(home, "oc-argv.log"), "");
});

test("同 serial 已有 run 在跑 → 退 3（一机一单），不登记 escort", () => {
  const { home, env } = setup({ busy: "yes" });
  const r = run(BASE, env);
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /正在跑/);
  assert.equal(read(home, "oc-argv.log"), "");
});

test("正常起跑：escort 登记 → 起跑命令带 --tag 与 --commander <escort id> → 输出 WF_LAUNCHED", () => {
  const { home, env } = setup();
  const r = run(BASE, env);
  assert.equal(r.status, 0, r.stderr);
  const oc = read(home, "oc-argv.log");
  assert.match(oc, /cron add .*--agent media/);
  assert.match(oc, /escort-xian-m4-cmd\d{8}/);
  const launch = read(home, "ssh-argv.log").split("\n").find((l) => l.includes("nohup"));
  assert.ok(launch, "应有一次 nohup 起跑");
  assert.match(launch, /wf-run\.sh keyword_acquisition legacy ANGYVB4402004137 'AI人工智能训练师' 6 1 --tag cmd\d{8} --commander d76fe21a/);
  assert.match(r.stdout.trim().split("\n").pop(), new RegExp(`^WF_LAUNCHED tag=cmd\\d{8} host=xian-m4 cap=keyword_acquisition serial=ANGYVB4402004137 escort=${ESCORT_ID}`));
});

test("--sources：中英文逗号都拆成逐行写到执行机，并以 --sources 传给 wf-run", () => {
  const { home, env } = setup();
  const r = run(["benchmark_link_acquisition", ...BASE.slice(1), "--sources", "https://www.douyin.com/user/AAA， MS4wBBB,https://v.douyin.com/xyz/"], env);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(home, "sources-received.txt"), "https://www.douyin.com/user/AAA\nMS4wBBB\nhttps://v.douyin.com/xyz/\n");
  const launch = read(home, "ssh-argv.log").split("\n").find((l) => l.includes("nohup"));
  assert.match(launch, /wf-run\.sh benchmark_link_acquisition .* --sources ~\/wf-sources\/cmd\d{8}\.txt --tag/);
});

test("起跑后未见 WF_RUN_STARTED → 撤销 escort 并退 5，报错带日志尾", () => {
  const { home, env } = setup({ started: "no" });
  const r = run(BASE, env);
  assert.equal(r.status, 5);
  assert.match(r.stderr, /拒跑/);
  assert.match(read(home, "oc-argv.log"), new RegExp(`cron rm ${ESCORT_ID}`));
});

test("--dry-run 不写源、不登记 escort、不起跑", () => {
  const { home, env } = setup();
  const r = run([...BASE, "--dry-run"], env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DRY_RUN/);
  assert.equal(read(home, "oc-argv.log"), "");
  assert.ok(!read(home, "ssh-argv.log").includes("nohup"));
});

test("wf-status.sh 拒绝非法 host/TAG（防注入）", () => {
  const { env } = setup();
  assert.equal(spawnSync("bash", [STATUS, "us-vps", "cmd09292315"], { env }).status, 2);
  assert.equal(spawnSync("bash", [STATUS, "xian-m4", "cmd1;rm -rf ~"], { env }).status, 2);
});

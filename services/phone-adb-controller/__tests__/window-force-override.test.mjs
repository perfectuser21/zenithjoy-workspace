// services/phone-adb-controller/__tests__/window-force-override.test.mjs
//
// 10-08 获客产量恢复 A 段试跑(Brain 任务 9a8784b7): 主理人要求白天立即试跑金诺 work 号,
// 但 wf-run.sh 开跑前和 batch2.sh 每词开头都按 8–22 点触达时窗硬退让,没有任何开关。
// 加显式开关 WF_FORCE_OUTSIDE_WINDOW(只认 "1"): 只有发起命令时设了才放行,并写一行「时窗守卫被手动跳过」+发起人+原因;
// 默认行为不变。
// 顺带修: 14:43 那批时窗退让发生在账本 init 之前,收尾 trap 照样跑 finalize → not_initialized → 升级分身(误报)。
// 退让改走正常 skipped 收尾,不跑自检、不升级。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");
const LIB = join(SRC, "wf-run-lib.sh");
const BATCH2 = join(SRC, "batch2.sh");
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
const SKIP = !ZSH && "no zsh (CI: sudo apt-get install -y zsh)";
const readOr = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

function yieldProbe(hour, extra = {}) {
  const env = { ...process.env, ...extra };
  if (!("WF_FORCE_OUTSIDE_WINDOW" in extra)) delete env.WF_FORCE_OUTSIDE_WINDOW;
  return spawnSync(ZSH, ["-c", `log(){ print -r -- "LOG $*" }; source ${LIB}; if wf_window_yield ${hour}; then print yield; else print run; fi`],
    { encoding: "utf8", env });
}

test("wf-run 时窗: 默认白天退让、夜里放行", { skip: SKIP }, () => {
  assert.match(yieldProbe("14").stdout, /^yield$/m);
  assert.match(yieldProbe("08").stdout, /^yield$/m);
  assert.match(yieldProbe("21").stdout, /^yield$/m);
  assert.match(yieldProbe("22").stdout, /^run$/m);
  assert.match(yieldProbe("03").stdout, /^run$/m);
});

test("wf-run 时窗: WF_FORCE_OUTSIDE_WINDOW=1 白天放行,并记发起人和原因", { skip: SKIP }, () => {
  const r = yieldProbe("14", { WF_FORCE_OUTSIDE_WINDOW: "1", WF_FORCE_BY: "team-lead", WF_FORCE_REASON: "A段试跑" });
  assert.match(r.stdout, /^run$/m);
  assert.match(r.stdout, /LOG 时窗守卫被手动跳过\(WF_FORCE_OUTSIDE_WINDOW=1\) 发起人=team-lead 原因=A段试跑/);
});

test("wf-run 时窗: 开关只认 1(true/yes/0/空都不放行)", { skip: SKIP }, () => {
  for (const v of ["true", "yes", "0", "", "11"]) {
    assert.match(yieldProbe("14", { WF_FORCE_OUTSIDE_WINDOW: v }).stdout, /^yield$/m, `值 ${JSON.stringify(v)} 不应放行`);
  }
});

test("wf-run: 时窗退让走 skipped 收尾,不跑账本自检、不升级分身", () => {
  const wr = readFileSync(join(SRC, "wf-run.sh"), "utf8");
  assert.match(wr, /if wf_window_yield; then WF_YIELDED=1;/, "退让路径要打标记");
  const fin = wr.slice(wr.indexOf("run_finalize(){"), wr.indexOf("\n}\n", wr.indexOf("run_finalize(){")));
  const yieldIdx = fin.indexOf('"${WF_YIELDED:-0}" == 1');
  assert.ok(yieldIdx > 0, "run_finalize 要认退让标记");
  assert.ok(yieldIdx < fin.indexOf('bash "$WFR" finalize'), "退让在账本 finalize 自检之前返回");
  assert.ok(yieldIdx < fin.indexOf("escalate"), "退让不升级");
});

// batch2 每词开头的时窗判断同样要认开关(否则 wf-run 放行了,batch2 第 1 个词照样不开)
const FAKE_HK = `#!/bin/zsh
W=$(python3 -c "import urllib.parse,sys;print(urllib.parse.unquote(sys.argv[1]))" "$2")
print -r -- "$W" >> "$HOME/hk.log"
exit 0`;
const FAKE_SSH = `#!/bin/sh
echo "$*" >> "$HOME/ssh.log"; exit 0`;
function b2(extra) {
  const home = mkdtempSync(join(tmpdir(), "b2force-"));
  const bin = join(home, ".local", "bin");
  mkdirSync(bin, { recursive: true });
  for (const [n, body] of [["ssh", FAKE_SSH], ["scp", FAKE_SSH]]) { writeFileSync(join(bin, n), body); chmodSync(join(bin, n), 0o755); }
  const hk = join(home, "hk-fake.sh"); writeFileSync(hk, FAKE_HK); chmodSync(hk, 0o755);
  const wf = join(home, "kw.txt"); writeFileSync(wf, "a\nb\n");
  const env = { ...process.env, HOME: home, HARVEST_KEYWORD: hk, WFR_DISABLED: "1", BATCH_SLEEP: "0", WALL_REPORT: "/nonexistent", BATCH2_NOW_HOUR: "14", ...extra };
  if (!("WF_FORCE_OUTSIDE_WINDOW" in extra)) delete env.WF_FORCE_OUTSIDE_WINDOW;
  const r = spawnSync(ZSH, [BATCH2, "p1", wf, "t9", "1", ""], { encoding: "utf8", env, timeout: 30000 });
  return { r, home };
}

test("batch2 时窗: 默认白天第 1 个词都不开", { skip: SKIP }, () => {
  const { r, home } = b2({});
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readOr(join(home, "hk.log")), "");
});

test("batch2 时窗: WF_FORCE_OUTSIDE_WINDOW=1 白天词照跑;只认 1", { skip: SKIP }, () => {
  const ok = b2({ WF_FORCE_OUTSIDE_WINDOW: "1" });
  assert.equal(ok.r.status, 0, ok.r.stderr);
  assert.deepEqual(readOr(join(ok.home, "hk.log")).trim().split("\n"), ["a", "b"]);
  const no = b2({ WF_FORCE_OUTSIDE_WINDOW: "true" });
  assert.equal(readOr(join(no.home, "hk.log")), "");
});

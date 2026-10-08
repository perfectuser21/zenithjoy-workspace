// services/phone-adb-controller/__tests__/deploy-kickstart-disabled.test.mjs
//
// 10-08 ce5969ed 自动部署失败(run 37729917751): mmv 上分身 watcher com.zenithjoy.escortclaude 是有意 launchctl disable 的,
// escort-claude-escalation.sh 换版后 kickstart_if_changed 照样 kickstart -k → "Could not find service" → FAILED=1,
// deploy.sh 在发布 deployment-manifest 之前退出: 执行机文件已是新版、manifest 还是旧版,采收冻结固定版本全部拒跑。
// 修后: 服务被 launchctl disable 时只记一行「已禁用,不重载」,不判失败;没禁用但重载失败仍判失败。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DEPLOY = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "deploy.sh"), "utf8");
const fn = (name) => {
  const m = DEPLOY.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, "m"));
  assert.ok(m, `deploy.sh 里找不到 ${name}()`);
  return m[0];
};

// 假 ssh: md5 换版;print-disabled 按 DISABLED 回;kickstart 按 KICK_FAIL 失败
function run(env) {
  const script = `
FAILED=0
ssh(){ shift; case "$1" in
  *md5*) echo new;;
  *print-disabled*) if [ "$DISABLED" = 1 ]; then printf '\\t"com.zenithjoy.escortclaude" => disabled\\n'; else printf '\\t"com.zenithjoy.other" => disabled\\n'; fi;;
  *kickstart*) echo KICKED >&2; [ "$KICK_FAIL" = 1 ] && { echo 'Could not find service' >&2; return 113; }; return 0;;
esac; }
remote_md5(){ echo new; }
${fn("kickstart_if_changed")}
kickstart_if_changed mmv com.zenithjoy.escortclaude old "~/bin/x.sh"
echo "FAILED=$FAILED"`;
  return spawnSync("bash", ["-c", script], { encoding: "utf8", env: { ...process.env, ...env } });
}

test("服务被 launchctl disable → 不 kickstart、不判失败,留一行说明", () => {
  const r = run({ DISABLED: "1", KICK_FAIL: "1" });
  assert.match(r.stdout, /FAILED=0/, r.stdout + r.stderr);
  assert.match(r.stdout, /com\.zenithjoy\.escortclaude 已被 launchctl disable,不重载/);
  assert.doesNotMatch(r.stderr, /KICKED/);
});

test("未禁用但 kickstart 失败 → 仍判失败(不放过真故障)", () => {
  const r = run({ DISABLED: "0", KICK_FAIL: "1" });
  assert.match(r.stdout, /FAILED=1/, r.stdout + r.stderr);
  assert.match(r.stdout, /重载失败/);
});

test("未禁用且 kickstart 成功 → 正常重载", () => {
  const r = run({ DISABLED: "0", KICK_FAIL: "0" });
  assert.match(r.stdout, /FAILED=0/);
  assert.match(r.stdout, /已 kickstart -k/);
});

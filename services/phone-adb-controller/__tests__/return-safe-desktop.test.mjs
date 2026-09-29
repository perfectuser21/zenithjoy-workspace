// douyin-phone-adb return-safe-desktop 子命令回归测试（0929 DoD 审计批次4新建）。
// 事故形状：契约"回安全桌面"(cleanup 活动 step 3)从建成起就是零实现——
// close-app 虽然也按 HOME 键，但只验证"前台不再是抖音"，不验证"真的回到了桌面"
// (有可能落在另一个 App 上)。契约要求的断言是"前台 = launcher"。
//
// 修法：新增 return-safe-desktop 子命令，用设备自身声明的默认桌面(HOME intent
// resolve-activity)查出真实 launcher 包名——不 hardcode 任何厂商包名(0929 真机
// xian-m4 两台荣耀机实测是 com.hihonor.android.launcher，小米/OPPO/vivo 各不相同)，
// 按 HOME 键最多重试3次，前台仍不是 launcher 就 die。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT = new URL("../douyin-phone-adb", import.meta.url).pathname;

test("前置：zsh 可用", () => {
  assert.equal(spawnSync("zsh", ["-c", "exit 0"]).error, undefined,
    "没有 zsh —— 本文件所有守卫都会静默失效，请在 CI 里装上");
});

// 假 adb：resolve-activity 返回可配置的 launcher 包名；dumpsys window 的前台按
// "跳过前N次是抖音,之后是launcher"的策略回，模拟"按了几次HOME才真正回到桌面"。
function makeFakeAdb({ launcherPkg = "com.hihonor.android.launcher", settleAfter = 1 }) {
  return `#!/bin/sh
HOME_PRESS_COUNT_FILE="\${TMPDIR:-/tmp}/rsd-home-presses-$$-marker"
[ -n "$RSD_COUNT_FILE" ] && HOME_PRESS_COUNT_FILE="$RSD_COUNT_FILE"
args="$*"
case "$args" in
  *"get-state"*) echo device; exit 0;;
  *"resolve-activity"*) printf 'name=x.y.Launcher\\npackageName=${launcherPkg}\\n'; exit 0;;
  *"input keyevent 3"*)
    n=$(cat "$HOME_PRESS_COUNT_FILE" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$HOME_PRESS_COUNT_FILE"
    exit 0;;
  *"dumpsys window"*)
    n=$(cat "$HOME_PRESS_COUNT_FILE" 2>/dev/null || echo 0)
    if [ "$n" -ge "${settleAfter}" ]; then
      printf 'mCurrentFocus=Window{abc u0 ${launcherPkg}/.MainActivity}\\n'
    else
      printf 'mCurrentFocus=Window{abc u0 com.ss.android.ugc.aweme/.MainActivity}\\n'
    fi
    exit 0;;
  *"screencap"*) exit 0;;
  *"pull"*) exit 0;;
esac
exit 0`;
}

function setup({ launcherPkg, settleAfter } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "rsd-"));
  const reg = join(dir, "r.tsv");
  writeFileSync(reg, "legacy\tSER1\tANY-MODEL\t1199\t2663\n");
  const adbPath = join(dir, "fake-adb");
  writeFileSync(adbPath, makeFakeAdb({ launcherPkg, settleAfter }));
  chmodSync(adbPath, 0o755);
  const countFile = join(dir, "home-presses");
  return { dir, reg, adbPath, countFile };
}

function run({ launcherPkg, settleAfter } = {}) {
  const { reg, adbPath, countFile } = setup({ launcherPkg, settleAfter });
  return new Promise((resolve) => {
    const p = spawn("zsh", [SCRIPT, "--profile", "legacy", "return-safe-desktop"], {
      env: { ...process.env, DOUYIN_PHONE_REGISTRY: reg, DOUYIN_ADB_BIN: adbPath, RSD_COUNT_FILE: countFile },
    });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("close", (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}

test("第一次按HOME就已经在launcher → 成功,输出launcher包名", async () => {
  const r = await run({ launcherPkg: "com.hihonor.android.launcher", settleAfter: 1 });
  assert.equal(r.code, 0, `err=${r.err}`);
  assert.match(r.out, /launcher=com\.hihonor\.android\.launcher/);
});

test("前2次按HOME仍在抖音,第3次才回到launcher → 重试后成功", async () => {
  const r = await run({ launcherPkg: "com.miui.home", settleAfter: 3 });
  assert.equal(r.code, 0, `err=${r.err}`);
  assert.match(r.out, /launcher=com\.miui\.home/);
});

test("按满3次HOME仍不在launcher(卡在弹窗等) → die,不假装成功", async () => {
  const r = await run({ launcherPkg: "com.hihonor.android.launcher", settleAfter: 99 });
  assert.notEqual(r.code, 0, `不应该在没真正到桌面时判定成功, out=${r.out}`);
  assert.match(r.err, /still not on safe desktop/);
});

test("不 hardcode 厂商包名: 换一个完全不同的launcher包名(vivo)同样能识别成功", async () => {
  const r = await run({ launcherPkg: "com.bbk.launcher2", settleAfter: 1 });
  assert.equal(r.code, 0, `err=${r.err}`);
  assert.match(r.out, /launcher=com\.bbk\.launcher2/);
});

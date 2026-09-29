// harvest-cron.sh 通话中拦截回归测试（0929 DoD 审计发现的死代码）。
// 事故：契约「验通话空闲」这一步一直是死代码——douyin-phone-adb 的 preflight 子命令
// 里有真实的 call_state 检测（dumpsys telephony.registry 的 mCallState），但从建成起
// 就没有任何调用链路碰过这个子命令，harvest-cron.sh 自己的 preflight 只查在线+唤醒，
// 从不查通话状态。手机通话中被自动化戳屏幕，触点全部落在通话界面上。
//
// 修法：harvest-cron.sh 新增 device_call_busy() 纯函数 + 在设备 preflight 段落用真实
// dumpsys telephony.registry 查询 mCallState，占线(1=ringing/2=offhook)即 escalate+exit 0。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HC = join(HERE, "..", "harvest-cron.sh");
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
const SKIP = !ZSH && "no zsh (CI: sudo apt-get install -y zsh)";

function lib(cmd) {
  return spawnSync(ZSH, ["-c", `HARVEST_CRON_LIB=1 source ${HC}; ${cmd}`], { encoding: "utf8" });
}

test("device_call_busy: mCallState=0(idle) → 未占线(非0)", { skip: SKIP }, () => {
  assert.notEqual(lib(`device_call_busy 0`).status, 0);
});
test("device_call_busy: mCallState=1(ringing) → 占线(0)", { skip: SKIP }, () => {
  assert.equal(lib(`device_call_busy 1`).status, 0);
});
test("device_call_busy: mCallState=2(offhook) → 占线(0)", { skip: SKIP }, () => {
  assert.equal(lib(`device_call_busy 2`).status, 0);
});
test("device_call_busy: 空/无法识别的值 → 未占线(非0，fail-open，不因读取失败误挡整批)", { skip: SKIP }, () => {
  assert.notEqual(lib(`device_call_busy ""`).status, 0);
  assert.notEqual(lib(`device_call_busy unknown`).status, 0);
});

test("接线守卫: 设备 preflight 段落必须真的查询 mCallState 并用 device_call_busy 网关，且在 exit 0 之前", { skip: SKIP }, () => {
  const src = readFileSync(HC, "utf8");
  const iDumpsys = src.indexOf("dumpsys telephony.registry");
  const iGate = src.indexOf('device_call_busy "$CALLSTATE"');
  const iExit = src.indexOf("call_busy", iGate);
  assert.ok(iDumpsys > 0, "找不到 mCallState 真实查询");
  assert.ok(iGate > iDumpsys, "device_call_busy 网关应在查询之后");
  assert.ok(iExit > iGate, "占线时应有对应的失败记账/退出路径");
});

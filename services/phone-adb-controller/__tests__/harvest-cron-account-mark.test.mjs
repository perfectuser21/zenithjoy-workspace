// harvest-cron.sh 读账号标记(我页)回归测试（0929 DoD 审计批次4修复的死代码）。
// 事故：契约"读账号标记(我页)"从建成起就是死代码——douyin-phone-adb 的 account-current
// 子命令（真读"我"页"抖音号："文本，多版本兼容，找不到底部导航会自动重试+纠偏）从建成起
// 没有任何调用链路碰过它，登错号/串号全程无人发现，采到的线索会被静默贴上错误账号的标签。
//
// 修法：新增 account_registered() 纯函数校验"我页读到的抖音号是否登记在本profile下"，
// 并在 harvest-cron.sh 设备 preflight 段落里真调 account-current + 用它网关，读不到号
// 或号不在册都 escalate + 记账为需人工处理 + exit 0，不静默继续采。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HC = join(HERE, "..", "harvest-cron.sh");
// 7f842d12: harvest-cron.sh 已退成薄壳(exec wf-run.sh keyword_acquisition),源码接线守卫改查实现 wf-run.sh
const HC_IMPL = join(HERE, "..", "wf-run.sh");
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
const SKIP = !ZSH && "no zsh (CI: sudo apt-get install -y zsh)";

function lib(cmd) {
  return spawnSync(ZSH, ["-c", `HARVEST_CRON_LIB=1 source ${HC}; ${cmd}`], { encoding: "utf8" });
}

function withRegistry(content, fn) {
  const dir = mkdtempSync(join(tmpdir(), "acctreg-"));
  const p = join(dir, "routes.tsv");
  writeFileSync(p, content);
  return fn(p);
}

test("account_registered: profile+douyin_id 都命中注册表 → 已注册(0)", { skip: SKIP }, () => {
  withRegistry("jinoshengyuan-work\tlangzi63485\t躺赢AI学姐\tsearch-primary\n", (reg) => {
    assert.equal(lib(`account_registered jinoshengyuan-work langzi63485 ${reg}`).status, 0);
  });
});

test("account_registered: douyin_id 存在但挂在别的 profile 下 → 未注册(非0)", { skip: SKIP }, () => {
  withRegistry("jinoshengyuan-work\tlangzi63485\t躺赢AI学姐\tsearch-primary\n", (reg) => {
    assert.notEqual(lib(`account_registered yueshengyun-work langzi63485 ${reg}`).status, 0);
  });
});

test("account_registered: 本 profile 下没有这个 douyin_id → 未注册(非0)", { skip: SKIP }, () => {
  withRegistry("jinoshengyuan-work\tlangzi63485\t躺赢AI学姐\tsearch-primary\n", (reg) => {
    assert.notEqual(lib(`account_registered jinoshengyuan-work someone-else ${reg}`).status, 0);
  });
});

test("account_registered: 登记表文件不可读(挂了) → fail-open,不拦(0)", { skip: SKIP }, () => {
  assert.equal(lib(`account_registered jinoshengyuan-work langzi63485 /nonexistent/path.tsv`).status, 0);
});

// ── 接线守卫: preflight 段落必须真调 account-current 并用 account_registered 网关 ──
test("接线守卫: preflight 必须调 account-current,读不到号/号不在册都要走 exit 0 的失败记账路径,且发生在 wfr_bootstrap(init 写账本)之前", { skip: SKIP }, () => {
  const src = readFileSync(HC_IMPL, "utf8");
  const iCallState = src.indexOf('device_call_busy "$CALLSTATE"');
  const iAcctCall = src.indexOf('account-current "$TAG');
  const iReadFailed = src.indexOf("account_read_failed");
  const iMismatch = src.indexOf("account_mismatch");
  const iRegisteredGate = src.indexOf('account_registered "$P"');
  const iBootstrap = src.indexOf("wfr_bootstrap \"$TAG\"");
  assert.ok(iCallState > 0, "找不到通话中检测(定位锚点)");
  assert.ok(iAcctCall > iCallState, "account-current 应该在通话检测之后调用");
  assert.ok(iReadFailed > iAcctCall, "读不到抖音号应有对应的失败记账分支");
  assert.ok(iRegisteredGate > iAcctCall, "应该用 account_registered 网关校验注册表");
  assert.ok(iMismatch > iRegisteredGate, "号不在册应有 account_mismatch 失败记账分支");
  assert.ok(iBootstrap > iMismatch, "账号校验必须在 wfr_bootstrap(账本init)之前完成");
});

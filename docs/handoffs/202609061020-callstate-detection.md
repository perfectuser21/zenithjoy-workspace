# Handoff：给 douyin-phone-runtime 信号桥补真实通话状态检测(call_state)（PR#1784）

> task_id=unknown（路径B小改动，未走 Brain task 注册）

## 结论

**PASS**。PR #1784 已合并（squash merge，`perfectuser21/zenithjoy-workspace`），分支 `cp-09060821-callstate-detection`。

## 归位

`customer_app/line02/keyword_acquisition` · keep-green（补齐既有信号桥的已知缺口，不新增格子坐标）。

## 背景

验证 ZenithJoy 信号桥能否驱动 OpenClaw 真实 AI（Work Commander + worker）过程中发现：`douyin-phone-runtime` skill 有一条安全铁律——"无法确认手机是否在通话中，就安全停止"。这个检测能力从设计之初（PR#1777）就是占位实现（固定返回 `unknown`），导致整套获客流程在 preflight 阶段完成后必然触发安全停止，永远无法推进到后续阶段（找视频/discovery 等）。这不是新发现的 bug，是设计文档里早已承认、需要补齐的已知缺口。

## 完成

- **Android 端**（`services/agent-android`）：
  - `AndroidManifest.xml` 新增 `READ_PHONE_STATE` 权限声明
  - `AgentService.kt` 新增 `callStateProbe()` 私有函数，`device_info` 指令返回值新增 `callState` 字段（`idle`/`ringing`/`offhook`/`permission_denied`），替代占位 `unknown`
  - 权限被拒绝时明确返回 `permission_denied`，**绝不静默返回 `idle`**——避免下游误判"可以继续操作"而干扰用户真实通话（这是这次改动最关键的安全判定点，已拍板）
  - `MainActivity.kt` 状态页仿照既有 `RECORD_AUDIO` 授权模式，加了"授权通话状态"按钮
- **脚本端**（`scripts/openclaw`）：
  - `adb-controller-bridge.sh` 的 `cmd_preflight()` 从硬编码 `call_state:"unknown"` 改为读取真实透传值
  - 顺带补录 `close-app` 命令实现——这是此前在 HK 网关运维排查过程中紧急直接部署到生产、从未走代码流程正式入库的历史欠账，这次一并补齐（key home 回桌面 + 验证前台非抖音 + 落盘桌面截图证据）
  - 中台 API 路由、`phonectl.sh` 全程零改动（对 `device_info` 的 data 字段是纯透传架构）
- **测试**：`CommandExecutorTest.kt` 新增 callState 透传回归测试；`adb-controller-bridge.test.js` 完整 TDD 红绿灯（新增 call_state 场景 2 条 + close-app 场景 2 条），全量测试 59/59 通过
- **真机验证**（HONOR MAA-AN00，`zenithjoy-bridge-smoke` profile，本地构建 + 正式 release keystore 签名 + 覆盖安装，不影响设备已有绑定状态）：
  - 未授权 `READ_PHONE_STATE` → `call_state` 正确返回 `permission_denied`
  - 授权后（非通话）→ `call_state` 正确返回真实 `idle`
  - 端到端确认：独立测试 workflow 副本（`AwrSocialLeadgenV4BridgeTest`，不碰生产悦升/金诺租户）验证到 preflight 真正通过、平台锁真正获取（`call_state_idle:1, lock_acquired:1`）——之前"因 call_state=unknown 永久安全停止"的阻塞点已彻底解除

## 过程中的重要教训（记录供以后参考）

HK-VPS 上 `/opt/openclaw/zenithjoy-bridge/scripts/adb-controller-bridge.sh` 是会话早期手动 `scp` 部署的一份**静态拷贝**，跟 git 仓库完全独立、不会自动同步。这次 Task4 在仓库里改完 `call_state` 逻辑、测试全绿之后，第一次真机验证仍然读到旧的 `unknown`——排查了很久才发现根因是"服务器上跑的还是旧版本脚本，压根没部署过仓库里的改动"。这次已经把仓库版本和 HK-VPS 部署版本重新对齐（含把 HK-VPS 上独有的 `close-app` 实现补录回仓库），但**这套"脚本部署在生产服务器、和 git 仓库分离"的运维模式本身仍是隐患**，后续如果再改这个脚本，必须记得同步部署，或者更根本地解决"部署方式"这个问题。

## 未完成 / 明确范围外

1. **不处理多 SIM 卡分别取状态**（YAGNI，测试机是单卡，`getCallState()` 无 subId 参数版本足够）
2. **不新增"通话状态"独立轮询指令**（复用 `device_info` 满足当前 preflight 一次性判定需求）
3. **真实来电 ringing/offhook 场景未做真机验证**（很难专门配合"打个电话去测"，`idle`/`permission_denied` 两态验证到位即可交付，后续真机自然遇到来电时若有异常再回来修）
4. **意外发现的新问题**：修复 `call_state` 后，preflight 真正通过、推进到 `open-app` 阶段时，出现 `LAUNCH_NOT_FOREGROUND` 错误（打开抖音后未正确进入前台），跟本次改动无关，是一个独立的、全新的问题，已尝试写入 Brain issues（API 调用报鉴权错误，未确认是否真正入库，需要人工核实）
5. **`foreground_pkg` 恒为 `unknown` 的既有 bug**：`cmd_preflight` 里 `foreground=$(echo "$dinfo" | jq -r '.foregroundPkg // "unknown"')` 取的字段路径在真实中台响应里根本不存在（真实响应结构里没有独立的顶层 `foregroundPkg` 字段），这是从脚本设计之初就存在的、跟本次改动无关的独立 bug，未修复

## 下一步

1. 排查 `open-app LAUNCH_NOT_FOREGROUND` 问题，这是继续推进"信号桥驱动 OpenClaw 完整获客流程"这条主线的下一个真实阻塞点
2. 顺手修 `foreground_pkg` 恒为 `unknown` 的字段路径 bug
3. 评估 HK-VPS 信号桥脚本部署方式，避免"仓库改了、服务器没同步"再次发生
4. 确认 Brain issue 是否成功写入（PR 收尾时 API 调用报了 UNAUTHORIZED，不确定是否有兜底机制真正写入了）

## 数据源

- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1784
- Merge commit: `1357ba01c3f2249cd27edb3824c6783d9a7e0733`
- 设计文档: `docs/superpowers/specs/2026-09-06-callstate-detection-design.md`
- 实现计划: `docs/superpowers/plans/2026-09-06-callstate-detection.md`
- Decision: `74f71907-d40f-40ce-8f09-1ce731bd57a6`（Brain strategic-decisions，category=small-change）
- 前置 PR：#1777（adb_controller 信号桥适配层）、#1779/#1781（preflight platform 字段 bug 修复）

## Artifacts

- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1784
- Branch: `cp-09060821-callstate-detection`（已删除，squash merge 后清理）

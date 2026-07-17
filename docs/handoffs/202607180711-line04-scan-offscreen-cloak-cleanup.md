# Handoff：Line04 扫描态挪坐标屏外根治窗口闪烁 + cloak 死代码清理

- task_id: unknown（原交接单声称 Brain task `3807fcc0`「已 claim」，但该 ID 只有 8 位十六进制前缀，不是合法 UUID；在 tasks 表最近 2000 条记录中按 ID 前缀和标题关键词均未查到对应任务，无法回写 Brain DB。仅写本 docs/handoffs 镜像。）
- verdict: PASS
- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1372（已合并，merge commit 652a8f0b）

## 完成

1. 承接上一 session 已完成的核心修复（commit 3f832808，分支 `cp-07172323-scan-offscreen`）：`_should_move_offscreen(offscreen_reply, for_reply) = offscreen_reply or not for_reply`，让扫描态（`for_reply=False`）无论 `_OFFSCREEN_REPLY` 是否为 True 都挪坐标屏外，根治真机扫描时窗口每 ~10s 弹闪。
2. 版本号 1.0.133 → 1.0.134，共 7 处（原交接单只列了 6 处，遗漏了 `apps/api/src/services/walking-skeleton.service.ts` 的 `HEARTBEAT_MODULES` 硬编码常量——这是心跳下发版本号的真正来源，manifest.json 只是其中一个校验点）：
   - `services/agent/build-modules/line04/manifest.json`
   - `services/agent/modules/line04/manifest.json`
   - `.github/workflows/scripts/smoke/offscreen-version-gate-smoke.sh`
   - `.github/workflows/scripts/smoke/preflight-delivery-selfcheck-smoke.sh`
   - `.github/workflows/scripts/smoke/wechat-cs-visible-delivery-smoke.sh`
   - `.github/workflows/scripts/smoke/heartbeat-module-health-smoke.sh`
   - `apps/api/src/services/walking-skeleton.service.ts`（新发现的第 7 处，`apps/api/tests/regression/module-version-sync.test.ts` 是护栏但当时没被想起来查）
3. DeepSeek Code Review 🔴 指出：注释说 cloak 跨进程 `E_ACCESSDENIED` 从不生效（decision ee2890bb），但代码仍在 `_ensure_tray_visible` 的 minimized/visible 分支里调用 `DwmSetWindowAttribute`。核实后确认这是真问题——予以移除（`_restore_window_state` 侧的 uncloak 触发条件同步收窄为仅 `original_state == 'tray'`）。tray 分支的常驻隐身 cloak（`_CLOAK_OWNED`，v1.0.105 机制）不在本次改动范围内，原样保留。
4. 上一步 cloak 清理导致 7 个旧回归测试（PR #1355/commit 96e5b28d 引入）报红——这些测试断言的正是"扫描态 cloak-only、不挪坐标"的旧行为，即本次要修的 bug 本身。逐一核实语义后重写（回复态相关的补 `for_reply=True` 保留 B 方案覆盖；扫描态相关的改断言"挪坐标、不再 cloak"）。
5. 所有改动的 Python 文件均双写：源 `services/agent/wechat-rpa/` + 镜像 `services/agent/build-modules/line04/wechat-rpa/`，全程用 diff 校验两份一致。
6. CI 全绿后 auto-merge 生效，PR #1372 已合并进 main。

## 没做 / 遗留

- **真机部署验证未做**：原交接单第 5 步「发 line04 新包 → 部署 rog → 真机肉眼确认扫描时不弹窗、来消息能正常回复」本次未执行。CI 里的 `job2/job3`（self-hosted xian-rog）跑的是 dryrun/单测/气泡可读性 gate，不等价于真实部署后的肉眼验证。
- tray 分支的 cloak（`_CLOAK_OWNED` 常驻隐身机制）未审查——按 ee2890bb 的铁证，tray 分支的 cloak 大概率同样跨进程无效，`_finish_scan_window` 里 `if st == "tray" and _CLOAK_OWNED: return` 可能导致弹出的托盘窗口永远不会被真正隐藏（因为跳过了 `_restore_window_state` 的 `SW_HIDE`，寄望于一个可能从不生效的 cloak）。这次为了控制改动范围没有动它，值得单独起一个 sprint 查证。
- 本地 macOS 环境跑 `pytest services/agent/wechat-rpa/tests/ -q`（全目录）会额外冒出 6 个与本次改动无关的失败（`test_launch_weixin.py`、`test_scan_recent_contacts.py`、以及 3 个 `test_tray_scan_fix.py` 用例），在真机 CI（Windows self-hosted xian-rog）上不会复现——已用未改动的原始测试文件在本地做过同样的全量跑验证，确认是本地环境噪音（可能是 macOS `ctypes.windll` stub 与真 Windows 环境下模块导入顺序污染的差异），不是本次改动引入。未深挖根因，如果以后要在本地跑全量测试遇到这几个诡异失败，可以直接参考本条跳过它们。

## 下一步

1. 找 xian-rog 真机部署新版 line04（1.0.134），肉眼确认：扫描时不弹窗、来消息能正常回复。
2. 视情况另立 sprint 审查 tray 分支的 `_CLOAK_OWNED` 常驻隐身机制是否也是无效 cloak 导致的潜在 bug（见上方遗留项）。
3. Brain task 3807fcc0 对应的原始任务记录目前查无此 ID，如果这是个真实存在但格式记录错误的任务，需要人工核实原始 ID 并手动回写状态。

## 数据源

- 分支：`cp-07172323-scan-offscreen`（已合并，worktree 已清理）
- PR：https://github.com/perfectuser21/zenithjoy-workspace/pull/1372
- 涉及文件：`services/agent/wechat-rpa/listen_chat.py` + 镜像、`apps/api/src/services/walking-skeleton.service.ts`、7 处版本号、7 个测试文件

## 决策引用

- decision 7b8857f7：扫描态挪坐标屏外的修法
- decision ee2890bb：cloak 跨进程 `E_ACCESSDENIED` 真机铁证（三档权限全测过）

## 产物

- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1372
- merge commit: 652a8f0bbf8c125850cf3f02a2d080aacbdf6c94

# Handoff：Line04 最小化窗口离屏还原被最大化态吞掉的修复 + 上一交接单三项遗留收尾

- task_id: unknown（本次 /dev 是交互式承接上一 session 的 handoff next_steps，未走 headed Brain task 派发，`.dev-mode` 的 task_id=local，非合法 UUID，跳过 Brain tasks 表回写）
- verdict: PASS
- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1374（已合并，merge commit 4fa28345735373f6ed74ec0e4b6ac5279d68ed46）

## 承接的上一交接单（PR #1372 handoff）三项遗留

1. **真机部署 1.0.134 验证扫描不弹窗** —— 已验证，但结果是 FAIL（详见下方根因），已开新 PR #1374 修复。
2. **tray 分支 `_CLOAK_OWNED` 常驻隐身审查** —— 未直接验证（真机测试走的是"最小化"分支，不是"托盘隐藏"分支，两者是 `_ensure_tray_visible` 里不同的 if/elif 分支）。仍是待验证假设，不在本次范围内解决，见下方「没做/遗留」。
3. **Brain task `3807fcc0` 查无此 ID** —— 已解决。用"更新时间倒序"重新查（此前两轮搜索按创建时间正序取前 2000 条，任务表实际 2500+ 条，这条任务是 2026-07-17 创建的新任务，排在后面被漏掉）。真实 ID = `3807fcc0-72e2-4600-85d6-072e3ebf66d8`，状态 `failed` 是真实准确的——S2 锚点闸（缺 `payload.anchor.{journey_id,gp_id,step_id}`）在点火时就直接拒绝，headed 流水线从未真正跑起来；实际交付是走独立人工 `/dev` session 完成的（PR #1372）。已通过 `PATCH /api/brain/tasks/<id>` 写入 `result` 字段回写这段说明（status 本身是终态 `failed`，Brain API 不允许再转，属预期行为，不是 bug）。

## 完成（本次新发现 + 修复，PR #1374）

### 真机验证方法论（比过去更硬的证据）

用 WinAPI 高频轮询（`IsIconic` + `GetWindowRect` ground truth，每 250ms 或更高频，而非读 `zj-listener.log` 心跳推断）在 xian-rog 上验证微信最小化后是否真的不弹窗。20 秒窗口内**复现 2 次**：微信从离屏坐标短暂（250-500ms）弹回屏内可见坐标。

### 根因（decision 433b117c）——与 7-17 已修的 cloak 问题是不同的坑

WeChat 窗口一旦被最大化过，`WINDOWPLACEMENT.flags` 带 `WPF_RESTORETOMAXIMIZED`。`_ensure_tray_visible` 的 `elif _is_iconic:`（最小化）分支用 `SetWindowPlacement` 把 `rcNormalPosition` 改到离屏坐标 `(-2600,60)` 后调 `ShowWindow(SW_SHOWNOACTIVATE)` 还原——但只要该 flag 还在，Windows 完全无视刚设的离屏坐标，直接按最大化展开，窗口整屏可见（真机 rect 与显示器 work area 吻合，`(0,0,1707,1019)` work area 对应观测到的 `(-7,-7,1714,1026)`，±7px 是 Windows 10/11 的隐形拉伸边框）。

进一步真机验证发现第二层坑：即使清掉该 flag，`SetWindowPlacement` 对 `rcLeft` 仍可能被 Windows 钳制贴边（真机实测目标 X 被夹到 0，只有 Y=60 生效）——`SetWindowPlacement` 天生带"防丢窗口"钳制，不像 `SetWindowPos` 那样允许真正的任意离屏坐标（`_ensure_tray_visible` 的 tray/visible 分支一直用的是 `SetWindowPos`，从未踩过这个坑，只有 minimized 分支独用 `SetWindowPlacement` 才中招）。

### 修法（4 点，均已落 CI 单测 + 真机验证）

1. `_neutralize_maximize_restore` 纯函数：`SetWindowPlacement` 前清掉 `WPF_RESTORETOMAXIMIZED` + 强制 `showCmd=SW_SHOWNORMAL`。
2. `ShowWindow(4)` 后读 `GetWindowRect` 校验，仍在屏内就补一次 `SetWindowPos`（不受钳制，双保险）。
3. `_saved_normal_pos` 扩展为 6 元组 `(l,t,r,b,flags,showCmd)`，`_restore_window_state` 还原时用**原始**值写回——不能让"为隐藏做的临时调整"变成对用户最大化偏好的永久改动。
4. `_restore_window_state` 的 minimized 分支在 `ShowWindow(SW_MINIMIZE)` 前后临时关闭/恢复 `SPI_SETANIMATION`——从离屏坐标直接最小化会让 Windows 的最小化动画从离屏动画穿过屏内可见区域（任务栏永远在屏内），关动画可避免这一段中间可见帧。

版本 1.0.134 → 1.0.135（9 处引用：2 manifest + 4 smoke + 2 walking-skeleton service/test + 1 heartbeat-modules test）。

### TDD 证据

`test_minimized_maximize_restore_fix.py`（10 用例）先 commit（对着未修复代码跑，9/10 转红，1 个是"不画蛇添足"对称守卫两态都应过）→ 再 commit 实现让全部转绿。

## ⚠️ 重要教训：真机诊断脚本必须先备份原始 WINDOWPLACEMENT 再改，不能就地改完就假设"恢复"

调查根因过程中，为了在真机复现 bug，写了多轮独立诊断脚本直接用 `SetWindowPlacement`/`ShowWindow` 操作真实微信窗口（未经过 `_ensure_tray_visible` 的正式代码路径）。**每个诊断脚本自己捕获"当前 rect"当作"原始 rect"来做还原**——但如果窗口在上一轮诊断里已经被改小了，下一轮捕获到的"当前"就是已经损坏的状态，越测越坏。最终真实后果：真机主窗口（hwnd 985334）和一个次要窗口（hwnd 788804）的 `rcNormalPosition` 被永久钳在 `(67,67,502,490)`（435×423 小窗）和 `(767,400,942,597)`（175×197 小窗），`WPF_RESTORETOMAXIMIZED` 也被清空——虽然窗口本身还能正常收发消息，但侧边栏/导航布局在这个尺寸下不显示，直接导致 CI 里 `job3 — 真机气泡可读性 gate` 报错「session list 里找不到 文件传输助手」（rerun 两次同样报错，不是随机 flaky，是真实状态损坏）。

用截图 ground truth 确认问题后手动修复：直接对 hwnd 985334 重新 `SetWindowPlacement` 到一个健康尺寸 `(60,60,1400,900)` + `flags=0`，截图确认侧边栏和"文件传输助手"恢复可见，CI rerun 后全绿合并。

**下次做类似真机 WINDOWPLACEMENT 实验**：diagnostic 脚本必须在**第一次**修改前用一个独立文件把原始 `(rect, flags, showCmd)` 落盘（不依赖内存变量在多轮脚本调用间存活），且每次收尾必须显式核对（截图或读回 rect）确认真的恢复到落盘的原始值，而不是"调了 SW_RESTORE 就默认恢复了"。

## 没做 / 遗留

- **tray 分支 `_CLOAK_OWNED` 审查**（上一交接单原始项 2）仍未验证。`_finish_scan_window` 里 `if st == "tray" and _CLOAK_OWNED: return` 跳过 `_restore_window_state` 的假设未被本次真机测试触及（本次走的是"最小化"分支，需要另外真实触发微信"隐藏到托盘"——IsWindowVisible=False 而非 IsIconic=True 的状态——目前不清楚如何在不动 WeChat 自身托盘设置的前提下程序化模拟该状态，值得单独起 sprint 想办法真实触发）。
- 本次 CI 通过不等于已经用新版 1.0.135 重新做过完整的"扫描 20+ 秒不弹窗"肉眼复测（CI 的 job3 只测气泡可读性，不是专门测离屏隐藏的可见性）——建议下一个 sprint 补一个真机自检守卫，直接把本次用的 WinAPI 高频轮询方法固化成脚本，跑在 self-hosted xian-rog CI job 里，而不是只靠人工 SSH 临时验证（当前只在本次交互 session 里手工验证过一次）。

## 数据源

- PR：https://github.com/perfectuser21/zenithjoy-workspace/pull/1374
- merge commit：4fa28345735373f6ed74ec0e4b6ac5279d68ed46
- 涉及文件：`services/agent/wechat-rpa/listen_chat.py` + 镜像、9 处版本号引用、`services/agent/wechat-rpa/tests/test_minimized_maximize_restore_fix.py` + 镜像
- Brain task 回写：`3807fcc0-72e2-4600-85d6-072e3ebf66d8`（result 字段）

## 决策引用

- decision 433b117c：line04 微信窗口最小化恢复动画/最大化态导致离屏隐藏短暂闪现（本次修法依据）
- decision ee2890bb：cloak 跨进程 E_ACCESSDENIED 真机铁证（7-17 已修，与本次是不同根因）
- decision 7b8857f7：扫描态挪坐标屏外的修法（7-17）

## 产物

- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1374
- merge commit: 4fa28345735373f6ed74ec0e4b6ac5279d68ed46

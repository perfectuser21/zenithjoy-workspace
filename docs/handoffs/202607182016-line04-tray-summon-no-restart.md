# Handoff：Line04 ✕关闭恢复改用托盘图标召唤替代重启微信（用户拍板正解，真机端到端验证）

- task_id: unknown（交互式 /dev 承接，`.dev-mode` task_id=local，跳过 Brain tasks 表回写）
- verdict: PASS
- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1395（已合并，merge commit ad2a338e941142b7faf8570d84dbadf0b00df303）

## 用户拍板（否定前两刀的重启方案）

"塌了它只是进入到托盘了，你应该在托盘里边把它召唤出来，而不是直接把微信给我重启。"—— #1391（fallback 找到隐藏窗口）/#1393（快速自愈跳过冷却）都还是走重启，被用户明确否定。这一刀换成微信自己的托盘恢复。

## 机制（真机 9+3 轮实验实锤，本次会话最深的一次真机挖掘）

✕关闭 = 主窗口 `SW_HIDE` + 微信自身**撕掉 UI 内容树**。真机逐一排除的救不回内容的方法：`SW_SHOWNA` / 最大化 / 滚轮 jiggle / 任务栏按钮点击 / `UIAElementInfo` 直接构造 / **UIA Invoke**。唯一有效：**真实鼠标双击通知区（`^` 溢出里的）微信托盘图标** → 触发微信自己的从托盘恢复逻辑 → content 0→12 会话，~5s，不杀进程。

## 修法（PR #1395，模块 1.0.142）

`_summon_wechat_from_tray()`：展开通知区 `^` 溢出（真实点击 chevron）→ 轮询等浮层稳定 → 真实鼠标双击微信图标（`SetCursorPos`+`mouse_event`，坐标 UIA 动态取）→ 轮询确认内容重建。接进 ✕关闭快速自愈路径作为**首选**：召唤成功即完事（不重启），失败才退回 `_restart_wechat_for_uia` 兜底。光标测完还原，仅 ✕关闭恢复路径调用（罕见），不影响静默扫描。

## 关键坑（真机踩出，已写入代码注释与 decision 96de919c）

1. **UIA Invoke 点托盘图标无效**——不转发鼠标消息，必须真实 `SetCursorPos`+`mouse_event` 双击。这是第一版托盘尝试（tray_summon 用 invoke）0 触发的根因。
2. 单击/任务栏按钮/窗口 API 都只让空壳窗口可见，**不重建内容**——只有微信自己的托盘恢复路径重建。
3. 溢出浮层要**轮询等稳定再找图标**（否则首次 attempt 找不到，是 3 轮重复实验里唯一失败那轮的根因）。修法里对 chevron 展开后加了 6×0.35s 轮询。
4. 需要**双击**（单击真机测下来不稳定）。

## 真机端到端验证（合并前，真实监听运行下）

```
19:56:30  程序化 ✕ 关闭（hidden=true）
19:56:47  检测到 UIA 树塌缩
19:57:51  ✕关闭快速自愈：先试托盘召唤(双击托盘图标触发微信自恢复，不重启)
19:57:55  ✕关闭托盘召唤成功：双击托盘图标重建内容树(attempt=1)，无需重启
19:58:54  完全恢复 login=True sessions=12
```
全程**无任何"已重启微信"日志**（最近一次重启是 19:40，本次 ✕关闭之前）——铁证纯召唤、进程没被杀。

## 本次会话 line04 窗口话题完整脉络（8 个 PR）

同一话题从"闪一下"一路挖到"✕关闭恢复"，共 8 个修复 PR：
1. #1374 最小化恢复被最大化态吞掉离屏坐标
2. #1379 操作者前台使用时仍挪窗口导致闪烁
3. #1381 离屏 X 用固定假设宽度算死，最大化窗口露屏
4. #1383 托盘态回复静默（窗口停离屏没挑回屏内）
5. #1387 回复态屏内可见不变量（结构性根因，前四刀都没打中真实路径）
6. #1391 ✕关闭永久卡死（get_main_window 隐藏窗口 fallback）
7. #1393 ✕关闭恢复慢/被冷却饿死（快速自愈通道）
8. #1395（本次）✕关闭恢复改托盘召唤，不重启

其中 #1387/#1391/#1395 是靠"用户否定表面补丁 → 逼出结构性/正解"推进的，都真机端到端验证过才合并。工作方式教训见 [[feedback_realmachine_fix_validate_yourself]]。

## 没做 / 遗留

- **托盘召唤是 Win11-specific**（`TopLevelWindowForOverflowXamlIsland` 溢出浮层）。客户机若是 Win10/不同任务栏布局，`_find_chevron_center`/`_find_wx_icon_center` 找不到 → 自动退回重启兜底（不会更差），但客户机形态多样时召唤命中率待观察。可在 `_is_tray_overflow_host` 里按客户机实际类名补充。
- **召唤依赖微信托盘图标在溢出区**：若用户把微信图标拖到通知区常显（不在 `^` 里），当前 `_find_wx_icon_center` 只搜溢出浮层会漏。可扩展为先搜常显区（Shell_TrayWnd 的 SystemTray）再搜溢出。
- **真实鼠标双击会瞬间移动光标**（测完还原）：仅 ✕关闭恢复触发，罕见，但用户正在用鼠标那一刻会被抢一下。可接受度待用户反馈。
- 旧遗留：恢复总时长仍受塌缩检测心跳周期（~60s）影响、本地 macOS 全量 pytest 噪音、rog 多方共享互斥锁。

## 数据源

- PR：https://github.com/perfectuser21/zenithjoy-workspace/pull/1395（merge ad2a338e）
- 涉及：`services/agent/wechat-rpa/listen_chat.py` + 镜像（新增 `_summon_wechat_from_tray`/`_rect_center`/`_is_tray_overflow_host`）、`tests/test_tray_summon.py` + 镜像、9 处版本号（1.0.141→1.0.142）
- 前置 handoff：`202607181923-line04-xclose-fast-heal.md`（#1393）

## 决策引用

- decision 96de919c：✕关闭恢复用托盘图标召唤(真实双击)替代重启微信（本次修法依据，含 UIA Invoke 无效等真机坑）
- decision 0ed4632b（#1393）/ d3e7299b（#1391）：同话题前两刀

## 产物

- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1395
- merge commit: ad2a338e941142b7faf8570d84dbadf0b00df303

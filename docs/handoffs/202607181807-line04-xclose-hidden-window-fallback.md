# Handoff：Line04 ✕关闭到托盘永久卡死修复——get_main_window 隐藏窗口 fallback（真机端到端验证）

- task_id: unknown（交互式 /dev 承接，`.dev-mode` task_id=local，跳过 Brain tasks 表回写）
- verdict: PASS
- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1391（已合并，merge commit c9c228790523654ba8dc0c118023616ce5718c30）

## 用户报障（真机实测原话）

"我把微信直接从右上角点个叉叉关闭，它又进入托盘里面了…它就显示微信进程已运行，但 UIA 找不到主窗口…它就一直卡到这了…我点最大化、最小化可以，但是我点关了，在界面上没有了，你就失败了"。且老代码唯一出路（重量级重启微信）被用户当场目睹并明确否定："你应该通过什么东西把它召唤出来，而不是直接把微信给我重启了"。

## 根因（真机 9 轮实验钉死）

✕ 关闭 = `SW_HIDE`（窗口对象存活，非销毁）→ `get_main_window()` 用 pywinauto **可见窗口枚举**永远 miss → 返回 None → 主循环卡"跳过重复启动"。

## 修法（PR #1391，模块 1.0.140）

`get_main_window` 尾部 fallback：可见枚举 miss → raw `EnumWindows`（含不可见，win32 初筛纯函数 `_is_main_window_candidate`）→ `UIAElementInfo(hwnd)` 直接构造（真机验证隐藏态可构造）→ **UIA 层类名终审**（`mmui::MainWindow`/Qt5+中文"微信"命中；`mmui::LoginWindow` 登录窗、`title=Weixin` 空壳排除）→ 返回 wrapper，既有托盘分支/自愈机制接管。

## 真机端到端验证结果（合并前，监听真实运行状态下）

程序化 ✕ 关闭 → **5 秒内**心跳 `found_window=True`（老代码此处 False 永久卡死）→ 树塌缩检测接管 → 90s 宽限 → 重启自愈 → 欢迎屏自动点『进入微信』→ **约 3 分钟全自动恢复** `login=True sessions=12`，全程无人工介入。

## 排查中实锤的反直觉事实（防后人再踩，全部真机证据）

1. **二次启动 Weixin.exe 不是单实例激活**——真的会拉起第二个实例停在登录窗（进程数 5→6 实测），且**登录窗的 win32 外框类名/标题与主窗口完全相同**（`Qt51514QWindowIcon`/"微信"），仅 UIA 层类名可区分（`mmui::LoginWindow` vs `mmui::MainWindow`）。本次排查中 3 轮实验打错窗口（WM_CLOSE 无效/树恒空/枚举 miss 全是假象）的元凶。老代码"跳过重复启动"的谨慎是对的。
2. **✕ 关闭会撕掉 UI 内容树**——窗口对象在、内容没了；SW_SHOWNA/SW_MAXIMIZE/滚轮 jiggle 均救不回内容（多轮验证）；与自己 SW_HIDE 再唤回（内容完好，30 会话可读）行为完全不同。当前内容重建仍需一次重启自愈。
3. **`UIAElementInfo(hwnd)` 可对隐藏窗口直接构造**——绕开 pywinauto 可见性枚举限制的关键。
4. 任务栏还有一个 `title="Weixin"`（英文）的空壳窗口长期存在，UIA 树恒空，可见时会被旧 `get_main_window` 误认（按枚举顺序），fallback 的 UIA 类名终审同时防了这个。

## 本次排查自己造的坑（已收拾，引以为戒）

- round 4 验证"二次启动"时真的拉起了第二个微信实例，污染了后续 3 轮实验判断；已 kill 清理。
- 数小时高强度窗口操作把当时的微信实例内部状态弄僵（WM_CLOSE 不响应、树恒空），最终重启微信一次收拾干净（重启后自动登录，无损）。
- 教训已并入 [[feedback_realmachine_fix_validate_yourself]]：真机实验前先全景快照（所有候选窗口+PID+可见性），实验对象用 PID+UIA 类名双重锁定，绝不能只按"枚举第一个"取窗口。

## 没做 / 遗留

- **零重启召唤**：真正不重启微信就恢复内容，需要模拟托盘图标的真实点击（微信自己的恢复路径）。本次验证 UIA Invoke 打不到通知区图标（只找到任务栏按钮，点击后窗口可见但内容/UIA 仍死）。可行方向：Win11 通知区溢出窗口(`TopLevelWindowForOverflowXamlIsland`)展开后再找图标、或 Shell_NotifyIcon 消息注入。值得单独 sprint。
- **✕关闭自愈的恢复时长 ~3 分钟**（90s 塌缩宽限 + 重启 + 欢迎屏自愈）。若想更快，可在 fallback 命中"隐藏主窗口"时直接短路进重启自愈（跳过 90s 宽限，因为 ✕ 关闭态的内容撕毁是确定的）——待用户对 3 分钟时长的反馈再决定。
- 本地 macOS 全量 pytest 噪音（14 个）、xian-rog 多方共享互斥锁两个旧遗留仍在。

## 数据源

- PR：https://github.com/perfectuser21/zenithjoy-workspace/pull/1391（merge c9c22879）
- 涉及：`services/agent/wechat-rpa/find_weixin.py` + 镜像、`tests/test_get_main_window_hidden_fallback.py` + 镜像、9 处版本号（1.0.139→1.0.140）
- 前置 handoff：`202607181449-line04-reply-onscreen-invariant.md`（#1387，同日第 5 个修复）

## 决策引用

- decision d3e7299b：✕关闭到托盘 get_main_window 永久找不到窗口卡死（本次修法依据）
- decision 284f56ac（#1387）/ 9c933d60（#1383）/ b5041511（#1381）/ 7e77a7e3（#1379）/ 433b117c（#1374）：同日同话题前五个修复

## 产物

- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1391
- merge commit: c9c228790523654ba8dc0c118023616ce5718c30

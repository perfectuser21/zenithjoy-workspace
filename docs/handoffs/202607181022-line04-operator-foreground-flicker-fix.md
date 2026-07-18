# Handoff：Line04 操作者前台使用微信时扫描仍闪烁的修复

- task_id: unknown（交互式 /dev 承接，`.dev-mode` task_id=local，非合法 UUID，跳过 Brain tasks 表回写）
- verdict: PASS
- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1379（已合并，merge commit cd8e5ebe520b3ff4157a4d85e2de1e8b8b9d718e）

## 背景

紧接 PR #1374（最小化窗口离屏还原被最大化态吞掉的修复）之后，用户在 rog 上真机实时反馈：正打开微信在用时，每 1-3 秒被挪到屏外再挪回一次，肉眼可见持续闪烁，用户原话"很蠢"。这是与 #1374 修的问题（最大化态吞掉离屏坐标）完全不同的另一个分支——`_ensure_tray_visible` 的"可见非最小化"分支。

## 完成

1. **根因**：`_ensure_tray_visible` 的"可见非最小化"分支（对应窗口当前可见、非最小化——也就是操作者正常打开在用的状态）不管操作者是否正在使用微信，每次扫描周期（1-3 秒一次）都无条件把窗口挪到屏幕外再挪回。代码里已有 `_wechat_is_foreground()` 判断操作者是否在前台使用微信，但此前只用在"要不要顶替回复"，从未用来"跳过挪窗口"。
2. **修法**：
   - `_ensure_tray_visible` 顶部加 `_wechat_is_foreground(mw)` 判断，前台时整个函数 no-op（不挪任何窗口，原地读——UIA 读取一个已可见非最小化窗口本不需要挪动位置）。
   - 最小化分支"恢复到离屏坐标"这一步（`ShowWindow(4)`）与 `_restore_window_state` 的"离屏→再最小化"方向相反但道理对称——都必然经过任务栏(屏内)→目标位置 的动画路径。对称加临时关闭/恢复系统最小化动画。
3. 版本 1.0.135 → 1.0.136（9 处引用同步）。
4. TDD：4 用例先 commit（2/4 对着未修复代码转红）→ 实现 commit 让全部转绿；另跑相关既有回归套件（tray/visible/offscreen/persistent-cloak 共 50 用例）确认无回归。

## 中间插曲：另一个会话的真机撞车（已排除，不是本次代码问题）

用户最初反馈"抢鼠标键盘"时，一度怀疑是 #1374 的修复代码或 CI 撞车。深查后发现：当晚有另一个独立 Cecelia/Claude 会话在 xian-rog 上做"微信语音通话 RPA 接入可行性调研"（PR #1377），其交接单原话自述"程序化鼠标/键盘操作与 C-CloudRunner 抢占了交互式桌面控制权，一度让用户'鼠标被抢、窗口忽大忽小'"，时间线与用户反馈吻合。这次事故与本次代码修复无关，是 xian-rog 被多个会话共享、缺少互斥锁导致的基础设施问题（与既有审计已点名的"CI 与常驻 agent 互搅"同类）。排除这个之后，用户进一步指出"闪"是实时正在发生、且是"正在用微信时"发生的，才定位到本 PR 真正修的这个根因。

## 没做 / 遗留

- **xian-rog 多会话共享缺互斥锁**的结构性问题仍未解决（不在本次范围）：任何两个同时对 rog 做真机 GUI 自动化的会话/CI job 都可能再次撞车，需要单独立项做"谁在用交互式桌面"的占用登记/锁。
- 本次修复未在真机上做过肉眼复测确认"操作者正在用时不再闪"（用户报告问题→定位根因→改代码→CI 验证通过合并，全程走的是 CI 单测验证，没有真机肉眼二次确认这个具体场景）。建议用户下次打开微信使用时留意是否还有闪烁，如果还有需要继续反馈。
- 新版本 1.0.136 何时通过 OTA 真正推送到 rog 上运行中的 agent，取决于该机自身的模块升级轮询周期，本次未手动强制推送验证。

## 数据源

- PR：https://github.com/perfectuser21/zenithjoy-workspace/pull/1379
- merge commit：cd8e5ebe520b3ff4157a4d85e2de1e8b8b9d718e
- 涉及文件：`services/agent/wechat-rpa/listen_chat.py` + 镜像、9 处版本号引用、`services/agent/wechat-rpa/tests/test_operator_foreground_skip_and_anim_symmetry.py` + 镜像
- 前置 handoff：`docs/handoffs/202607180908-line04-minimized-offscreen-maximize-fix.md`（PR #1374 交接单）

## 决策引用

- decision 7e77a7e3：line04 微信扫描态即使操作者正在用也无条件挪窗口，肉眼可见闪烁（本次修法依据）
- decision 433b117c：line04 微信窗口最小化恢复动画/最大化态导致离屏隐藏短暂闪现（#1374，不同分支的另一个问题）

## 产物

- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1379
- merge commit: cd8e5ebe520b3ff4157a4d85e2de1e8b8b9d718e

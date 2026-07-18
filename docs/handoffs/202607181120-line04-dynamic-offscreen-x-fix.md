# Handoff：Line04 离屏 X 固定假设宽度算死导致最大化窗口露出屏幕的修复

- task_id: unknown（交互式 /dev 承接，`.dev-mode` task_id=local，非合法 UUID，跳过 Brain tasks 表回写）
- verdict: PASS
- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1381（已合并，merge commit c34ed5d047f11ba8e7fa07cf38b56dae716fd407）

## 背景

紧接 PR #1374（最小化窗口离屏还原被最大化态吞掉）、PR #1379（操作者前台使用微信时扫描仍挪窗口）之后，用户在 rog 上真机实时反馈第三个独立问题："最大化的窗口过两秒它在左边...但它没有移出屏幕外"。

## 完成

1. **根因**：模块级 `_OFFSCREEN_X` 是启动时 `compute_offscreen_x(win_width=1200)` 算出的固定常量（假设窗口宽度=1200px，ROG 单屏上算出 -1400）。窗口若处于最大化态（真机实测宽度约 1707px），挪窗口时仍用这个假设 1200px 算出的固定值——窗口右边缘落在 `-1400+1707=307`，屏幕左侧 307px 那一块露出来。这与窗口是否最小化/托盘/可见无关，纯粹是"窗口比假设的宽"就会露出屏幕。
2. **修法**：新增 `_safe_offscreen_x(width)` 纯函数，每次挪窗口前用**这一次实际的窗口宽度**现算安全偏移量（复用 `compute_offscreen_x` 本就支持的 `win_width` 参数），取现算值和模块级常量中更负的一个（双保险，现算异常时回退常量）。替换 `_ensure_tray_visible` 三分支（tray/minimized/visible）+ `_uia_send` 共 5 处直接用静态常量的 `SetWindowPos`/`SetWindowPlacement` 调用。
3. 版本 1.0.136 → 1.0.137（9 处引用同步）。
4. TDD：5 用例先 commit（全部对着未修复代码转红：`AttributeError`）→ 实现 commit 让全部转绿；另跑相关既有回归套件（tray/visible/offscreen/persistent-cloak/minimized-maximize/operator-foreground，共 55 用例）确认无回归。

## 本次会话完整脉络（供下一个大脑参考）

同一个"扫描态窗口可见性"话题，本次交互 session 一共揪出并修复了 **3 个相互独立的 bug**（用户实时盯真机、边看边报的效果很好，建议这种"边用边挑"的验证方式继续沿用）：

1. PR #1374：最小化窗口恢复到离屏坐标时，若窗口曾被最大化过，`WPF_RESTORETOMAXIMIZED` flag 导致 Windows 无视离屏坐标直接按最大化展开。
2. PR #1379：操作者正在前台使用微信时，"可见非最小化"分支仍无条件挪窗口再挪回，每次扫描周期产生肉眼可见闪烁。
3. PR #1381（本次）：离屏 X 是启动时假设固定宽度算出的常量，最大化窗口比假设的宽就会露出屏幕。

中间还排查过两次"假警报"：① 另一个独立 Cecelia 会话（PR #1377，微信语音通话 RPA 调研）在 rog 上做真机实验与本次会话撞车，一度误判为本次代码的问题；② rog 上的 CI 真机 job（job2/job3）多次直接操作同一个真实微信窗口，把窗口"正常大小"的记录（rcNormalPosition）压缩变小，导致 `sessions` 从 32 掉到 4/25 不等，一度误判为"不回复了"，实际是窗口太小导致虚拟化渲染的会话列表只有少数条目进入 UIA 可读范围。这两类问题都不是代码逻辑 bug，而是 **xian-rog 被多方（另一会话/CI真机job/常驻agent）共享、缺少互斥锁**导致的基础设施问题，仍未解决（见下方遗留项）。

## 没做 / 遗留

- **xian-rog 多方共享缺互斥锁**的结构性问题仍未解决（本次会话踩了至少 3 次）：任何"另一会话的真机实验"或"CI 真机 job"都可能与常驻 agent 撞车，表现为窗口尺寸/位置被弄乱、鼠标键盘被抢、UIA 树塌缩。需要单独立项做"谁在用交互式桌面"的占用登记/锁，这是本次三个 PR 都没有解决的根本问题。
- 本次三个修复叠加后，用户尚未做过一次完整的"从头到尾正常使用微信 5-10 分钟不再有任何异常"的最终确认——每次都是发现一个问题就立刻修一个，建议下次专门留出时间做一次干净的最终验收。
- 新版本 1.0.137 何时通过 OTA 真正推送到 rog 上运行中的 agent，取决于该机自身的模块升级轮询周期。

## 数据源

- PR：https://github.com/perfectuser21/zenithjoy-workspace/pull/1381
- merge commit：c34ed5d047f11ba8e7fa07cf38b56dae716fd407
- 涉及文件：`services/agent/wechat-rpa/listen_chat.py` + 镜像、9 处版本号引用、`services/agent/wechat-rpa/tests/test_dynamic_offscreen_x.py` + 镜像
- 前置 handoff：`docs/handoffs/202607181022-line04-operator-foreground-flicker-fix.md`（PR #1379）、`docs/handoffs/202607180908-line04-minimized-offscreen-maximize-fix.md`（PR #1374）

## 决策引用

- decision b5041511：line04 离屏X用启动时固定假设宽度算死，最大化窗口更宽导致右边缘露出屏幕（本次修法依据）
- decision 7e77a7e3：line04 微信扫描态即使操作者正在用也无条件挪窗口，肉眼可见闪烁（#1379）
- decision 433b117c：line04 微信窗口最小化恢复动画/最大化态导致离屏隐藏短暂闪现（#1374）

## 产物

- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1381
- merge commit: c34ed5d047f11ba8e7fa07cf38b56dae716fd407

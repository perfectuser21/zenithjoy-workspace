# Handoff：Line04 托盘态回复静默不可见的修复

- task_id: unknown（交互式 /dev 承接，`.dev-mode` task_id=local，非合法 UUID，跳过 Brain tasks 表回写）
- verdict: PASS
- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1383（已合并，merge commit 9a5fa59f8250509ad2a95cdd15d67a86f480aebe）

## 背景

紧接 PR #1374/#1379/#1381（本次会话连续三个窗口可见性修复）之后，用户描述了对"扫描 vs 回复"这个设计的准确预期：扫描消息时不该被看见，但**回复发送时应该让操作者看见**。用户实测发现："他没弹出来，他静默回复了，没有弹出窗口，但是已经回复了"——这与设计预期不符。

## 完成

1. **根因**：代码里 `OFFSCREEN_REPLY=False`（B 方案默认）本就是为了让回复态可见（设计意图早已存在，见历史注释"可见+送达确认+焦点安全"），`_should_move_offscreen` 对回复态也正确返回 False（不该继续挪到离屏）。但扫描态的常驻隐身机制（`_CLOAK_OWNED`）会把托盘窗口留在离屏坐标上（跨轮不收窗，防闪烁），回复态虽然跳过了"继续挪出去"，却从没有对应地"把已经离屏的窗口挑回屏内"——这是一个纯粹的逻辑遗漏，不是设计错误。
2. **修法**：扫描态挪到离屏前，把移动前坐标存进 `_saved_visible_pos`；回复态检测窗口仍在离屏坐标就挑回该记录位置（无记录退回安全默认值）。
3. 版本 1.0.137 → 1.0.138（9 处引用同步）。
4. TDD：4 用例先 commit（3/4 对着未修复代码转红）→ 实现 commit 让全部转绿；另跑相关既有回归套件（共 59 用例）确认无回归。

## 附带排查：托盘 UIA 读不到的假设，本次真机验证未复现

同一轮反馈用户还提到"最大化时点右上角直接进托盘，UIA 读不到"——这是本次会话（乃至更早交接单）就存疑、从未验证过的托盘 `_CLOAK_OWNED` 分支假设（原始交接单 202607180711 的遗留项②）。本次真机上精确模拟"可见态直接隐藏进托盘"（`visible=False, iconic=False`，与用户描述场景完全一致），走生产代码同样的还原序列（cloak 尝试+`ShowWindow(SW_SHOWNA)`+`_TRAY_RESTORE_SLEEP`），UIA 在 0.35s/0.75s/2s 三个时间点均正常读到完整树（181 元素/30 会话条目），**未能复现**。推测可能是：① 微信自己点击托盘按钮时内部行为与外部直接调 `ShowWindow(SW_HIDE)` 不同；② 用户那次观测恰好撞上本次会话前段的其他干扰（另一并发会话 + CI 真机 job 撞车）。这条假设仍未证实也未证伪，留给下次真机复现时现场盯着看。

## 本次会话完整脉络（供下一个大脑参考，已是第 4 个相关 PR）

同一话题"line04 扫描/回复窗口可见性"，本次交互 session 一共产出 **4 个相互独立的修复**：

1. PR #1374：最小化窗口恢复到离屏坐标时，若窗口曾被最大化过，`WPF_RESTORETOMAXIMIZED` flag 导致 Windows 无视离屏坐标直接按最大化展开。
2. PR #1379：操作者正在前台使用微信时，"可见非最小化"分支仍无条件挪窗口再挪回，每次扫描周期产生肉眼可见闪烁。
3. PR #1381：离屏 X 是启动时假设固定宽度算出的常量，最大化窗口比假设的宽就会露出屏幕。
4. PR #1383（本次）：托盘态回复时，窗口被扫描态的常驻隐身留在离屏坐标，回复态没有把它挑回屏内，导致回复静默发生。

## 没做 / 遗留

- **托盘 UIA 读不到**的假设仍未证实/证伪（见上）。
- **xian-rog 多方共享缺互斥锁**的结构性问题仍未解决（本次会话累计踩了 3 次以上：CI 真机 job 与常驻 agent 撞车、另一并发会话与常驻 agent 撞车）。
- 4 个 PR 叠加后，仍未做过一次完整的"从头到尾正常使用微信 5-10 分钟不再有任何异常"的最终确认。

## 数据源

- PR：https://github.com/perfectuser21/zenithjoy-workspace/pull/1383
- merge commit：9a5fa59f8250509ad2a95cdd15d67a86f480aebe
- 涉及文件：`services/agent/wechat-rpa/listen_chat.py` + 镜像、9 处版本号引用、`services/agent/wechat-rpa/tests/test_tray_reply_visible_fix.py` + 镜像
- 前置 handoff：`docs/handoffs/202607181120-line04-dynamic-offscreen-x-fix.md`（PR #1381）、`docs/handoffs/202607181022-line04-operator-foreground-flicker-fix.md`（PR #1379）、`docs/handoffs/202607180908-line04-minimized-offscreen-maximize-fix.md`（PR #1374）

## 决策引用

- decision 9c933d60：line04 托盘态回复时窗口停在离屏坐标从未挑回屏内，导致回复静默不可见（本次修法依据）
- decision b5041511：line04 离屏X用启动时固定假设宽度算死（#1381）
- decision 7e77a7e3：line04 微信扫描态即使操作者正在用也无条件挪窗口（#1379）
- decision 433b117c：line04 微信窗口最小化恢复动画/最大化态导致离屏隐藏短暂闪现（#1374）

## 产物

- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1383
- merge commit: 9a5fa59f8250509ad2a95cdd15d67a86f480aebe

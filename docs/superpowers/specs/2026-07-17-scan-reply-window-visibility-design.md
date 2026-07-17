# 设计：拆分扫描态/回复态窗口可见性（DWM cloak 独立于 OFFSCREEN_REPLY）

## 背景

真机反馈：微信窗口每隔十几秒弹出来又缩回去。根因：`scan_unread`/`scan_recent_contacts` 每轮扫描都调
`_ensure_tray_visible(mw)` 把窗口从 minimized/tray 唤醒读 UIA 树；今年 6 月 B 方案把默认
`OFFSCREEN_REPLY=False`（可见模式，用于回复态的真送达确认+焦点安全），但 `_ensure_tray_visible` 里
`minimized`/`visible` 两个分支的 DWM cloak 调用**和** `OFFSCREEN_REPLY` 坐标搬移逻辑绑在同一个
`if _OFFSCREEN_REPLY:` 判断块里（`listen_chat.py:540`、`:572`）——`OFFSCREEN_REPLY=False` 时这两个分支
完全跳过 cloak，窗口真的在原始坐标可见弹出。`tray` 分支（`:513`）已经证明"无论 OFFSCREEN_REPLY 取值都先
cloak"这个模式在生产可用（该分支从 v1.0.93 起就是这么写的）。

## 目标

给 `_ensure_tray_visible`/`_restore_window_state` 加 `for_reply: bool = False` 参数：
- **扫描态**（`for_reply=False`，新默认，`scan_unread`/`scan_recent_contacts` 调用点不用改代码）：
  `minimized`/`visible` 分支的 DWM cloak 调用从 `if _OFFSCREEN_REPLY:` 中解耦出来，改为
  `if not for_reply:` 独立触发（跟 `tray` 分支同规格：无论 OFFSCREEN_REPLY 是什么都 cloak）。
  **坐标搬移逻辑完全不动**——`SetWindowPlacement`/`SetWindowPos` 挪屏幕外那部分继续只受 `OFFSCREEN_REPLY`
  控制，不受 `for_reply` 影响。
- **回复态**（`for_reply=True`，`reply_in_chat` 显式传入）：`minimized`/`visible` 分支行为与今天完全一致
  （cloak 仍然只在 `OFFSCREEN_REPLY=True` 时跟随坐标搬移一起触发；`OFFSCREEN_REPLY=False` 时不 cloak，
  窗口按 6 月 B 方案可见+送达确认+焦点安全）。

## 具体改动点（`services/agent/wechat-rpa/listen_chat.py`）

### `_ensure_tray_visible(mw, for_reply: bool = False) -> str`

- `tray` 分支（`:512-535`）：不变（本来就无条件 cloak，`for_reply` 不影响这支）。
- `minimized` 分支（`:536-568`）：
  - 现状：cloak 调用（`:541-545`）和坐标搬移（`:546-563`）共享同一个 `if _OFFSCREEN_REPLY:`。
  - 改动：cloak 调用改为独立的 `if not for_reply:` 触发；坐标搬移块保留原 `if _OFFSCREEN_REPLY:` 不变
    （两个 if 块分离，不再共享条件）。
  - 返回值：只要发生了 cloak 或坐标搬移中的任意一个，就必须返回 `'minimized'`（否则 `_restore_window_state`
    收不到状态字符串，配对的 uncloak/坐标还原会漏掉）——现状本来就是无条件 `return 'minimized'`（`:568`
    在 `elif _is_iconic:` 分支末尾，不受内部 if 影响），这条不用改。
- `visible` 分支（`:569-586`）：
  - 现状：cloak + 坐标搬移 + `return 'visible'` 全部包在同一个 `if _OFFSCREEN_REPLY:` 里
    （`:572-586`）——`OFFSCREEN_REPLY=False` 时整个分支直接跳过，函数落到 `:587-589` 返回 `''`，
    `_restore_window_state` 收到 `''` 时是 no-op（`:602`），**没有任何还原动作**。
  - 改动：拆成两个独立判断——
    1. `if not for_reply:`（扫描态）：只做 cloak（不做坐标搬移），记录一个新的还原标记（复用
       `_saved_visible_pos` 或新增一个纯 cloak 标记 dict，因为坐标没变，`_restore_window_state`
       的 `visible` 分支里"还原坐标"那段要跳过），`return 'visible'`。
    2. `if _OFFSCREEN_REPLY:`（回复态且开着 OFFSCREEN_REPLY）：保留现状全部逻辑（cloak + 坐标搬移 +
       `return 'visible'`）不变。
    3. 都不满足（`for_reply=True` 且 `OFFSCREEN_REPLY=False`）：保持现状，落到函数尾部 `return ''`。
  - **关键**：由于纯 cloak 场景没有挪坐标，`_restore_window_state` 的 `visible` 分支需要能区分
    "挪了坐标要还原坐标" vs "只 cloak 了要 uncloak"——用一个额外的 dict（如 `_cloak_only_visible`,
    存 hwnd 集合）区分，避免复用 `_saved_visible_pos` 导致还原逻辑误判成"有坐标要还原"。

### `_restore_window_state(mw, original_state, for_reply: bool = False) -> None`

- `tray`/`minimized` 分支：不变。
- `visible` 分支（`:627-637`）：
  - 现状：`if _OFFSCREEN_REPLY:` 才尝试从 `_saved_visible_pos` 弹出坐标并还原。
  - 改动：先检查 hwnd 是否在新的纯 cloak 标记集合里——如果是（本次是扫描态触发的纯 cloak，没挪坐标），
    只需要走到后面的 uncloak 逻辑，不做坐标还原；否则保留现状 `if _OFFSCREEN_REPLY:` 还原坐标的分支。
- uncloak 判断（`:640`）：现状 `if original_state == 'tray' or (original_state and _OFFSCREEN_REPLY):`——
  `visible`/`minimized` 分支在 `OFFSCREEN_REPLY=False` 时不会走 uncloak，因为它们的 cloak 现在由
  `for_reply` 单独触发。改为：`if original_state == 'tray' or (original_state and (_OFFSCREEN_REPLY or not for_reply)):`
  ——即"扫描态触发过 cloak 的" 或 "OFFSCREEN_REPLY 触发过 cloak 的"都要 uncloak。

### 调用点

- `scan_unread`（`:984`, `:1167`）→ 不改代码，`for_reply` 用默认值 `False`。
- `scan_recent_contacts`（`:2043`, `:2078`）→ 同上，默认 `False`。
- `reply_in_chat`（`:2976`, `:3046`）→ 显式改为 `_ensure_tray_visible(mw, for_reply=True)` /
  `_restore_window_state(mw, orig_state, for_reply=True)`。

## 测试策略

- **单元测试**（新增，纯逻辑，mock `ctypes.windll`）：
  1. `_ensure_tray_visible(mw, for_reply=False)` 对 `tray`/`minimized`/`visible` 三种模拟状态都断言
     `DwmSetWindowAttribute` 被调用（cloak=1）。
  2. `_ensure_tray_visible(mw, for_reply=True)` 且 `OFFSCREEN_REPLY=False` 时，`minimized`/`visible`
     两种状态断言 `DwmSetWindowAttribute` **未**被调用（对照组，防止改错方向；`tray` 分支永远调用，
     不在此对照组里）。
  3. `_restore_window_state` 配对：cloak 过的（无论 `for_reply` 取值）状态字符串传入后，断言
     uncloak（`DwmSetWindowAttribute` cloak=0）被调用；纯 cloak（`for_reply=False`）场景断言坐标
     还原相关的 win32 调用（`SetWindowPlacement`/`SetWindowPos`）**未**被调用（证明只 uncloak 不挪坐标）。
  4. 源码静态断言：`reply_in_chat` 函数体内对 `_ensure_tray_visible`/`_restore_window_state` 的调用
     显式传了 `for_reply=True`（grep 源码文本，回归锚点，防止以后被误改回默认值）。
- **变异测试**：把某个 `if not for_reply:`/`if for_reply:` 条件故意改反或删掉，确认对应新测试真的报红。
- 现有测试套件全量跑绿（`services/agent/wechat-rpa/` 下现有 test，含本 session 已知的 pre-existing
  flaky 之外全部通过）。

## 不做的事

- 不改动 `OFFSCREEN_REPLY` 坐标搬移逻辑本身（该挪哪还挪哪，纯扫描态不涉及坐标）。
- 不改动 UIA 读取逻辑、送达确认逻辑、焦点归还逻辑（`reply_in_chat` 除了两处传参外完全不变）。
- 不改 `tray` 分支（已经是无条件 cloak，本来就符合扫描态/回复态都需要的行为）。

## 验收标准（照抄 PrepPRD）

- [ ] 新增单测覆盖上述 4 组场景
- [ ] 变异测试证明新测试真的报红过
- [ ] 全量 `wechat-rpa` 测试套件跑绿
- [ ] CI 全绿，`build-modules/line04` manifest version bump（1.0.131 → 1.0.132，4 处同步）
- [ ] `golden-path-4-smoke.sh` 新增一个 Step（源码含 `for_reply` 参数 + 3 处调用点正确传参的纯函数等价断言）

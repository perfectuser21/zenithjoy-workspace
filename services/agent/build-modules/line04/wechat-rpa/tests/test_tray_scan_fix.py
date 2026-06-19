"""
Regression test — 微信托盘扫描修复（PR #754 根因）。

根因：微信在系统托盘（IsWindowVisible=False）时 mmui 虚拟列表 UIA name 不实时更新，
新消息角标永远扫不到 → scan_unread 持续返回 unread=0，AI 停止回复。

修法：
  _ensure_tray_visible(mw) — 扫描前检查 IsWindowVisible；若 False 则 SW_SHOWNA(8) 短暂
  还原并等 0.35s，让 Qt 重建 UIA 虚拟列表后再扫。扫完 _restore_tray(mw) SW_HIDE(0) 送回。

本文件是托盘场景的永久 regression test，禁止删除。
"""
from __future__ import annotations

import ctypes
import os
import sys
import types
from contextlib import contextmanager
from typing import Any
from unittest.mock import MagicMock, patch

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)


def _stub_heavy_deps():
    for name in ["pywinauto", "pywinauto.application",
                 "pywinauto.controls", "pywinauto.controls.uia_controls"]:
        if name not in sys.modules:
            mod = types.ModuleType(name)
            mod.Desktop = MagicMock()
            sys.modules[name] = mod
    for name in ["requests"]:
        if name not in sys.modules:
            mod = types.ModuleType(name)
            mod.get = MagicMock()
            mod.post = MagicMock()
            sys.modules[name] = mod


_stub_heavy_deps()


@contextmanager
def _mock_windll(user32):
    """在 macOS/Linux 上注入 ctypes.windll stub，Windows 上替换真实 windll。"""
    windll_mock = MagicMock(user32=user32, kernel32=MagicMock())
    had_windll = hasattr(ctypes, "windll")
    original = getattr(ctypes, "windll", None)
    ctypes.windll = windll_mock
    try:
        yield windll_mock
    finally:
        if had_windll:
            ctypes.windll = original
        else:
            try:
                delattr(ctypes, "windll")
            except AttributeError:
                pass


if "listen_chat" in sys.modules:
    del sys.modules["listen_chat"]

import listen_chat  # noqa: E402


def _make_mock_mw(hwnd: int = 12345):
    mw = MagicMock()
    mw.element_info.handle = hwnd
    mw.descendants.return_value = []
    return mw


def test_ensure_tray_visible_hidden_calls_showna():
    """托盘隐藏时 _ensure_tray_visible 必须调 ShowWindow(hwnd, 8) 并返回 'tray'。"""
    mw = _make_mock_mw(hwnd=99)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = False

    with _mock_windll(user32), patch("time.sleep"):
        result = listen_chat._ensure_tray_visible(mw)

    assert result == 'tray'
    user32.ShowWindow.assert_called_with(99, 8)


def test_ensure_tray_visible_visible_no_call():
    """窗口可见且非最小化时 _ensure_tray_visible 不得调 ShowWindow。

    v1.0.29 及以前：返回 ''，不做任何操作。
    v1.0.30 fix：_OFFSCREEN_REPLY=True 时返回 'visible'（移到离屏），但 ShowWindow 仍不调。
    断言更新为 v1.0.30 行为。
    """
    mw = _make_mock_mw(hwnd=99)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = True
    user32.IsIconic.return_value = 0  # 非最小化

    with _mock_windll(user32), patch("time.sleep"):
        result = listen_chat._ensure_tray_visible(mw)

    # v1.0.30：可见窗口 _OFFSCREEN_REPLY=True 时移到离屏返回 'visible'
    assert result == 'visible'
    user32.ShowWindow.assert_not_called()  # ShowWindow 仍不调（用 SetWindowPos 移位）


def test_restore_tray_calls_sw_hide():
    """_restore_tray 必须调 ShowWindow(hwnd, 0) SW_HIDE。"""
    mw = _make_mock_mw(hwnd=77)
    user32 = MagicMock()

    with _mock_windll(user32):
        listen_chat._restore_tray(mw)

    user32.ShowWindow.assert_called_with(77, 0)


def test_scan_unread_tray_hidden_showna_then_hide():
    """托盘场景：scan_unread 须先 SW_SHOWNA 再扫、扫完再 SW_HIDE。"""
    mw = _make_mock_mw(hwnd=55)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = False
    call_order: list = []

    def record_show(hwnd: int, cmd: int) -> None:
        call_order.append(cmd)

    user32.ShowWindow.side_effect = record_show

    with _mock_windll(user32), patch("time.sleep"):
        listen_chat.scan_unread(mw)

    assert 8 in call_order, "scan_unread 须调 SW_SHOWNA=8"
    assert 0 in call_order, "scan_unread 须调 SW_HIDE=0"
    assert call_order.index(8) < call_order.index(0), "SW_SHOWNA 须在 SW_HIDE 之前"


def test_scan_unread_visible_no_showna():
    """窗口可见且非最小化时 scan_unread 不得调 ShowWindow（不闪不抖动）。"""
    mw = _make_mock_mw(hwnd=55)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = True
    user32.IsIconic.return_value = 0  # 非最小化

    with _mock_windll(user32):
        listen_chat.scan_unread(mw)

    user32.ShowWindow.assert_not_called()


def test_reply_in_chat_tray_shows_before_open_chat_then_hides():
    """托盘场景：reply_in_chat 须先 SW_SHOWNA(8) 再切窗，最后 SW_HIDE(0) 送回。

    根因（PR #758）：_open_chat → _post_click_item → item.rectangle() 在托盘状态下
    返回离屏坐标(32878,32679)，PostMessage 打不到列表项，苏小x/糊糊大老婆等发不出去。
    修法：reply_in_chat 开头 _ensure_tray_visible，finally _restore_tray。
    """
    mw = _make_mock_mw(hwnd=42)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = False  # 托盘隐藏
    call_order: list = []

    def record_show(hwnd: int, cmd: int) -> None:
        call_order.append(("ShowWindow", cmd))

    user32.ShowWindow.side_effect = record_show

    item = MagicMock()
    open_chat_called_after_show: list = []

    def fake_open_chat(fmw, it, sender, **kw):
        open_chat_called_after_show.append(8 in [c[1] for c in call_order])
        return False  # 无法切换→早退，触发 finally

    with _mock_windll(user32), \
         patch("time.sleep"), \
         patch.object(listen_chat, "_open_chat", side_effect=fake_open_chat):
        listen_chat.reply_in_chat(mw, item, "hello", sender="苏小x")

    assert 8 in [c[1] for c in call_order], "reply_in_chat 须先 SW_SHOWNA(8) 让坐标有效"
    assert 0 in [c[1] for c in call_order], "reply_in_chat 须在结束时 SW_HIDE(0) 送回托盘"
    assert call_order.index(("ShowWindow", 8)) < call_order.index(("ShowWindow", 0)), \
        "SW_SHOWNA 必须在 SW_HIDE 之前"
    assert open_chat_called_after_show and open_chat_called_after_show[0], \
        "_open_chat 必须在 SW_SHOWNA 之后调用"


def test_reply_in_chat_visible_no_extra_showna():
    """窗口已可见且非最小化时 reply_in_chat 不得额外调 ShowWindow（避免闪烁）。"""
    mw = _make_mock_mw(hwnd=43)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = True  # 已可见
    user32.IsIconic.return_value = 0  # 非最小化

    item = MagicMock()

    with _mock_windll(user32), \
         patch("time.sleep"), \
         patch.object(listen_chat, "_open_chat", return_value=False):
        listen_chat.reply_in_chat(mw, item, "hello", sender="于瑾")

    user32.ShowWindow.assert_not_called()


def test_ensure_tray_visible_moves_offscreen_when_offscreen_mode():
    """_OFFSCREEN_REPLY=True 时 _ensure_tray_visible 必须在 ShowWindow(8) 之后调 SetWindowPos(-2600, 60)。

    regression：SW_SHOWNA(8) 把窗口还原到屏幕可见区 → 用户看到微信弹窗。
    修法：还原后立即 SetWindowPos 移到 (-2600,60)，UIA 树仍可用，用户完全看不到。

    注：GetWindowRect 在 mock 环境不写入 RECT，_rc 保持默认 left=0（> -2000 条件成立），
    足以触发 SetWindowPos 分支，无需 side_effect 修改 byref 对象。
    """
    mw = _make_mock_mw(hwnd=88)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = False
    # GetWindowRect mock 不写入 RECT → _rc.left 默认 0 > -2000 → 触发 SetWindowPos

    original_offscreen = listen_chat._OFFSCREEN_REPLY
    try:
        listen_chat._OFFSCREEN_REPLY = True
        with _mock_windll(user32), patch("time.sleep"):
            listen_chat._ensure_tray_visible(mw)
    finally:
        listen_chat._OFFSCREEN_REPLY = original_offscreen

    # 必须先 ShowWindow(8)，再 SetWindowPos 到 (_OFFSCREEN_X, _OFFSCREEN_Y)
    user32.ShowWindow.assert_called_with(88, 8)
    setpos_calls = user32.SetWindowPos.call_args_list
    assert len(setpos_calls) >= 1, "必须调 SetWindowPos 把窗口移到屏幕外"
    args = setpos_calls[0][0]  # positional args: (hwnd, hWndInsertAfter, x, y, cx, cy, flags)
    # x 坐标断言生效的 _OFFSCREEN_X（config 几何推导值），不写死 -2600：
    # CI Linux 回退 -2600，真机 Windows 推导 ≈-1400，两者都验证"移到【配置的】屏外坐标"。
    assert args[2] == listen_chat._OFFSCREEN_X, \
        f"x 坐标必须是 _OFFSCREEN_X({listen_chat._OFFSCREEN_X})，实际是 {args[2]}"
    assert args[3] == listen_chat._OFFSCREEN_Y, \
        f"y 坐标必须是 _OFFSCREEN_Y({listen_chat._OFFSCREEN_Y})，实际是 {args[3]}"


def test_ensure_tray_visible_no_setwindowpos_when_offscreen_mode_off():
    """_OFFSCREEN_REPLY=False 时 _ensure_tray_visible 只调 ShowWindow(8)，不移出屏幕（保留弹窗模式）。"""
    mw = _make_mock_mw(hwnd=89)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = False

    original_offscreen = listen_chat._OFFSCREEN_REPLY
    try:
        listen_chat._OFFSCREEN_REPLY = False
        with _mock_windll(user32), patch("time.sleep"):
            listen_chat._ensure_tray_visible(mw)
    finally:
        listen_chat._OFFSCREEN_REPLY = original_offscreen

    user32.ShowWindow.assert_called_with(89, 8)
    user32.SetWindowPos.assert_not_called()


# ── v1.0.27 regression：最小化到任务栏场景（IsWindowVisible=True, IsIconic=True）──


def test_ensure_tray_visible_iconic_calls_showna():
    """最小化（IsWindowVisible=True, IsIconic=True）必须 SW_SHOWNOACTIVATE(4) 并返回 'minimized'。

    v1.0.26 bug：IsIconic 被跳过 → 返回 False → _uia_send 调 SW_RESTORE=9 把窗口拉前台。
    v1.0.27 bug：IsIconic 处理了但用 SW_SHOWNA(8) → 幽灵坐标，UIA 失效，窗口仍弹前台。
    v1.0.28 fix：改用 SW_SHOWNOACTIVATE(4) 还原到正常坐标，不抢焦点，UIA 完整可用。
    """
    mw = _make_mock_mw(hwnd=111)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = True
    user32.IsIconic.return_value = 1

    with _mock_windll(user32), patch("time.sleep"):
        result = listen_chat._ensure_tray_visible(mw)

    assert result == 'minimized', "_ensure_tray_visible 对最小化窗口必须返回 'minimized'"
    user32.ShowWindow.assert_called_with(111, 4)


def test_ensure_tray_visible_iconic_moves_offscreen():
    """最小化 + _OFFSCREEN_REPLY=True 时，_ensure_tray_visible 必须通过 SetWindowPlacement 把窗口移到屏外。

    v1.0.26 bug：IsIconic 被跳过 → 移出屏幕逻辑从未调用 → _uia_send 的 SW_RESTORE=9 激活窗口。
    v1.0.28 fix：使用 SW_SHOWNOACTIVATE(4) + SetWindowPos(-2600,60)。
    v1.0.29 fix：改用 SetWindowPlacement 预定位，ShowWindow(4) 直接恢复到屏外（消除 50ms 闪烁）。
    """
    mw = _make_mock_mw(hwnd=112)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = True
    user32.IsIconic.return_value = 1
    user32.GetWindowPlacement.return_value = 1  # 模拟成功

    original_offscreen = listen_chat._OFFSCREEN_REPLY
    try:
        listen_chat._OFFSCREEN_REPLY = True
        with _mock_windll(user32), patch("time.sleep"):
            listen_chat._ensure_tray_visible(mw)
    finally:
        listen_chat._OFFSCREEN_REPLY = original_offscreen

    user32.ShowWindow.assert_called_with(112, 4)
    user32.GetWindowPlacement.assert_called(), "必须调 GetWindowPlacement 获取原始坐标"
    user32.SetWindowPlacement.assert_called(), "必须调 SetWindowPlacement 预改离屏坐标"


# ── v1.0.28 regression：最小化必须 SW_SHOWNOACTIVATE(4)+SW_MINIMIZE(6)，不能 SW_SHOWNA(8)+SW_HIDE(0) ──


def test_ensure_tray_visible_minimized_uses_sw_shownoactivate_not_sw_showna():
    """最小化（IsIconic=True）必须 SW_SHOWNOACTIVATE(4)，禁止 SW_SHOWNA(8)。

    v1.0.27 bug：最小化窗口用 SW_SHOWNA(8) → 窗口停在幽灵坐标 (-32000,-32000)，
    UIA 事件无订阅者，_open_chat PostMessage 失效；UIA 坐标全错导致切窗触发 WeChat
    内部激活逻辑，窗口弹到前台。
    正确做法（wechat-uia-silent-send SKILL.md）：SW_SHOWNOACTIVATE(4) 还原到正常坐标
    再 SetWindowPos(-2600,60) 移出屏幕；不抢焦点，UIA 树完整可用。
    """
    mw = _make_mock_mw(hwnd=113)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = True
    user32.IsIconic.return_value = 1

    with _mock_windll(user32), patch("time.sleep"):
        listen_chat._ensure_tray_visible(mw)

    sw_calls = [c[0] for c in user32.ShowWindow.call_args_list]
    assert (113, 8) not in sw_calls, "最小化窗口禁止调 SW_SHOWNA(8)（幽灵坐标）"
    assert (113, 4) in sw_calls,     "最小化窗口必须调 SW_SHOWNOACTIVATE(4)"


def test_restore_window_state_minimized_calls_sw_minimize():
    """_restore_window_state(mw, 'minimized') 必须调 SW_MINIMIZE(6)，禁止 SW_HIDE(0)。

    v1.0.27 bug：reply_in_chat finally 调 _restore_tray → SW_HIDE(0) → 微信从任务栏消失进托盘。
    正确行为：还原到任务栏最小化状态（SW_MINIMIZE=6），不改变状态类型。
    """
    mw = _make_mock_mw(hwnd=200)
    user32 = MagicMock()

    with _mock_windll(user32):
        listen_chat._restore_window_state(mw, 'minimized')

    sw_calls = [c[0] for c in user32.ShowWindow.call_args_list]
    assert (200, 6) in sw_calls, "_restore_window_state('minimized') 必须调 SW_MINIMIZE(6)"
    assert (200, 0) not in sw_calls, "_restore_window_state('minimized') 禁止调 SW_HIDE(0)"


def test_scan_unread_minimized_restores_to_minimized_not_tray():
    """最小化场景：scan_unread 扫完后必须 SW_MINIMIZE(6)，禁止 SW_HIDE(0)。

    v1.0.27 bug：scan_unread 对最小化窗口调 _restore_tray(SW_HIDE=0) → 窗口进托盘，
    改变了用户可见状态（任务栏图标消失）。正确流程：扫完应 SW_MINIMIZE(6) 还原到任务栏。
    """
    mw = _make_mock_mw(hwnd=55)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = True
    user32.IsIconic.return_value = 1
    sw_calls: list = []

    def record_show(hwnd: int, cmd: int) -> None:
        sw_calls.append(cmd)

    user32.ShowWindow.side_effect = record_show

    with _mock_windll(user32), patch("time.sleep"):
        listen_chat.scan_unread(mw)

    assert 6 in sw_calls, "scan_unread 最小化场景须调 SW_MINIMIZE(6) 还原任务栏"
    assert 0 not in sw_calls, "scan_unread 最小化场景禁止调 SW_HIDE(0)（送回托盘会改变状态）"


def test_reply_in_chat_minimized_restores_to_minimized_not_tray():
    """最小化场景：reply_in_chat 发完后必须 SW_MINIMIZE(6)，禁止 SW_HIDE(0)。

    v1.0.27 bug：reply_in_chat finally 调 _restore_tray(SW_HIDE=0) → 微信进托盘，
    用户任务栏里看不到微信了。正确行为：SW_MINIMIZE(6) 保持在任务栏最小化状态。
    """
    mw = _make_mock_mw(hwnd=43)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = True
    user32.IsIconic.return_value = 1
    sw_calls: list = []

    def record_show(hwnd: int, cmd: int) -> None:
        sw_calls.append(cmd)

    user32.ShowWindow.side_effect = record_show

    item = MagicMock()

    with _mock_windll(user32), \
         patch("time.sleep"), \
         patch.object(listen_chat, "_open_chat", return_value=False):
        listen_chat.reply_in_chat(mw, item, "hello", sender="于瑾")

    assert 6 in sw_calls, "reply_in_chat 最小化场景须调 SW_MINIMIZE(6) 还原任务栏"
    assert 0 not in sw_calls, "reply_in_chat 最小化场景禁止调 SW_HIDE(0)"


# ── v1.0.29 regression：SetWindowPlacement 预定位离屏，消除 ShowWindow(4) 50ms 闪烁 ──


def test_ensure_tray_visible_minimized_calls_setwindowplacement_before_showwindow():
    """最小化 + _OFFSCREEN_REPLY=True 时，_ensure_tray_visible 必须在 ShowWindow(4) 之前调
    GetWindowPlacement + SetWindowPlacement，把 rcNormalPosition 改成离屏坐标。

    v1.0.28 bug：ShowWindow(4) 先把窗口恢复到原始屏幕位置（如100,100），50ms 后才调
    SetWindowPos 移到 -2600。这 50ms 窗口在屏幕上可见，用户看到"弹跳"。

    v1.0.29 fix：先用 SetWindowPlacement 把 rcNormalPosition 改成 (-2600,60)，
    再调 ShowWindow(4)，窗口恢复动画直接打到屏外，用户完全看不到。
    """
    mw = _make_mock_mw(hwnd=222)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = True
    user32.IsIconic.return_value = 1
    call_order: list = []

    user32.GetWindowPlacement.side_effect = lambda *a, **kw: call_order.append("GetWindowPlacement") or 1
    user32.SetWindowPlacement.side_effect = lambda *a, **kw: call_order.append("SetWindowPlacement") or 1
    user32.ShowWindow.side_effect = lambda *a, **kw: call_order.append(f"ShowWindow({a[1]})")

    original_offscreen = listen_chat._OFFSCREEN_REPLY
    try:
        listen_chat._OFFSCREEN_REPLY = True
        with _mock_windll(user32), patch("time.sleep"):
            listen_chat._ensure_tray_visible(mw)
    finally:
        listen_chat._OFFSCREEN_REPLY = original_offscreen

    assert "GetWindowPlacement" in call_order, "必须调 GetWindowPlacement 获取原始坐标"
    assert "SetWindowPlacement" in call_order, "必须调 SetWindowPlacement 预改离屏坐标"
    assert "ShowWindow(4)" in call_order, "仍须调 ShowWindow(4) 还原窗口"
    assert call_order.index("SetWindowPlacement") < call_order.index("ShowWindow(4)"), \
        "SetWindowPlacement 必须在 ShowWindow(4) 之前调用（先改位置再还原）"


def test_ensure_tray_visible_minimized_saves_original_pos():
    """_ensure_tray_visible 最小化场景须把原始 rcNormalPosition 存入 _saved_normal_pos。

    若不保存原始坐标，SW_MINIMIZE 后用户手动还原时窗口出现在 -2600 离屏。
    """
    mw = _make_mock_mw(hwnd=223)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = True
    user32.IsIconic.return_value = 1
    user32.GetWindowPlacement.return_value = 1

    listen_chat._saved_normal_pos.pop(223, None)

    original_offscreen = listen_chat._OFFSCREEN_REPLY
    try:
        listen_chat._OFFSCREEN_REPLY = True
        with _mock_windll(user32), patch("time.sleep"):
            listen_chat._ensure_tray_visible(mw)
    finally:
        listen_chat._OFFSCREEN_REPLY = original_offscreen

    assert 223 in listen_chat._saved_normal_pos, \
        "_saved_normal_pos 必须保存 hwnd=223 的原始位置，供 _restore_window_state 还原"


def test_restore_window_state_minimized_restores_rcnormalposition():
    """_restore_window_state('minimized') 在 SW_MINIMIZE(6) 后须调 SetWindowPlacement 还原原始坐标。

    v1.0.28 gap：SW_MINIMIZE(6) 后 rcNormalPosition 仍是 (-2600,60)，
    用户手动从任务栏点开微信会出现在屏幕外。
    v1.0.29 fix：SW_MINIMIZE 后再 SetWindowPlacement 把 rcNormalPosition 改回原始值。
    """
    mw = _make_mock_mw(hwnd=224)
    user32 = MagicMock()
    user32.GetWindowPlacement.return_value = 1

    listen_chat._saved_normal_pos[224] = (100, 100, 900, 700)

    original_offscreen = listen_chat._OFFSCREEN_REPLY
    try:
        listen_chat._OFFSCREEN_REPLY = True
        with _mock_windll(user32):
            listen_chat._restore_window_state(mw, 'minimized')
    finally:
        listen_chat._OFFSCREEN_REPLY = original_offscreen

    user32.SetWindowPlacement.assert_called()
    assert 224 not in listen_chat._saved_normal_pos, "_saved_normal_pos 应在还原后清除 hwnd=224"

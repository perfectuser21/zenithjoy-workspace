# -*- coding: utf-8 -*-
"""
TDD — 会话列表翻屏改用 WM_MOUSEWHEEL（真机实证 PageDown 滚不动）。

根因（rog 真机实证）：微信是 Qt，键盘事件只派发给「有焦点的内部 widget」，会话列表没焦点
→ PostMessageW(主窗口, WM_KEYDOWN/UP, VK_NEXT) 的 PageDown 完全滚不动（连续 8 次列表纹丝不动）。
已验证修法：投 WM_MOUSEWHEEL 到主窗口 hwnd，负 delta 下滚，lParam = 会话列表控件内一点的
**屏幕坐标**（WM_MOUSEWHEEL 的 lParam 是屏幕坐标，与鼠标键消息相反——关键）。

滚动本身是真机行为不可单测，但**构造的消息参数可单测**：mock PostMessageW，断言
`_scroll_session_list_wheel` 投了 WM_MOUSEWHEEL(0x020A) + 负 delta + lParam 用的是从会话列表
ListItem rect 算出的屏幕坐标。
"""
from __future__ import annotations

import ctypes
import os
import sys
import types
from contextlib import contextmanager
from unittest.mock import MagicMock

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

if "listen_chat" in sys.modules:
    del sys.modules["listen_chat"]

import listen_chat  # noqa: E402

WM_MOUSEWHEEL = 0x020A


@contextmanager
def _mock_windll(user32):
    windll_mock = MagicMock(user32=user32, kernel32=MagicMock(), dwmapi=MagicMock())
    had = hasattr(ctypes, "windll")
    orig = getattr(ctypes, "windll", None)
    ctypes.windll = windll_mock
    try:
        yield windll_mock
    finally:
        if had:
            ctypes.windll = orig
        else:
            try:
                delattr(ctypes, "windll")
            except AttributeError:
                pass


class _Rect:
    def __init__(self, left, top, right, bottom):
        self.left, self.top, self.right, self.bottom = left, top, right, bottom


def _make_mw_with_item_rects(rects, hwnd=4242):
    """构造一个 mw：descendants(ListItem) 返回带 rectangle() 的会话项（左列坐标）。"""
    mw = MagicMock()
    mw.element_info.handle = hwnd
    items = []
    for r in rects:
        it = MagicMock()
        it.rectangle.return_value = _Rect(*r)
        items.append(it)
    mw.descendants.return_value = items
    return mw


def _decode_lparam(lparam):
    return (lparam & 0xFFFF, (lparam >> 16) & 0xFFFF)  # (x, y)


def _decode_delta(wparam):
    d = (wparam >> 16) & 0xFFFF
    return d - 0x10000 if d >= 0x8000 else d  # 还原有符号 delta


MOUSEEVENTF_WHEEL = 0x0800


def _c_int_value(v):
    """还原 ctypes.c_int(...).value（mouse_event 第 4 参传的是 c_int(...).value，已是有符号 int）。"""
    return v


# ─── 主路径：真硬件滚轮 SetCursorPos + mouse_event（长列表 PostMessage 合成滚轮会卡死）──


def test_real_wheel_setcursorpos_to_list_center_then_mouse_event_negative():
    """真硬件滚轮：SetCursorPos 到会话列表中心 → mouse_event(MOUSEEVENTF_WHEEL, 负 delta) 下滚。"""
    rects = [(100, 180, 457, 240), (100, 240, 457, 300), (100, 300, 457, 360)]
    mw = _make_mw_with_item_rects(rects)
    user32 = MagicMock()
    user32.SetCursorPos.return_value = 1  # 有桌面输入权
    user32.GetCursorPos.return_value = 1

    with _mock_windll(user32):
        listen_chat._scroll_session_list_wheel(mw)

    # 移光标到会话列表中心（x≈中位 278，y≈纵向中位 270）
    assert user32.SetCursorPos.called, "必须 SetCursorPos 把光标移到列表中心"
    move_calls = [c for c in user32.SetCursorPos.call_args_list]
    cx, cy = move_calls[0].args
    assert 270 <= cx <= 286, f"光标 x 应≈列表中位，实际 {cx}"
    assert 180 <= cy <= 360, f"光标 y 应落在列表纵向范围，实际 {cy}"

    # mouse_event(MOUSEEVENTF_WHEEL, 0, 0, 负 delta, 0)
    assert user32.mouse_event.called, "必须发真硬件滚轮 mouse_event"
    for c in user32.mouse_event.call_args_list:
        a = c.args
        assert a[0] == MOUSEEVENTF_WHEEL, f"flag 应 MOUSEEVENTF_WHEEL，实际 {hex(a[0])}"
        assert _c_int_value(a[3]) < 0, f"wheel delta 必须为负（下滚），实际 {a[3]}"
    # 不走 PostMessage 合成滚轮（主路径成功时）
    assert not any(c.args[1] == WM_MOUSEWHEEL for c in user32.PostMessageW.call_args_list), \
        "真硬件滚轮成功时不应再投 PostMessage 合成滚轮"


def test_real_wheel_saves_and_restores_cursor():
    """扫描前 GetCursorPos 存光标、滚完 SetCursorPos 还原（不干扰运营正在用的鼠标）。"""
    rects = [(100, 180, 457, 240)]
    mw = _make_mw_with_item_rects(rects)
    user32 = MagicMock()
    user32.SetCursorPos.return_value = 1
    user32.GetCursorPos.return_value = 1
    with _mock_windll(user32):
        listen_chat._scroll_session_list_wheel(mw)
    assert user32.GetCursorPos.called, "必须先 GetCursorPos 存原光标位置"
    # 最后一次 SetCursorPos 是还原（应在所有 mouse_event 之后）——这里只校验 GetCursorPos+SetCursorPos 都调过
    assert user32.SetCursorPos.call_count >= 2, "至少移到列表中心 + 还原两次 SetCursorPos"


def test_real_wheel_multiple_pulses():
    """每翻一屏发多次真滚轮（单次滚不够一屏），≥3 次 mouse_event。"""
    mw = _make_mw_with_item_rects([(100, 180, 457, 240)])
    user32 = MagicMock()
    user32.SetCursorPos.return_value = 1
    user32.GetCursorPos.return_value = 1
    with _mock_windll(user32):
        listen_chat._scroll_session_list_wheel(mw)
    assert user32.mouse_event.call_count >= 3, f"每屏应发≥3 次真滚轮，实际 {user32.mouse_event.call_count}"


# ─── 回退路径：SetCursorPos 失败（无桌面输入权，PsExec 探测态）→ 回退 PostMessage 合成滚轮 ──


def test_fallback_to_postmessage_when_setcursorpos_fails():
    """SetCursorPos 返 0（无输入权）→ 回退原 PostMessage WM_MOUSEWHEEL 合成滚轮，不硬崩。"""
    rects = [(100, 180, 457, 240), (100, 240, 457, 300)]
    mw = _make_mw_with_item_rects(rects)
    user32 = MagicMock()
    user32.SetCursorPos.return_value = 0   # 无桌面输入权
    user32.GetCursorPos.return_value = 0
    with _mock_windll(user32):
        listen_chat._scroll_session_list_wheel(mw)
    wheel_calls = [c for c in user32.PostMessageW.call_args_list if c.args[1] == WM_MOUSEWHEEL]
    assert wheel_calls, "SetCursorPos 失败应回退 PostMessage 合成滚轮"
    for c in wheel_calls:
        assert _decode_delta(c.args[2]) < 0, "回退滚轮 delta 仍为负（下滚）"


def test_wheel_no_items_falls_back_without_crash():
    """会话列表空（拿不到 item rect）→ 不崩，安全返回。"""
    mw = MagicMock()
    mw.element_info.handle = 999
    mw.descendants.return_value = []
    user32 = MagicMock()
    user32.SetCursorPos.return_value = 1
    with _mock_windll(user32):
        listen_chat._scroll_session_list_wheel(mw)  # 不抛即可


def test_wheel_no_hwnd_safe():
    """主窗口 hwnd 为 0 → 直接安全返回，不滚不投。"""
    mw = MagicMock()
    mw.element_info.handle = 0
    user32 = MagicMock()
    with _mock_windll(user32):
        listen_chat._scroll_session_list_wheel(mw)
    assert not user32.mouse_event.called
    assert not user32.PostMessageW.called

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


def test_wheel_posts_wm_mousewheel_negative_delta_at_list_screen_coords():
    """投 WM_MOUSEWHEEL 到主窗口，wParam 负 delta（下滚），lParam=会话列表项算出的屏幕坐标。"""
    # 真机实测左列会话项 x≈100-457，三项纵向排开
    rects = [(100, 180, 457, 240), (100, 240, 457, 300), (100, 300, 457, 360)]
    mw = _make_mw_with_item_rects(rects)
    user32 = MagicMock()

    with _mock_windll(user32):
        listen_chat._scroll_session_list_wheel(mw)

    assert user32.PostMessageW.called, "必须投递消息"
    calls = user32.PostMessageW.call_args_list
    # 全部消息都应是 WM_MOUSEWHEEL，且投到主窗口 hwnd
    for c in calls:
        args = c.args
        assert args[0] == mw.element_info.handle
        assert args[1] == WM_MOUSEWHEEL, f"应投 WM_MOUSEWHEEL，实际 {hex(args[1])}"
        assert _decode_delta(args[2]) < 0, "delta 必须为负（下滚）"
        x, y = _decode_lparam(args[3])
        # x = 会话项中心 x 的中位数（(100+457)/2≈278），y 落在第一项内（180-240）
        assert 270 <= x <= 286, f"x 应≈会话列表中位 x，实际 {x}"
        assert 180 <= y <= 240, f"y 应落在第一会话项内，实际 {y}"


def test_wheel_posts_multiple_pulses_per_page():
    """每翻一屏投多次 wheel（真机单次滚不够一屏），≥3 次。"""
    mw = _make_mw_with_item_rects([(100, 180, 457, 240)])
    user32 = MagicMock()
    with _mock_windll(user32):
        listen_chat._scroll_session_list_wheel(mw)
    assert user32.PostMessageW.call_count >= 3, f"每屏应投≥3 次 wheel，实际 {user32.PostMessageW.call_count}"


def test_wheel_no_items_falls_back_without_crash():
    """会话列表空（拿不到 item rect）→ 不崩，退化用窗口中心或直接不投，安全返回。"""
    mw = MagicMock()
    mw.element_info.handle = 999
    mw.descendants.return_value = []
    user32 = MagicMock()
    with _mock_windll(user32):
        listen_chat._scroll_session_list_wheel(mw)  # 不抛即可


def test_wheel_no_hwnd_safe():
    """主窗口 hwnd 为 0 → 直接安全返回，不投消息。"""
    mw = MagicMock()
    mw.element_info.handle = 0
    user32 = MagicMock()
    with _mock_windll(user32):
        listen_chat._scroll_session_list_wheel(mw)
    assert not user32.PostMessageW.called

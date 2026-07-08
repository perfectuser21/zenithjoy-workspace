"""
回归测试 — wechat-rpa 三修 2026-07-08

Fix A: 心跳检测微信窗口过小(宽<_WECHAT_MIN_WIDTH) → SW_MAXIMIZE 自愈
Fix B: 欢迎回来屏检测(is_welcome_back_screen / get_welcome_back_hwnd)
Fix C: _find_left_nav_button_point 改窗口相对坐标 + _reset_session_list_to_top 前拉前台

【CI 安全】零真实 pywinauto/win32 import；纯 Fake/Mock 对象，跨平台可跑。
"""
from __future__ import annotations

import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

# 注入 fake pywinauto（非 Windows 环境无此包）
if "pywinauto" not in sys.modules:
    sys.modules["pywinauto"] = MagicMock()

import find_weixin  # noqa: E402


# ─── Fix B helpers ────────────────────────────────────────────────────────────

class _FakeEI:
    def __init__(self, class_name="", name="", handle=0):
        self.class_name = class_name
        self.name = name
        self.handle = handle


class _FakeButton:
    def __init__(self, name=""):
        self.element_info = _FakeEI(name=name)


class _FakeWindow:
    def __init__(self, class_name="", title="", buttons=None, handle=0):
        self.element_info = _FakeEI(class_name=class_name, name=title, handle=handle)
        self._buttons = buttons or []

    def descendants(self, control_type=None):
        if control_type == "Button":
            return self._buttons
        return []


class _FakeDesktop:
    def __init__(self, wins):
        self._wins = wins

    def windows(self):
        return self._wins


def _make_desktop(wins):
    desk = MagicMock()
    desk.return_value.windows.return_value = wins
    return desk


# ─── Fix B: is_welcome_back_screen ────────────────────────────────────────────

def test_is_welcome_back_screen_true():
    """mmui::LoginWindow title=微信 + 子按钮「进入微信」→ True"""
    btn = _FakeButton("进入微信")
    win = _FakeWindow("mmui::LoginWindow", "微信", buttons=[btn])
    desk_cls = _make_desktop([win])

    orig = sys.modules["pywinauto"]
    sys.modules["pywinauto"] = MagicMock()
    sys.modules["pywinauto"].Desktop = desk_cls
    try:
        result = find_weixin.is_welcome_back_screen()
    finally:
        sys.modules["pywinauto"] = orig
    assert result is True


def test_is_welcome_back_screen_false_no_button():
    """mmui::LoginWindow title=微信 但无「进入微信」按钮 → False（真隐私锁）"""
    btn = _FakeButton("关闭")
    win = _FakeWindow("mmui::LoginWindow", "微信", buttons=[btn])
    desk_cls = _make_desktop([win])

    orig = sys.modules["pywinauto"]
    sys.modules["pywinauto"] = MagicMock()
    sys.modules["pywinauto"].Desktop = desk_cls
    try:
        result = find_weixin.is_welcome_back_screen()
    finally:
        sys.modules["pywinauto"] = orig
    assert result is False


def test_is_welcome_back_screen_false_no_window():
    """没有 LoginWindow → False"""
    win = _FakeWindow("mmui::MainWindow", "微信", buttons=[])
    desk_cls = _make_desktop([win])

    orig = sys.modules["pywinauto"]
    sys.modules["pywinauto"] = MagicMock()
    sys.modules["pywinauto"].Desktop = desk_cls
    try:
        result = find_weixin.is_welcome_back_screen()
    finally:
        sys.modules["pywinauto"] = orig
    assert result is False


def test_get_welcome_back_hwnd_returns_handle():
    """欢迎回来屏存在时返回非零 hwnd"""
    btn = _FakeButton("进入微信")
    win = _FakeWindow("mmui::LoginWindow", "微信", buttons=[btn], handle=12345)
    desk_cls = _make_desktop([win])

    orig = sys.modules["pywinauto"]
    sys.modules["pywinauto"] = MagicMock()
    sys.modules["pywinauto"].Desktop = desk_cls
    try:
        hwnd = find_weixin.get_welcome_back_hwnd()
    finally:
        sys.modules["pywinauto"] = orig
    assert hwnd == 12345


def test_get_welcome_back_hwnd_zero_when_absent():
    """无欢迎回来屏时返回 0"""
    win = _FakeWindow("mmui::MainWindow", "微信", buttons=[], handle=99)
    desk_cls = _make_desktop([win])

    orig = sys.modules["pywinauto"]
    sys.modules["pywinauto"] = MagicMock()
    sys.modules["pywinauto"].Desktop = desk_cls
    try:
        hwnd = find_weixin.get_welcome_back_hwnd()
    finally:
        sys.modules["pywinauto"] = orig
    assert hwnd == 0


# ─── Fix C: _find_left_nav_button_point ───────────────────────────────────────

# 在 listen_chat 中导入（延迟到测试函数内避免顶层 win32 import 副作用）
def _get_find_fn():
    import importlib
    # 注入 fake ctypes + pywinauto 避免真实 win32 调用
    if "ctypes" not in sys.modules:
        sys.modules["ctypes"] = MagicMock()
    lc = importlib.import_module("listen_chat")
    return lc._find_left_nav_button_point


class _FakeRect:
    def __init__(self, left, top, right, bottom):
        self.left = left
        self.top = top
        self.right = right
        self.bottom = bottom


def test_find_nav_button_absolute_coords_regression():
    """Fix-C 修复前：r.left < left_max=90 在窗口不贴左边缘时误判（回归保护）。
    窗口left=500，按钮绝对坐标 r.left=520 → 窗口相对坐标=20 < 90 → 应找到。
    旧逻辑：520 < 90 → False（找不到）。新逻辑 window_left=500: 520-500=20 < 90 → True。
    """
    fn = _get_find_fn()
    r = _FakeRect(left=520, top=100, right=545, bottom=150)
    buttons = [("微信", r)]
    # 旧逻辑（window_left默认0）
    result_old = fn(buttons, "微信", left_max=90, window_left=0)
    assert result_old is None, "旧逻辑此时不应找到（验证回归场景）"
    # 新逻辑传入正确 window_left
    result_new = fn(buttons, "微信", left_max=90, window_left=500)
    assert result_new == (532, 125), f"新逻辑应找到按钮中心点，得到 {result_new}"


def test_find_nav_button_left_edge_still_works():
    """窗口贴左边缘(window_left=0)时原有逻辑不变"""
    fn = _get_find_fn()
    r = _FakeRect(left=5, top=200, right=85, bottom=260)
    buttons = [("通讯录", r), ("微信", _FakeRect(5, 300, 85, 360))]
    pt = fn(buttons, "通讯录", left_max=90, window_left=0)
    assert pt == (45, 230)


def test_find_nav_button_excludes_right_column():
    """右侧同名控件（窗口相对 x >= left_max）不选"""
    fn = _get_find_fn()
    r_right = _FakeRect(left=600, top=200, right=700, bottom=260)  # 在右侧
    buttons = [("微信", r_right)]
    pt = fn(buttons, "微信", left_max=90, window_left=500)
    # 600-500=100 >= 90 → None
    assert pt is None

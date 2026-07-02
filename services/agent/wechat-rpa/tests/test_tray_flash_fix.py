"""
Regression test — 托盘扫描 DWM cloak 防闪屏（PR #1043）。

根因：_ensure_tray_visible 的 tray 分支有 `if _OFFSCREEN_REPLY:` 守卫，
导致 B 方案（OFFSCREEN_REPLY=False）跳过 DwmSetWindowAttribute cloak。
每次 scan_unread（每 3 秒）WeChat 从托盘弹出时用户都看到窗口闪一下。

修法：
  tray 分支无条件调 DwmSetWindowAttribute(hwnd, 13, 1) 再 ShowWindow(8)，
  使合成器不渲染（用户不可见），扫完 _restore_window_state 再 uncloak。
  OFFSCREEN_REPLY 只控制"是否移到屏幕外坐标"，不控制"是否 cloak"。

本文件是闪屏 bug 的永久 regression test，禁止删除。
"""
from __future__ import annotations

import ctypes
import os
import sys
import types
from unittest.mock import MagicMock, patch
from contextlib import contextmanager

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


# ── 核心闪屏回归：tray 分支必须 cloak，无论 OFFSCREEN_REPLY 是 True 还是 False ──

def test_ensure_tray_visible_cloaks_offscreen_false():
    """OFFSCREEN_REPLY=False（B方案）时 tray 分支必须调 DwmSetWindowAttribute(cloak=1) 防闪屏。

    旧代码: `if _OFFSCREEN_REPLY: DwmSetWindowAttribute(...)` → B方案跳过 → 闪屏。
    修后: 无条件 cloak。
    """
    mw = _make_mock_mw(hwnd=300)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = False

    original_offscreen = listen_chat._OFFSCREEN_REPLY
    try:
        listen_chat._OFFSCREEN_REPLY = False
        with _mock_windll(user32) as wdll, patch("time.sleep"):
            listen_chat._ensure_tray_visible(mw)
        assert wdll.dwmapi.DwmSetWindowAttribute.called, (
            "OFFSCREEN_REPLY=False 时 tray 分支必须调 DwmSetWindowAttribute(cloak) 防闪屏"
        )
    finally:
        listen_chat._OFFSCREEN_REPLY = original_offscreen


def test_ensure_tray_visible_cloak_before_showwindow_offscreen_false():
    """OFFSCREEN_REPLY=False: DWM cloak 必须在 ShowWindow(8) 之前执行。

    否则窗口在被 DWM 隐藏之前已出现在屏幕上（仍然闪屏）。
    """
    mw = _make_mock_mw(hwnd=301)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = False
    call_order: list = []

    original_offscreen = listen_chat._OFFSCREEN_REPLY
    try:
        listen_chat._OFFSCREEN_REPLY = False
        with _mock_windll(user32) as wdll, patch("time.sleep"):
            wdll.dwmapi.DwmSetWindowAttribute.side_effect = lambda *a: call_order.append("dwm_cloak")
            user32.ShowWindow.side_effect = lambda *a: call_order.append(f"show_{a[1]}")
            listen_chat._ensure_tray_visible(mw)
    finally:
        listen_chat._OFFSCREEN_REPLY = original_offscreen

    assert "dwm_cloak" in call_order, "必须调 DwmSetWindowAttribute"
    assert "show_8" in call_order, "必须调 ShowWindow(8)"
    assert call_order.index("dwm_cloak") < call_order.index("show_8"), (
        "DWM cloak 必须在 ShowWindow(8) 之前，否则窗口已出现在屏幕上"
    )


def test_restore_window_state_uncloaks_after_tray_offscreen_false():
    """OFFSCREEN_REPLY=False 时 _restore_window_state('tray') 必须调 DwmSetWindowAttribute(uncloak=0)。

    cloak 与 uncloak 必须配对；未 uncloak 会导致微信窗口永久不可见（用户无法正常使用）。
    """
    mw = _make_mock_mw(hwnd=302)
    user32 = MagicMock()

    original_offscreen = listen_chat._OFFSCREEN_REPLY
    try:
        listen_chat._OFFSCREEN_REPLY = False
        with _mock_windll(user32) as wdll:
            listen_chat._restore_window_state(mw, 'tray')
        assert wdll.dwmapi.DwmSetWindowAttribute.called, (
            "OFFSCREEN_REPLY=False 时 _restore_window_state('tray') 必须调 DwmSetWindowAttribute(uncloak)"
        )
    finally:
        listen_chat._OFFSCREEN_REPLY = original_offscreen


def test_ensure_tray_visible_cloaks_offscreen_true_unchanged():
    """OFFSCREEN_REPLY=True（A方案）时 cloak 行为不变（回归保护）。"""
    mw = _make_mock_mw(hwnd=303)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = False

    original_offscreen = listen_chat._OFFSCREEN_REPLY
    try:
        listen_chat._OFFSCREEN_REPLY = True
        with _mock_windll(user32) as wdll, patch("time.sleep"):
            listen_chat._ensure_tray_visible(mw)
        assert wdll.dwmapi.DwmSetWindowAttribute.called, (
            "OFFSCREEN_REPLY=True 时 tray 分支仍必须调 DwmSetWindowAttribute(cloak)"
        )
    finally:
        listen_chat._OFFSCREEN_REPLY = original_offscreen


def test_tray_no_setwindowpos_when_offscreen_false():
    """OFFSCREEN_REPLY=False 时 tray 分支加了 cloak 后仍然不调 SetWindowPos（只隐藏不移位）。

    B方案语义：窗口保持原坐标，只是 DWM 层不渲染；不应把窗口移到 -2600。
    """
    mw = _make_mock_mw(hwnd=304)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = False

    original_offscreen = listen_chat._OFFSCREEN_REPLY
    try:
        listen_chat._OFFSCREEN_REPLY = False
        with _mock_windll(user32), patch("time.sleep"):
            listen_chat._ensure_tray_visible(mw)
        user32.SetWindowPos.assert_not_called()
    finally:
        listen_chat._OFFSCREEN_REPLY = original_offscreen

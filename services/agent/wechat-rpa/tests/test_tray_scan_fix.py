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
    """托盘隐藏时 _ensure_tray_visible 必须调 ShowWindow(hwnd, 8) 并返回 True。"""
    mw = _make_mock_mw(hwnd=99)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = False

    with _mock_windll(user32), patch("time.sleep"):
        result = listen_chat._ensure_tray_visible(mw)

    assert result is True
    user32.ShowWindow.assert_called_with(99, 8)


def test_ensure_tray_visible_visible_no_call():
    """窗口可见时 _ensure_tray_visible 不得调 ShowWindow，返回 False。"""
    mw = _make_mock_mw(hwnd=99)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = True

    with _mock_windll(user32):
        result = listen_chat._ensure_tray_visible(mw)

    assert result is False
    user32.ShowWindow.assert_not_called()


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
    """窗口可见时 scan_unread 不得调 ShowWindow（不闪不抖动）。"""
    mw = _make_mock_mw(hwnd=55)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = True

    with _mock_windll(user32):
        listen_chat.scan_unread(mw)

    user32.ShowWindow.assert_not_called()

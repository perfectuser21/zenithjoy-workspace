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
    """窗口已可见时 reply_in_chat 不得额外调 ShowWindow（避免闪烁）。"""
    mw = _make_mock_mw(hwnd=43)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = True  # 已可见

    item = MagicMock()

    with _mock_windll(user32), \
         patch("time.sleep"), \
         patch.object(listen_chat, "_open_chat", return_value=False):
        listen_chat.reply_in_chat(mw, item, "hello", sender="于瑾")

    user32.ShowWindow.assert_not_called()

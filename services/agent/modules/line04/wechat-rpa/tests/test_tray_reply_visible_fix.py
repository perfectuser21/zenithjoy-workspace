# -*- coding: utf-8 -*-
"""
Regression test —— 托盘态回复时窗口停在离屏坐标、从未挑回屏内导致"静默回复"
（真机实时反馈，2026-07-18）。

真机反馈原话："他没弹出来，他静默回复了，没有弹出窗口，但是已经回复了。"

根因：扫描态（for_reply=False）常驻隐身机制（_CLOAK_OWNED）把托盘窗口留在离屏坐标
上（防止每轮弹收产生闪烁）。当真正需要回复（for_reply=True）且 OFFSCREEN_REPLY=False
（B 方案默认，回复态应可见）时，`_should_move_offscreen` 正确返回 False（不应该
"继续挪到离屏"），但旧代码只是"跳过挪出去"，从没有对应地"把已经在离屏坐标的窗口
挑回屏内"——于是回复全程发生在离屏坐标，用户看不见任何动静。

修法：
  1. 扫描态挪到离屏前，把移动前的坐标存进 _saved_visible_pos（复用"可见"分支已有的
     记录字典），作为"最近一次真实可见位置"的锚点。
  2. 回复态（_should_move_offscreen 返回 False）时，显式检测窗口当前是否仍在离屏
     坐标（left <= -2000），若是则挪回 _saved_visible_pos 记录的位置（无记录时退回
     一个安全的屏内默认位置 (100,100)）。

本文件是这个 bug 的永久 regression test，禁止删除。
"""
from __future__ import annotations

import ctypes
import os
import sys
import types
from contextlib import contextmanager
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
    windll_mock = MagicMock(user32=user32, kernel32=MagicMock(), dwmapi=MagicMock())
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


# 禁止 del sys.modules 重导入（2026-07-03 教训，见 test_tray_flash_fix.py 注释）。
import listen_chat  # noqa: E402


def _make_mock_mw(hwnd: int = 980):
    mw = MagicMock()
    mw.element_info.handle = hwnd
    mw.descendants.return_value = []
    return mw


def _fill_rect(left):
    def _side_effect(h, rect_byref):
        rect_byref._obj.left = left
        rect_byref._obj.top = 60
        rect_byref._obj.right = left + 400
        rect_byref._obj.bottom = 460
        return 1
    return _side_effect


def test_ensure_tray_visible_reply_moves_offscreen_window_back_when_no_saved_pos():
    """回复态(for_reply=True, OFFSCREEN_REPLY=False)，窗口当前在离屏坐标且无历史记录
    → 必须挪回一个安全的屏内默认位置，不能什么都不做（否则回复静默发生在离屏）。"""
    HWND = 981
    mw = _make_mock_mw(hwnd=HWND)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = 0
    user32.GetWindowRect.side_effect = _fill_rect(left=-2600)  # 常驻隐身留在离屏坐标

    original_offscreen_reply = listen_chat._OFFSCREEN_REPLY
    listen_chat._saved_visible_pos.pop(HWND, None)
    try:
        listen_chat._OFFSCREEN_REPLY = False
        with _mock_windll(user32), patch("time.sleep"):
            result = listen_chat._ensure_tray_visible(mw, for_reply=True)
    finally:
        listen_chat._OFFSCREEN_REPLY = original_offscreen_reply
        listen_chat._saved_visible_pos.pop(HWND, None)

    assert result == "tray"
    user32.SetWindowPos.assert_called()
    call_args = user32.SetWindowPos.call_args[0]
    assert call_args[2] > -2000, "回复态必须把窗口挪回屏内可见坐标，不能停在离屏"


def test_ensure_tray_visible_reply_uses_saved_visible_pos_when_available():
    """回复态挪回屏内时，若有 _saved_visible_pos 记录的"最近一次真实可见位置"，
    必须用这个记录值，而不是随便挪到默认坐标。"""
    HWND = 982
    mw = _make_mock_mw(hwnd=HWND)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = 0
    user32.GetWindowRect.side_effect = _fill_rect(left=-2600)

    original_offscreen_reply = listen_chat._OFFSCREEN_REPLY
    listen_chat._saved_visible_pos[HWND] = (321, 234)
    try:
        listen_chat._OFFSCREEN_REPLY = False
        with _mock_windll(user32), patch("time.sleep"):
            listen_chat._ensure_tray_visible(mw, for_reply=True)
    finally:
        listen_chat._OFFSCREEN_REPLY = original_offscreen_reply
        listen_chat._saved_visible_pos.pop(HWND, None)

    call_args = user32.SetWindowPos.call_args[0]
    assert call_args[2] == 321
    assert call_args[3] == 234


def test_ensure_tray_visible_reply_no_redundant_move_when_already_onscreen():
    """回复态时窗口已经在屏内（未被常驻隐身留在离屏）→ 不应画蛇添足再调 SetWindowPos。"""
    HWND = 983
    mw = _make_mock_mw(hwnd=HWND)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = 0
    user32.GetWindowRect.side_effect = _fill_rect(left=200)  # 已在屏内

    original_offscreen_reply = listen_chat._OFFSCREEN_REPLY
    listen_chat._saved_visible_pos.pop(HWND, None)
    try:
        listen_chat._OFFSCREEN_REPLY = False
        with _mock_windll(user32), patch("time.sleep"):
            listen_chat._ensure_tray_visible(mw, for_reply=True)
    finally:
        listen_chat._OFFSCREEN_REPLY = original_offscreen_reply
        listen_chat._saved_visible_pos.pop(HWND, None)

    user32.SetWindowPos.assert_not_called()


def test_ensure_tray_visible_scan_saves_visible_pos_before_moving_offscreen():
    """扫描态(for_reply=False)挪到离屏前，必须把移动前坐标存进 _saved_visible_pos，
    供之后回复态挑回屏内时使用。"""
    HWND = 984
    mw = _make_mock_mw(hwnd=HWND)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = 0
    user32.GetWindowRect.side_effect = _fill_rect(left=150)  # 挪之前在屏内的真实位置

    listen_chat._saved_visible_pos.pop(HWND, None)
    try:
        with _mock_windll(user32), patch("time.sleep"):
            result = listen_chat._ensure_tray_visible(mw)  # 默认 for_reply=False（扫描）
        saved = listen_chat._saved_visible_pos.get(HWND)
    finally:
        listen_chat._saved_visible_pos.pop(HWND, None)

    assert result == "tray"
    assert saved == (150, 60), f"扫描态挪离屏前必须存下原坐标，实际 {saved!r}"

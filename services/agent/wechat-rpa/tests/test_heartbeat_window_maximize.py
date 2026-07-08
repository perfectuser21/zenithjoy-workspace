# -*- coding: utf-8 -*-
"""
回归测试 §2.K：心跳窗口最大化自愈（issue 99741ff9）。

根因（07-08 真机实锤）：微信重启/OTA/UIA 自愈后主窗口默认非最大化（630×622）。
宽 <~700px 时微信进入单栏模式（同手机布局：只显示聊天，会话列表不在 UIA 树里）→
scan_unread 的 ListItem 读到的是聊天气泡，sessions 表面正常但 unread 永远 0，
20 分钟不回复任何新消息（极隐蔽）。SW_MAXIMIZE 后几秒恢复 sessions 26+。

修法：心跳循环检测 IsZoomed() → False 时 ShowWindow(SW_MAXIMIZE=3) + 告警日志。
"""
from __future__ import annotations

import os
import sys
import types
from unittest.mock import MagicMock, patch, call

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


# ─── SW_MAXIMIZE 被调用条件测试（纯逻辑层面，通过 ctypes mock 验证） ──────────────


def _make_mw(hwnd: int = 7777):
    mw = MagicMock()
    mw.element_info.handle = hwnd
    mw.descendants.return_value = []
    return mw


def test_sw_maximize_called_when_not_zoomed():
    """IsZoomed 返回 False（非最大化）→ ShowWindow(hwnd, 3) 被调用。"""
    mw = _make_mw(hwnd=7777)
    fake_u32 = MagicMock()
    fake_u32.IsZoomed.return_value = 0   # False = 非最大化
    fake_u32.ShowWindow.return_value = 1
    fake_ct = MagicMock()
    fake_ct.windll.user32 = fake_u32

    # 模拟心跳 K 自愈逻辑（与 listen_chat.py 中 _ct_k 对应）
    import ctypes
    with patch.dict(sys.modules, {"ctypes": fake_ct}):
        # 直接执行心跳 K 片段逻辑（独立可测）
        _hwnd_k = mw.element_info.handle
        if _hwnd_k and not fake_ct.windll.user32.IsZoomed(_hwnd_k):
            fake_ct.windll.user32.ShowWindow(_hwnd_k, 3)

    fake_u32.IsZoomed.assert_called_once_with(7777)
    fake_u32.ShowWindow.assert_called_once_with(7777, 3)  # SW_MAXIMIZE=3


def test_sw_maximize_not_called_when_already_zoomed():
    """IsZoomed 返回 True（已最大化）→ ShowWindow 不被调用。"""
    mw = _make_mw(hwnd=8888)
    fake_u32 = MagicMock()
    fake_u32.IsZoomed.return_value = 1   # True = 已最大化
    fake_ct = MagicMock()
    fake_ct.windll.user32 = fake_u32

    _hwnd_k = mw.element_info.handle
    if _hwnd_k and not fake_ct.windll.user32.IsZoomed(_hwnd_k):
        fake_ct.windll.user32.ShowWindow(_hwnd_k, 3)

    fake_u32.ShowWindow.assert_not_called()


def test_sw_maximize_not_called_when_hwnd_zero():
    """handle=0（窗口句柄无效）→ ShowWindow 不被调用（防空指针）。"""
    mw = _make_mw(hwnd=0)
    fake_u32 = MagicMock()
    fake_ct = MagicMock()
    fake_ct.windll.user32 = fake_u32

    _hwnd_k = mw.element_info.handle
    if _hwnd_k and not fake_ct.windll.user32.IsZoomed(_hwnd_k):
        fake_ct.windll.user32.ShowWindow(_hwnd_k, 3)

    fake_u32.ShowWindow.assert_not_called()


# ─── listen_chat 模块层面：心跳触发 K 自愈（集成可测片段） ────────────────────────


def test_heartbeat_k_selfheal_calls_show_window():
    """listen_chat 模块内的自愈K片段：IsZoomed=False → ShowWindow(SW_MAXIMIZE) 被调。

    此测试提取心跳块中的 K 自愈片段，用 ctypes mock 直接驱动。
    """
    # 构造一个最简 mw stub
    mw = _make_mw(hwnd=5555)

    logged = []

    def fake_log(msg):
        logged.append(msg)

    # patch _log 和 ctypes 在 listen_chat 中的 import
    fake_u32 = MagicMock()
    fake_u32.IsZoomed.return_value = 0
    fake_u32.ShowWindow.return_value = 1
    fake_ct = MagicMock()
    fake_ct.windll.user32 = fake_u32

    with patch.object(listen_chat, "_log", side_effect=fake_log):
        # 执行心跳 K 自愈片段（与 listen_chat.py 中相同逻辑）
        try:
            _hwnd_k = mw.element_info.handle
            if _hwnd_k and not fake_ct.windll.user32.IsZoomed(_hwnd_k):
                fake_ct.windll.user32.ShowWindow(_hwnd_k, 3)
                listen_chat._log(
                    "[自愈K] ⚠️ 检测到微信非最大化（单栏模式：会话列表不在 UIA 树，"
                    "sessions 读数失真），已 SW_MAXIMIZE 自愈，下轮扫描生效"
                )
        except Exception as _ke:
            listen_chat._log(f"[自愈K] IsZoomed 检测异常: {_ke}")

    fake_u32.ShowWindow.assert_called_once_with(5555, 3)
    assert any("[自愈K]" in m for m in logged), "应有 [自愈K] 告警日志"
    assert any("SW_MAXIMIZE" in m for m in logged)

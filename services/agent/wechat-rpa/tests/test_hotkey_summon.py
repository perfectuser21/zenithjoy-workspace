# -*- coding: utf-8 -*-
"""
Regression test —— 热键召唤 Ctrl+Alt+W 替代脆弱托盘召唤（handoff 0719 发现1，rog 真机验证）。

背景：真塌自愈原召唤主路 _summon_wechat_from_tray() 要去系统托盘溢出区(XamlIsland)
认微信图标，图标位置/DPI/Win11 UWP 化跨机器不稳定，真机实测 rog 上会掉回重启兜底。
微信自带全局热键「显示/隐藏窗口」（用户设为 Ctrl+Alt+W、范围「所有窗口」）不依赖任何
坐标/图标识别，真机验证：关进托盘→发 Ctrl+Alt+W→窗口弹回前台+UIA 树重建。

Ctrl+Alt+W 是 toggle，必须 verify 驱动——只在检测到隐藏/塌缩态才发，发后校验
"树已重建"，没到位允许重试处理奇偶次数，都不行才降级托盘召唤/重启。

CI 只测纯逻辑（非 Windows 直接 False + 重试判定的 verify 守卫）——真实按键发送/UIA
读取走真机端到端验证，不进 CI（同 test_tray_summon.py 的测试范围原则）。
"""
from __future__ import annotations

import os
import sys
import types
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

import listen_chat  # noqa: E402


def test_summon_returns_false_on_non_windows(monkeypatch):
    """非 Windows（CI Linux/mac）→ 直接 False，绝不抛（上层退回托盘召唤/重启兜底）。"""
    import platform
    monkeypatch.setattr(platform, "system", lambda: "Linux")
    assert listen_chat._summon_wechat_via_hotkey() is False


def test_retry_stops_once_tree_ready_TOGGLE_GUARD():
    """核心安全守卫：树已恢复(tree_ready=True) → 不再发热键。

    Ctrl+Alt+W 是显示/隐藏 toggle——对已经恢复可见的窗口再发一次会把它藏回去。
    verify 驱动意味着每次发送前都要先确认仍处于需要召唤的状态。
    """
    assert listen_chat._should_continue_hotkey_retry(
        attempt=0, max_attempts=3, tree_ready=True) is False
    assert listen_chat._should_continue_hotkey_retry(
        attempt=1, max_attempts=3, tree_ready=True) is False


def test_retry_continues_while_not_ready_and_budget_remains():
    assert listen_chat._should_continue_hotkey_retry(
        attempt=0, max_attempts=3, tree_ready=False) is True
    assert listen_chat._should_continue_hotkey_retry(
        attempt=2, max_attempts=3, tree_ready=False) is True


def test_retry_stops_at_max_attempts():
    """奇偶处理有限度：重试耗尽仍未恢复 → 停止，交给上层降级(托盘/重启)。"""
    assert listen_chat._should_continue_hotkey_retry(
        attempt=3, max_attempts=3, tree_ready=False) is False
    assert listen_chat._should_continue_hotkey_retry(
        attempt=5, max_attempts=3, tree_ready=False) is False


def test_input_struct_size_is_40_on_x64():
    """x64 铁坑守卫（2026-07-19 真机根因）：SendInput 的 INPUT 结构体 union 必须含最大成员
    MOUSEINPUT，sizeof 必须 = 40。若 union 只放 KEYBDINPUT → sizeof=32 → SendInput 每次
    返回 0 + GetLastError=87(ERROR_INVALID_PARAMETER)，一个键都发不出（曾误判"热键路线不通"）。
    改回小 union 让本测试报红。全部生产/CI 环境均 x64（指针 8 字节）。"""
    import ctypes
    assert ctypes.sizeof(listen_chat.INPUT) == 40


def test_make_kb_input_keydown_and_keyup():
    """键盘 INPUT 纯构造：type=INPUT_KEYBOARD、vk 正确、up 标志正确。"""
    down = listen_chat._make_kb_input(0x57)  # 'W'
    assert down.type == 1                     # INPUT_KEYBOARD
    assert down.u.ki.wVk == 0x57
    assert down.u.ki.dwFlags == 0             # keydown
    up = listen_chat._make_kb_input(0x57, up=True)
    assert up.u.ki.dwFlags == 0x0002          # KEYEVENTF_KEYUP

"""回归测试（2026-07-08 真机取证，issue 99741ff9 / skill §2.K）：

真机现象：主窗口 630x622 非最大化时微信进【单栏布局】，会话列表整个不在 UIA 树，
scan_unread 读到的是聊天气泡（sessions=4 假象），新消息 20 分钟无反应且日志"一切正常"。
SW_MAXIMIZE 后 sessions 4→26 立即恢复。微信重启后默认非最大化 → 每次自愈重启都掉坑。
修法：心跳检测 可见+非最大化 → 自动 SW_MAXIMIZE 自愈；iconic（托盘/最小化）是合法
运行态不动（强行弹窗打扰客户机操作者）。

本文件是永久 regression test，禁止删除。
"""
from __future__ import annotations

import os
import sys
import types
from unittest.mock import MagicMock


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


HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, WECHAT_RPA_DIR)
_stub_heavy_deps()

import listen_chat  # noqa: E402


def test_visible_not_maximized_needs_heal():
    assert listen_chat.window_needs_maximize(is_zoomed=False, is_iconic=False) is True


def test_already_maximized_no_heal():
    assert listen_chat.window_needs_maximize(is_zoomed=True, is_iconic=False) is False


def test_iconic_tray_state_untouched():
    """最小化/托盘是合法运行态（'微信最小化也能跑'），绝不强行弹最大化窗口。"""
    assert listen_chat.window_needs_maximize(is_zoomed=False, is_iconic=True) is False


def test_build_diag_carries_window_state_and_welcome_fails():
    diag = listen_chat.build_diag(
        main_window_found=True, login_present=False, logged_in=True,
        screen_locked=False, sessions_seen=26, unread_senders=[],
        replied_count=0, last_error=None, skip_snapshot={"delta": {}},
        window_state={"zoomed": True, "iconic": False, "w": 2560, "h": 1528,
                      "maximize_heals": 1},
        welcome_click_fails=0,
    )
    assert diag["window_state"]["zoomed"] is True
    assert diag["window_state"]["maximize_heals"] == 1
    assert diag["welcome_click_fails"] == 0


def test_build_diag_backward_compatible_without_new_args():
    """旧调用（不带新参数）不破坏：新键有安全默认值。"""
    diag = listen_chat.build_diag(
        main_window_found=True, login_present=False, logged_in=True,
        screen_locked=False, sessions_seen=5, unread_senders=[],
        replied_count=0, last_error=None, skip_snapshot={"delta": {}},
    )
    assert diag["window_state"] == {}
    assert diag["welcome_click_fails"] == 0

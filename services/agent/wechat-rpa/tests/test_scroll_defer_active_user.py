# -*- coding: utf-8 -*-
"""滚轮扫描避让真实用户操作（2026-07-16 用户真机反馈：抢键盘鼠标，人没法用）。

根因：`_scroll_session_list_wheel` 扫描长联系人列表必须用**真实硬件级鼠标滚轮**
（`SetCursorPos` + `mouse_event`）——这是真机验证过的硬约束，消息模拟的滚轮在长
列表上会卡死（"加力 12 次不动，只覆盖 16 条"）。这个硬件级操作本身不能去掉，但
如果客户机操作者此刻正在用自己的鼠标/键盘，这个操作会把光标挪走打断他们。

修法：滚动前查系统级"距上次真实输入过去多久"（`GetLastInputInfo`），如果用户
刚刚（默认 1.5s 内）有过真实操作，说明正在活跃使用，本轮跳过这次滚动扫描，
下一轮再试——不影响已排队回复的发送时效，只延后"主动扫描发现新消息"这一步。

本文件是该改进的永久 regression test。
"""
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
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)
_stub_heavy_deps()

if "listen_chat" in sys.modules:
    del sys.modules["listen_chat"]

import listen_chat  # noqa: E402


def test_defer_when_user_just_active():
    """用户 0.5s 前刚操作过（< 阈值 1.5s）→ 应该避让，本轮跳过滚动。"""
    assert listen_chat.should_defer_scroll_for_active_user(idle_ms=500) is True


def test_no_defer_when_user_idle_long_enough():
    """用户已经 3s 没操作（>= 阈值）→ 可以安全滚动。"""
    assert listen_chat.should_defer_scroll_for_active_user(idle_ms=3000) is False


def test_defer_boundary_exactly_at_threshold_is_safe():
    """恰好等于阈值 → 不避让（边界值算作"已经够久没操作"，避免无限退避）。"""
    assert listen_chat.should_defer_scroll_for_active_user(idle_ms=1500) is False


def test_scroll_checks_idle_before_hijacking_cursor():
    """_scroll_session_list_wheel 函数体必须调用 should_defer_scroll_for_active_user，
    防止有人把这道避让检查悄悄绕过、真实鼠标劫持又变成无条件执行。
    """
    import ast

    src_path = os.path.join(WECHAT_RPA_DIR, "listen_chat.py")
    with open(src_path, encoding="utf-8") as f:
        tree = ast.parse(f.read())
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "_scroll_session_list_wheel":
            calls = set()
            for n in ast.walk(node):
                if isinstance(n, ast.Call) and isinstance(n.func, ast.Name):
                    calls.add(n.func.id)
            assert "should_defer_scroll_for_active_user" in calls, (
                "_scroll_session_list_wheel 必须调用 should_defer_scroll_for_active_user "
                f"做用户活跃避让，实际调用: {sorted(calls)}"
            )
            return
    raise AssertionError("未找到 _scroll_session_list_wheel 函数")

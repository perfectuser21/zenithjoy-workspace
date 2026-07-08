# -*- coding: utf-8 -*-
"""
回归测试 §2.I：_find_left_nav_button_point 改窗口相对坐标。

根因（07-08 真机实锤）：原实现用屏幕绝对坐标 r.left < left_max(90)。
窗口在屏幕中间（实测 left=964）时，导航按钮 r.left 约为 964+20=984，
永远 >= 90 → 每次 `_reset_session_list_to_top` 找不到按钮 → 跳过切 tab → 回顶失效
→ 视口外会话永远取不到 → 客服死循环不回复（issue 8e163d87）。

修法：改为窗口相对坐标 r.left - win_left < left_max。
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

if "listen_chat" in sys.modules:
    del sys.modules["listen_chat"]

import listen_chat  # noqa: E402


class _Rect:
    def __init__(self, left, top, right, bottom):
        self.left, self.top, self.right, self.bottom = left, top, right, bottom


# ─── Bug 复现：窗口在屏中间，旧代码找不到按钮（回归保护） ────────────────────────────


def test_nav_button_found_when_window_at_screen_center():
    """窗口 left=964，按钮 rect.left=984（窗口相对 20）→ 应找到（修复前找不到）。"""
    win_left = 964
    buttons = [
        ("通讯录", _Rect(984, 200, 1024, 240)),   # 窗口相对 left=20 < 90 → 应找到
        ("微信",  _Rect(984, 100, 1024, 140)),    # 同上
        ("通讯录", _Rect(1500, 200, 1600, 240)),   # 右侧同名 → 不选（相对 536 >= 90）
    ]
    pt = listen_chat._find_left_nav_button_point(buttons, "通讯录", left_max=90, win_left=win_left)
    assert pt is not None, (
        "窗口在屏中间时 _find_left_nav_button_point 应能找到导航按钮（§2.I 回归）"
    )
    # 返回的是屏幕坐标中心点
    assert pt == ((984 + 1024) // 2, (200 + 240) // 2)


def test_nav_button_right_side_excluded_when_window_at_center():
    """右侧按钮（窗口相对 x >= 90）不应选，即使绝对坐标相对看起来像左侧。"""
    win_left = 964
    buttons = [
        ("微信", _Rect(1060, 100, 1140, 140)),  # 窗口相对 left=96 >= 90 → 不选
    ]
    pt = listen_chat._find_left_nav_button_point(buttons, "微信", left_max=90, win_left=win_left)
    assert pt is None, "窗口相对坐标 >= left_max 的按钮不应被选中"


def test_nav_button_backward_compat_default_win_left_zero():
    """win_left 默认 0（向后兼容）：原有测试场景不受影响（窗口贴屏幕左边缘）。"""
    buttons = [
        ("微信", _Rect(20, 100, 60, 140)),    # left=20 < 90 → 找到（兼容旧行为）
        ("通讯录", _Rect(20, 160, 60, 200)),
    ]
    pt = listen_chat._find_left_nav_button_point(buttons, "微信")  # win_left=0
    assert pt == (40, 120)
    pt2 = listen_chat._find_left_nav_button_point(buttons, "通讯录")
    assert pt2 == (40, 180)


def test_nav_button_boundary_window_relative():
    """边界：窗口相对坐标正好等于 left_max 时不选（严格小于）。"""
    win_left = 100
    buttons = [
        ("微信", _Rect(190, 100, 230, 140)),  # 窗口相对 90，等于 left_max → 不选
        ("微信", _Rect(189, 150, 229, 190)),  # 窗口相对 89 < 90 → 选
    ]
    pt1 = listen_chat._find_left_nav_button_point(buttons[:1], "微信", left_max=90, win_left=win_left)
    assert pt1 is None, "窗口相对坐标等于 left_max 时不应选中"
    pt2 = listen_chat._find_left_nav_button_point(buttons[1:], "微信", left_max=90, win_left=win_left)
    assert pt2 == ((189 + 229) // 2, (150 + 190) // 2)

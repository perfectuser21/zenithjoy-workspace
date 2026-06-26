# -*- coding: utf-8 -*-
"""
TDD — 扫描"随缘"修法（rog 真机实证）：扫前切 tab 回真顶 + 只读左列会话 + 鲁棒到底判定。

真因（rog 真机 + 用户屏前实证）：scan_recent_contacts 没先回列表真顶（向上滚彻底失效），
列表停哪从哪往下扫 → 上半截会话（文件传输助手/莫易/崔华/于瑾…）经常漏。
三件套修法的纯逻辑可单测：
1. _filter_left_column_item_names：只保留会话列表（左列 x<阈值）ListItem，排除开着聊天时
   右边消息气泡/时间戳噪音（"08:22"/"[preflight-selfcheck]"）。
2. _find_left_nav_button_point：按 name + 左列 x<left_max 定位「通讯录」/「微信」导航按钮中心点
   （切 tab 回顶的点击目标，不写死坐标）。
3. 鲁棒到底：末项（最后一个会话名）连续 ≥N 次不变才判到底（旧的连续 2 屏无新增会半路停漏底部）。

真机 UIA（切 tab/读控件树）不可单测，但上面三个纯逻辑可测。
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


# ─── 1. 左列会话过滤：只保留 center_x < 阈值 的会话项名字 ───────────────────────


def test_filter_left_column_keeps_session_items_drops_right_pane_noise():
    """会话项中心 x 在左列(<460)保留；右侧聊天消息气泡/时间戳(x>=460)是噪音剔除。"""
    # (name, center_x)
    items = [
        ("莫易\n你好\n08:00\n", 278),          # 左列会话 → 收
        ("崔华\n在吗\n07:00\n", 200),           # 左列会话 → 收
        ("08:22", 900),                          # 右侧时间戳噪音 → 剔
        ("[preflight-selfcheck]", 760),          # 右侧消息气泡噪音 → 剔
    ]
    out = listen_chat._filter_left_column_item_names(items, x_max=460)
    assert out == ["莫易\n你好\n08:00\n", "崔华\n在吗\n07:00\n"]


def test_filter_left_column_boundary_exclusive():
    """正好等于阈值的剔除（>= x_max 算右侧）。"""
    items = [("A", 459), ("B", 460), ("C", 461)]
    out = listen_chat._filter_left_column_item_names(items, x_max=460)
    assert out == ["A"]


# ─── 2. 导航按钮定位：name + 左列 x<left_max → 中心点 ─────────────────────────────


class _Rect:
    def __init__(self, left, top, right, bottom):
        self.left, self.top, self.right, self.bottom = left, top, right, bottom


def test_find_left_nav_button_point_by_name_and_left_col():
    """「微信」按钮在最左导航栏(x<90)→ 返回其中心点；右侧同名文本不误选。"""
    buttons = [
        ("微信", _Rect(20, 100, 60, 140)),     # 左导航栏按钮 → 命中，中心(40,120)
        ("通讯录", _Rect(20, 160, 60, 200)),
        ("微信", _Rect(500, 100, 560, 140)),    # 右侧某处同名 → 不选（x>=90）
    ]
    pt = listen_chat._find_left_nav_button_point(buttons, "微信", left_max=90)
    assert pt == (40, 120)
    pt2 = listen_chat._find_left_nav_button_point(buttons, "通讯录", left_max=90)
    assert pt2 == (40, 180)


def test_find_left_nav_button_point_missing_returns_none():
    buttons = [("微信", _Rect(20, 100, 60, 140))]
    assert listen_chat._find_left_nav_button_point(buttons, "通讯录", left_max=90) is None


# ─── 3. 鲁棒到底：末项连续 N 次不变才停 ──────────────────────────────────────────


def test_bottom_reached_only_after_last_item_unchanged_streak():
    """末项连续 >= max_unchanged 次不变 → 到底；不足则继续（防滚动偶发 stall 半路停）。"""
    assert listen_chat._bottom_reached_by_last_item(unchanged_streak=10, max_unchanged=10) is True
    assert listen_chat._bottom_reached_by_last_item(unchanged_streak=11, max_unchanged=10) is True


def test_not_bottom_before_streak_reached():
    # 旧逻辑连续 2 次无变化就停 → 半路停漏底部；新逻辑必须扛到 10
    assert listen_chat._bottom_reached_by_last_item(unchanged_streak=2, max_unchanged=10) is False
    assert listen_chat._bottom_reached_by_last_item(unchanged_streak=9, max_unchanged=10) is False


def test_scroll_max_pages_at_least_35():
    """硬上限放宽到 >=35 屏（多滚到底无害，绝不少滚漏底部）。"""
    assert listen_chat._SCROLL_MAX_PAGES >= 35


def test_last_item_unchanged_max_streak_is_at_least_10():
    assert listen_chat._SCROLL_LAST_ITEM_UNCHANGED_MAX >= 10

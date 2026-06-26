# -*- coding: utf-8 -*-
"""
TDD — 「扫描随缘」三件套修法的纯逻辑单测（1.0.69，rog 真机实证根因）。

背景（rog 真机 + 用户屏前实证）：`scan_recent_contacts` 扫好友只扫到一个局部窗口、漏上半截
（文件传输助手/崔华/于瑾/微信ClawBot/冬瓜MGL 等够不到）。真因：微信 4.1.8 Qt 会话列表只认向下
滚轮，向上滚/Home/Ctrl+Home/WM_VSCROLL/拖滚动条全失效——列表停哪从哪往下扫。三件套修法：
  ① 切「通讯录」→「微信」tab 回真顶（唯一可靠回顶法）；
  ② 只读左列会话项（排除开着聊天时右侧消息气泡/时间噪音）；
  ③ 鲁棒到底（末项连续不变才停，不被列表重排骗到半路提前停漏底部）。

真机 UIA 那段（切 tab 点击/滚轮）不可 CI 测，但「左列过滤 / 末项到底判定 / 左列导航按钮挑选」
是纯函数，必须 CI clean 可测。本文件只测纯函数（顶层零 pywinauto）。
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


# ─── ② 只读左列：_filter_left_column 纯函数 ─────────────────────────────────────


def test_left_column_excludes_right_side_chat_noise():
    """开着聊天时右侧消息区被当 ListItem 渲染进来（x 大）→ 必须按 x<460 滤掉，只留左列会话。"""
    items = [
        ("于瑾\n您好\n15:26\n", 230),          # 左列会话
        ("崔华\n在吗\n11:09\n", 200),          # 左列会话
        ("08:22", 720),                        # 右侧时间戳噪音
        ("[preflight-selfcheck]", 650),        # 右侧消息气泡噪音
        ("收到，谢谢老板", 880),               # 右侧对方消息气泡
    ]
    out = listen_chat._filter_left_column(items)
    assert out == ["于瑾\n您好\n15:26\n", "崔华\n在吗\n11:09\n"]


def test_left_column_dynamic_boundary_overrides_fallback():
    """给了会话列表 rect.right（动态边界）→ 用它而不是回退 460。"""
    items = [("甲\n…", 250), ("乙\n…", 380), ("丙右侧噪音", 500)]
    # list_right=300：x=250 留，x=380/500 都在右侧滤掉（与回退 460 不同结果，证明动态生效）
    assert listen_chat._filter_left_column(items, list_right=300) == ["甲\n…"]
    # 同一批用回退 460：x=380 会留下（对比，证明边界确实切换了）
    assert listen_chat._filter_left_column(items, list_right=None) == ["甲\n…", "乙\n…"]


def test_left_column_invalid_list_right_falls_back():
    """list_right <=0 / None → 退回 fallback(460)，不因坏边界全滤光。"""
    items = [("甲", 100), ("乙右噪音", 600)]
    assert listen_chat._filter_left_column(items, list_right=0) == ["甲"]
    assert listen_chat._filter_left_column(items, list_right=-5) == ["甲"]


def test_left_column_keeps_items_without_coords():
    """拿不到坐标(center_x=None)→ 宽松保留，不因缺坐标漏掉真实会话。"""
    items = [("无坐标会话", None), ("左列", 120), ("右噪音", 999)]
    assert listen_chat._filter_left_column(items) == ["无坐标会话", "左列"]


def test_left_column_empty_input():
    assert listen_chat._filter_left_column([]) == []


def test_left_column_custom_fallback():
    items = [("a", 100), ("b", 200)]
    assert listen_chat._filter_left_column(items, fallback=150) == ["a"]


# ─── ③ 鲁棒到底：_bottom_item_name + _should_stop_scroll_robust 纯函数 ────────────


def test_bottom_item_name_takes_last_nonempty_first_line():
    names = ["于瑾\n您好\n15:26\n", "崔华\n在吗\n11:09\n", "冬瓜MGL\n[1条]\n收到\n08:00\n"]
    assert listen_chat._bottom_item_name(names) == "冬瓜MGL"


def test_bottom_item_name_skips_trailing_empty():
    """末尾的空串/纯空白项跳过，取真正最底部那个有名字的。"""
    names = ["甲\n你好", "乙\n在吗", "", "   ", "\n"]
    assert listen_chat._bottom_item_name(names) == "乙"


def test_bottom_item_name_none_when_all_empty():
    assert listen_chat._bottom_item_name([]) is None
    assert listen_chat._bottom_item_name(["", "  ", "\n\n"]) is None


def test_robust_stop_only_after_threshold_unchanged():
    """末项连续不变达阈值(默认 10)才停——比旧的连续 2 屏无新增稳，不半路漏底。"""
    # 默认阈值 10：9 次不停，10 次才停。
    assert listen_chat._should_stop_scroll_robust(9) is False
    assert listen_chat._should_stop_scroll_robust(10) is True
    assert listen_chat._should_stop_scroll_robust(15) is True


def test_robust_stop_threshold_is_relaxed_to_at_least_ten():
    """守住"放宽到 ≥10"：默认阈值常量不得退回旧的 2（否则又半路提前停漏底部）。"""
    assert listen_chat._SCROLL_BOTTOM_UNCHANGED_MAX >= 10


def test_robust_stop_custom_threshold():
    assert listen_chat._should_stop_scroll_robust(2, max_streak=3) is False
    assert listen_chat._should_stop_scroll_robust(3, max_streak=3) is True


def test_robust_stop_does_not_stop_at_zero():
    """刚开始(streak=0)绝不停。"""
    assert listen_chat._should_stop_scroll_robust(0) is False


# ─── ① 回顶：_pick_nav_button 纯函数（左列导航按钮挑选）────────────────────────


def test_pick_nav_button_matches_name_in_left_column():
    """名字精确匹配且在左列(rel x<90)→ 命中其下标。"""
    buttons = [
        ("微信", 45),       # 0：左列「微信」tab
        ("通讯录", 45),     # 1：左列「通讯录」tab
        ("收藏", 45),       # 2
    ]
    assert listen_chat._pick_nav_button(buttons, "通讯录") == 1
    assert listen_chat._pick_nav_button(buttons, "微信") == 0


def test_pick_nav_button_ignores_same_name_outside_left_column():
    """会话列表里也可能有叫"微信"的项(x 大)，不能误选——只认左列导航栏。"""
    buttons = [
        ("微信", 230),      # 会话列表里的"微信"会话（x 大，非导航）
        ("微信", 45),       # 真·左列导航「微信」tab
    ]
    assert listen_chat._pick_nav_button(buttons, "微信") == 1


def test_pick_nav_button_not_found():
    assert listen_chat._pick_nav_button([("收藏", 45)], "通讯录") == -1
    assert listen_chat._pick_nav_button([], "微信") == -1


def test_pick_nav_button_handles_none_center_x():
    """坐标缺失(None)的按钮不得被当左列导航误选（回顶要求精确定位）。"""
    assert listen_chat._pick_nav_button([("通讯录", None)], "通讯录") == -1


def test_pick_nav_button_custom_left_x_max():
    buttons = [("通讯录", 80)]
    assert listen_chat._pick_nav_button(buttons, "通讯录", left_x_max=90) == 0
    assert listen_chat._pick_nav_button(buttons, "通讯录", left_x_max=50) == -1

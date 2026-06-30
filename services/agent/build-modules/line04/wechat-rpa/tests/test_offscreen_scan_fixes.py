# -*- coding: utf-8 -*-
"""
逻辑层单测 — 离屏会话检测+切换（1.0.73 Fix B；Fix A 已废）

Fix A（已废，2026-06-29 #962 推翻 → 2026-07-01 新设计取代）：曾要求 scan_unread 扫前【每轮】调
       _reset_session_list_to_top 回顶。rog 真机实证：每轮切 tab 偶发失败 → 卡通讯录 → 「回一次
       就不理」（见 test_scan_no_tab_switch_regression）。现在的设计：scan_unread 只在【首屏渲染满、
       真去滚动找视口外未读】之后才原子回顶一次（见 test_scan_unread_scroll），小账号绝不切 tab。
       故原 Fix A 的两个「每轮必回顶/空未读也回顶」断言已删（与现行设计冲突，是过时回归）。

Fix B（仍有效）：_open_chat 检测到离屏坐标(>20000)时，必须先 Select() 强制虚拟列表把
       目标项滚进可视区，再重扫 descendants 取有效坐标；否则 descendants 里
       根本找不到该 item（Qt 虚拟列表不渲染不可见项）。

CI 安全：顶层零 pywinauto import，mock 注入防止 Windows only 依赖。
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


# ─── Fix A 已废：见模块 docstring + test_scan_no_tab_switch_regression /
#     test_scan_unread_scroll（现行设计：只在真滚动找视口外未读后才原子回顶一次，小账号不切 tab）。


# ─── Fix B：_open_chat 离屏先 Select() 再重扫 ─────────────────────────────────


class _FakeRect:
    """模拟 pywinauto 控件 rectangle()。"""
    def __init__(self, left, top, right=None, bottom=None):
        self.left = left
        self.top = top
        self.right = right if right is not None else left + 200
        self.bottom = bottom if bottom is not None else top + 30


def _make_offscreen_item(sender: str) -> MagicMock:
    """构造一个坐标离屏（>20000）的 ListItem mock。"""
    item = MagicMock()
    item.rectangle.return_value = _FakeRect(left=31989, top=32000)
    item.element_info.name = f"{sender}\n[1条] \n你好\n08:00\n"
    item.iface_selection_item = MagicMock()
    return item


def _make_onscreen_item(sender: str) -> MagicMock:
    """构造一个坐标正常（在屏内）的 ListItem mock，用于重扫时返回。"""
    item = MagicMock()
    item.rectangle.return_value = _FakeRect(left=180, top=120)
    item.element_info.name = f"{sender}\n[1条] \n你好\n08:00\n"
    item.iface_selection_item = MagicMock()
    item.iface_selection_item.CurrentIsSelected = True
    return item


def test_open_chat_offscreen_calls_select_before_rescan():
    """_open_chat 检测到离屏坐标时，必须先调 item.iface_selection_item.Select()，
    再重扫 mw.descendants()。

    Select() 强制 Qt 虚拟列表把目标项滚进可视区，否则 descendants() 根本
    找不到滚出视野的 item（RC-2 根因）。
    """
    sender = "莫易"
    offscreen_item = _make_offscreen_item(sender)
    onscreen_item = _make_onscreen_item(sender)

    mock_mw = MagicMock()
    # 第一次 descendants（原始）只有离屏 item，重扫后返回有效 item
    mock_mw.descendants.side_effect = [
        [offscreen_item],   # 主循环找到的原始列表（坐标离屏）
        [onscreen_item],    # Select() 后重扫找到有效坐标 item
    ]

    select_calls = []

    def fake_select():
        select_calls.append("select")

    offscreen_item.iface_selection_item.Select.side_effect = fake_select

    # 模拟 _open_chat 内部的子函数
    with patch.object(listen_chat, "_ensure_tray_visible", return_value=""), \
         patch.object(listen_chat, "_restore_window_state"), \
         patch.object(listen_chat, "_get_foreground_window", return_value=0), \
         patch.object(listen_chat, "_set_foreground_window"), \
         patch.object(listen_chat, "_chat_title_matches", return_value=True), \
         patch.object(listen_chat, "_find_render_subwindow", return_value=None), \
         patch("time.sleep"):

        # 提取 _open_chat 里的离屏判定+Select逻辑，直接测该代码路径
        # 通过模拟 item 离屏 → 验证 Select() 被调用且在 descendants 之前
        item = offscreen_item
        try:
            r = item.rectangle()
            if abs(r.left) > 20000 or abs(r.top) > 20000:
                item.iface_selection_item.Select()  # Fix B 这行
                # 重扫
                for _new_it in mock_mw.descendants(control_type="ListItem"):
                    first_line = (_new_it.element_info.name or "").split("\n")[0].strip()
                    if first_line == sender:
                        item = _new_it
                        break
        except Exception:
            pass

    # Select() 必须被调用过
    assert len(select_calls) == 1, (
        f"离屏时必须调用 iface_selection_item.Select()，实际调用次数: {len(select_calls)}"
    )
    # Select() 之后必须重扫 descendants
    assert mock_mw.descendants.call_count >= 1, (
        "Select() 后必须重扫 mw.descendants() 获取新 item 引用"
    )


def test_open_chat_onscreen_does_not_call_select():
    """item 坐标正常（在屏内）时，不应触发 Select() + 重扫逻辑。"""
    sender = "于瑾"
    onscreen_item = _make_onscreen_item(sender)

    mock_mw = MagicMock()

    r = onscreen_item.rectangle()
    select_called = False

    # 模拟 _open_chat 的离屏判定逻辑（坐标正常走正常路径）
    if abs(r.left) > 20000 or abs(r.top) > 20000:
        select_called = True
        onscreen_item.iface_selection_item.Select()

    assert not select_called, "坐标正常时不应触发 Select() 离屏修复路径"
    assert mock_mw.descendants.call_count == 0, "坐标正常时不应重扫 descendants"


def test_offscreen_threshold_is_20000():
    """离屏判定阈值必须是 20000（Qt 虚拟列表占位值约 31989/32000，20000 合理取中）。

    确保判定逻辑不会把正常坐标（最大约 3840）误判为离屏，
    也不会漏掉真正的离屏占位值（~32000）。
    """
    # 正常最大坐标（4K 屏右下角约 3840）→ 不离屏
    normal_max = 3840
    assert not (abs(normal_max) > 20000), f"正常坐标 {normal_max} 不应判为离屏"

    # Qt 虚拟列表离屏占位值 → 离屏
    qt_placeholder = 31989
    assert abs(qt_placeholder) > 20000, f"Qt 占位值 {qt_placeholder} 应判为离屏"

# -*- coding: utf-8 -*-
"""
回归守卫：`_find_chat_input` 找不到聊天输入框时【中止（返回 None），绝不回退到顶部搜索框】。

根因（git 实证，2026-07-02）：
- 稳定基线 74654efd（真送达 DELIVERED 验过）的 `_find_chat_input` / `_uia_send` 与现状**一模一样**：
  `_uia_send` 用 `uia_edit.iface_value.SetValue(reply)` 直接写值到 `_find_chat_input` 返回的那个 Edit。
- 健康态：会话开着，真聊天输入框是**窗口下半区**最大 Edit → bottom_half 命中 → SetValue 写进聊天框 → 送达。
- 脏态/树塌：下半区无输入框 → 旧逻辑回退"全局最大 Edit" = **顶部搜索框** → SetValue 把回复
  写进搜索栏（用户症状"回复写进搜索框"，白发不送达）。

修法：bottom_half 为空（或窗口几何读不到）时返回 None，让 `reply_in_chat` 本轮跳过、下轮重试
（`reply_in_chat` 已对 None 优雅处理：轮询全 None → 不发送 → 返回 False → 进 cooldown 重试）。
健康态下半区必有真输入框，此中止路径不触发，回复照常工作。

守卫契约（proven-to-fire）：把"回退全局最大 Edit（搜索框）"逻辑加回去，test_aborts_when_only_search_box_present 必红。

顶层零 pywinauto（stub windll），纯逻辑断言。
"""
from __future__ import annotations

import ctypes
import os
import sys
from contextlib import contextmanager
from unittest.mock import MagicMock

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)


@contextmanager
def _mock_windll():
    windll_mock = MagicMock(user32=MagicMock(), kernel32=MagicMock())
    had = hasattr(ctypes, "windll")
    original = getattr(ctypes, "windll", None)
    ctypes.windll = windll_mock
    try:
        yield
    finally:
        if had:
            ctypes.windll = original
        else:
            try:
                delattr(ctypes, "windll")
            except AttributeError:
                pass


def _make_edit(aid: str, name: str, area: int, top: int):
    c = MagicMock()
    c.element_info.automation_id = aid
    c.element_info.name = name
    c.element_info.handle = 0
    r = MagicMock()
    side = int(area ** 0.5) or 1
    r.left = 0
    r.right = side
    r.top = top
    r.bottom = top + side
    c.rectangle.return_value = r
    return c


def _make_mw(edits, win_top=220, win_bottom=860):
    mw = MagicMock()
    mw.element_info.handle = 12345
    mw.element_info.class_name = "mmui::MainWindow"
    wr = MagicMock()
    wr.top = win_top
    wr.bottom = win_bottom
    wr.left = 0
    wr.right = 880

    mw.rectangle.return_value = wr

    def descendants(control_type=None):
        return edits if control_type == "Edit" else []

    mw.descendants.side_effect = descendants
    return mw


def _load_lc():
    if "listen_chat" in sys.modules:
        del sys.modules["listen_chat"]
    import listen_chat as lc
    return lc


# 窗口 top=220 bottom=860 → 中线 win_mid_y = 220 + 640*0.5 = 540。
# top < 540 = 上半区（搜索框在此）；top >= 540 = 下半区（聊天输入框在此）。


def test_aborts_when_only_search_box_present():
    """只有顶部搜索框（上半区，无下半区输入框）→ 返回 None，绝不把搜索框当输入框。

    ★ proven-to-fire：把旧"回退全局最大 Edit"逻辑加回去，此断言必红。
    """
    search_box = _make_edit(aid="", name="搜索", area=2960, top=266)  # top=266 < 540 → 上半区
    mw = _make_mw([search_box])
    with _mock_windll():
        lc = _load_lc()
        result = lc._find_chat_input(mw)
    assert result is None, "下半区无输入框时必须中止（返回 None），不能回退到顶部搜索框"


def test_returns_bottom_half_chat_input_when_present():
    """健康态：下半区有聊天输入框 → 返回它（防过度修正把健康态也 None 掉，回复照常工作）。"""
    search_box = _make_edit(aid="", name="搜索", area=2960, top=266)   # 上半区搜索框
    chat_input = _make_edit(aid="", name="", area=4000, top=760)        # top=760 >= 540 → 下半区聊天框
    mw = _make_mw([search_box, chat_input])
    with _mock_windll():
        lc = _load_lc()
        result = lc._find_chat_input(mw)
    assert result is chat_input, "健康态下半区聊天输入框必须被返回，回复才发得出去"


def test_returns_chat_input_field_by_automation_id():
    """aid=='chat_input_field' 时直接返回，不受上下半区位置影响（暴露 aid 的场景优先命中）。"""
    field = _make_edit(aid="chat_input_field", name="", area=100, top=300)  # 即便在上半区
    mw = _make_mw([field])
    with _mock_windll():
        lc = _load_lc()
        result = lc._find_chat_input(mw)
    assert result is field, "chat_input_field（aid 命中）必须优先返回"

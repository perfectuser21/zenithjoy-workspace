# -*- coding: utf-8 -*-
"""判群标题读取几何根治（2026-07-16 xian-rog 真机：招商雍澜湾业主群被自动回复）。

根因：`_read_chat_header_texts` 用**绝对屏幕坐标**过滤标题 Text 控件
（`_HEADER_TOP_MAX=210` / `_HEADER_LEFT_MIN=460`）。微信窗口不在屏幕左上角时
（真机实测登录后主窗口位于 (1069,478)），标题区 Text 控件的绝对 top 远超过
210 上限 → 被过滤 → 返回 [] → 群判定拿不到任何信号 → 三道判群闸全部失效。

同一时刻 `_chat_title_matches` 用**相对窗口**坐标（`top < wr.top+150` 且
`left > wr.left + width//4`）能正常读到标题——这是本文件要求 `_read_chat_header_texts`
对齐的目标写法。

本文件是该 bug 的永久 regression test，禁止删除。
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

if "listen_chat" in sys.modules:
    del sys.modules["listen_chat"]

import listen_chat  # noqa: E402


class _Rect:
    def __init__(self, l, t, r, b):
        self.left, self.top, self.right, self.bottom = l, t, r, b


class _EI:
    def __init__(self, name=""):
        self.name = name


class _Text:
    def __init__(self, name, rect):
        self.element_info = _EI(name=name)
        self._rect = rect

    def rectangle(self):
        return self._rect


class _MW:
    """真机形态 Fake：微信主窗口不在屏幕左上角（真机实测 (1069,478)）。"""

    def __init__(self, win_rect, texts):
        self._rect = win_rect
        self._texts = texts

    def rectangle(self):
        return self._rect

    def descendants(self, control_type=None):
        if control_type == "Text":
            return list(self._texts)
        return []


def _mw_with_offscreen_window():
    """窗口偏移到屏幕中部（left=1069, top=478，同真机实测坐标）。

    标题 Text 控件的绝对坐标：top=520（相对窗口仅 top+42，在 `top<wr.top+150` 内），
    left=1200（相对窗口 left+131，在 `left > wr.left + width//4` 内）——
    用相对坐标能读到；旧的绝对坐标常量（top<210）会把它错误滤掉。
    """
    win_rect = _Rect(1069, 478, 1489, 1048)  # width=420
    header_text = _Text("招商雍澜湾业主群(497)", _Rect(1200, 520, 1450, 545))
    return _MW(win_rect, [header_text])


def test_read_chat_header_texts_uses_relative_not_absolute_coords():
    """★窗口不在屏幕左上角时，标题区文本必须仍被读到（相对窗口坐标）。"""
    mw = _mw_with_offscreen_window()
    texts = listen_chat._read_chat_header_texts(mw)
    assert texts, (
        "微信窗口偏移到屏幕中部时 _read_chat_header_texts 返回空——"
        "说明仍在用绝对屏幕坐标过滤，标题区被误滤掉（本次真机事故根因）"
    )
    assert any("招商雍澜湾业主群" in t for t in texts)


def test_read_chat_header_texts_group_detected_when_window_offscreen():
    """★端到端：窗口偏移时，判群结果也必须正确识别为群（不是私聊）。"""
    mw = _mw_with_offscreen_window()
    texts = listen_chat._read_chat_header_texts(mw)
    n = listen_chat._is_group_by_header(texts)
    assert n == 497, (
        f"窗口偏移到屏幕中部时应判定为群(497人)，实际判定结果={n!r}——"
        "绝对坐标过滤器让标题读取返回空，群判定退化成'无法判定'"
    )

# -*- coding: utf-8 -*-
"""read_chat_bubbles 守卫：读当前会话全部可见气泡（上→下有序 + 方向），几何全相对推导。

窗口 Fake (0,0)-(800,600)：chat_left=200，midline=500（同 test_msg_direction.py 约定）。
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import listen_chat


class _Rect:
    def __init__(self, l, t, r, b):
        self.left, self.top, self.right, self.bottom = l, t, r, b


class _EI:
    def __init__(self, name=""):
        self.name = name
        self.handle = 12345


class _Text:
    def __init__(self, name, rect):
        self.element_info = _EI(name=name)
        self._rect = rect

    def rectangle(self):
        return self._rect


class _MW:
    def __init__(self, texts, rect=None):
        self.element_info = _EI()
        self._texts = texts
        self._rect = rect or _Rect(0, 0, 800, 600)

    def rectangle(self):
        return self._rect

    def descendants(self, control_type=None):
        return list(self._texts) if control_type == "Text" else []


_TITLE = _Text("客户A", _Rect(300, 20, 600, 50))       # 标题区 top<150 → 排除
_LIST = _Text("客户A\n[2条]\n在吗\n12:00", _Rect(10, 80, 180, 130))  # 左列 → 排除


def test_ordered_top_to_bottom_with_direction():
    """乱序 descendants → 按 r.top 排序输出；左=incoming 右=outgoing。"""
    mw = _MW([
        _TITLE, _LIST,
        _Text("发下资料", _Rect(210, 480, 380, 520)),     # 下（新）incoming
        _Text("好的稍等", _Rect(600, 300, 770, 340)),     # 上（旧）outgoing
    ])
    assert listen_chat.read_chat_bubbles(mw) == [
        {"text": "好的稍等", "direction": "outgoing"},
        {"text": "发下资料", "direction": "incoming"},
    ]


def test_midline_and_empty_name():
    """压线判 outgoing（保守）；空 name 跳过。"""
    mw = _MW([_Text("压线", _Rect(420, 300, 580, 340)), _Text("", _Rect(210, 400, 380, 440))])
    assert listen_chat.read_chat_bubbles(mw) == [{"text": "压线", "direction": "outgoing"}]


def test_ghost_offscreen_returns_empty():
    """幽灵坐标（±32000）→ []（fail-closed；正常离屏 -2600 不受影响）。"""
    mw = _MW([_Text("在吗", _Rect(-31790, 480, -31620, 520))],
             rect=_Rect(-32000, -32000, -31200, -31400))
    assert listen_chat.read_chat_bubbles(mw) == []


def test_normal_offscreen_still_reads():
    """扫描态窗口在 OFFSCREEN_X=-2600：几何相对推导必须照常工作。"""
    mw = _MW([_Text("在吗", _Rect(-2390, 480, -2220, 520))],
             rect=_Rect(-2600, 60, -1800, 660))
    assert listen_chat.read_chat_bubbles(mw) == [{"text": "在吗", "direction": "incoming"}]

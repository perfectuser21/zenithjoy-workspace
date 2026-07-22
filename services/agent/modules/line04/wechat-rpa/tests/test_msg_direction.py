"""mock 气泡位置回归测试 — listen_chat._last_bubble_direction 读最底部气泡判左右对齐方向。

Line04「不回自己」：只对「对方发来(incoming / 左对齐)」回复，对「我方/AI/操作者
(outgoing / 右对齐)」与「读不到气泡(None)」跳过。6 case 对齐 sprint 独立 oracle（防假绿）：
incoming / outgoing / operator / last_bubble_wins / empty / midline。
顶层零-pywinauto 纯函数，纯 Fake 注入可测（同 _parse_item_name CI 锚点约定）。
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
    """窗口 (0,0)-(800,600)：chat_left=200，聊天面板中线=500。"""

    def __init__(self, texts):
        self.element_info = _EI()
        self._texts = texts

    def rectangle(self):
        return _Rect(0, 0, 800, 600)

    def descendants(self, control_type=None):
        return list(self._texts) if control_type == "Text" else []


# 标题区(top<顶+150)/会话列表(left<chat_left) → 都不算消息气泡
_TITLE = _Text("客户A", _Rect(300, 20, 600, 50))
_LIST = _Text("客户A\n[2条]\n在吗\n12:00", _Rect(10, 80, 180, 130))


def test_incoming_left_bubble():
    """最底部左对齐气泡 → "incoming"（对方发来，应回）。"""
    mw = _MW([_TITLE, _LIST, _Text("在吗在吗", _Rect(210, 480, 380, 520))])
    assert listen_chat._last_bubble_direction(mw) == "incoming"


def test_outgoing_right_bubble():
    """最底部右对齐气泡 → "outgoing"（我方/AI，跳过不回自己）。"""
    mw = _MW([_TITLE, _LIST, _Text("好的稍等", _Rect(600, 480, 770, 520))])
    assert listen_chat._last_bubble_direction(mw) == "outgoing"


def test_operator_rightmost_bubble():
    """操作者最右对齐气泡(最底部) → "outgoing"（据此 human_intervened=True 跳过，人工优先）。"""
    mw = _MW([
        _TITLE, _LIST,
        _Text("客户问题", _Rect(210, 300, 380, 340)),
        _Text("我手动回复了", _Rect(590, 500, 780, 540)),
    ])
    assert listen_chat._last_bubble_direction(mw) == "outgoing"


def test_last_bubble_wins():
    """多条气泡只认最底部那条（上 outgoing + 底 incoming → incoming）。"""
    mw = _MW([
        _TITLE,
        _Text("我先说的", _Rect(600, 300, 770, 340)),
        _Text("对方后回", _Rect(210, 500, 380, 540)),
    ])
    assert listen_chat._last_bubble_direction(mw) == "incoming"


def test_empty_no_bubble():
    """聊天面板无气泡 → None（安全跳过，宁可漏回不可回错）。"""
    mw = _MW([_TITLE, _LIST])
    assert listen_chat._last_bubble_direction(mw) is None


def test_midline_boundary():
    """气泡压中线 → "outgoing"（压线倾向判我方更安全）。"""
    mw = _MW([_TITLE, _Text("压线气泡", _Rect(420, 480, 580, 520))])
    assert listen_chat._last_bubble_direction(mw) == "outgoing"

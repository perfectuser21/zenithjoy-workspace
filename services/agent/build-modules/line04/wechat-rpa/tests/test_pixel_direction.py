# -*- coding: utf-8 -*-
"""像素判向守卫（2026-07-03 用户拍板，1.0.104）：

微信 4.x 把气泡"在左在右"从所有程序接口藏死（三层探针+raw view 实锤：
消息条目外框横跨全宽、内部零子元素）——位置信息物理上只存在于渲染像素里。
判向 = PrintWindow 内存取窗口画面（被遮挡也能取到自身内容）→ 每行消息在
右侧采样带找绿色气泡色块（微信自己发的绿泡 #95EC69 永远在右）→
有绿=outgoing，无绿=incoming。覆盖手机端以 B 身份发消息的场景
（前台判定/已发送历史都抓不到的最后漏洞）。

优先级：像素判向（capture 成功）＞ 已发送历史匹配（capture 失败兜底）。
本文件是像素判向的永久 regression test。
"""
import os
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import listen_chat


class _Rect:
    def __init__(self, l, t, r, b):
        self.left, self.top, self.right, self.bottom = l, t, r, b


class _EI:
    def __init__(self, name="", control_type=""):
        self.name = name
        self.control_type = control_type
        self.handle = 12345


class _MsgItem:
    def __init__(self, text, top):
        self.element_info = _EI(name=text, control_type="ListItem")
        self._rect = _Rect(729, top, 1269, top + 80)

    def rectangle(self):
        return self._rect


class _MsgList:
    def __init__(self, items):
        self.element_info = _EI(name="消息", control_type="List")
        self._items = items

    def rectangle(self):
        return _Rect(729, 199, 1269, 748)

    def children(self):
        return list(self._items)


class _MW:
    def __init__(self, items):
        self.element_info = _EI()
        self._list = _MsgList(items)

    def rectangle(self):
        return _Rect(91, 79, 1268, 928)

    def descendants(self, control_type=None):
        if control_type == "List":
            return [self._list]
        return []


class _FakeCapture:
    """假窗口画面：green_rows 里的行（窗口坐标 y）右侧采样带返回微信绿。"""

    def __init__(self, green_rows):
        self.green_rows = set(green_rows)

    def pixel(self, x, y):
        for gy in self.green_rows:
            if abs(y - gy) <= 40:
                return (149, 236, 105)  # 微信绿 #95EC69
        return (245, 245, 245)  # 背景灰


# ── 纯函数：绿泡识别 ───────────────────────────────────────────────────────────

def test_is_wechat_green_recognizes_bubble_color():
    assert listen_chat._is_wechat_green(149, 236, 105) is True   # 标准绿
    assert listen_chat._is_wechat_green(160, 230, 120) is True   # 近似绿
    assert listen_chat._is_wechat_green(245, 245, 245) is False  # 背景
    assert listen_chat._is_wechat_green(255, 255, 255) is False  # 白泡
    assert listen_chat._is_wechat_green(100, 100, 100) is False


# ── 像素判向接入 read_chat_bubbles ─────────────────────────────────────────────

def test_pixel_direction_marks_green_row_outgoing(monkeypatch):
    """右侧有绿色块的行 = outgoing（哪怕文本不在已发送历史里——手机发的场景）。"""
    listen_chat._SENT_TEXTS.clear()  # 历史为空：老机制会全判 incoming
    cap = _FakeCapture(green_rows=[340])  # 第二条消息行有绿泡
    monkeypatch.setattr(listen_chat, "_capture_window_pixels", lambda mw: cap)
    mw = _MW([
        _MsgItem("客户的问题", 220),
        _MsgItem("我用手机发的回复", 300),   # 行中心 y=340 → 绿
        _MsgItem("客户又问", 420),
    ])
    bubbles = listen_chat.read_chat_bubbles(mw)
    assert [b["direction"] for b in bubbles] == [
        "incoming", "outgoing", "incoming"], (
        f"绿泡行必须判 outgoing（手机发的 B 消息），实际 {bubbles!r}"
    )


def test_pixel_capture_failure_falls_back_to_sent_history(monkeypatch):
    """取画面失败（窗口最小化等）→ 回退已发送历史匹配（现有行为不退化）。"""
    monkeypatch.setattr(listen_chat, "_capture_window_pixels", lambda mw: None)
    listen_chat._SENT_TEXTS.clear()
    listen_chat._record_sent_text("机器人发过的话")
    mw = _MW([
        _MsgItem("客户的问题", 220),
        _MsgItem("机器人发过的话", 300),
    ])
    bubbles = listen_chat.read_chat_bubbles(mw)
    assert [b["direction"] for b in bubbles] == ["incoming", "outgoing"]


def test_pixel_direction_overrides_missing_history(monkeypatch):
    """像素判向优先：历史里没有的绿泡行也判 outgoing；无绿的行照常 incoming。"""
    listen_chat._SENT_TEXTS.clear()
    cap = _FakeCapture(green_rows=[240])
    monkeypatch.setattr(listen_chat, "_capture_window_pixels", lambda mw: cap)
    mw = _MW([_MsgItem("操作者手机插话", 200)])
    bubbles = listen_chat.read_chat_bubbles(mw)
    assert bubbles[0]["direction"] == "outgoing"


class _AllOutOfBoundsCapture:
    """像素全越界（返回 None）——模拟气泡 rect 超出窗口截图范围。"""

    def pixel(self, x, y):
        return None


def test_row_is_outgoing_all_pixels_oob_returns_none():
    """[RED→v1.0.109] 像素全越界时 _row_is_outgoing_by_pixels 必须返回 None（非 False）。

    根因（2026-07-06 bubble gate 连续 2 次 fail）：虚拟列表最新气泡 rect 底部可超出
    窗口截图边界（r.bottom > wr.bottom），导致右侧采样带全部 cap.pixel 返回 None，
    旧代码直接 return False → read_chat_bubbles 走 else 分支判 incoming，跳过
    _matches_any_sent 已发送历史回退 → marker_outgoing=False gate 报红。
    修正：全越界（any_valid=False）时返回 None，让调用方走回退路径。
    """
    cap = _AllOutOfBoundsCapture()
    result = listen_chat._row_is_outgoing_by_pixels(cap, 900, 940, 100, 800)
    assert result is None, (
        f"全像素越界时应返回 None（触发 _matches_any_sent 回退），实际返回 {result!r}"
    )


def test_row_is_outgoing_all_pixels_oob_falls_back_to_sent_history(monkeypatch):
    """[RED→v1.0.109] 全越界时 read_chat_bubbles 必须回退 _matches_any_sent 判向。

    场景：气泡 rect 底部超出窗口截图边界（全采样点 out-of-bounds），历史里有该文本
    → 必须判 outgoing（而非 incoming）。
    """
    listen_chat._SENT_TEXTS.clear()
    listen_chat._record_sent_text("刚发的最新消息")

    cap = _AllOutOfBoundsCapture()
    monkeypatch.setattr(listen_chat, "_capture_window_pixels", lambda mw: cap)

    mw = _MW([_MsgItem("刚发的最新消息", 200)])
    bubbles = listen_chat.read_chat_bubbles(mw)
    assert bubbles[0]["direction"] == "outgoing", (
        "全像素越界时必须回退已发送历史判向 outgoing，"
        f"实际 {bubbles[0]['direction']!r}"
    )

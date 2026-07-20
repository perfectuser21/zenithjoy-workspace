# -*- coding: utf-8 -*-
"""bug5 观测：角标缺失（预览变化触发但无 [N条] 角标）计数守卫。

现场（issue 30c9ce74）：客户发消息但 ListItem name 里 [N条] 角标时有时无。scan_unread
的预览变化 fallback（elif prev != name）已能兜底触发（消息不丢），本 task 只加观测——
命中该分支即计一次 badge-miss，轮尾按"与上轮不同才打"节流打一行 [scan] badge-miss，
给深查留数据。

守卫契约：消息仍进结果（不丢）+ badge-miss 计数增加（_LAST_BADGE_MISS_COUNT）。
顶层零 pywinauto，monkeypatch 打开/读气泡。
"""
import os
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import listen_chat


class _EI:
    def __init__(self, name=""):
        self.name = name
        self.handle = 12345


class _Item:
    def __init__(self, name):
        self.element_info = _EI(name=name)


class _MW:
    def __init__(self, items):
        self.element_info = _EI()
        self._items = items

    def rectangle(self):
        class _R:
            left, top, right, bottom = 0, 0, 800, 600
        return _R()

    def descendants(self, control_type=None):
        if control_type == "ListItem":
            return list(self._items)
        return []


@pytest.fixture(autouse=True)
def _no_window_ops(monkeypatch):
    monkeypatch.setattr(listen_chat, "_ensure_tray_visible", lambda mw: "")
    monkeypatch.setattr(listen_chat, "_restore_window_state", lambda mw, s: None)
    monkeypatch.setattr(listen_chat, "_read_chat_header_texts", lambda mw: ["客户"])
    monkeypatch.setattr(listen_chat, "_chat_title_matches", lambda mw, s: True)
    monkeypatch.setattr(listen_chat.time, "sleep", lambda s: None)
    listen_chat._KNOWN_GROUPS.clear()
    listen_chat._ANCHOR_STALL.clear()
    listen_chat._LAST_BADGE_MISS_COUNT = -1


def test_preview_change_no_badge_still_delivers_and_counts(monkeypatch):
    """无 [N条] 角标但预览变了 → 消息仍进结果 且 badge-miss 计数 +1。"""
    monkeypatch.setattr(listen_chat, "_open_chat",
                        lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "您好99元", "direction": "outgoing"},
        {"text": "我想买好产品", "direction": "incoming"},
    ])
    last_preview = {"默忆": "默忆\n在吗\n14:40\n"}
    mw = _MW([_mk("默忆\n我想买好产品\n14:43\n")])
    out = listen_chat.scan_unread(mw, last_preview)
    assert [m["content"] for m in out] == ["我想买好产品"], "预览变化消息不能丢"
    assert listen_chat._LAST_BADGE_MISS_COUNT == 1, "无角标触发必须计入 badge-miss"


def test_badge_session_does_not_count_miss(monkeypatch):
    """有 [N条] 角标的正常会话 → 不计 badge-miss（保持 0）。"""
    monkeypatch.setattr(listen_chat, "_open_chat",
                        lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "您好99元", "direction": "outgoing"},
        {"text": "发下资料", "direction": "incoming"},
    ])
    mw = _MW([_mk("默忆\n[1条] \n发下资料\n14:43\n")])
    listen_chat.scan_unread(mw, {})
    assert listen_chat._LAST_BADGE_MISS_COUNT == 0, "角标会话不应计入 badge-miss"


def _mk(name):
    return _Item(name)

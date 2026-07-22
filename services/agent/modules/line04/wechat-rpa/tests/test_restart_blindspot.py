# -*- coding: utf-8 -*-
"""重启盲区守卫（2026-07-03 10:19 真机实况，1.0.101）：

监听进程重启（OTA/自愈/preflight 都会触发）后 last_preview 内存态清空 →
发现层"首见只记录不触发"把重启前后进来的客户消息当成基线 → 永不触发 →
用户体感"不理我了"（10:19:50 重启，用户消息正好挂在窗口里）。

修法：首见 seed 时不再无脑静默——对**活跃会话**（sender 在持久化的
_REPLY_ANCHOR 里=聊过且回过），若预览内容 ①不命中已发送历史（不是我方
回复）②不等于锚点文本（不是已回过的那条）→ 说明有未处理的客户消息，
直接入候选触发。非活跃会话保持静默 seed（防重启风暴翻陈年消息）。
本文件是该盲区的永久 regression test。
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
    def __init__(self, name="", control_type=""):
        self.name = name
        self.control_type = control_type
        self.handle = 12345


class _Item:
    def __init__(self, name):
        self.element_info = _EI(name=name, control_type="ListItem")


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
def _env(monkeypatch):
    monkeypatch.setattr(listen_chat, "_ensure_tray_visible", lambda mw: "")
    monkeypatch.setattr(listen_chat, "_restore_window_state", lambda mw, s: None)
    monkeypatch.setattr(listen_chat, "_chat_title_matches", lambda mw, s: True)
    monkeypatch.setattr(listen_chat, "_read_chat_header_texts", lambda mw: ["默忆"])
    monkeypatch.setattr(listen_chat, "_open_chat",
                        lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat.time, "sleep", lambda s: None)
    monkeypatch.setattr(listen_chat, "_jiggle_msg_list", lambda mw: None)
    listen_chat._KNOWN_GROUPS.clear()
    listen_chat._TRAILING_STALL.clear()


def test_restart_seed_triggers_pending_message_for_active_sender(monkeypatch):
    """重启后首轮扫描：活跃会话（有锚点）预览=未处理的客户消息 → 必须触发，
    不能静默 seed（10:19 实况：用户消息挂在窗口里永远没人理）。"""
    listen_chat._REPLY_ANCHOR.clear()
    listen_chat._REPLY_ANCHOR["默忆"] = "那 5000 呢"  # 活跃会话（回过）
    listen_chat._record_sent_text("5000的话，能做的就多了。")
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "那 5000 呢", "direction": "incoming"},
        {"text": "5000的话，能做的就多了。", "direction": "outgoing"},
        {"text": "重启期间发的消息", "direction": "incoming"},
    ])
    mw = _MW([_Item("默忆\n重启期间发的消息\n10:19\n")])
    last_preview = {}  # 重启：内存清空
    out = listen_chat.scan_unread(mw, last_preview)
    assert out and out[0]["sender"] == "默忆", (
        "活跃会话的未处理消息在重启首轮必须触发（重启盲区）"
    )
    assert "重启期间发的消息" in out[0]["content"]


def test_restart_seed_stays_silent_when_preview_is_own_reply(monkeypatch):
    """重启后预览=我方最后回复（正常情况）→ 静默 seed，不触发不开窗。"""
    listen_chat._REPLY_ANCHOR.clear()
    listen_chat._REPLY_ANCHOR["默忆"] = "那 5000 呢"
    own = "5000的话，能做的就多了。"
    listen_chat._record_sent_text(own)
    opened = []
    monkeypatch.setattr(listen_chat, "_open_chat",
                        lambda mw, it, s, expect_content="": opened.append(1) or True)
    mw = _MW([_Item(f"默忆\n{own}\n10:18\n")])
    last_preview = {}
    out = listen_chat.scan_unread(mw, last_preview)
    assert not out and not opened, "预览=我方回复 → 静默 seed 不开窗"
    assert "默忆" in last_preview


def test_restart_seed_stays_silent_for_inactive_sender(monkeypatch):
    """非活跃会话（没锚点=从没回过）→ 保持静默 seed（防重启翻陈年消息风暴）。"""
    listen_chat._REPLY_ANCHOR.clear()
    opened = []
    monkeypatch.setattr(listen_chat, "_open_chat",
                        lambda mw, it, s, expect_content="": opened.append(1) or True)
    mw = _MW([_Item("陌生人\n三个月前的老消息\n05-01\n")])
    last_preview = {}
    out = listen_chat.scan_unread(mw, last_preview)
    assert not out and not opened

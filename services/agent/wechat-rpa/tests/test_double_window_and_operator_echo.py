# -*- coding: utf-8 -*-
"""两 bug 守卫（2026-07-03 用户指定，1.0.103）：

Bug1 双弹窗：扫描"弹出→读完收回→回复再弹出→再收回"，一轮两次弹/收，慢且晃眼。
  修：scan_unread 有 emit 时**不收窗**（orig_state 存 _SCAN_WINDOW_STATE），
  主循环回完本轮调 _finish_scan_window 统一收一次。

Bug2 操作者自话被回：操作者手动打字必然微信在前台（人在操作），而机器人操作
  从不留前台（焦点归还）。修：扫描开始采样前台——前台=微信 → 本轮预览变化
  视为人工接管：不 emit、提交触发、锚点推进过操作者文本（之后客户消息照常回）。
  角标路径（真未读客户消息）不受影响。

本文件是两 bug 的永久 regression test。
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
    monkeypatch.setattr(listen_chat, "_ensure_tray_visible", lambda mw: "tray")
    monkeypatch.setattr(listen_chat, "_chat_title_matches", lambda mw, s: True)
    monkeypatch.setattr(listen_chat, "_read_chat_header_texts", lambda mw: ["默忆"])
    monkeypatch.setattr(listen_chat, "_open_chat",
                        lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "_jiggle_msg_list", lambda mw: None)
    monkeypatch.setattr(listen_chat, "_wechat_is_foreground", lambda mw: False)
    monkeypatch.setattr(listen_chat.time, "sleep", lambda s: None)
    listen_chat._KNOWN_GROUPS.clear()
    listen_chat._TRAILING_STALL.clear()
    listen_chat._SCAN_WINDOW_STATE = ""


# ── Bug1：有 emit 不收窗，主循环统一收 ─────────────────────────────────────────

def test_scan_keeps_window_when_emitting(monkeypatch):
    """扫描有 emit → 不调 _restore_window_state（回复接着用同一次弹出）。"""
    restored = []
    monkeypatch.setattr(listen_chat, "_restore_window_state",
                        lambda mw, s: restored.append(s))
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "旧回复", "direction": "outgoing"},
        {"text": "在吗", "direction": "incoming"},
    ])
    mw = _MW([_Item("默忆\n[1条] \n在吗\n15:00\n")])
    out = listen_chat.scan_unread(mw, {})
    assert out, "前置：有 emit"
    assert not restored, "有 emit 时扫描绝不能收窗（双弹窗 bug）"
    assert listen_chat._SCAN_WINDOW_STATE == "tray", "orig_state 须暂存待回复后统一收"
    # 主循环回完 → 统一收一次
    listen_chat._finish_scan_window(mw)
    assert restored == ["tray"]
    assert listen_chat._SCAN_WINDOW_STATE == ""


def test_scan_restores_window_when_nothing_to_emit(monkeypatch):
    """无 emit → 维持旧行为：扫完立即收窗。"""
    restored = []
    monkeypatch.setattr(listen_chat, "_restore_window_state",
                        lambda mw, s: restored.append(s))
    mw = _MW([])
    out = listen_chat.scan_unread(mw, {})
    assert not out
    assert restored == ["tray"]


def test_finish_scan_window_idempotent(monkeypatch):
    """_finish_scan_window 空状态时是 no-op（可安全放在轮尾无条件调用）。"""
    restored = []
    monkeypatch.setattr(listen_chat, "_restore_window_state",
                        lambda mw, s: restored.append(s))
    listen_chat._SCAN_WINDOW_STATE = ""
    listen_chat._finish_scan_window(_MW([]))
    assert not restored


# ── Bug2：操作者前台 = 人工接管 ────────────────────────────────────────────────

def test_operator_foreground_suppresses_preview_trigger(monkeypatch):
    """前台=微信（操作者在打字）→ 预览变化不 emit、提交触发、锚点推进过操作者文本。"""
    monkeypatch.setattr(listen_chat, "_wechat_is_foreground", lambda mw: True)
    opened = []
    monkeypatch.setattr(listen_chat, "_open_chat",
                        lambda mw, it, s, expect_content="": opened.append(1) or True)
    monkeypatch.setattr(listen_chat, "_restore_window_state", lambda mw, s: None)
    listen_chat._REPLY_ANCHOR.clear()
    listen_chat._REPLY_ANCHOR["默忆"] = "老问题"
    mw = _MW([_Item("默忆\n我是操作者手动打的话\n15:01\n")])
    last_preview = {"默忆": "默忆\n老问题\n14:59\n"}
    out = listen_chat.scan_unread(mw, last_preview)
    assert not out, "操作者在前台打字，绝不能把他的话当客户消息回（人工优先）"
    assert not opened, "人工接管时连窗都不该开"
    assert last_preview["默忆"] == "默忆\n我是操作者手动打的话\n15:01\n", "触发须提交"
    assert listen_chat._REPLY_ANCHOR["默忆"] == "我是操作者手动打的话", (
        "锚点须推进过操作者文本，否则之后客户消息的 trailing 会把它带回来"
    )


def test_operator_foreground_does_not_block_badge_messages(monkeypatch):
    """角标路径（真未读客户消息）不受前台判定影响，照常回。"""
    monkeypatch.setattr(listen_chat, "_wechat_is_foreground", lambda mw: True)
    monkeypatch.setattr(listen_chat, "_restore_window_state", lambda mw, s: None)
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "旧回复", "direction": "outgoing"},
        {"text": "客户新消息", "direction": "incoming"},
    ])
    listen_chat._REPLY_ANCHOR.clear()
    mw = _MW([_Item("默忆\n[1条] \n客户新消息\n15:02\n")])
    out = listen_chat.scan_unread(mw, {})
    assert out and "客户新消息" in out[0]["content"]


def test_background_preview_trigger_still_works(monkeypatch):
    """前台≠微信（正常情况）→ 预览变化照常触发回复。"""
    monkeypatch.setattr(listen_chat, "_restore_window_state", lambda mw, s: None)
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "旧回复", "direction": "outgoing"},
        {"text": "客户又说了话", "direction": "incoming"},
    ])
    listen_chat._REPLY_ANCHOR.clear()
    mw = _MW([_Item("默忆\n客户又说了话\n15:03\n")])
    last_preview = {"默忆": "默忆\n旧回复\n15:02\n"}
    out = listen_chat.scan_unread(mw, last_preview)
    assert out and "客户又说了话" in out[0]["content"]

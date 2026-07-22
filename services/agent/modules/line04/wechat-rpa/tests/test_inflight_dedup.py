# -*- coding: utf-8 -*-
"""处理中去重守卫（2026-07-03 17:47 生产实录，1.0.106）：

扫描 1s + 冷却 2s 后暴露的竞态：emit → 草稿生成+发送要 5~10s，期间每秒扫描
把同一 trailing 重复 emit → 同一条客户消息被连回 3 遍（"我想买30w"14 秒 3 条
相似回复，客户观感=复读机）。旧 30s 冷却把窗口盖住了，提速后露出。

修法：_INFLIGHT 会话级"处理中"标记——scan_unread emit 某 sender 后置位，
主循环该消息处理完（DELIVERED/失败/跳过）清除；置位期间该 sender 不进候选
（不开窗不 emit）。本文件是复读竞态的永久 regression test。
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
    monkeypatch.setattr(listen_chat, "_jiggle_msg_list", lambda mw: None)
    monkeypatch.setattr(listen_chat, "_wechat_is_foreground", lambda mw: False)
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "旧回复", "direction": "outgoing"},
        {"text": "我想买30w", "direction": "incoming"},
    ])
    monkeypatch.setattr(listen_chat.time, "sleep", lambda s: None)
    listen_chat._KNOWN_GROUPS.clear()
    listen_chat._TRAILING_STALL.clear()
    listen_chat._INFLIGHT.clear()
    listen_chat._REPLY_ANCHOR.clear()
    listen_chat._SENT_TEXTS.clear()


def _mk_mw():
    return _MW([_Item("默忆\n[1条] \n我想买30w\n17:47\n")])


def test_second_scan_does_not_reemit_while_inflight():
    """第一轮 emit 后（处理中），第二轮扫描绝不重复 emit 同一会话——
    17:47 实录：发送要 5-10s，1s 扫描把同一条消息连报 3 次 → 客户被复读 3 遍。"""
    out1 = listen_chat.scan_unread(_mk_mw(), {})
    assert out1 and out1[0]["sender"] == "默忆", "前置：第一轮正常 emit"
    out2 = listen_chat.scan_unread(_mk_mw(), {})
    assert not out2, f"处理中（未 DELIVERED/未失败）绝不重复 emit，实际 {out2!r}"


def test_inflight_cleared_on_delivered_allows_next_message():
    """DELIVERED 提交后清除处理中标记 → 后续新消息照常触发。"""
    out1 = listen_chat.scan_unread(_mk_mw(), {})
    assert out1
    listen_chat._commit_reply_success(out1[0], {})
    assert "默忆" not in listen_chat._INFLIGHT
    # 客户又发新消息（气泡多一条）→ 正常 emit
    import types
    listen_chat.read_chat_bubbles = lambda mw: [
        {"text": "旧回复", "direction": "outgoing"},
        {"text": "我想买30w", "direction": "incoming"},
        {"text": "新问题", "direction": "incoming"},
    ]
    out2 = listen_chat.scan_unread(
        _MW([_Item("默忆\n[1条] \n新问题\n17:48\n")]), {})
    assert out2, "DELIVERED 后新消息必须照常触发"


def test_release_inflight_on_failure_allows_retry():
    """发送失败/草稿失败 → _release_inflight 清标记 → 下轮可重试（不丢消息）。"""
    out1 = listen_chat.scan_unread(_mk_mw(), {})
    assert out1
    listen_chat._release_inflight("默忆")
    out2 = listen_chat.scan_unread(_mk_mw(), {})
    assert out2, "失败释放后必须能重试（宁可迟到不可丢）"

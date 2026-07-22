# -*- coding: utf-8 -*-
"""发送失败后角标已清导致冷却重试永远不触发、消息永久静默丢失（2026-07-08 rog 生产实测）。

根因：_open_chat（打开会话尝试回复）本身会让微信清掉原生未读角标。发送失败后原来只把
reply_failed_at[key] 记进一个依赖 scan_unread 每轮重新探测到 unread 才会被求值的冷却表——
一旦角标被清掉，这条消息永远不会再出现在 unread 里，冷却重试条件永远没机会被求值，
消息被永久丢弃，且没有任何后续告警真正执行。

修法：新增独立于 scan_unread/unread 角标检测的待重试队列 _PENDING_RETRY + select_due_retries
纯函数，主循环每轮独立检查这个队列，不依赖角标重新出现。

本文件是这个修复的永久 regression test。
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import listen_chat


def test_select_due_retries_returns_sender_after_cooldown_even_without_unread():
    """核心证明：即使 unread 列表完全不含该 sender（角标已清），到期的待重试队列条目依然会被选中。"""
    pending = {
        "默忆": {"content": "你叫什么", "reply": "我们叫悦升云端", "failed_at": 1000.0, "attempts": 1},
    }
    due = listen_chat.select_due_retries(pending, now=1061.0, cooldown_seconds=60.0)
    assert due == ["默忆"], "冷却已过期的 sender 必须被选中重试，不依赖 unread 角标"


def test_select_due_retries_skips_before_cooldown():
    pending = {
        "默忆": {"content": "你叫什么", "reply": "我们叫悦升云端", "failed_at": 1000.0, "attempts": 1},
    }
    due = listen_chat.select_due_retries(pending, now=1030.0, cooldown_seconds=60.0)
    assert due == [], "冷却未到期不应重试（防抖）"


def test_select_due_retries_multiple_senders_independent_cooldown():
    pending = {
        "默忆": {"content": "a", "reply": "r1", "failed_at": 1000.0, "attempts": 1},
        "苏小妖": {"content": "b", "reply": "r2", "failed_at": 1050.0, "attempts": 1},
    }
    due = listen_chat.select_due_retries(pending, now=1061.0, cooldown_seconds=60.0)
    assert due == ["默忆"], "每个 sender 独立计算冷却，未到期的不选中"


def test_record_reply_failure_adds_to_pending_queue():
    pending = {}
    listen_chat.record_reply_failure(
        pending, sender="默忆", content="你叫什么", reply="我们叫悦升云端", now=1000.0)
    assert "默忆" in pending
    assert pending["默忆"]["content"] == "你叫什么"
    assert pending["默忆"]["reply"] == "我们叫悦升云端"
    assert pending["默忆"]["attempts"] == 1


def test_record_reply_failure_increments_attempts_on_repeat():
    pending = {}
    listen_chat.record_reply_failure(pending, sender="默忆", content="a", reply="r", now=1000.0)
    listen_chat.record_reply_failure(pending, sender="默忆", content="a", reply="r", now=1070.0)
    assert pending["默忆"]["attempts"] == 2
    assert pending["默忆"]["failed_at"] == 1070.0, "重试仍失败要刷新 failed_at，用于下一轮冷却计时"


def test_record_reply_failure_gives_up_after_max_attempts():
    """连续失败达上限（3次）→ 从队列移除，不再无限重试卡死。"""
    pending = {}
    listen_chat.record_reply_failure(pending, sender="默忆", content="a", reply="r", now=1000.0)
    listen_chat.record_reply_failure(pending, sender="默忆", content="a", reply="r", now=1070.0)
    listen_chat.record_reply_failure(pending, sender="默忆", content="a", reply="r", now=1140.0)
    assert "默忆" not in pending, "达到最大重试次数应放弃（防止无限重试卡死），交由关键人告警兜底"


def test_clear_pending_retry_on_success():
    pending = {"默忆": {"content": "a", "reply": "r", "failed_at": 1000.0, "attempts": 1}}
    listen_chat.clear_pending_retry(pending, sender="默忆")
    assert "默忆" not in pending

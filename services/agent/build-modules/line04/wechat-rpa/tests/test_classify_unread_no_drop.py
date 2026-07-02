# -*- coding: utf-8 -*-
"""
回归守卫：客户消息绝不静默丢弃——去重(is_dup)排在 sender_cooldown/replied/fail 之后。

根因（2026-07-02 查证 auto_reply.py is_duplicate 一读就标记 seen）：
主循环 eligible 过滤旧顺序把 is_duplicate 排在 sender_cooldown 之前。一条消息第一次被读到时
若正撞 30s sender 冷却 → 先被去重标记成"见过"、再被冷却跳过（没回）→ 之后每轮重读都被 dup
永久丢弃 → 永不回复（用户症状"连发两条只回一条，被丢的那条再也不回"）。

修法：classify_unread 把两个【有副作用】的检查用惰性 callable 传入，只在走到才调用：
- is_dup（标记型）放 cooldown/replied/fail 【之后】、rate 【之前】；
- rate_check（消费型，True 时扣额度）放【最后】。
被前置关卡跳过的消息不触发 is_dup 标记、也不消费 rate → 下轮条件解除后照常可回（能晚回、绝不丢）。

守卫契约（proven-to-fire）：把 is_dup 挪回 sender_cooldown 之前，test_cooldown_does_not_consume_dedup 必红。
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

import listen_chat as lc  # noqa: E402


def _spy(returns):
    """返回 (callable, calls)：calls[0] 记录调用次数，用于断言'未被调用=未产生副作用'。"""
    calls = [0]

    def _fn():
        calls[0] += 1
        return returns

    return _fn, calls


def _ok_rate():
    return (True, None)


def test_cooldown_does_not_consume_dedup():
    """撞 sender 冷却 → 'sender_cooldown' 且 is_dup 【绝不被调用】（不标记 → 下轮可重试，绝不丢）。

    ★ proven-to-fire：把去重挪回冷却之前，此断言必红。
    """
    is_dup, dup_calls = _spy(False)
    rate, rate_calls = _spy((True, None))
    reason, _ = lc.classify_unread(
        roster_gate_on=False,
        roster_should_reply=True,
        in_sender_cooldown=True,
        already_replied=False,
        in_fail_cooldown=False,
        is_dup=is_dup,
        rate_check=rate,
    )
    assert reason == "sender_cooldown"
    assert dup_calls[0] == 0, "撞冷却时 is_dup 绝不能被调用（否则消息被标记后永久丢弃）"
    assert rate_calls[0] == 0, "撞冷却时不应消费频控额度"


def test_eligible_marks_dedup_and_consumes_rate():
    """全部通过 → 'eligible'，is_dup 调用一次(标记,在途保护)、rate 调用一次(扣额度)。"""
    is_dup, dup_calls = _spy(False)
    rate, rate_calls = _spy((True, None))
    reason, _ = lc.classify_unread(
        roster_gate_on=False,
        roster_should_reply=True,
        in_sender_cooldown=False,
        already_replied=False,
        in_fail_cooldown=False,
        is_dup=is_dup,
        rate_check=rate,
    )
    assert reason == "eligible"
    assert dup_calls[0] == 1
    assert rate_calls[0] == 1


def test_genuine_reread_is_dup_before_rate():
    """同一轮 UIA 重复读(is_dup True) → 'dup'，且 rate 【不被调用】(重复读不浪费额度)。"""
    is_dup, dup_calls = _spy(True)
    rate, rate_calls = _spy((True, None))
    reason, _ = lc.classify_unread(
        roster_gate_on=False,
        roster_should_reply=True,
        in_sender_cooldown=False,
        already_replied=False,
        in_fail_cooldown=False,
        is_dup=is_dup,
        rate_check=rate,
    )
    assert reason == "dup"
    assert dup_calls[0] == 1
    assert rate_calls[0] == 0, "重复读应在 rate 之前被挡，不浪费频控额度"


def test_rate_limited_returns_next_at():
    """频控满 → 'rate_limited' 且带 next_at（rate 是最后一关，仅为通过前置的真消息扣额度）。"""
    is_dup, dup_calls = _spy(False)
    rate, _ = _spy((False, "2026-07-02T05:00:00Z"))
    reason, next_at = lc.classify_unread(
        roster_gate_on=False,
        roster_should_reply=True,
        in_sender_cooldown=False,
        already_replied=False,
        in_fail_cooldown=False,
        is_dup=is_dup,
        rate_check=rate,
    )
    assert reason == "rate_limited"
    assert next_at == "2026-07-02T05:00:00Z"
    assert dup_calls[0] == 1  # dup 在 rate 之前已调用


def test_order_roster_first_no_side_effects():
    """名单门命中 → 'roster_gate'，最高优先，is_dup / rate 都不被调用。"""
    is_dup, dup_calls = _spy(False)
    rate, rate_calls = _spy((True, None))
    reason, _ = lc.classify_unread(
        roster_gate_on=True,
        roster_should_reply=False,
        in_sender_cooldown=True,
        already_replied=True,
        in_fail_cooldown=True,
        is_dup=is_dup,
        rate_check=rate,
    )
    assert reason == "roster_gate"
    assert dup_calls[0] == 0 and rate_calls[0] == 0


def test_order_replied_before_dedup():
    """已回过 → 'replied'（在去重之前命中，is_dup 不被调用 → 不影响后续同内容新消息）。"""
    is_dup, dup_calls = _spy(False)
    reason, _ = lc.classify_unread(
        roster_gate_on=False,
        roster_should_reply=True,
        in_sender_cooldown=False,
        already_replied=True,
        in_fail_cooldown=False,
        is_dup=is_dup,
        rate_check=_ok_rate,
    )
    assert reason == "replied"
    assert dup_calls[0] == 0

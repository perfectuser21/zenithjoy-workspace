# -*- coding: utf-8 -*-
"""
回归守卫：客户消息绝不静默丢弃——去重(is_dup)必须是过滤的【最后一关】。

根因（2026-07-02 查证 auto_reply.py is_duplicate 一读就标记 seen）：
主循环 eligible 过滤旧顺序把 is_duplicate 排在 sender_cooldown/rate 之前。一条消息第一次
被读到时若正撞 30s sender 冷却 → 先被去重标记成"见过"、再被冷却跳过（没回）→ 之后每轮重读
都被 dup 永久丢弃 → 永不回复（用户症状"连发两条只回一条，被丢的那条再也不回"）。

修法：classify_unread 把 is_dup 放最后一关，且 is_dup 是【有标记副作用的 callable，只在走到
最后才调用】。被冷却/频控/已回等前置关卡跳过的消息不触发去重标记 → 下轮条件解除后照常可回
（能晚回、绝不静默丢）。去重仍挡"同一轮 UIA 重复读"，在途双回保护不变。

守卫契约（proven-to-fire）：把 is_dup 挪回冷却之前（或在冷却跳过时也调用 is_dup），
test_cooldown_does_not_consume_dedup 必红。
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

import listen_chat as lc  # noqa: E402


def _dup_spy(returns=False):
    """返回一个 (callable, calls) — calls[0] 记录被调用次数，用于断言'未被调用=未标记'。"""
    calls = [0]

    def _fn():
        calls[0] += 1
        return returns

    return _fn, calls


def test_cooldown_does_not_consume_dedup():
    """撞 sender 冷却 → 返回 'sender_cooldown' 且 is_dup 【绝不被调用】（不标记 → 下轮可重试，绝不丢）。

    ★ proven-to-fire：把去重挪回冷却之前，此断言必红。
    """
    is_dup, calls = _dup_spy(returns=False)
    reason = lc.classify_unread(
        roster_gate_on=False,
        roster_should_reply=True,
        in_sender_cooldown=True,   # 撞冷却
        already_replied=False,
        in_fail_cooldown=False,
        rate_ok=True,
        is_dup=is_dup,
    )
    assert reason == "sender_cooldown"
    assert calls[0] == 0, "撞冷却时 is_dup 绝不能被调用（否则消息被标记后永久丢弃）"


def test_rate_limited_does_not_consume_dedup():
    """撞频控 → 返回 'rate_limited' 且 is_dup 不被调用（频控解除后仍可回，不丢）。"""
    is_dup, calls = _dup_spy(returns=False)
    reason = lc.classify_unread(
        roster_gate_on=False,
        roster_should_reply=True,
        in_sender_cooldown=False,
        already_replied=False,
        in_fail_cooldown=False,
        rate_ok=False,   # 频控满
        is_dup=is_dup,
    )
    assert reason == "rate_limited"
    assert calls[0] == 0, "频控跳过时 is_dup 不能被调用（否则消息被永久丢弃）"


def test_eligible_marks_dedup_once():
    """全部条件通过 → 返回 'eligible' 且 is_dup 被调用一次（在途双回保护：eligible 消息必标记）。"""
    is_dup, calls = _dup_spy(returns=False)
    reason = lc.classify_unread(
        roster_gate_on=False,
        roster_should_reply=True,
        in_sender_cooldown=False,
        already_replied=False,
        in_fail_cooldown=False,
        rate_ok=True,
        is_dup=is_dup,
    )
    assert reason == "eligible"
    assert calls[0] == 1, "eligible 消息必须调用 is_dup 标记一次（在途重复读保护）"


def test_genuine_reread_is_dup():
    """同一轮 UIA 重复读（is_dup 返回 True）→ 返回 'dup'（去重仍生效）。"""
    is_dup, calls = _dup_spy(returns=True)
    reason = lc.classify_unread(
        roster_gate_on=False,
        roster_should_reply=True,
        in_sender_cooldown=False,
        already_replied=False,
        in_fail_cooldown=False,
        rate_ok=True,
        is_dup=is_dup,
    )
    assert reason == "dup"
    assert calls[0] == 1


def test_order_roster_first():
    """名单门命中 → 'roster_gate'，最高优先，is_dup 不被调用。"""
    is_dup, calls = _dup_spy(returns=False)
    reason = lc.classify_unread(
        roster_gate_on=True,
        roster_should_reply=False,   # 不在名单
        in_sender_cooldown=True,
        already_replied=True,
        in_fail_cooldown=True,
        rate_ok=False,
        is_dup=is_dup,
    )
    assert reason == "roster_gate"
    assert calls[0] == 0


def test_order_replied_before_dedup():
    """已回过 → 'replied'（在去重之前命中，is_dup 不被调用）。"""
    is_dup, calls = _dup_spy(returns=False)
    reason = lc.classify_unread(
        roster_gate_on=False,
        roster_should_reply=True,
        in_sender_cooldown=False,
        already_replied=True,
        in_fail_cooldown=False,
        rate_ok=True,
        is_dup=is_dup,
    )
    assert reason == "replied"
    assert calls[0] == 0

# -*- coding: utf-8 -*-
"""
TDD — 气泡 gate 恢复重试次数不足（issue b237a4b6，2026-07-24 rog 真机截图+UIA 实证）。

真因：CI self-hosted runner（rog）和生产 line04-wechat-cs 监听共用同一微信窗口，靠
desktop-lease-broker 优先级互斥；CI 持租期间监听整轮让位（设计上刻意不碰 UIA），窗口
状态维持在让位那一刻的样子。若那一刻窗口正停在某个已打开的聊天面板（不是会话列表），
selfcheck_bubbles.find_item_with_recovery 目前对 reset_fn（_reset_session_list_to_top）
只调用一次，失败就直接放弃——但 _reset_session_list_to_top 自身的点击升级梯是瞬时操作，
网络/前台焦点/窗口动画等瞬态原因导致的单次失败，换一轮全新尝试大概率能成功。

本测试覆盖纯逻辑（mw/sleep_fn/reset_fn 全部注入，不碰真实 UIA）：reset_fn 前两次失败、
第三次成功时，find_item_with_recovery 必须重试到位找到 target，而不是第一次失败就放弃。
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
AGENT_DIR = os.path.abspath(os.path.join(HERE, "..", ".."))
TOOLS_DIR = os.path.join(AGENT_DIR, "tools")
if TOOLS_DIR not in sys.path:
    sys.path.insert(0, TOOLS_DIR)

import selfcheck_bubbles  # noqa: E402


class _FakeItem:
    def __init__(self, name):
        self.element_info = type("EI", (), {"name": name})()


class _FakeMainWindow:
    """descendants() 按调用顺序依次弹出测试预设好的视图快照。"""

    def __init__(self, sequence):
        self._sequence = list(sequence)

    def descendants(self, control_type=None):
        if self._sequence:
            return self._sequence.pop(0)
        return []


def test_reset_fn_succeeds_on_third_attempt_after_two_failures():
    """reset_fn 前两次返回 False（升级梯用尽），第三次返回 True 且视图已含 target。

    当前实现（未修复前）：reset_fn 只调一次，第一次 False 就直接返回 not_found，
    永远等不到第三次成功——本测试在未修复前必然失败。
    """
    target = "文件传输助手"
    stuck_view = [_FakeItem("[bubble-gate] 1234567890"), _FakeItem("时间戳气泡")]
    recovered_view = [_FakeItem("张三"), _FakeItem(target), _FakeItem("李四")]

    # retries=2 → find 阶段消费 3 次视图（first_try + retry_1 + retry_2）；
    # reset 阶段第 3 次 reset_fn 成功后再消费 1 次视图确认找到。
    mw = _FakeMainWindow([stuck_view, stuck_view, stuck_view, recovered_view])

    reset_calls = {"n": 0}

    def fake_reset_fn(_mw):
        reset_calls["n"] += 1
        return reset_calls["n"] >= 3

    def fake_sleep(_seconds):
        pass

    item, how = selfcheck_bubbles.find_item_with_recovery(
        mw, target, retries=2, retry_delay_s=0.01,
        sleep_fn=fake_sleep, reset_fn=fake_reset_fn,
    )

    assert item is not None, (
        f"reset_fn 重试机制未生效：前两次失败后应继续重试而非直接放弃 (how={how})"
    )
    assert item.element_info.name == target
    assert reset_calls["n"] == 3, (
        f"reset_fn 应恰好被调用 3 次（前两次失败+第三次成功），实际 {reset_calls['n']} 次"
    )
    assert how.startswith("reset_recovery"), f"预期 how 以 reset_recovery 开头，实际 {how!r}"


def test_reset_fn_still_gives_up_after_exhausting_all_retries():
    """reset_fn 每次都失败，重试耗尽后仍应老实返回 not_found（不能无限重试拖垮 CI）。"""
    target = "文件传输助手"
    stuck_view = [_FakeItem("不相关气泡")]
    mw = _FakeMainWindow([stuck_view] * 20)  # 给够余量，函数应在有限次数内停手

    reset_calls = {"n": 0}

    def fake_reset_fn(_mw):
        reset_calls["n"] += 1
        return False

    item, how = selfcheck_bubbles.find_item_with_recovery(
        mw, target, retries=1, retry_delay_s=0.01,
        sleep_fn=lambda s: None, reset_fn=fake_reset_fn,
    )

    assert item is None
    assert how == "not_found"
    assert reset_calls["n"] >= 2, "reset_fn 全失败时至少应重试 2 次以上才放弃（不能仍是老的只试一次）"
    assert reset_calls["n"] <= 10, "reset_fn 重试次数应有上限，不能无限重试拖垮 CI"


def test_reset_fn_first_attempt_success_only_calls_once():
    """reset_fn 第一次就成功时，不应做多余重试（效率回归保护）。"""
    target = "文件传输助手"
    stuck_view = [_FakeItem("不相关气泡")]
    recovered_view = [_FakeItem(target)]
    mw = _FakeMainWindow([stuck_view, recovered_view])

    reset_calls = {"n": 0}

    def fake_reset_fn(_mw):
        reset_calls["n"] += 1
        return True

    item, how = selfcheck_bubbles.find_item_with_recovery(
        mw, target, retries=0, retry_delay_s=0.01,
        sleep_fn=lambda s: None, reset_fn=fake_reset_fn,
    )

    assert item is not None
    assert reset_calls["n"] == 1, f"reset_fn 首次即成功时不应多余重试，实际调用 {reset_calls['n']} 次"

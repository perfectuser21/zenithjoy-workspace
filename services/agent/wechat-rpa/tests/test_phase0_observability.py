# -*- coding: utf-8 -*-
"""Phase 0 观测埋点纯逻辑单测：skip 计数器 + build_diag（不跑微信，顶层零 pywinauto）。"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import listen_chat  # noqa: E402


def test_skip_counter_total_and_delta():
    c = listen_chat._SkipCounter()
    c.record("dup")
    c.record("dup")
    c.record("group")
    snap = c.snapshot()
    assert snap["total"] == {"dup": 2, "group": 1}
    assert snap["delta"] == {"dup": 2, "group": 1}


def test_skip_counter_delta_resets_after_snapshot():
    c = listen_chat._SkipCounter()
    c.record("cooldown")
    c.snapshot()  # 清 delta
    c.record("no_reply")
    snap = c.snapshot()
    assert snap["total"] == {"cooldown": 1, "no_reply": 1}
    assert snap["delta"] == {"no_reply": 1}  # 只含本周期新增

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


def test_build_diag_includes_version_and_skip_reasons(monkeypatch):
    monkeypatch.setattr(listen_chat, "_MODULE_VERSION", "1.0.87")
    c = listen_chat._SkipCounter()
    c.record("dup")
    c.record("group")
    diag = listen_chat.build_diag(
        main_window_found=True, login_present=False, logged_in=True,
        screen_locked=False, sessions_seen=5,
        unread_senders=["a", "b"], replied_count=1, last_error=None,
        skip_snapshot=c.snapshot(),
    )
    assert diag["module_version"] == "1.0.87"
    assert diag["skip_reasons"]["total"] == {"dup": 1, "group": 1}
    assert diag["unread_count"] == 2
    assert diag["sessions_seen"] == 5
    assert diag["replied_count"] == 1


def test_build_diag_unread_senders_capped_at_10():
    diag = listen_chat.build_diag(
        main_window_found=True, login_present=False, logged_in=True,
        screen_locked=False, sessions_seen=20,
        unread_senders=[str(i) for i in range(20)], replied_count=0,
        last_error=None, skip_snapshot={"total": {}, "delta": {}},
    )
    assert len(diag["unread_senders"]) == 10
    assert diag["unread_count"] == 20  # 计数是全量，列表截断

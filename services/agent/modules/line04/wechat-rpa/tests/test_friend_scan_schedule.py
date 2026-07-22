# -*- coding: utf-8 -*-
"""
TDD — 做法二 PR2：窗口锁 + 回复优先调度 + 采集软超时 + 跑完重建可读态。

单进程单循环里 A(客服回复) 与 B(CRM好友采集) 共用同一微信窗口/UIA/焦点，不能并行
（xian-rog 0629 真机铁证）。PR1 已删 B 的自动触发；PR2 加调度纪律：
- 回复优先：本轮有 pending 未读 → 不插入采集（force 标志留到下轮无未读再扫）。
- 采集软超时 ≤120s：滚太久中断让回 A，防长扫饿死回复。
- B 跑完务必重建可读态（补 SPI 屏幕阅读器标志），否则 A 接手读不到会话。

顶层零 pywinauto（用 stub），纯逻辑 + 行为断言。
"""
from __future__ import annotations

import os
import sys
import types
from unittest.mock import MagicMock

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)


def _stub_heavy_deps():
    for name in ["pywinauto", "pywinauto.application",
                 "pywinauto.controls", "pywinauto.controls.uia_controls"]:
        if name not in sys.modules:
            mod = types.ModuleType(name)
            mod.Desktop = MagicMock()
            sys.modules[name] = mod


_stub_heavy_deps()

import listen_chat  # noqa: E402
from listen_chat import (  # noqa: E402
    _should_insert_scan,
    _scan_deadline_exceeded,
    run_friend_scan,
)


# ── 回复优先调度（窗口锁的核心：A 优先，B 让位）──────────────────
def test_insert_scan_force_no_unread_runs():
    """中台触发(force) + 本轮无未读 → 插入采集。"""
    assert _should_insert_scan(True, False) is True


def test_insert_scan_force_with_unread_blocked():
    """★回复优先：中台触发但本轮有 pending 未读 → 不插入(让 A 先回)。"""
    assert _should_insert_scan(True, True) is False


def test_insert_scan_no_force_never():
    """无 force → 永不采集（PR1 纪律：只认中台按钮）。"""
    assert _should_insert_scan(False, False) is False
    assert _should_insert_scan(False, True) is False


# ── 采集软超时（防长扫饿死回复）──────────────────────────────
def test_deadline_not_exceeded_within_budget():
    assert _scan_deadline_exceeded(0.0, 119.0, 120.0) is False


def test_deadline_exceeded_at_budget():
    """★超时让回 A：跑到 max_seconds → 中断滚动。"""
    assert _scan_deadline_exceeded(0.0, 120.0, 120.0) is True


def test_deadline_zero_means_unlimited():
    """max_seconds<=0 视为不限（不误中断）。"""
    assert _scan_deadline_exceeded(0.0, 999999.0, 0.0) is False


# ── B 跑完重建可读态（否则 A 接手读不到会话）──────────────────
def test_run_friend_scan_rebuilds_readable_state(monkeypatch):
    """★B 跑完必须补设 SPI 标志(重建可读态)。"""
    calls = {"ensure_uia": 0}
    monkeypatch.setattr(listen_chat, "scan_recent_contacts",
                        lambda mw, limit=100, max_seconds=0: [{"name": "a"}])
    monkeypatch.setattr(listen_chat, "enrich_contacts_with_details",
                        lambda mw, c: c)
    monkeypatch.setattr(listen_chat, "post_friend_scan",
                        lambda url, wid, c: {"ok": True, "ingested": 1})
    monkeypatch.setattr(listen_chat, "_ensure_uia_flag",
                        lambda: calls.__setitem__("ensure_uia", calls["ensure_uia"] + 1) or True)
    res = run_friend_scan(MagicMock(), "http://mw", "cs-x")
    assert res["ok"] is True
    assert calls["ensure_uia"] >= 1, "run_friend_scan 跑完必须调 _ensure_uia_flag 重建可读态"


def test_run_friend_scan_rebuilds_readable_state_even_on_error(monkeypatch):
    """★即便采集异常，也必须 finally 重建可读态，绝不把微信留在 A 读不了的态。"""
    calls = {"ensure_uia": 0}

    def _boom(mw, limit=100, max_seconds=0):
        raise RuntimeError("scan boom")

    monkeypatch.setattr(listen_chat, "scan_recent_contacts", _boom)
    monkeypatch.setattr(listen_chat, "_ensure_uia_flag",
                        lambda: calls.__setitem__("ensure_uia", calls["ensure_uia"] + 1) or True)
    res = run_friend_scan(MagicMock(), "http://mw", "cs-x")
    assert res["ok"] is False
    assert calls["ensure_uia"] >= 1, "异常路径也必须 finally 调 _ensure_uia_flag"

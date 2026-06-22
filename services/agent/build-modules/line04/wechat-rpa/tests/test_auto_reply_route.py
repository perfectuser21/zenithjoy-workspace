#!/usr/bin/env python3
"""
test_auto_reply_route.py — 无审批自动回复闭环 路由/可靠性 oracle（Contract Round 1）。

本文件是 **proposer 合同 oracle**（TDD red）：generator 实现
services/agent/wechat-rpa/auto_reply.py 的下列纯/半纯函数使其转绿。
逻辑断言（环境无关）→ CI 绿即逻辑 done；真机送达接缝见 e2e-verify.ps1。

要求 auto_reply.py 导出：
  decide_reply_route(in_whitelist, business_hours_ok, auto_agent_on, daily_count, daily_limit) -> str
  within_business_hours(start_hhmm, end_hhmm, now_time) -> bool        # 含跨午夜 + end="24:00"
  pick_reply_delay() -> float                                          # 随机 [1.0, 5.0]
  is_duplicate(contact, text, now_ts, window_seconds=...) -> bool      # 同(联系人,文本,时间窗)只回一次
  llm_timeout_skip(elapsed_ms, timeout_ms=20000) -> bool              # >20s 跳过不发占位
  broadcast_action(prev_on, next_on, key_contact) -> dict             # {"action": online|offline|skip, "target": ...}
  alert_on_failure(reason, key_contact) -> dict                       # 失败/掉线告警 payload（带 reason + target）
  build_receipt(route, ok, reason=None) -> dict                       # 回执：auto_sent / send_failed(不重发)
"""
from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import auto_reply as m  # noqa: E402  generator 须新建本模块


# ── 路由真值表（5 行字面量）─────────────────────────────────────────────────
@pytest.mark.parametrize(
    "in_wl,bh,on,cnt,lim,expected",
    [
        (True, True, False, 0, 0, "review"),          # 自动代理 OFF → 监控态
        (False, True, True, 0, 0, "pending_human"),   # 名单外 → 待人工
        (True, False, True, 0, 0, "skip_offhours"),   # 营业时间外 → 不回
        (True, True, True, 2, 2, "pending_human"),    # daily 超额 → 待人工
        (True, True, True, 0, 0, "auto"),             # 全绿 → 自动回
    ],
)
def test_route_auto_review_pending_human_skip_offhours(in_wl, bh, on, cnt, lim, expected):
    assert m.decide_reply_route(in_wl, bh, on, cnt, lim) == expected


def test_route_review_when_off_even_if_whitelisted():
    # OFF 优先级最高：名单内 + 营业时间内也只出草稿
    assert m.decide_reply_route(True, True, False, 0, 0) == "review"


def test_route_pending_human_not_in_whitelist_priority():
    # ON 下名单外即便营业时间内也 pending_human（不自动回陌生人）
    assert m.decide_reply_route(False, True, True, 0, 0) == "pending_human"


def test_route_skip_offhours():
    assert m.decide_reply_route(True, False, True, 0, 0) == "skip_offhours"


def test_route_values_subset_of_four_literals():
    vals = {
        m.decide_reply_route(a, b, c, 0, 0)
        for a in (True, False)
        for b in (True, False)
        for c in (True, False)
    }
    assert vals <= {"auto", "review", "pending_human", "skip_offhours"}


# ── 营业时间（含跨午夜 + end=24:00）─────────────────────────────────────────
def test_business_hours_full_day_until_midnight():
    assert m.within_business_hours("06:00", "24:00", dt.time(8, 0)) is True
    assert m.within_business_hours("06:00", "24:00", dt.time(23, 59)) is True
    assert m.within_business_hours("06:00", "24:00", dt.time(5, 0)) is False


def test_business_hours_cross_midnight():
    # 22:00–02:00 跨午夜：23:30 真，03:00 假，01:00 真
    assert m.within_business_hours("22:00", "02:00", dt.time(23, 30)) is True
    assert m.within_business_hours("22:00", "02:00", dt.time(1, 0)) is True
    assert m.within_business_hours("22:00", "02:00", dt.time(3, 0)) is False


# ── 拟人延迟 1~5s ───────────────────────────────────────────────────────────
def test_reply_delay_in_range_and_random():
    ds = [m.pick_reply_delay() for _ in range(50)]
    assert all(1.0 <= d <= 5.0 for d in ds)
    assert len(set(ds)) > 1  # 必须随机，不能是常量


# ── 去重幂等 ─────────────────────────────────────────────────────────────────
def test_dedup_same_contact_text_window_only_once():
    now = 1_000_000.0
    assert m.is_duplicate("alice", "你好", now) is False  # 首次未重
    assert m.is_duplicate("alice", "你好", now + 1) is True  # 时间窗内重复
    # 不同文本不算重
    assert m.is_duplicate("alice", "在吗", now + 1) is False


# ── LLM 超时 >20s 跳过不发占位 ──────────────────────────────────────────────
def test_llm_timeout_skip():
    assert m.llm_timeout_skip(21000) is True
    assert m.llm_timeout_skip(1500) is False


# ── 开关跳变播报 ─────────────────────────────────────────────────────────────
def test_broadcast_online():
    r = m.broadcast_action(False, True, "ks_wx")
    assert r["action"] == "online" and r["target"] == "ks_wx"


def test_broadcast_offline():
    r = m.broadcast_action(True, False, "ks_wx")
    assert r["action"] == "offline" and r["target"] == "ks_wx"


def test_broadcast_key_contact_unconfigured_skips():
    r = m.broadcast_action(False, True, "")
    assert r["action"] == "skip"


def test_broadcast_no_change_skips():
    assert m.broadcast_action(True, True, "ks_wx")["action"] == "skip"


# ── 失败/掉线告警 ────────────────────────────────────────────────────────────
def test_alert_on_failure_payload():
    r = m.alert_on_failure("send_failed: read-back timeout", "ks_wx")
    assert r["target"] == "ks_wx"
    assert "send_failed" in r["reason"]


# ── 回执：成功 auto_sent / 失败 send_failed 不重发 ──────────────────────────
def test_receipt_auto_sent():
    r = m.build_receipt("auto", ok=True)
    assert r["status"] == "auto_sent"


def test_receipt_send_failed_no_retry():
    r = m.build_receipt("auto", ok=False, reason="disconnected")
    assert r["status"] == "send_failed"
    assert r.get("retry") is False  # 不重发，防刷屏

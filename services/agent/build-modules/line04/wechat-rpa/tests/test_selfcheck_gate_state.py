# -*- coding: utf-8 -*-
"""selfcheck_bubbles 找窗口状态机纯函数（2026-07-06 CI 闸修复）。

背景：rog 微信 UIA 死区 ~40h 期间 gate 报「no wechat window — 微信没跑或没登录」，
把「进程在但 UIA 死区」和「微信真没跑」混为一谈，运营无法按 reason 行动。
"""
import os
import sys

_TOOLS = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
if _TOOLS not in sys.path:
    sys.path.insert(0, _TOOLS)

from selfcheck_bubbles import (  # noqa: E402
    FIND_WINDOW_RETRIES,
    FIND_WINDOW_RETRY_DELAY_S,
    classify_no_window,
)


def test_no_process_classified():
    code, msg = classify_no_window(process_running=False)
    assert code == "NO_PROCESS"
    assert "Weixin.exe" in msg


def test_uia_dead_classified():
    code, msg = classify_no_window(process_running=True)
    assert code == "UIA_DEAD"
    assert "UIA" in msg


def test_retry_budget_covers_transient_startup():
    # 有界重试至少覆盖 1 分钟瞬态（微信启动/树重建），但别无限等
    assert FIND_WINDOW_RETRIES * FIND_WINDOW_RETRY_DELAY_S >= 60
    assert FIND_WINDOW_RETRIES * FIND_WINDOW_RETRY_DELAY_S <= 180

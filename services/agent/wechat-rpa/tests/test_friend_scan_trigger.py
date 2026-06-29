# -*- coding: utf-8 -*-
"""
TDD — `_should_run_friend_scan` 触发判定纯函数单测（做法二 PR1 回归守卫）。

背景（xian-rog 0629 真机铁证）：CRM 好友采集(Ability B)与客服回复(Ability A)
共用同一个微信窗口 / 同一个 UIA / 同一个焦点，**不能并行**。B 自动跑
（开机必跑 `not friend_scan_done_once` + 周期 `FRIEND_SCAN_INTERVAL`）会滚全会话列表 /
逐个开会话 → 丢 SPI 屏幕阅读器标志 → UIA 树塌缩 → #950 据此误重启正在工作的微信 →
多分钟死区（"回一次就不理"）。#811 无 CRM 扫好友故超级稳定。

本 PR 彻底删掉自动触发路径、**不留开关**：CRM 采集【只】由中台显式
「立即扫好友」按钮(force) 触发（受未来窗口锁保护，做法二 PR2）。

守卫契约（proven-to-fire）：
- force=False 时，无论 done_once / 周期取何值 → 一律 False（不跑）。
  ★ 把旧自动逻辑（`or not done_once` / `or now-last>=interval`）加回去，此处必红。
- force=True → True（保留中台显式触发）。

顶层零 pywinauto（用 stub），纯逻辑断言。
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

from listen_chat import _should_run_friend_scan  # noqa: E402


def test_force_true_runs():
    """中台「立即扫好友」按钮(force=True) → 触发。"""
    assert _should_run_friend_scan(True) is True


def test_force_false_never_runs_even_if_never_scanned():
    """★回归守卫：从没扫过(done_once=False) 也绝不开机自动跑——只认 force。"""
    assert _should_run_friend_scan(
        False, done_once=False, now=99999.0, last=0.0, interval=1.0
    ) is False


def test_force_false_never_runs_even_if_interval_elapsed():
    """★回归守卫：周期早过(now-last>=interval) 也绝不周期自动跑——只认 force。"""
    assert _should_run_friend_scan(
        False, done_once=True, now=1_000_000.0, last=0.0, interval=86400.0
    ) is False


def test_force_true_overrides_all():
    """force=True 永远跑，与 done_once / 周期无关。"""
    assert _should_run_friend_scan(
        True, done_once=True, now=0.0, last=0.0, interval=86400.0
    ) is True

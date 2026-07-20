# -*- coding: utf-8 -*-
"""
Regression test —— 树塌自愈的【可读时效守卫】：真塌才自愈、假塌绝不误触发
（真机日志实锤 2 次迭代，2026-07-18）。

## 迭代史（都有真机证据，全写进来防重犯）

一版（信号=IsWindowVisible）：真机端到端 0 触发——监听自己的托盘分支 1-3s 内就把
隐藏窗口唤回可见，塌缩检测跑起来时窗口早已可见，该条件永远 False。

二版（信号=最近托盘唤回时间戳）：真机日志实锤误触发——22:02:16 刚成功 DELIVERED
一条给默忆(树是好的)、22:02:28 心跳裸读却报塌缩、22:03:32 快速自愈就去召唤了一个
其实好好的微信。根因：托盘唤回每轮扫描都发生=恒命中，把 agent 自己挪屏外造成的
【假塌】也当真塌。

三版（本文件，信号=可读时效守卫）：判"微信是不是真坏"的唯一真相 = scan 最近还能不
能读到会话。scan 每 1-3s 挪屏外读一次、读到健康树就刷新 last_readable_scan_at。心跳
每 60s 裸读会撞上 agent 自己挪屏外的隐身瞬间(假塌)；只有 scan 连续超过
_HEAL_READABLE_GRACE_SECONDS 真读不到，才认定真坏(✕关闭撕树 / 标志丢)。

本文件是"假塌误重启"的永久 regression test，禁止删除。
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
    for name in ["requests"]:
        if name not in sys.modules:
            mod = types.ModuleType(name)
            mod.get = MagicMock()
            mod.post = MagicMock()
            sys.modules[name] = mod


_stub_heavy_deps()

import listen_chat  # noqa: E402


NOW = 10_000.0


def _call(collapsed_since=NOW - 20.0, last_readable_scan_at=NOW - 100.0,
          last_restart_at=0.0, restarts_done=0):
    return listen_chat._should_fast_heal_hidden_collapsed(
        NOW, collapsed_since, last_readable_scan_at,
        last_restart_at, restarts_done, listen_chat._WECHAT_RESTART_MAX,
    )


def test_heal_fires_when_scan_cannot_read_for_grace():
    """真坏（scan 连续读不到会话超过 grace）+ 塌缩短暂持续 → 放行自愈。"""
    assert _call(last_readable_scan_at=NOW - 100.0) is True


def test_no_heal_when_scan_recently_read_healthy_FALSE_COLLAPSE():
    """⭐核心回归：scan 最近还读到过健康会话（微信在正常工作，心跳裸读是假塌）
    → 绝不自愈。根治真机 22:02 "刚成功发消息、心跳报塌、误召唤" 那个 bug。"""
    grace = listen_chat._HEAL_READABLE_GRACE_SECONDS
    assert _call(last_readable_scan_at=NOW - 1.0) is False          # 1s 前刚读到健康
    assert _call(last_readable_scan_at=NOW - (grace - 1)) is False  # 仍在守卫窗口内


def test_heal_boundary_at_grace():
    """恰好达到 grace 才算真坏（边界）。"""
    grace = listen_chat._HEAL_READABLE_GRACE_SECONDS
    assert _call(last_readable_scan_at=NOW - grace) is True
    assert _call(last_readable_scan_at=NOW - (grace + 5)) is True


def test_no_heal_before_collapse_started():
    """未进入塌缩态（collapsed_since=None）→ 不触发。"""
    assert _call(collapsed_since=None) is False


def test_short_sustain_debounce():
    """塌缩持续 < 短防抖（15s）→ 暂不触发（防瞬时态误杀）。"""
    assert _call(collapsed_since=NOW - 5.0) is False
    assert _call(collapsed_since=NOW - listen_chat._HIDDEN_COLLAPSED_SUSTAIN_SECONDS + 1) is False
    assert _call(collapsed_since=NOW - listen_chat._HIDDEN_COLLAPSED_SUSTAIN_SECONDS - 1) is True


def test_independent_short_cooldown_not_starved_by_600s():
    """独立 120s 短冷却：刚自愈过 → 挡；过了短冷却 → 放行。绝不被树塌 600s 饿死。"""
    assert _call(last_restart_at=NOW - 60.0) is False
    assert _call(last_restart_at=NOW - listen_chat._HIDDEN_HEAL_COOLDOWN_SECONDS - 1) is True
    assert listen_chat._HIDDEN_HEAL_COOLDOWN_SECONDS < 600


def test_respects_global_restart_max():
    """全局重启上限仍生效（防无限 loop 的最后防线不放松）。"""
    assert _call(restarts_done=listen_chat._WECHAT_RESTART_MAX) is False
    assert _call(restarts_done=listen_chat._WECHAT_RESTART_MAX + 3) is False


def test_grace_is_short_for_fast_real_recovery():
    """守卫窗口必须短（≤30s）——真坏后 scan 几轮读不到就该放行，不能太久卡住恢复。"""
    assert listen_chat._HEAL_READABLE_GRACE_SECONDS <= 30

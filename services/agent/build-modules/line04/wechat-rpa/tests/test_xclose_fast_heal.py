# -*- coding: utf-8 -*-
"""
Regression test —— ✕关闭后恢复慢/被冷却饿死：隐藏态+树塌缩快速自愈通道
（真机实测反馈，2026-07-18）。

## 现象（用户原话 + 日志实锤）

"我把微信一关…再发消息，你什么都听不到了…也不见重启"。日志：18:34:43 ✕关闭
（fallback 生效 found_window=True）→ 18:34:46 塌缩检测启动 90s 宽限 → 直到
18:36:54 才重启（约 2 分 10 秒），期间用户消息无人回。更糟：树塌自愈有 600s
冷却 + 可读守卫，连续触发时会"喊了要重启却迟迟不动"。

## 根因

✕关闭撕掉 UI 内容树是**确定性**的（真机多轮证实，SHOWNA/maximize/jiggle 均
救不回）——但它走的是为"树可能自己恢复"设计的通用塌缩自愈：90s 宽限没意义、
600s 冷却会饿死、可读守卫（✕关闭前 scan 一直健康→last_readable 很新）还会
再挡一道。

## 修法（首版设计错误的教训已并入）

首版用"此刻 IsWindowVisible=False"当 ✕关闭特征——真机端到端验证 0 触发：监听
自己的托盘分支 1-3 秒内就把隐藏窗口唤回成可见（挪屏外），塌缩检测跑起来时窗口
早已"可见"。正确信号 = **托盘唤回动作本身**（`_ensure_tray_visible` tray 分支
记录 `_LAST_TRAY_RESTORE_AT`），塌缩发生在唤回时间戳附近（±120s 关联窗口）→
判定 ✕关闭撕树 → 短防抖 15s 后立即重启。独立 120s 短冷却（不与树塌 600s 共享），
绕过可读守卫，重启计数仍并入全局上限（防无限 loop）。

本文件是这个 bug 的永久 regression test，禁止删除。
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


def _call(recent_tray_restore_at=NOW - 25.0, collapsed_since=NOW - 20.0,
          last_restart_at=0.0, restarts_done=0):
    return listen_chat._should_fast_heal_hidden_collapsed(
        NOW, recent_tray_restore_at, collapsed_since,
        last_restart_at, restarts_done, listen_chat._WECHAT_RESTART_MAX,
    )


def test_fast_heal_fires_for_tray_restore_then_collapse():
    """✕关闭特征齐备（塌缩紧跟托盘唤回 + 持续超短防抖）→ 立即放行重启，不等 90s。"""
    assert _call() is True


def test_fast_heal_requires_recent_tray_restore():
    """从未托盘唤回（=0）或唤回久远（与塌缩不关联）→ 不走快速通道（交还通用自愈）。

    首版设计错误教训：不能用"此刻 IsWindowVisible"判定——监听托盘分支 1-3s 内就把
    隐藏窗口唤回可见，塌缩检测时该条件永远 False（真机端到端 0 触发实锤）。"""
    assert _call(recent_tray_restore_at=0.0) is False
    assert _call(recent_tray_restore_at=NOW - 20.0 - listen_chat._TRAY_RESTORE_RELEVANCE_SECONDS - 10) is False


def test_fast_heal_relevance_window_both_directions():
    """唤回可发生在塌缩检测之前或之后（心跳周期错位），±关联窗口内都算。"""
    assert _call(recent_tray_restore_at=NOW - 20.0 - 60) is True   # 唤回早于塌缩 60s
    assert _call(recent_tray_restore_at=NOW - 20.0 + 60) is True   # 唤回晚于塌缩 60s


def test_fast_heal_requires_collapse_started():
    """未进入塌缩态（collapsed_since=None）→ 不触发。"""
    assert _call(collapsed_since=None) is False


def test_fast_heal_short_sustain_debounce():
    """塌缩持续时长 < 短防抖阈值（15s）→ 暂不触发（防瞬时态误杀）。"""
    assert _call(collapsed_since=NOW - 5.0) is False
    assert _call(collapsed_since=NOW - listen_chat._HIDDEN_COLLAPSED_SUSTAIN_SECONDS + 1) is False


def test_fast_heal_sustain_is_much_shorter_than_generic_90s():
    """快速通道防抖必须显著短于通用 90s 宽限——这是本修复的意义所在。"""
    assert listen_chat._HIDDEN_COLLAPSED_SUSTAIN_SECONDS <= 30
    assert _call(collapsed_since=NOW - 31.0) is True


def test_fast_heal_independent_short_cooldown():
    """独立短冷却（120s）：刚重启过 → 挡；过了短冷却 → 放行。
    关键：不受树塌自愈 600s 冷却饿死（真机 18:24 重启后 18:34 ✕关闭被 600s 卡住实锤）。"""
    assert _call(last_restart_at=NOW - 60.0) is False
    assert _call(last_restart_at=NOW - listen_chat._HIDDEN_HEAL_COOLDOWN_SECONDS - 1) is True
    assert listen_chat._HIDDEN_HEAL_COOLDOWN_SECONDS < 600, "独立冷却必须短于树塌自愈的 600s"


def test_fast_heal_respects_global_restart_max():
    """全局重启上限仍然生效（防无限重启 loop 的最后防线不放松）。"""
    assert _call(restarts_done=listen_chat._WECHAT_RESTART_MAX) is False
    assert _call(restarts_done=listen_chat._WECHAT_RESTART_MAX + 3) is False

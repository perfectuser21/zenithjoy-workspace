# -*- coding: utf-8 -*-
"""
UIA 死区（进程在但主窗口丢失）自愈 — regression test（issue e6203ac4，禁止删除）。

真机实锤（xian-rog 0704→0706）：微信进程在、get_main_window() 返回 None，listener 每 ~4s 打
「微信进程已在运行但 UIA 找不到主窗口（UIA 未就绪），跳过重复启动，等待下次激活」持续 40 小时
永不自愈；0706 09:28 listener 进程重启后走「微信未运行→带 SPI 标志自动启动」路径 3 分钟痊愈。

根因：#950 树塌自愈（_is_uia_tree_collapsed）要求 mw 已找到且 descendants≤2 才触发，
mw=None 分支完全没有自愈路径。

修法：该状态（Weixin 进程在 + mw=None）连续持续 > _WINDOW_LOST_SUSTAIN_SECONDS(180s)
→ 触发重启微信自愈，复用 #950 现有 _should_restart_for_collapsed_tree 冷却(600s)/
单进程上限(5次) 机制与 _restart_wechat_for_uia() 重启函数，不另造一套。

本文件测：
  1. 纯函数 should_heal_window_lost（持续超阈值才自愈）
  2. 纯函数 track_window_lost_since（状态复位：窗口找到/进程不在 → 清零计时）
  3. 主循环接线守卫（源码文本断言，模式同 test_mainloop_wiring.py）
"""
from __future__ import annotations

import io
import os
import re
import sys
import types
from unittest.mock import MagicMock


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


HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

_stub_heavy_deps()

import listen_chat  # noqa: E402

LISTEN_CHAT_PATH = os.path.join(WECHAT_RPA_DIR, "listen_chat.py")


def _source() -> str:
    with io.open(LISTEN_CHAT_PATH, "r", encoding="utf-8") as f:
        return f.read()


class TestShouldHealWindowLost:
    """纯函数：进程在但主窗口丢失，持续 > 阈值(默认180s) 才触发自愈。"""

    def test_not_lost_yet_no_heal(self):
        # lost_since=None（尚未进入丢失态）→ 绝不自愈
        assert listen_chat.should_heal_window_lost(None, 1000.0) is False

    def test_lost_under_threshold_no_heal(self):
        # 丢失 100s < 180s → 不自愈（避开启动过渡/瞬时态）
        assert listen_chat.should_heal_window_lost(1000.0, 1100.0) is False

    def test_lost_exactly_threshold_no_heal(self):
        # 恰好 180s（阈值边界，要求「持续 > 180s」）→ 不自愈
        assert listen_chat.should_heal_window_lost(1000.0, 1180.0) is False

    def test_lost_over_threshold_heals(self):
        # 丢失 181s > 180s → 自愈
        assert listen_chat.should_heal_window_lost(1000.0, 1181.0) is True

    def test_lost_40_hours_heals(self):
        # rog 实锤场景：丢失 40 小时 → 必须自愈（原实现此态永不自愈）
        assert listen_chat.should_heal_window_lost(0.0, 40 * 3600.0) is True

    def test_custom_threshold(self):
        assert listen_chat.should_heal_window_lost(0.0, 50.0, threshold_s=60) is False
        assert listen_chat.should_heal_window_lost(0.0, 61.0, threshold_s=60) is True

    def test_default_threshold_constant_is_180(self):
        assert listen_chat._WINDOW_LOST_SUSTAIN_SECONDS == 180


class TestTrackWindowLostSince:
    """纯函数：维护「进程在+主窗口丢失」起始时刻；窗口找到/进程不在 → 清零复位。"""

    def test_enter_lost_state_starts_timer(self):
        # 进程在 + 窗口没找到 + 此前未计时 → 从 now 起计
        assert listen_chat.track_window_lost_since(
            window_found=False, weixin_running=True, lost_since=None, now=123.0
        ) == 123.0

    def test_sustained_lost_keeps_original_since(self):
        # 持续丢失 → 保留最早起始时刻（不重置，否则永远到不了阈值）
        assert listen_chat.track_window_lost_since(
            window_found=False, weixin_running=True, lost_since=100.0, now=250.0
        ) == 100.0

    def test_window_found_resets(self):
        # mw 找到 → 立即清零计时
        assert listen_chat.track_window_lost_since(
            window_found=True, weixin_running=True, lost_since=100.0, now=250.0
        ) is None

    def test_weixin_not_running_resets(self):
        # 进程不在（走「未运行→自动启动」路径）→ 不属于 UIA 死区，清零
        assert listen_chat.track_window_lost_since(
            window_found=False, weixin_running=False, lost_since=100.0, now=250.0
        ) is None


class TestMainloopWiring:
    """主循环接线守卫（源码文本断言）：mw=None + 进程在 分支必须接自愈，且复用 #950 机制。"""

    def test_window_lost_branch_wires_selfheal(self):
        src = _source()
        # 找到「进程已在运行但 UIA 找不到主窗口」分支
        m = re.search(r"微信进程已在运行但 UIA 找不到主窗口", src)
        assert m is not None, "主循环里找不到「微信进程已在运行但 UIA 找不到主窗口」分支"
        # 该分支前后必须接 should_heal_window_lost（往前找 1500 字符窗口）
        window = src[max(0, m.start() - 1500): m.start() + 500]
        assert "should_heal_window_lost" in window, (
            "mw=None + 进程在 分支没接 should_heal_window_lost —— UIA 死区永不自愈（rog 40h 实锤）"
        )
        assert "_restart_wechat_for_uia" in window, (
            "UIA 死区自愈必须复用 #950 的 _restart_wechat_for_uia 重启函数，不得另造一套"
        )
        assert "_should_restart_for_collapsed_tree" in window, (
            "UIA 死区自愈必须复用 #950 的冷却(600s)/单进程上限(5次)判定 _should_restart_for_collapsed_tree"
        )

    def test_heal_log_mentions_dead_zone(self):
        src = _source()
        assert "UIA 死区自愈" in src, "自愈日志必须打「UIA 死区自愈：…重启微信」便于真机排障检索"

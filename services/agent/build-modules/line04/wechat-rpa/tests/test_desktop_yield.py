# -*- coding: utf-8 -*-
"""桌面互斥让位判定纯函数测试（CI 可测，零 pywinauto）。

背景（2026-07-18 实证）：rog 上常驻 line04 监听与 self-hosted CI runner 抢同一 session-1
交互桌面 = 持续真塌根因。CI 抢桌面前 acquire priority<50 的全局桌面租约；监听主循环顶部
查 broker /status，若他人持有更高优先级租约 → 整轮让位。本文件锁死"何时该让位"的判定逻辑。
"""
from __future__ import annotations

import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))
LISTEN_CHAT_PATH = os.path.abspath(os.path.join(HERE, "..", "listen_chat.py"))


def _load_should_yield():
    spec = importlib.util.spec_from_file_location("listen_chat_for_yield", LISTEN_CHAT_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod._should_yield_desktop, mod._DESKTOP_LEASE_CLIENT_ID, mod._DESKTOP_LEASE_PRIORITY


def test_broker_unreachable_status_none_does_not_yield():
    """broker 不可达（status=None）→ 不让位（降级，core 没起就没 CI 争用，对齐 f26e099c）。"""
    fn, me, my_pri = _load_should_yield()
    assert fn(None, me, my_pri) is False


def test_no_lease_held_does_not_yield():
    """无人持租 → 不让位。"""
    fn, me, my_pri = _load_should_yield()
    assert fn({"held": False}, me, my_pri) is False


def test_self_held_does_not_yield():
    """自己持有（发送路径临时租约）→ 不让位，绝不因自己持租把自己饿死。"""
    fn, me, my_pri = _load_should_yield()
    status = {"held": True, "client_id": me, "priority": my_pri}
    assert fn(status, me, my_pri) is False


def test_other_higher_priority_yields():
    """他人持有更高优先级（数字更小，CI=10 < 监听=50）→ 让位。"""
    fn, me, my_pri = _load_should_yield()
    status = {"held": True, "client_id": "ci/bubble-read-gate", "priority": 10}
    assert fn(status, me, my_pri) is True


def test_other_same_or_lower_priority_does_not_yield():
    """他人持有同级/更低优先级（不该发生，CI 用更高）→ 不让位，避免被误低优先级 client 拖死。"""
    fn, me, my_pri = _load_should_yield()
    assert fn({"held": True, "client_id": "other", "priority": my_pri}, me, my_pri) is False
    assert fn({"held": True, "client_id": "other", "priority": my_pri + 10}, me, my_pri) is False


def test_other_held_unknown_priority_yields_conservatively():
    """他人持有但优先级字段缺失/非法 → 保守让位（宁可暂停也别撞 CI）。"""
    fn, me, my_pri = _load_should_yield()
    assert fn({"held": True, "client_id": "ci/x"}, me, my_pri) is True
    assert fn({"held": True, "client_id": "ci/x", "priority": "bad"}, me, my_pri) is True

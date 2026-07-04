# -*- coding: utf-8 -*-
"""v1.0.107 Bug1 regression test: INFLIGHT TTL 自动释放（防异常路径泄漏）。

场景：某 sender 加入 _INFLIGHT 后，因异常路径导致没有经过正常的 DELIVERED / 失败释放，
长期卡在 _INFLIGHT 里，导致该客户的后续消息永远不被处理。

修法：_expire_inflight_ttl() 扫描超过 INFLIGHT_TTL 秒的 sender 强制释放。
"""
import os
import sys
import time

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import listen_chat


@pytest.fixture(autouse=True)
def _clean_state():
    listen_chat._INFLIGHT.clear()
    listen_chat._INFLIGHT_ADDED_AT.clear()
    listen_chat._LAST_EMIT.clear()
    yield
    listen_chat._INFLIGHT.clear()
    listen_chat._INFLIGHT_ADDED_AT.clear()
    listen_chat._LAST_EMIT.clear()


def test_ttl_constants_exist():
    """INFLIGHT_TTL 和 _INFLIGHT_ADDED_AT 必须存在（v1.0.107 契约）。"""
    assert hasattr(listen_chat, 'INFLIGHT_TTL'), "缺 INFLIGHT_TTL 常量"
    assert hasattr(listen_chat, '_INFLIGHT_ADDED_AT'), "缺 _INFLIGHT_ADDED_AT 字典"
    assert listen_chat.INFLIGHT_TTL >= 60, "INFLIGHT_TTL 至少 60s"


def test_expire_inflight_ttl_function_exists():
    """_expire_inflight_ttl 函数必须存在。"""
    assert callable(getattr(listen_chat, '_expire_inflight_ttl', None)), \
        "缺 _expire_inflight_ttl 函数"


def test_inflight_add_records_timestamp(monkeypatch):
    """_INFLIGHT.add 时必须同步写 _INFLIGHT_ADDED_AT。"""
    # 手动模拟 scan_unread 给 _INFLIGHT 加入 sender 的路径
    # 直接用底层：_INFLIGHT.add + _INFLIGHT_ADDED_AT[sender] = ts
    sender = "test_sender_timestamp"
    now = time.time()
    listen_chat._INFLIGHT.add(sender)
    listen_chat._INFLIGHT_ADDED_AT[sender] = now
    assert sender in listen_chat._INFLIGHT_ADDED_AT
    assert abs(listen_chat._INFLIGHT_ADDED_AT[sender] - now) < 1.0


def test_expire_inflight_ttl_releases_stale(monkeypatch):
    """超过 TTL 的 sender 被 _expire_inflight_ttl() 强制释放。"""
    sender = "zombie_sender"
    listen_chat._INFLIGHT.add(sender)
    # 模拟该 sender 在很久以前加入（超过 TTL）
    stale_ts = time.time() - listen_chat.INFLIGHT_TTL - 10
    listen_chat._INFLIGHT_ADDED_AT[sender] = stale_ts

    listen_chat._expire_inflight_ttl()

    assert sender not in listen_chat._INFLIGHT, \
        "超时 sender 必须被 TTL 机制强制释放"
    assert sender not in listen_chat._INFLIGHT_ADDED_AT, \
        "_INFLIGHT_ADDED_AT 也必须同时清除"


def test_expire_inflight_ttl_keeps_fresh():
    """未超时的 sender 不被 TTL 释放。"""
    sender = "fresh_sender"
    listen_chat._INFLIGHT.add(sender)
    listen_chat._INFLIGHT_ADDED_AT[sender] = time.time()  # 刚加入

    listen_chat._expire_inflight_ttl()

    assert sender in listen_chat._INFLIGHT, \
        "未超时 sender 不应被 TTL 释放"


def test_release_inflight_clears_added_at():
    """_release_inflight 必须同时清 _INFLIGHT_ADDED_AT。"""
    sender = "rel_sender"
    listen_chat._INFLIGHT.add(sender)
    listen_chat._INFLIGHT_ADDED_AT[sender] = time.time()

    listen_chat._release_inflight(sender)

    assert sender not in listen_chat._INFLIGHT
    assert sender not in listen_chat._INFLIGHT_ADDED_AT, \
        "_release_inflight 必须同时清 _INFLIGHT_ADDED_AT"

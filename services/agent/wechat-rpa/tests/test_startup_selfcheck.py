# -*- coding: utf-8 -*-
# 启动自检消息单测（Step6，decision 05871b00：每次启动发一条给固定测试联系人，
# 验证整条后台静默发送链路真的通了）。
#
# 覆盖：
# - _should_send_startup_selfcheck 纯函数：收件人未配置 / 本进程已发过 → deny by default
# - _find_session_item 找不到目标会话 → 返回 None（不抛异常）
# - send_startup_selfcheck 软失败：找不到会话/发送异常都不上抛，只 log
import os
from unittest.mock import patch

import listen_chat


def test_should_send_when_contact_configured_and_not_done():
    assert listen_chat._should_send_startup_selfcheck(done=False, contact="固定测试联系人") is True


def test_should_not_send_when_already_done():
    assert listen_chat._should_send_startup_selfcheck(done=True, contact="固定测试联系人") is False


def test_should_not_send_when_contact_empty():
    assert listen_chat._should_send_startup_selfcheck(done=False, contact="") is False
    assert listen_chat._should_send_startup_selfcheck(done=False, contact=None) is False


class _FakeElementInfo:
    def __init__(self, name):
        self.name = name


class _FakeItem:
    def __init__(self, name):
        self.element_info = _FakeElementInfo(name)


class _FakeMainWindow:
    def __init__(self, names):
        self._names = names

    def descendants(self, control_type=None):
        return [_FakeItem(n) for n in self._names]


def test_find_session_item_matches_by_first_line():
    mw = _FakeMainWindow(["固定测试联系人\n最新消息预览", "别的联系人"])
    item = listen_chat._find_session_item(mw, "固定测试联系人")
    assert item is not None
    assert item.element_info.name.startswith("固定测试联系人")


def test_find_session_item_returns_none_when_not_found():
    mw = _FakeMainWindow(["张三", "李四"])
    assert listen_chat._find_session_item(mw, "找不到的联系人") is None


def test_send_startup_selfcheck_returns_false_when_contact_env_empty():
    mw = _FakeMainWindow(["随便谁"])
    with patch.dict(os.environ, {"ZJ_STARTUP_SELFCHECK_CONTACT": ""}, clear=False):
        # 重新读取模块级配置常量的等价路径：直接传空 contact 场景由 _should_send_startup_selfcheck 已覆盖，
        # 这里验证 send_startup_selfcheck 对"找不到会话"的软失败路径。
        result = listen_chat.send_startup_selfcheck(mw, middleware_url="")
        assert result is False


def test_send_startup_selfcheck_soft_fails_when_session_not_found(monkeypatch):
    monkeypatch.setattr(listen_chat, "_STARTUP_SELFCHECK_CONTACT", "固定测试联系人")
    mw = _FakeMainWindow(["别的联系人"])
    # 找不到目标会话 → 软失败返回 False，不抛异常
    result = listen_chat.send_startup_selfcheck(mw, middleware_url="")
    assert result is False


def test_send_startup_selfcheck_calls_reply_with_lease_when_found(monkeypatch):
    monkeypatch.setattr(listen_chat, "_STARTUP_SELFCHECK_CONTACT", "固定测试联系人")
    mw = _FakeMainWindow(["固定测试联系人"])

    called = {}

    def _fake_reply_with_lease(mw_arg, item_arg, text, sender, middleware_url):
        called["sender"] = sender
        called["text"] = text
        return True

    monkeypatch.setattr(listen_chat, "reply_in_chat_with_lease", _fake_reply_with_lease)
    result = listen_chat.send_startup_selfcheck(mw, middleware_url="http://mw")
    assert result is True
    assert called["sender"] == "固定测试联系人"

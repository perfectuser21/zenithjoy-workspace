# -*- coding: utf-8 -*-
"""桌面租约降级放行 + middleware_url 禁令守卫（issue 6e890bf6 增量 / 1.0.110，永久留 CI）。

背景：租约打错地址（middleware→本机 IPC）主修在 PR #1142（1.0.109）。本文件锁住
它之上的两个增量契约（决策 f26e099c，用户拍板）：

1. 降级放行：Broker 联系不上（连接拒绝/超时/404/解析失败——老 core 无此路由、
   core 未起）→ acquire 返回 True + stderr degrade-allow 警告，绝不因仲裁缺席
   阻断回复（否则老 core 客户机永久不回复 = 6e890bf6 换姿势重演）；
   显式 granted:false（Broker 在岗、桌面被占）→ 仍 False 跳过本轮。
2. AST 守卫：desktop_lease_* 函数体（含形参）永久禁止出现 middleware_url——
   Broker 在本机 127.0.0.1 IPC，死参数会误导下次改动接回中台。
"""
import ast
import json
import os
import sys
import urllib.error

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import listen_chat


@pytest.fixture(autouse=True)
def _reset_lease_state():
    listen_chat._current_lease_id = None
    yield
    listen_chat._current_lease_id = None


class _FakeResp:
    def __init__(self, payload):
        self._body = json.dumps(payload).encode("utf-8")

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def test_lease_functions_never_touch_middleware_url():
    """AST 守卫：Broker 在本机 IPC，desktop_lease_* 不许再碰 middleware_url（含形参）。"""
    with open(os.path.join(_WECHAT, "listen_chat.py"), encoding="utf-8") as f:
        tree = ast.parse(f.read())
    offenders = []
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name.startswith("desktop_lease_"):
            for sub in ast.walk(node):
                if isinstance(sub, ast.Name) and sub.id == "middleware_url":
                    offenders.append(f"{node.name}:{sub.lineno}")
                if isinstance(sub, ast.arg) and sub.arg == "middleware_url":
                    offenders.append(f"{node.name}(arg):{sub.lineno}")
    assert offenders == [], (
        f"desktop_lease_* 禁止引用 middleware_url（Broker 在本机 127.0.0.1 IPC）: {offenders}")


def test_acquire_degrade_allow_when_broker_unreachable(monkeypatch, capsys):
    """Broker 联系不上（老 core 无路由 / core 未起）→ 降级放行，绝不阻断回复。"""
    def _boom(req, timeout=0):
        raise urllib.error.URLError("connection refused")

    monkeypatch.setattr(listen_chat.urllib.request, "urlopen", _boom)
    assert listen_chat.desktop_lease_acquire() is True
    assert listen_chat._current_lease_id is None
    assert "degrade-allow" in capsys.readouterr().err


def test_acquire_denied_when_broker_says_not_granted(monkeypatch):
    """Broker 在岗但桌面被占 → 维持跳过本轮语义（降级只对'联系不上'）。"""
    monkeypatch.setattr(
        listen_chat.urllib.request, "urlopen",
        lambda req, timeout=0: _FakeResp({"granted": False, "retry_after_ms": 500}))
    assert listen_chat.desktop_lease_acquire() is False


def test_acquire_granted_no_arg_signature(monkeypatch):
    """acquire/release 无参签名（地址由 _get_local_discovery_base 内部决定）。"""
    seen = []

    def _ok(req, timeout=0):
        seen.append(req.full_url)
        if req.full_url.endswith("/acquire"):
            return _FakeResp({"granted": True, "lease_id": "L1"})
        return _FakeResp({"ok": True})

    monkeypatch.setattr(listen_chat.urllib.request, "urlopen", _ok)
    monkeypatch.delenv("ZENITHJOY_LOCAL_PORT", raising=False)
    assert listen_chat.desktop_lease_acquire() is True
    assert listen_chat._current_lease_id == "L1"
    listen_chat.desktop_lease_release()
    assert seen, "未发出任何租约请求"
    assert all(u.startswith("http://127.0.0.1:58432/api/agent/desktop-lease-broker/")
               for u in seen), seen

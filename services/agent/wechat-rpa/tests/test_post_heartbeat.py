"""
TDD — listen_chat.post_heartbeat：监听每分钟向中台上报心跳（进程守护 sub-item 2）。

要求：
  - POST {middleware}/api/wechat/listener-heartbeat，body 含 agent_id / wechat_id。
  - 失败绝不抛异常（网络抖动不能拖垮监听）→ 返回 {ok: False}。

RED：post_heartbeat 不存在 → AttributeError。
GREEN：实现后 2 case 通过。

CI 安全：顶层零 pywinauto；用 fake requests 注入 sys.modules，跨平台可跑。
"""
from __future__ import annotations

import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

import listen_chat  # noqa: E402


def _make_fake_requests(capture, status=200, raise_exc=None):
    m = types.ModuleType("requests")

    def post(url, json=None, timeout=None):  # noqa: A002 - 模拟 requests.post 签名
        capture["url"] = url
        capture["json"] = json
        if raise_exc:
            raise raise_exc
        return types.SimpleNamespace(status_code=status, text="ok", json=lambda: {"ok": True})

    m.post = post  # type: ignore[attr-defined]
    return m


def test_post_heartbeat_success(monkeypatch):
    cap: dict = {}
    monkeypatch.setitem(sys.modules, "requests", _make_fake_requests(cap))
    r = listen_chat.post_heartbeat("http://mw:3000", agent_id="a1", wechat_id="wx1")
    assert r["ok"] is True
    assert cap["url"].endswith("/api/wechat/listener-heartbeat")
    assert cap["json"]["agent_id"] == "a1"
    assert cap["json"]["wechat_id"] == "wx1"


def test_post_heartbeat_swallows_network_error(monkeypatch):
    monkeypatch.setitem(
        sys.modules, "requests", _make_fake_requests({}, raise_exc=RuntimeError("net down"))
    )
    r = listen_chat.post_heartbeat("http://mw:3000", agent_id="a1")
    assert r["ok"] is False  # 不抛异常，返回 ok:False


def test_post_heartbeat_non_200(monkeypatch):
    monkeypatch.setitem(sys.modules, "requests", _make_fake_requests({}, status=503))
    r = listen_chat.post_heartbeat("http://mw:3000")
    assert r["ok"] is False

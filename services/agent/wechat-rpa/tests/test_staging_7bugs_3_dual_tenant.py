# -*- coding: utf-8 -*-
"""Bug 3 — 同机双租户隔离（staging 7bugs / 1.0.108）

根因：同一台机器上两个不同租户账号共享相同的 machine_id（基于硬件指纹），
fetch_cs_config 只按 machine_id 查，A 租户可能拉到 B 租户的配置。

修法：fetch_cs_config 增加 wechat_id 参数，API 请求中加入 wechat_id 做二次定位。
本文件是永久 regression test。
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import cs_config_gate as gate


class FakeResp:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def test_fetch_cs_config_accepts_wechat_id_param():
    """fetch_cs_config 必须接受 wechat_id 关键字参数（不崩即为向后兼容）。"""
    # 不传 middleware_url 时会短路返回 (None, False)，但关键是不能 TypeError
    try:
        result = gate.fetch_cs_config("", "machine-X", wechat_id="wxid_test")
        assert result == (None, False)
    except TypeError as e:
        raise AssertionError(
            f"fetch_cs_config 必须接受 wechat_id 参数，当前签名缺少该参数: {e}"
        )


def test_fetch_cs_config_sends_wechat_id_in_params(monkeypatch):
    """fetch_cs_config 必须把 wechat_id 加入请求 params，供中台二次定位。

    Bug 场景：同机两租户共享 machine_id，只按 machine_id 查会拿到错误租户的配置。
    修法：params 中必须同时携带 machine_id 和 wechat_id。
    """
    captured = {}

    def fake_get(url, params=None, timeout=None):
        captured["params"] = params
        return FakeResp(200, {"wechat_id": "wxid_tenant_a", "auto_agent_enabled": True})

    monkeypatch.setattr(gate.requests, "get", fake_get)

    gate.fetch_cs_config("http://mw", "machine-X", wechat_id="wxid_tenant_a")

    assert "wechat_id" in captured["params"], \
        "fetch_cs_config 必须在请求 params 中携带 wechat_id（双租户隔离）"
    assert captured["params"]["wechat_id"] == "wxid_tenant_a"
    assert captured["params"]["machine_id"] == "machine-X"


def test_fetch_cs_config_without_wechat_id_still_works(monkeypatch):
    """wechat_id 为 None/默认值时，fetch_cs_config 向后兼容——不崩、正常拉配置。

    存量调用方没有传 wechat_id 时不应该 break。
    """
    captured = {}

    def fake_get(url, params=None, timeout=None):
        captured["params"] = params
        return FakeResp(200, {"wechat_id": "wxid_abc", "auto_agent_enabled": True})

    monkeypatch.setattr(gate.requests, "get", fake_get)

    cfg, ok = gate.fetch_cs_config("http://mw", "machine-X")
    assert ok is True
    assert cfg is not None


def test_fetch_cs_config_wechat_id_none_not_sent_as_string(monkeypatch):
    """wechat_id=None 时不应把 'None' 字符串加入 params（避免中台收到错误参数）。"""
    captured = {}

    def fake_get(url, params=None, timeout=None):
        captured["params"] = params
        return FakeResp(200, {"auto_agent_enabled": True})

    monkeypatch.setattr(gate.requests, "get", fake_get)

    gate.fetch_cs_config("http://mw", "machine-X", wechat_id=None)

    params = captured.get("params", {})
    # 如果传了 wechat_id，它不应该是字符串 "None"
    if "wechat_id" in params:
        assert params["wechat_id"] is None or params["wechat_id"] != "None", \
            "wechat_id=None 不应序列化为字符串 'None'"


def test_fetch_cs_config_dual_tenant_different_wechat_id(monkeypatch):
    """同机两租户各用自己的 wechat_id 拉配置，返回各自独立的配置。

    验证 wechat_id 参数被正确携带，确保中台能做二次隔离。
    """
    calls = []

    def fake_get(url, params=None, timeout=None):
        calls.append(params.copy() if params else {})
        wid = (params or {}).get("wechat_id")
        if wid == "wxid_tenant_a":
            return FakeResp(200, {"wechat_id": "wxid_tenant_a", "auto_agent_enabled": True})
        elif wid == "wxid_tenant_b":
            return FakeResp(200, {"wechat_id": "wxid_tenant_b", "auto_agent_enabled": False})
        return FakeResp(200, {"auto_agent_enabled": False})

    monkeypatch.setattr(gate.requests, "get", fake_get)

    cfg_a, ok_a = gate.fetch_cs_config("http://mw", "machine-X", wechat_id="wxid_tenant_a")
    cfg_b, ok_b = gate.fetch_cs_config("http://mw", "machine-X", wechat_id="wxid_tenant_b")

    # 确认两次调用都带了 wechat_id
    assert len(calls) == 2
    assert calls[0].get("wechat_id") == "wxid_tenant_a"
    assert calls[1].get("wechat_id") == "wxid_tenant_b"

    assert ok_a and cfg_a["auto_agent_enabled"] is True
    assert ok_b and cfg_b["auto_agent_enabled"] is False

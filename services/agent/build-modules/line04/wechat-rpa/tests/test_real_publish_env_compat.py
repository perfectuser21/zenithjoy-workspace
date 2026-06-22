"""
TDD — real_publish 判定必须同时认 REAL_PUBLISH 和 ZENITHJOY_AGENT_REAL_PUBLISH。

真机 bug（#818 出站播报假发）：prod agent 的 module-manager 起长驻 listener 时
注入的是 ZENITHJOY_AGENT_REAL_PUBLISH=1（与抖音/快手 handler 一致），**不是**
REAL_PUBLISH。旧代码 listen_chat 主循环 / send_chat 只认 REAL_PUBLISH →
real_publish=False → 出站走 send_chat mock 路径（假发但返回 ok）→ 中台标 auto_sent，
关键人根本没收到。

修复：real_publish 判定同时认两个 env 名（任一 =1/true 即真发），prod 现成的
ZENITHJOY_AGENT_REAL_PUBLISH=1 直接生效，无需机器加新 env。

【CI 安全】顶层零 pywinauto/win32 import；纯函数 + env 注入，跨平台跑。
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import listen_chat  # noqa: E402


def _clear_env(monkeypatch):
    monkeypatch.delenv("REAL_PUBLISH", raising=False)
    monkeypatch.delenv("ZENITHJOY_AGENT_REAL_PUBLISH", raising=False)


# ─── listen_chat._resolve_real_publish: 两个 env 名都认 ────────────────────────


def test_real_publish_via_legacy_env_name(monkeypatch):
    """只设 REAL_PUBLISH=1 → 真发（向后兼容，按需任务桥接的旧名）。"""
    _clear_env(monkeypatch)
    monkeypatch.setenv("REAL_PUBLISH", "1")
    assert listen_chat._resolve_real_publish() is True


def test_real_publish_via_zenithjoy_env_name(monkeypatch):
    """只设 ZENITHJOY_AGENT_REAL_PUBLISH=1 → 真发（prod 长驻 listener 现成的 env）。

    旧代码只认 REAL_PUBLISH → 这里会 real_publish=False（红）。
    """
    _clear_env(monkeypatch)
    monkeypatch.setenv("ZENITHJOY_AGENT_REAL_PUBLISH", "1")
    assert listen_chat._resolve_real_publish() is True


def test_real_publish_zenithjoy_true_string(monkeypatch):
    """ZENITHJOY_AGENT_REAL_PUBLISH=true（与抖音/快手 handler 同写法）→ 真发。"""
    _clear_env(monkeypatch)
    monkeypatch.setenv("ZENITHJOY_AGENT_REAL_PUBLISH", "true")
    assert listen_chat._resolve_real_publish() is True


def test_real_publish_default_false(monkeypatch):
    """两个 env 都没设 → mock（CI 默认安全态）。"""
    _clear_env(monkeypatch)
    assert listen_chat._resolve_real_publish() is False


def test_real_publish_zero_is_false(monkeypatch):
    """ZENITHJOY_AGENT_REAL_PUBLISH=0 → mock（显式关闭）。"""
    _clear_env(monkeypatch)
    monkeypatch.setenv("ZENITHJOY_AGENT_REAL_PUBLISH", "0")
    assert listen_chat._resolve_real_publish() is False


def test_real_publish_either_one_set_wins(monkeypatch):
    """任一 =1 即真发：REAL_PUBLISH=0 但 ZENITHJOY_AGENT_REAL_PUBLISH=1 → 真发。"""
    _clear_env(monkeypatch)
    monkeypatch.setenv("REAL_PUBLISH", "0")
    monkeypatch.setenv("ZENITHJOY_AGENT_REAL_PUBLISH", "1")
    assert listen_chat._resolve_real_publish() is True


# ─── send_chat.main(): CLI 入口也认两个 env 名 ────────────────────────────────


def test_send_chat_main_resolves_zenithjoy_env(monkeypatch):
    """send_chat 独立 spawn（按需任务）时 main() 也必须认 ZENITHJOY_AGENT_REAL_PUBLISH。

    旧代码 send_chat.main 只读 REAL_PUBLISH → 关键人出站若走独立 spawn 同样假发。
    """
    import io
    import types

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    import send_chat  # noqa: E402

    _clear_env(monkeypatch)
    monkeypatch.setenv("ZENITHJOY_AGENT_REAL_PUBLISH", "1")

    captured = {}

    def fake_send(target, wechat_id, message, real_publish):
        captured["real_publish"] = real_publish
        return {"ok": True, "dryRun": not real_publish}

    monkeypatch.setattr(send_chat, "send_chat_message", fake_send)
    monkeypatch.setattr(
        send_chat.sys, "stdin",
        io.StringIO('{"target":"默忆","wechat_id":"mo","message":"hi"}'),
    )

    send_chat.main()
    assert captured.get("real_publish") is True, (
        "send_chat.main 必须认 ZENITHJOY_AGENT_REAL_PUBLISH=1（旧代码只认 REAL_PUBLISH → False）"
    )

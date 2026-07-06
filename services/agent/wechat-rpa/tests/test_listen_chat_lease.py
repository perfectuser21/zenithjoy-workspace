#!/usr/bin/env python3
"""
test_listen_chat_lease.py — DesktopLeaseBroker IPC 接缝逻辑单测（Sprint 0703-line04-desktop-lease-broker）

纯逻辑断言（UI driver mock，无真机依赖），CI 绿即逻辑 done。
接缝 1（listen_chat.py dryrun IPC 日志验证）在 xian-rog 真机验证（B6）。

覆盖：
  - desktop_lease_acquire：HTTP 调用 IPC，granted=True → 日志含 "acquire granted"，返回 True
  - desktop_lease_acquire：granted=False → 日志含 "acquire failed"，返回 False
  - desktop_lease_acquire：HTTP 异常 → 日志含 "acquire failed"，返回 False（fail-safe）
  - desktop_lease_release：HTTP 调用 IPC，日志含 "release"
  - desktop_lease_release：HTTP 异常 → 静默忽略（best-effort）
  - [防假成功] invariant：acquire 失败时 run_dryrun_inject 跳过，不假发
  - [v1.0.109 local-discovery] acquire/release/renew 的 URL 基址必须是 127.0.0.1:ZENITHJOY_LOCAL_PORT
    而非 middleware_url（Brain 容器内 localhost 不通宿主机 IPC 端口）
"""
from __future__ import annotations

import json
import sys
from io import StringIO
from pathlib import Path
from typing import Any, Dict
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import listen_chat as lc  # noqa: E402


# ─── helpers ────────────────────────────────────────────────────────────────


def _make_http_response(payload: Dict[str, Any]) -> MagicMock:
    """模拟 urllib.request.urlopen 返回的 response context manager。"""
    mock_resp = MagicMock()
    mock_resp.__enter__ = lambda s: s
    mock_resp.__exit__ = MagicMock(return_value=False)
    mock_resp.read.return_value = json.dumps(payload).encode("utf-8")
    return mock_resp


# ─── desktop_lease_acquire ──────────────────────────────────────────────────


def test_acquire_granted_returns_true_and_logs(capsys):
    """Broker 返回 granted:true → acquire 返回 True，stderr 含 'acquire granted'。"""
    with patch("urllib.request.urlopen", return_value=_make_http_response(
        {"granted": True, "lease_id": "test-lease-001", "expires_at": 9999999999999}
    )):
        result = lc.desktop_lease_acquire("http://localhost:5221")

    assert result is True
    captured = capsys.readouterr()
    assert "[desktop_lease] acquire granted" in captured.err


def test_acquire_not_granted_returns_false_and_logs(capsys):
    """Broker 返回 granted:false → acquire 返回 False，stderr 含 'acquire failed'。"""
    with patch("urllib.request.urlopen", return_value=_make_http_response(
        {"granted": False, "retry_after_ms": 5000}
    )):
        result = lc.desktop_lease_acquire("http://localhost:5221")

    assert result is False
    captured = capsys.readouterr()
    assert "[desktop_lease] acquire failed" in captured.err


def test_acquire_http_error_returns_false_and_logs(capsys):
    """HTTP 异常 → acquire 返回 False，stderr 含 'acquire failed'（fail-safe，不抛异常）。"""
    with patch("urllib.request.urlopen", side_effect=Exception("connection refused")):
        result = lc.desktop_lease_acquire("http://localhost:5221")

    assert result is False
    captured = capsys.readouterr()
    assert "[desktop_lease] acquire failed" in captured.err


# ─── desktop_lease_release ──────────────────────────────────────────────────


def test_release_logs_on_success(capsys):
    """release 成功 → stderr 含 '[desktop_lease] release'。"""
    lc._current_lease_id = "test-lease-release-001"
    with patch("urllib.request.urlopen", return_value=_make_http_response({"ok": True})):
        lc.desktop_lease_release("http://localhost:5221")

    captured = capsys.readouterr()
    assert "[desktop_lease] release" in captured.err


def test_release_noop_when_no_lease_id(capsys):
    """无持有租约时 release 静默 noop，不发 HTTP 请求。"""
    lc._current_lease_id = None
    with patch("urllib.request.urlopen") as mock_open:
        lc.desktop_lease_release("http://localhost:5221")
    mock_open.assert_not_called()


def test_release_silences_http_error(capsys):
    """HTTP 异常 → release 静默忽略（best-effort），不抛异常，不 crash。"""
    lc._current_lease_id = "test-lease-err"
    with patch("urllib.request.urlopen", side_effect=Exception("timeout")):
        lc.desktop_lease_release("http://localhost:5221")  # 不应抛出


def test_release_clears_lease_id():
    """release 后 _current_lease_id 被清除（防止重复 release 发 HTTP）。"""
    lc._current_lease_id = "test-clear-001"
    with patch("urllib.request.urlopen", return_value=_make_http_response({"ok": True})):
        lc.desktop_lease_release("http://localhost:5221")
    assert lc._current_lease_id is None


# ─── [防假成功] invariant — run_dryrun_inject 集成 ──────────────────────────


def test_dryrun_inject_skips_when_acquire_fails(capsys):
    """acquire 失败 → run_dryrun_inject 跳过，emit_json ok:false，不调 post_draft_generate。"""
    args = MagicMock()
    args.inject_message = '{"sender":"客户A","wechat_id":"wxid_A","content":"你好"}'
    args.middleware_url = "http://localhost:5221"
    args.agent_id = None

    with patch.object(lc, "desktop_lease_acquire", return_value=False), \
         patch.object(lc, "post_draft_generate") as mock_draft, \
         patch.object(lc, "emit_json") as mock_emit:
        lc.run_dryrun_inject(args)

    mock_draft.assert_not_called()
    called_payload = mock_emit.call_args[0][0]
    assert called_payload.get("ok") is False


def test_dryrun_inject_calls_release_after_draft(capsys):
    """acquire 成功 → 调 post_draft_generate → 最终调 release（finally 保证）。"""
    args = MagicMock()
    args.inject_message = '{"sender":"客户B","wechat_id":"wxid_B","content":"测试"}'
    args.middleware_url = "http://localhost:5221"
    args.agent_id = None

    with patch.object(lc, "desktop_lease_acquire", return_value=True), \
         patch.object(lc, "desktop_lease_release") as mock_release, \
         patch.object(lc, "post_draft_generate", return_value={"ok": True}), \
         patch.object(lc, "emit_json"):
        lc.run_dryrun_inject(args)

    mock_release.assert_called_once_with("http://localhost:5221")


# ─── [ARTIFACT 防回归] reply_in_chat_with_lease — 真实回复主循环接线 ─────────
# PR#1082 只把 acquire/release 接进了 run_dryrun_inject（CLI 测试注入路径），
# 没接进 run_real_listen 真实调用的 reply_in_chat（见 4213 行）——真实客户消息
# 进来完全不会触发这套仲裁机制。补线：reply_in_chat_with_lease 包装 reply_in_chat，
# acquire 失败 → 跳过不发（[防假成功] invariant）；无论成功/异常都 release（finally）。


def test_reply_with_lease_acquire_denied_skips_send():
    """acquire 返回 False → 不调 reply_in_chat，直接返回 False。"""
    with patch.object(lc, "desktop_lease_acquire", return_value=False), \
         patch.object(lc, "reply_in_chat") as mock_reply:
        result = lc.reply_in_chat_with_lease(
            MagicMock(), MagicMock(), "你好", "客户A", "http://localhost:5221"
        )
    assert result is False
    mock_reply.assert_not_called()


def test_reply_with_lease_acquire_granted_sends_and_releases():
    """acquire 成功 → 调 reply_in_chat 发送 → 无论结果都 release。"""
    with patch.object(lc, "desktop_lease_acquire", return_value=True), \
         patch.object(lc, "desktop_lease_release") as mock_release, \
         patch.object(lc, "reply_in_chat", return_value=True) as mock_reply:
        result = lc.reply_in_chat_with_lease(
            MagicMock(), MagicMock(), "你好", "客户B", "http://localhost:5221"
        )
    assert result is True
    mock_reply.assert_called_once()
    mock_release.assert_called_once_with("http://localhost:5221")


def test_reply_with_lease_releases_even_on_exception():
    """reply_in_chat 抛异常 → release 仍必须被调用（finally 保证），异常继续往外抛。"""
    with patch.object(lc, "desktop_lease_acquire", return_value=True), \
         patch.object(lc, "desktop_lease_release") as mock_release, \
         patch.object(lc, "reply_in_chat", side_effect=RuntimeError("uia crash")):
        with pytest.raises(RuntimeError):
            lc.reply_in_chat_with_lease(
                MagicMock(), MagicMock(), "你好", "客户C", "http://localhost:5221"
            )
    mock_release.assert_called_once_with("http://localhost:5221")


def test_reply_with_lease_noop_when_no_middleware_url():
    """middleware_url 为空 → 不调 acquire/release，直接透传 reply_in_chat（本地/测试场景兼容）。"""
    with patch.object(lc, "desktop_lease_acquire") as mock_acquire, \
         patch.object(lc, "desktop_lease_release") as mock_release, \
         patch.object(lc, "reply_in_chat", return_value=True) as mock_reply:
        result = lc.reply_in_chat_with_lease(MagicMock(), MagicMock(), "你好", "客户D", "")
    assert result is True
    mock_acquire.assert_not_called()
    mock_release.assert_not_called()
    mock_reply.assert_called_once()


def test_run_real_listen_uses_reply_in_chat_with_lease():
    """[ARTIFACT 防回归] run_real_listen 源码里真实回复调用点必须走 reply_in_chat_with_lease
    包装函数，而不是裸调 reply_in_chat——否则真实客户消息不会经过桌面仲裁层。
    """
    src_path = Path(__file__).resolve().parents[1] / "listen_chat.py"
    src = src_path.read_text(encoding="utf-8")
    fn_start = src.index("def run_real_listen(")
    fn_end = src.index("\ndef ", fn_start + 1)
    fn_body = src[fn_start:fn_end]
    assert "reply_in_chat_with_lease(" in fn_body, (
        "run_real_listen 必须调用 reply_in_chat_with_lease 包装函数（接入桌面仲裁层），"
        "不能直接裸调 reply_in_chat"
    )


# ─── [v1.0.109] local-discovery URL 守卫 ─────────────────────────────────────
# 租约 IPC 必须走 127.0.0.1:ZENITHJOY_LOCAL_PORT（默认 58432）而非 middleware_url。
# Brain 容器内 localhost 指向容器自身，不通宿主 :5201；local-discovery 和 listen_chat.py
# 同在宿主 Windows 机上，127.0.0.1 始终可达。


def _capture_urlopen_url(response_payload: dict):
    """返回 (patch 上下文, captured dict)；调用后 captured['url'] 含被请求的 URL。"""
    import urllib.request as _ur
    captured: dict = {}

    def _fake(req, timeout=None):
        captured["url"] = req.full_url if hasattr(req, "full_url") else req.get_full_url()
        mock = MagicMock()
        mock.__enter__ = lambda s: s
        mock.__exit__ = MagicMock(return_value=False)
        mock.read.return_value = json.dumps(response_payload).encode("utf-8")
        return mock

    return patch("urllib.request.urlopen", side_effect=_fake), captured


def test_acquire_url_is_local_discovery_not_middleware(capsys):
    """[RED] desktop_lease_acquire 的 HTTP 目标必须含 127.0.0.1，不能含 middleware_url 的域。"""
    ctx, captured = _capture_urlopen_url({"granted": True, "lease_id": "x"})
    with ctx:
        lc.desktop_lease_acquire("http://external-middleware:5000")
    assert "127.0.0.1" in captured["url"], \
        f"acquire URL 应为 127.0.0.1:58432 local IPC，实际 {captured.get('url')!r}"
    assert "external-middleware" not in captured["url"], \
        "acquire URL 不应含 middleware_url 域名——租约 IPC 走本机 local-discovery，不走中台"


def test_release_url_is_local_discovery_not_middleware(capsys):
    """[RED] desktop_lease_release 的 HTTP 目标必须含 127.0.0.1，不能含 middleware_url 的域。"""
    lc._current_lease_id = "url-check-release"
    ctx, captured = _capture_urlopen_url({"ok": True})
    with ctx:
        lc.desktop_lease_release("http://external-middleware:5000")
    assert "127.0.0.1" in captured["url"], \
        f"release URL 应为 127.0.0.1:58432 local IPC，实际 {captured.get('url')!r}"
    assert "external-middleware" not in captured["url"], \
        "release URL 不应含 middleware_url 域名"


def test_acquire_url_uses_zenithjoy_local_port_env(monkeypatch, capsys):
    """[RED] ZENITHJOY_LOCAL_PORT env var 应被读取——acquire URL 端口随 env 变化。"""
    monkeypatch.setenv("ZENITHJOY_LOCAL_PORT", "19999")
    ctx, captured = _capture_urlopen_url({"granted": True, "lease_id": "z"})
    with ctx:
        lc.desktop_lease_acquire("http://mw:5000")
    assert "19999" in captured["url"], \
        f"acquire URL 端口应为 env ZENITHJOY_LOCAL_PORT=19999，实际 {captured.get('url')!r}"


def test_release_url_uses_zenithjoy_local_port_env(monkeypatch):
    """[RED] ZENITHJOY_LOCAL_PORT env var 应被读取——release URL 端口随 env 变化。"""
    monkeypatch.setenv("ZENITHJOY_LOCAL_PORT", "19999")
    lc._current_lease_id = "port-env-check"
    ctx, captured = _capture_urlopen_url({"ok": True})
    with ctx:
        lc.desktop_lease_release("http://mw:5000")
    assert "19999" in captured["url"], \
        f"release URL 端口应为 env ZENITHJOY_LOCAL_PORT=19999，实际 {captured.get('url')!r}"


def test_renew_exists_and_uses_local_discovery():
    """[RED] desktop_lease_renew 函数必须存在且 URL 含 127.0.0.1（不含 middleware 域）。"""
    assert hasattr(lc, "desktop_lease_renew"), \
        "desktop_lease_renew 函数不存在——需在 v1.0.109 中新增"
    lc._current_lease_id = "renew-url-check"
    ctx, captured = _capture_urlopen_url({"renewed": True, "expires_at": 9999999})
    with ctx:
        result = lc.desktop_lease_renew("http://external-middleware:5000")
    assert "127.0.0.1" in captured.get("url", ""), \
        f"renew URL 应为 127.0.0.1:58432 local IPC，实际 {captured.get('url')!r}"
    assert "external-middleware" not in captured.get("url", ""), \
        "renew URL 不应含 middleware_url 域名"
    assert result is True


def test_renew_returns_false_when_no_lease_id():
    """[RED] _current_lease_id 为空时 renew 应返回 False（无租约不用续期）。"""
    assert hasattr(lc, "desktop_lease_renew"), "desktop_lease_renew 函数不存在"
    lc._current_lease_id = None
    with patch("urllib.request.urlopen") as mock_open:
        result = lc.desktop_lease_renew("http://mw:5000")
    assert result is False
    mock_open.assert_not_called()


def test_renew_silences_http_error():
    """[RED] renew HTTP 异常 → 返回 False，不抛出（best-effort）。"""
    assert hasattr(lc, "desktop_lease_renew"), "desktop_lease_renew 函数不存在"
    lc._current_lease_id = "renew-err"
    with patch("urllib.request.urlopen", side_effect=Exception("timeout")):
        result = lc.desktop_lease_renew("http://mw:5000")
    assert result is False

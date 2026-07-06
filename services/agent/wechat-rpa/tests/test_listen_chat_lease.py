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
        result = lc.desktop_lease_acquire()

    assert result is True
    captured = capsys.readouterr()
    assert "[desktop_lease] acquire granted" in captured.err


def test_acquire_not_granted_returns_false_and_logs(capsys):
    """Broker 返回 granted:false → acquire 返回 False，stderr 含 'acquire failed'。"""
    with patch("urllib.request.urlopen", return_value=_make_http_response(
        {"granted": False, "retry_after_ms": 5000}
    )):
        result = lc.desktop_lease_acquire()

    assert result is False
    captured = capsys.readouterr()
    assert "[desktop_lease] acquire failed" in captured.err


def test_acquire_http_error_returns_false_and_logs(capsys):
    """HTTP 异常 → acquire 返回 False，stderr 含 'acquire failed'（fail-safe，不抛异常）。"""
    with patch("urllib.request.urlopen", side_effect=Exception("connection refused")):
        result = lc.desktop_lease_acquire()

    assert result is False
    captured = capsys.readouterr()
    assert "[desktop_lease] acquire failed" in captured.err


# ─── desktop_lease_release ──────────────────────────────────────────────────


def test_release_logs_on_success(capsys):
    """release 成功 → stderr 含 '[desktop_lease] release'。"""
    lc._current_lease_id = "test-lease-release-001"
    with patch("urllib.request.urlopen", return_value=_make_http_response({"ok": True})):
        lc.desktop_lease_release()

    captured = capsys.readouterr()
    assert "[desktop_lease] release" in captured.err


def test_release_noop_when_no_lease_id(capsys):
    """无持有租约时 release 静默 noop，不发 HTTP 请求。"""
    lc._current_lease_id = None
    with patch("urllib.request.urlopen") as mock_open:
        lc.desktop_lease_release()
    mock_open.assert_not_called()


def test_release_silences_http_error(capsys):
    """HTTP 异常 → release 静默忽略（best-effort），不抛异常，不 crash。"""
    lc._current_lease_id = "test-lease-err"
    with patch("urllib.request.urlopen", side_effect=Exception("timeout")):
        lc.desktop_lease_release()  # 不应抛出


def test_release_clears_lease_id():
    """release 后 _current_lease_id 被清除（防止重复 release 发 HTTP）。"""
    lc._current_lease_id = "test-clear-001"
    with patch("urllib.request.urlopen", return_value=_make_http_response({"ok": True})):
        lc.desktop_lease_release()
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

    mock_release.assert_called_once_with()


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
    mock_release.assert_called_once_with()


def test_reply_with_lease_releases_even_on_exception():
    """reply_in_chat 抛异常 → release 仍必须被调用（finally 保证），异常继续往外抛。"""
    with patch.object(lc, "desktop_lease_acquire", return_value=True), \
         patch.object(lc, "desktop_lease_release") as mock_release, \
         patch.object(lc, "reply_in_chat", side_effect=RuntimeError("uia crash")):
        with pytest.raises(RuntimeError):
            lc.reply_in_chat_with_lease(
                MagicMock(), MagicMock(), "你好", "客户C", "http://localhost:5221"
            )
    mock_release.assert_called_once_with()


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


# ─── 1.0.109: 租约 IPC 地址改指本机 local-discovery（ZENITHJOY_LOCAL_PORT）────────
# 桌面租约 Broker 运行在同一 Win 桌面机的 local-discovery 进程（127.0.0.1:58432）。
# 原实现误把 middleware_url（远程中台地址）当 IPC 基址；容器内 localhost 不通宿主。
# 以下测试在修复前必须失败：acquire/release 无参数调用会抛 TypeError。


import os as _os  # noqa: E402  (已在顶层 import，这里是避免名字冲突的局部引用)


def test_acquire_uses_local_discovery_default_port(capsys):
    """acquire() 无参调用，必须向 127.0.0.1:58432 发请求（默认端口）。"""
    captured_urls: list = []

    def _capture(req, timeout=None):
        captured_urls.append(req.full_url)
        return _make_http_response({"granted": True, "lease_id": "ld-001"})

    with patch("urllib.request.urlopen", side_effect=_capture):
        result = lc.desktop_lease_acquire()

    assert result is True
    assert len(captured_urls) == 1
    assert "127.0.0.1:58432" in captured_urls[0], (
        f"acquire URL 必须走 127.0.0.1:58432（local-discovery），实际: {captured_urls[0]}"
    )


def test_release_uses_local_discovery_default_port():
    """release() 无参调用，必须向 127.0.0.1:58432 发请求（默认端口）。"""
    captured_urls: list = []
    lc._current_lease_id = "lease-for-url-check"

    def _capture(req, timeout=None):
        captured_urls.append(req.full_url)
        return _make_http_response({})

    with patch("urllib.request.urlopen", side_effect=_capture):
        lc.desktop_lease_release()

    assert len(captured_urls) == 1
    assert "127.0.0.1:58432" in captured_urls[0], (
        f"release URL 必须走 127.0.0.1:58432（local-discovery），实际: {captured_urls[0]}"
    )


def test_acquire_respects_zenithjoy_local_port_env(capsys):
    """ZENITHJOY_LOCAL_PORT 环境变量可改写端口（优先于默认 58432）。"""
    captured_urls: list = []

    def _capture(req, timeout=None):
        captured_urls.append(req.full_url)
        return _make_http_response({"granted": True, "lease_id": "ld-002"})

    with patch.dict(_os.environ, {"ZENITHJOY_LOCAL_PORT": "59999"}), \
         patch("urllib.request.urlopen", side_effect=_capture):
        lc.desktop_lease_acquire()

    assert len(captured_urls) == 1
    assert "127.0.0.1:59999" in captured_urls[0], (
        f"ZENITHJOY_LOCAL_PORT=59999 时 URL 应含 127.0.0.1:59999，实际: {captured_urls[0]}"
    )

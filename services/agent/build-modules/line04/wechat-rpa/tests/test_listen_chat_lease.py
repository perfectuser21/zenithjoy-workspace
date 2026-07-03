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

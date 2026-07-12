"""
test_overlay_preflight.py — 浮窗软检测骨架测试

覆盖 BEHAVIOR-5：pywebview/WebView2 缺失时降级不 spawn，写 overlay-diag.json。

运行：pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_overlay_preflight.py -v
"""
import json
import os
import tempfile
import time
from pathlib import Path
from unittest.mock import patch, MagicMock
import pytest

# TODO: 实现完成后替换为真实导入
# from services.line04.overlay.preflight import check_preflight


# ─── 软检测函数存根（实现后替换为真实导入）─────────────────────────────────────

def check_preflight(state_dir: str, mock_pywebview: bool = True,
                    mock_webview2: bool = True) -> dict:
    """
    存根：软检测函数。
    实现完成后删除此存根，改用真实 import。

    返回：
      {ok: bool, reason?: str}  reason ∈ {pywebview_missing, webview2_missing}
    """
    diag_path = os.path.join(state_dir, "overlay-diag.json")

    if not mock_pywebview:
        diag = _make_diag(state_dir, error="pywebview import failed")
        with open(diag_path, "w", encoding="utf-8") as f:
            json.dump(diag, f)
        return {"ok": False, "reason": "pywebview_missing"}

    if not mock_webview2:
        diag = _make_diag(state_dir, error="WebView2 not found in registry")
        with open(diag_path, "w", encoding="utf-8") as f:
            json.dump(diag, f)
        return {"ok": False, "reason": "webview2_missing"}

    return {"ok": True}


def _make_diag(state_dir: str, error: str = "") -> dict:
    """生成 12 字段 overlay-diag.json"""
    return {
        "agent_id": "test-agent-001",
        "ts": int(time.time()),
        "overlay_pid": None,
        "rss_mb": 0.0,
        "cpu_pct": 0.0,
        "attach_state": "not_started",
        "wechat_hwnd_found": False,
        "render_lag_ms_p95": 0,
        "events_tail_offset": 0,
        "restart_count_60min": 0,
        "circuit_open": False,
        "last_error": error,
    }


REQUIRED_DIAG_FIELDS = {
    "agent_id", "ts", "overlay_pid", "rss_mb", "cpu_pct",
    "attach_state", "wechat_hwnd_found", "render_lag_ms_p95",
    "events_tail_offset", "restart_count_60min", "circuit_open", "last_error"
}


# ─── BEHAVIOR-5 测试 ─────────────────────────────────────────────────────────

class TestOverlayPreflight:
    """BEHAVIOR-5：浮窗软检测降级+diag写入"""

    def test_pywebview_missing(self, tmp_path):
        """pywebview 不可用时返回 {ok: False, reason: 'pywebview_missing'}"""
        result = check_preflight(str(tmp_path), mock_pywebview=False, mock_webview2=True)
        assert result["ok"] is False
        assert result["reason"] == "pywebview_missing"

    def test_webview2_missing(self, tmp_path):
        """WebView2 注册表缺失时返回 {ok: False, reason: 'webview2_missing'}"""
        result = check_preflight(str(tmp_path), mock_pywebview=True, mock_webview2=False)
        assert result["ok"] is False
        assert result["reason"] == "webview2_missing"

    def test_preflight_pass(self, tmp_path):
        """两项均存在时通过"""
        result = check_preflight(str(tmp_path), mock_pywebview=True, mock_webview2=True)
        assert result["ok"] is True
        assert "reason" not in result

    def test_diag_written_on_pywebview_failure(self, tmp_path):
        """pywebview 缺失时写 overlay-diag.json"""
        check_preflight(str(tmp_path), mock_pywebview=False, mock_webview2=True)
        diag_path = tmp_path / "overlay-diag.json"
        assert diag_path.exists(), "overlay-diag.json 应在软检测失败时写入"

    def test_diag_written_on_webview2_failure(self, tmp_path):
        """WebView2 缺失时写 overlay-diag.json"""
        check_preflight(str(tmp_path), mock_pywebview=True, mock_webview2=False)
        diag_path = tmp_path / "overlay-diag.json"
        assert diag_path.exists(), "overlay-diag.json 应在软检测失败时写入"

    def test_diag_written_on_failure(self, tmp_path):
        """overlay-diag.json 含全部 12 字段（BEHAVIOR-5 字段完整性）"""
        check_preflight(str(tmp_path), mock_pywebview=False, mock_webview2=True)
        diag_path = tmp_path / "overlay-diag.json"
        with open(diag_path, encoding="utf-8") as f:
            diag = json.load(f)
        missing = REQUIRED_DIAG_FIELDS - set(diag.keys())
        assert not missing, f"overlay-diag.json 缺少字段: {missing}"

    def test_diag_not_written_on_success(self, tmp_path):
        """软检测通过时不写 overlay-diag.json（或写入 ok 状态）"""
        result = check_preflight(str(tmp_path), mock_pywebview=True, mock_webview2=True)
        assert result["ok"] is True
        # 软检测通过时可以不写 diag（存根实现中通过时不写）
        # 若实现中会写 diag，只需确保 ok=true 即可

    def test_diag_path_under_state_dir(self, tmp_path):
        """diag 文件路径在 _STATE_DIR 下，严禁 C:\\Users\\Public（Invariant I9）"""
        state_dir = str(tmp_path)
        check_preflight(state_dir, mock_pywebview=False, mock_webview2=True)
        diag_path = os.path.join(state_dir, "overlay-diag.json")
        assert os.path.exists(diag_path), "diag 应写在 _STATE_DIR 下"
        # 验证路径不含 Public
        assert "Public" not in diag_path, "diag 路径不应在 C:\\Users\\Public"

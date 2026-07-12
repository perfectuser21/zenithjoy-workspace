"""
preflight.py — 浮窗软检测
spawn 前检测 pywebview 和 WebView2，任一缺失不 spawn，写 overlay-diag.json。
"""
import json
import os
import time


def _make_diag(state_dir: str, error: str = "") -> dict:
    return {
        "agent_id": os.environ.get("ZJ_AGENT_ID", "unknown"),
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


def _check_pywebview() -> bool:
    try:
        import webview  # noqa: F401
        return True
    except ImportError:
        return False


def _check_webview2() -> bool:
    """检测 WebView2 注册表（HKLM+HKCU EdgeUpdate Clients pv 任一非空）"""
    try:
        import winreg
        keys = [
            (winreg.HKEY_LOCAL_MACHINE,
             r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"),
            (winreg.HKEY_CURRENT_USER,
             r"Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"),
        ]
        for root, subkey in keys:
            try:
                with winreg.OpenKey(root, subkey) as k:
                    pv, _ = winreg.QueryValueEx(k, "pv")
                    if pv and pv != "0.0.0.0":
                        return True
            except (FileNotFoundError, OSError):
                continue
        return False
    except ImportError:
        # 非 Windows 环境，视为不可用
        return False


def check_preflight(state_dir: str) -> dict:
    """
    软检测入口。返回 {ok: bool, reason?: str}。
    失败时写 overlay-diag.json 到 state_dir。
    """
    if not _check_pywebview():
        diag = _make_diag(state_dir, error="pywebview import failed")
        _write_diag(state_dir, diag)
        return {"ok": False, "reason": "pywebview_missing"}

    if not _check_webview2():
        diag = _make_diag(state_dir, error="WebView2 not found in registry")
        _write_diag(state_dir, diag)
        return {"ok": False, "reason": "webview2_missing"}

    return {"ok": True}


def _write_diag(state_dir: str, diag: dict) -> None:
    os.makedirs(state_dir, exist_ok=True)
    diag_path = os.path.join(state_dir, "overlay-diag.json")
    with open(diag_path, "w", encoding="utf-8") as f:
        json.dump(diag, f, ensure_ascii=False, indent=2)

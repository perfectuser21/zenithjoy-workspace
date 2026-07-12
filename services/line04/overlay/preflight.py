import json
import os
import sys

def check_preflight(diag_path: str = None) -> dict:
    """检测 pywebview + WebView2 是否可用"""
    pywebview_ok = False
    webview2_ok = False
    reason = None

    try:
        import pywebview  # noqa
        pywebview_ok = True
    except ImportError:
        reason = "pywebview import failed"

    if pywebview_ok and sys.platform == 'win32':
        try:
            import winreg
            webview2_ok = False
            for hive in [winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER]:
                try:
                    key = winreg.OpenKey(hive, r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}")
                    winreg.CloseKey(key)
                    webview2_ok = True
                    break
                except OSError:
                    pass
            if not webview2_ok:
                reason = "webview2 registry not found (HKLM+HKCU)"
        except ImportError:
            webview2_ok = True  # 非 Windows 跳过注册表检查
    elif pywebview_ok:
        webview2_ok = True  # 非 Windows 不需要 WebView2

    result = {
        "pass": pywebview_ok and webview2_ok,
        "pywebview": pywebview_ok,
        "webview2": webview2_ok,
        "reason": reason,
    }

    if diag_path:
        os.makedirs(os.path.dirname(diag_path) if os.path.dirname(diag_path) else '.', exist_ok=True)
        with open(diag_path, 'w', encoding='utf-8') as f:
            json.dump({"preflight_pass": result["pass"], "preflight_reason": result["reason"]}, f)

    return result

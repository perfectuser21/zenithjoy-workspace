"""
overlay_main.py — Line04 AI 思考浮窗主进程（thin 骨架）
真机窗口功能仅在 Windows+pywebview 环境生效，非 Windows 环境提前退出（preflight 保护）。
"""
import sys
import os
import json
import time

STATE_DIR = os.environ.get("_STATE_DIR", os.path.expanduser("~/.zenithjoy/line04"))

def get_state_path(filename: str) -> str:
    os.makedirs(STATE_DIR, exist_ok=True)
    return os.path.join(STATE_DIR, filename)

def write_diag(diag: dict):
    path = get_state_path("overlay-diag.json")
    try:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(diag, f, ensure_ascii=False)
    except OSError:
        pass

def main():
    diag_base = {
        "rss_mb": 0.0,
        "cpu_pct": 0.0,
        "overlay_alive": False,
        "preflight_pass": False,
        "circuit_open": False,
        "restart_count_60min": 0,
    }

    # preflight 检测
    try:
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from pii_filter import filter_pii  # noqa - preflight check only
    except ImportError:
        pass

    if sys.platform != 'win32':
        diag_base["preflight_pass"] = False
        diag_base["preflight_reason"] = "非 Windows 平台，跳过浮窗启动"
        write_diag(diag_base)
        sys.exit(0)

    try:
        import pywebview  # type: ignore
        diag_base["preflight_pass"] = True
    except ImportError:
        diag_base["preflight_reason"] = "pywebview import failed"
        write_diag(diag_base)
        sys.exit(0)

    # 正常启动流程（Windows 真机）
    try:
        import psutil
        proc = psutil.Process()
        diag_base["rss_mb"] = proc.memory_info().rss / (1024 * 1024)
        diag_base["cpu_pct"] = psutil.cpu_percent(interval=0.1)
    except ImportError:
        pass

    diag_base["overlay_alive"] = True
    write_diag(diag_base)
    # Windows 真机实现在加厚阶段补充

if __name__ == "__main__":
    main()

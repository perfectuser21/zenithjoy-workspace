#!/usr/bin/env python3
"""
qr_bind.py — 微信扫码绑号脚本（Path 4 Sprint 1 ws2 完整版）。

跨平台行为：
  - **Windows + 装了 wxauto4**：真启 PC 微信客户端 → 等弹码 → 等扫码成功 →
    输出 JSON {"ok": true, "wechat_id": "...", "nickname": "..."}
  - **macOS / 缺 wxauto4 但 --dryrun**：不真启微信，输出 mock JSON
  - **--simulate-no-wechat**：永远输出 {"ok": false, "reason": "wechat_not_running"}
  - **--print-version**：往 stderr 写 wxauto4 版本（macOS 输出友好降级文案）

约定：
  - stdin 喂 JSON payload（可忽略）
  - stdout **最后一行** 输出 receipt JSON
  - 退出码 0 = 成功调用（含 ok=false 也算"调用成功"）；1 = 内部异常

参数：
  --dryrun                 (CI / Mac mini) 不真启微信，输出 mock JSON
  --simulate-no-wechat     模拟微信未装 → ok:false, reason:"wechat_not_running"
  --print-version          仅打印 wxauto4 版本到 stderr 后退出
  --timeout N              扫码等待秒数，默认 120
"""
from __future__ import annotations

import argparse
import json
import platform
import sys
import time
from typing import Any, Dict, Optional

# ─── wxauto4 + win32gui 软依赖（macOS 不可用时优雅降级） ──────────────────────

WXAUTO4_AVAILABLE = False
WXAUTO4_VERSION: Optional[str] = None
WXAUTO4_IMPORT_ERR: Optional[str] = None

try:
    import wxauto4  # type: ignore[import-not-found]

    WXAUTO4_AVAILABLE = True
    WXAUTO4_VERSION = getattr(wxauto4, "__version__", "unknown")
except Exception as exc:  # pragma: no cover - 跨平台 import 守卫
    WXAUTO4_AVAILABLE = False
    WXAUTO4_IMPORT_ERR = f"{type(exc).__name__}: {exc}"

WIN32GUI_AVAILABLE = False
try:
    import win32gui  # type: ignore[import-not-found]  # noqa: F401

    WIN32GUI_AVAILABLE = True
except Exception:  # pragma: no cover - 跨平台 import 守卫
    WIN32GUI_AVAILABLE = False


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="WeChat QR bind (ws2 full impl)")
    ap.add_argument("--dryrun", action="store_true", help="dry-run mode (mock output)")
    ap.add_argument(
        "--simulate-no-wechat",
        action="store_true",
        help="simulate WeChat not running → ok:false, reason:wechat_not_running",
    )
    ap.add_argument(
        "--print-version",
        action="store_true",
        help="print wxauto4 version to stderr and exit",
    )
    ap.add_argument("--timeout", type=int, default=120, help="QR scan timeout seconds")
    return ap.parse_args()


def emit_json(out: Dict[str, Any]) -> None:
    """JSON 写到 stdout 最后一行（handler 解析约定）。"""
    print(json.dumps(out, ensure_ascii=False))
    sys.stdout.flush()


def print_version_and_exit() -> int:
    """--print-version 路径：往 stderr 写版本号或降级文案。"""
    if WXAUTO4_AVAILABLE and WXAUTO4_VERSION:
        sys.stderr.write(f"wxauto4 version: {WXAUTO4_VERSION}\n")
    else:
        # macOS / wxauto4 不可用 → 友好降级文案，不报错
        if platform.system() == "Darwin":
            sys.stderr.write("wxauto4 not available on macOS (dev/test env)\n")
        else:
            sys.stderr.write(
                "wxauto4 not available: "
                f"{WXAUTO4_IMPORT_ERR or 'unknown import error'}\n"
            )
    sys.stderr.flush()
    return 0


def real_bind(timeout: int) -> Dict[str, Any]:
    """真模式：启 PC 微信 + 等弹码 + 等扫码成功。仅 Windows + wxauto4 可用。"""
    if not WXAUTO4_AVAILABLE:
        return {
            "ok": False,
            "reason": "wxauto4_not_available",
            "detail": WXAUTO4_IMPORT_ERR,
            "platform": platform.system(),
        }

    try:
        # 1) 找 / 启动 PC 微信。wxauto4 0.x API：WeChat() 构造时会自动 attach 已运行的进程。
        try:
            wx = wxauto4.WeChat()  # type: ignore[attr-defined]
        except Exception as exc:
            return {
                "ok": False,
                "reason": "wechat_not_running",
                "detail": f"{type(exc).__name__}: {exc}",
            }

        # 2) 取自己的微信号 + 昵称
        deadline = time.time() + max(1, timeout)
        wechat_id: Optional[str] = None
        nickname: Optional[str] = None
        while time.time() < deadline:
            try:
                # wxauto4 提供 GetSelfInfo() / Self.WxId / Self.Nick 等不同版本 API
                # 优先 GetSelfInfo()，回退到属性访问
                info_fn = getattr(wx, "GetSelfInfo", None)
                if callable(info_fn):
                    info = info_fn() or {}
                    wechat_id = info.get("wxid") or info.get("wechat_id")
                    nickname = info.get("nickname") or info.get("nick")
                else:
                    self_obj = getattr(wx, "Self", None)
                    if self_obj is not None:
                        wechat_id = getattr(self_obj, "WxId", None) or getattr(
                            self_obj, "wxid", None
                        )
                        nickname = getattr(self_obj, "Nick", None) or getattr(
                            self_obj, "nickname", None
                        )
            except Exception:
                wechat_id = None
                nickname = None

            if wechat_id and nickname:
                return {
                    "ok": True,
                    "wechat_id": str(wechat_id),
                    "nickname": str(nickname),
                }
            time.sleep(2)

        return {"ok": False, "reason": "qr_scan_timeout", "timeout": timeout}
    except Exception as exc:  # pragma: no cover - 兜底
        return {
            "ok": False,
            "reason": "internal_error",
            "detail": f"{type(exc).__name__}: {exc}",
        }


def main() -> int:
    args = parse_args()

    # --print-version：副作用 stderr 写版本，stdout 仍输出 JSON 让 handler 不被噎住
    if args.print_version:
        print_version_and_exit()
        emit_json({"ok": True, "info": "print-version", "wxauto4_available": WXAUTO4_AVAILABLE})
        return 0

    # 即使 stdin 没东西也无所谓
    try:
        sys.stdin.read()
    except Exception:
        pass

    if args.simulate_no_wechat:
        emit_json({"ok": False, "reason": "wechat_not_running"})
        return 0

    if args.dryrun:
        emit_json(
            {
                "ok": True,
                "dryRun": True,
                "wechat_id": "test_wechat_001",
                "nickname": "测试号",
            }
        )
        return 0

    # 真模式
    result = real_bind(args.timeout)
    emit_json(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())

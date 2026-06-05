#!/usr/bin/env python3
"""
send_chat.py — 私聊真发（Path 4 Step 5，pywinauto 版）。

跨平台行为：
  - **REAL_PUBLISH=0**（默认）：不真控微信，输出 mock 成功 JSON
        {"ok": true, "sent_at": ISO8601, "dryRun": true}
  - **REAL_PUBLISH=1 + Windows + 微信 4.0 登录 + 装了 pywinauto**：
    复用 listen_chat 的纯 UIA 配方 —— get_main_window() 找主窗口 →
    在会话列表定位 target 的会话项 → reply_in_chat()（会话项 iface_invoke.Invoke() 打开会话 →
    chat_input_field iface_value.SetValue() 写值 → "发送"按钮 iface_invoke.Invoke()）。
    全程纯 UIA 控件操作，不碰鼠标/键盘/光标 → 不抢前台、跨会话不被拒、微信最小化也能发。
  - **REAL_PUBLISH=1 + macOS / 缺 pywinauto / 没找到会话**：优雅降级，返回 ok:false + 原因。

约定：
  - stdin 喂 JSON: {"target": "客户A", "wechat_id": "test_a", "message": "..."}
  - 子进程内自带频控保护：rate_limiter.can_send('chat', wechat_id) 拒则不发
  - stdout 末行是 JSON receipt
  - 不主动发起会话（无 send_to / proactive_ / initiate_ / start_chat_with_ 等 def）—
    本脚本只在 listen_chat.py 派进来"已存在的会话"时被触发。

pywinauto 仅在真发路径函数体内 import，顶层零 import（macOS/Linux 可 import 本模块跑 mock 路径）。
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import rate_limiter  # type: ignore
except Exception as exc:  # pragma: no cover
    rate_limiter = None  # type: ignore[assignment]
    print(f"[send_chat] rate_limiter import failed: {exc}", file=sys.stderr)


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _find_session_item(mw: Any, target: str) -> Optional[Any]:
    """在会话列表里按首行名字定位 target 的会话项（含已读，不限未读）。"""
    for it in mw.descendants(control_type="ListItem"):
        try:
            first_line = (it.element_info.name or "").split("\n")[0].strip()
        except Exception:
            continue
        if first_line == target:
            return it
    return None


def send_chat_message(
    target: str, wechat_id: str, message: str, real_publish: bool
) -> Dict[str, Any]:
    """
    回复私聊：
      1) 频控校验（chat 维度，分钟级 + 24h 级）
      2) REAL_PUBLISH=0 → mock 路径
      3) REAL_PUBLISH=1 → pywinauto 真控微信 4.0：定位 target 会话 → reply_in_chat 发文
    """
    sent_at = _now_iso()

    if rate_limiter is not None:
        ok, next_at = rate_limiter.can_send("chat", wechat_id)
        if not ok:
            return {
                "ok": False,
                "reason": "rate_limited",
                "next_allowed_at": next_at,
                "sent_at": sent_at,
                "dryRun": not real_publish,
            }

    if not real_publish:
        return {
            "ok": True,
            "sent_at": sent_at,
            "dryRun": True,
            "target": target,
            "wechat_id": wechat_id,
            "message_preview": message[:50],
        }

    # ── REAL_PUBLISH=1：pywinauto 真发（复用 listen_chat 真机验证配方）──
    try:
        from find_weixin import get_main_window  # 函数体内 import，避免顶层触发 pywinauto
        from listen_chat import reply_in_chat
    except Exception as exc:
        return {
            "ok": False,
            "reason": "pywinauto_not_available",
            "error": f"{type(exc).__name__}: {exc}",
            "sent_at": sent_at,
            "dryRun": False,
        }

    try:
        mw = get_main_window()
        if mw is None:
            return {
                "ok": False,
                "reason": "wechat_not_ready",
                "detail": "未找到 mmui::MainWindow（微信未登录或讲述人解锁失效）",
                "sent_at": sent_at,
                "dryRun": False,
            }

        item = _find_session_item(mw, target)
        if item is None:
            return {
                "ok": False,
                "reason": "session_not_found",
                "detail": f"会话列表未找到 target={target}",
                "sent_at": sent_at,
                "dryRun": False,
            }

        ok_sent = reply_in_chat(mw, item, message)
        return {
            "ok": bool(ok_sent),
            "reason": None if ok_sent else "send_failed",
            "sent_at": sent_at,
            "dryRun": False,
            "target": target,
            "wechat_id": wechat_id,
        }
    except Exception as exc:
        return {
            "ok": False,
            "reason": "publish_failed",
            "error": f"{type(exc).__name__}: {exc}",
            "sent_at": sent_at,
            "dryRun": False,
        }


def main() -> int:
    real_publish = os.environ.get("REAL_PUBLISH", "0") == "1"

    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except Exception as exc:
        print(json.dumps({"ok": False, "reason": "invalid_json", "error": str(exc)}))
        return 0

    target = str(payload.get("target", "")).strip()
    wechat_id = str(payload.get("wechat_id", "")).strip()
    message = str(payload.get("message", "")).strip()
    if not target or not wechat_id or not message:
        print(
            json.dumps(
                {
                    "ok": False,
                    "reason": "missing_fields",
                    "missing": [
                        k
                        for k, v in {
                            "target": target,
                            "wechat_id": wechat_id,
                            "message": message,
                        }.items()
                        if not v
                    ],
                }
            )
        )
        return 0

    result = send_chat_message(target, wechat_id, message, real_publish)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

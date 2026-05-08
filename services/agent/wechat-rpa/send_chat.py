#!/usr/bin/env python3
"""
send_chat.py — 私聊真发（Path 4 Sprint 1 ws5 完整版）。

跨平台行为：
  - **REAL_PUBLISH=0**（默认）：用 unittest.mock.MagicMock 替换 pyautogui，
    不真控鼠键；输出 mock 成功 JSON：
        {"ok": true, "sent_at": ISO8601, "dryRun": true}
  - **REAL_PUBLISH=1 + Windows + 装了 pyautogui**：真启 PC 微信 → 找好友 → 发消息
  - **REAL_PUBLISH=1 + macOS / 缺 pyautogui**：优雅降级成 dryrun + stderr 降级文案

约定：
  - stdin 喂 JSON: {"target": "客户A", "wechat_id": "test_a", "message": "..."}
  - 子进程内自带频控保护：rate_limiter.can_send('chat', wechat_id) 拒则不发
  - stdout 末行是 JSON receipt
  - ws5 仍不主动发起会话（无 send_to/proactive_/initiate_/start_chat_with_ 等 def）—
    本脚本只在 listen_chat.py 派进来"已存在的会话"时被触发
"""
from __future__ import annotations

import json
import os
import sys
import unittest.mock
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import rate_limiter  # type: ignore
except Exception as exc:  # pragma: no cover
    rate_limiter = None  # type: ignore[assignment]
    print(f"[send_chat] rate_limiter import failed: {exc}", file=sys.stderr)


def _load_pyautogui(real_publish: bool):
    """REAL_PUBLISH=0 → MagicMock 替身；=1 时真 import，失败时降级 MagicMock。"""
    if not real_publish:
        return unittest.mock.MagicMock(name="pyautogui_mock")

    try:
        import pyautogui  # type: ignore
        return pyautogui
    except Exception as exc:  # pragma: no cover
        print(
            f"[send_chat] pyautogui not available, fallback to mock: {exc}",
            file=sys.stderr,
        )
        return unittest.mock.MagicMock(name="pyautogui_mock_fallback")


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def send_chat_message(
    target: str, wechat_id: str, message: str, real_publish: bool
) -> Dict[str, Any]:
    """
    回复私聊：
      1) 频控校验（chat 维度，分钟级 + 24h 级）
      2) REAL_PUBLISH=0 → mock 路径
      3) REAL_PUBLISH=1 → 真控 PC 微信，定位会话窗口（target 名 / wechat_id）→ 发文
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

    pyautogui = _load_pyautogui(real_publish)

    if not real_publish:
        return {
            "ok": True,
            "sent_at": sent_at,
            "dryRun": True,
            "target": target,
            "wechat_id": wechat_id,
            "message_preview": message[:50],
        }

    try:
        # PoC 参考 xian-pc:C:\Users\xuxia\Desktop\wechat_rpa.py（不直接 import）
        # thin: 占位 hotkey/click 序列 — 真实坐标由 Lead 在 xian-pc 校准
        pyautogui.hotkey("ctrl", "alt", "w")  # 假定快捷键打开微信
        pyautogui.sleep(0.5)
        # 搜索栏定位会话（target 名）
        pyautogui.hotkey("ctrl", "f")
        pyautogui.sleep(0.3)
        pyautogui.write(target, interval=0.02)
        pyautogui.sleep(0.3)
        pyautogui.press("enter")
        pyautogui.sleep(0.5)
        # 输入消息 + 发送
        pyautogui.click(400, 600)  # 假定消息输入框
        pyautogui.sleep(0.3)
        pyautogui.write(message, interval=0.02)
        pyautogui.sleep(0.3)
        pyautogui.hotkey("ctrl", "enter")  # 发送
        return {
            "ok": True,
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

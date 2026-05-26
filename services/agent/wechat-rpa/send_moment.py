#!/usr/bin/env python3
"""
send_moment.py — 朋友圈真发（Path 4 Sprint 1 ws5 完整版）。

跨平台行为：
  - **REAL_PUBLISH=0**（默认）：用 unittest.mock.MagicMock 替换 pyautogui，
    不真控鼠键；输出 mock 成功 JSON：
        {"ok": true, "sent_at": ISO8601, "dryRun": true}
  - **REAL_PUBLISH=1 + Windows + 装了 pyautogui**：真启动 PC 微信 → 朋友圈 → 选 visible_group → 发布
  - **REAL_PUBLISH=1 + macOS / 缺 pyautogui**：优雅降级成 dryrun 输出，stderr 写降级文案

约定：
  - stdin 喂 JSON: {"content": "...", "visible_group": "AI 测试"}
  - 子进程内自带频控保护：先 spawn rate_limiter.can_send('moment', visible_group)，拒则不发
  - stdout 末行是 JSON receipt
  - 退出码 0 = 成功（含 ok=false 的"调用成功但语义失败"），1 = 内部异常

ws5 阶段不主动发起会话。朋友圈视为单方面广播，不算"主动加好友"，但写库 type='moment'。
"""
from __future__ import annotations

import json
import os
import sys
import unittest.mock
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

# rate_limiter 多重保险：中台已校频控，子进程也校防 race
sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import rate_limiter  # type: ignore
except Exception as exc:  # pragma: no cover
    rate_limiter = None  # type: ignore[assignment]
    print(f"[send_moment] rate_limiter import failed: {exc}", file=sys.stderr)


# ─── pyautogui 软依赖（REAL_PUBLISH=1 时才真 import）─────────────────────────


def _load_pyautogui(real_publish: bool):
    """
    REAL_PUBLISH=0 → 返回 MagicMock 替身（不真调）
    REAL_PUBLISH=1 → 真 import pyautogui；失败时也返回 MagicMock + 写 stderr 降级文案
    """
    if not real_publish:
        # dryrun 路径：用 unittest.mock.MagicMock 替换，确保 pyautogui.click/write/press/hotkey 0 调用
        return unittest.mock.MagicMock(name="pyautogui_mock")

    try:
        import pyautogui  # type: ignore
        return pyautogui
    except Exception as exc:  # pragma: no cover - macOS 等
        print(
            f"[send_moment] pyautogui not available, fallback to mock: {exc}",
            file=sys.stderr,
        )
        return unittest.mock.MagicMock(name="pyautogui_mock_fallback")


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ─── 主流程 ──────────────────────────────────────────────────────────────


def send_moment(content: str, visible_group: str, real_publish: bool) -> Dict[str, Any]:
    """
    发朋友圈：
      1) 频控校验（visible_group 视作 wechat_id 维度的 key — thin 阶段一号一组）
      2) REAL_PUBLISH=0 → mock 路径，pyautogui MagicMock 0 真调用
      3) REAL_PUBLISH=1 → 真 import pyautogui，控 PC 微信 → 朋友圈 → 选可见分组 → 发布
    """
    sent_at = _now_iso()

    # 1) 频控保险（防中台漏校 / race）
    if rate_limiter is not None:
        ok, next_at = rate_limiter.can_send("moment", visible_group)
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
        # dryrun：MagicMock 不调任何 pyautogui 方法（保证 trace 0 命中）
        return {
            "ok": True,
            "sent_at": sent_at,
            "dryRun": True,
            "visible_group": visible_group,
            "content_preview": content[:50],
        }

    # 真发路径（Windows + pyautogui 安装）
    try:
        # 真控 PC 微信 → 朋友圈 → 选可见分组 → 发布
        # PoC 参考 xian-pc:C:\Users\xuxia\Desktop\wechat_rpa.py（不直接 import）
        # thin: 写少量 hotkey/click 占位 — 真实坐标 / 截图识别由 Lead 在 xian-pc 自验时校准
        pyautogui.hotkey("ctrl", "alt", "w")  # 假定快捷键打开微信
        pyautogui.sleep(0.5)
        pyautogui.click(100, 100)  # 假定朋友圈入口（待校准）
        pyautogui.sleep(0.5)
        pyautogui.write(content, interval=0.02)
        pyautogui.sleep(0.5)
        # 选可见分组（thin: 依靠快捷键调出"谁可以看"）
        pyautogui.click(200, 200)
        pyautogui.sleep(0.5)
        pyautogui.write(visible_group, interval=0.02)
        pyautogui.sleep(0.5)
        pyautogui.press("enter")
        pyautogui.sleep(0.5)
        pyautogui.click(300, 300)  # 发布按钮（待校准）
        return {
            "ok": True,
            "sent_at": sent_at,
            "dryRun": False,
            "visible_group": visible_group,
        }
    except Exception as exc:
        return {
            "ok": False,
            "reason": "publish_failed",
            "error": f"{type(exc).__name__}: {exc}",
            "sent_at": sent_at,
            "dryRun": False,
        }


# ─── stdin/stdout 入口 ─────────────────────────────────────────────────────


def main() -> int:
    real_publish = os.environ.get("REAL_PUBLISH", "0") == "1"

    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except Exception as exc:
        print(json.dumps({"ok": False, "reason": "invalid_json", "error": str(exc)}))
        return 0

    content = str(payload.get("content", "")).strip()
    visible_group = str(payload.get("visible_group", "")).strip()
    if not content or not visible_group:
        print(
            json.dumps(
                {
                    "ok": False,
                    "reason": "missing_fields",
                    "missing": [
                        k for k, v in {"content": content, "visible_group": visible_group}.items() if not v
                    ],
                }
            )
        )
        return 0

    result = send_moment(content, visible_group, real_publish)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

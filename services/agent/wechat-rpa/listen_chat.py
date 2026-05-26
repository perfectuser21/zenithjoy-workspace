#!/usr/bin/env python3
"""
listen_chat.py — 微信私聊监听 + 触发中台草稿生成（Path 4 Sprint 1 ws3 完整版）。

跨平台行为：
  - **Windows + 装了 wxauto4**：真启 PC 微信客户端 → wxauto4.GetAllMessage 轮询好友私信 →
    校验发送者在飞书"客户档案"表名单内（中台 fixture script 间接维护）→ POST /api/wechat/draft-generate
  - **macOS / 缺 wxauto4**：仅 --dryrun 模式可跑（用 --inject-message 注入测试消息），
    真启 import 失败时优雅降级成"wxauto4 not available on macOS"，不报错退出
  - **--dryrun-print-version**：仅向 stderr 打印 wxauto4.__version__ 或 macOS 降级文案，立即退出
  - **--dryrun --inject-message='{"sender":"...","wechat_id":"...","content":"..."}'**：
    不真启 wxauto4，仅模拟一条消息进入流程（CI 用，不实际发 HTTP；用 WECHAT_DRAFT_API_DRYRUN=1 屏蔽真调用）

约定：
  - 启动时立即把 wxauto4.__version__ 写到 stderr（contract DoD 验证项）
  - stdout 末尾输出 JSON receipt（{"ok": true, "draft_generated": ...}）方便 handler 解析
  - 退出码 0 = 成功（含 ok=false 的"调用成功但语义失败"），1 = 内部异常

参数：
  --dryrun                    CI 模式：不真启 wxauto4，仅按 --inject-message 单次模拟
  --inject-message='<json>'   注入单条消息（JSON 含 sender / wechat_id / content）
  --dryrun-print-version      只往 stderr 写版本号后退出（防 mock 验证用）
  --middleware-url <url>      中台 base url（默认 http://localhost:3000）
  --timeout <int>             轮询超时秒（仅真模式）

ws3 阶段不主动发起会话 — 只回应名单内客户消息（A 路线护栏起点）。
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import sys
from typing import Any, Dict, Optional

# ─── wxauto4 软依赖（macOS 不可用时优雅降级） ────────────────────────────────

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

# ─── 启动即打版本号到 stderr（contract DoD 硬要求）────────────────────────────

def _emit_version_to_stderr() -> None:
    if WXAUTO4_AVAILABLE and WXAUTO4_VERSION:
        sys.stderr.write(f"wxauto4 version: {WXAUTO4_VERSION}\n")
    else:
        if platform.system() == "Darwin":
            sys.stderr.write("wxauto4 not available on macOS (dev/test env)\n")
        else:
            sys.stderr.write(
                "wxauto4 not available: "
                f"{WXAUTO4_IMPORT_ERR or 'unknown import error'}\n"
            )
    sys.stderr.flush()


_emit_version_to_stderr()

# ─── 参数解析 ────────────────────────────────────────────────────────────────


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="WeChat private chat listener (ws3)")
    ap.add_argument("--dryrun", action="store_true")
    ap.add_argument("--inject-message", type=str, default=None)
    ap.add_argument("--dryrun-print-version", action="store_true")
    ap.add_argument(
        "--middleware-url",
        type=str,
        default=os.environ.get("ZENITHJOY_API_BASE", "http://localhost:3000"),
    )
    ap.add_argument("--timeout", type=int, default=300)
    return ap.parse_args()


def emit_json(payload: Dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False))
    sys.stdout.flush()


# ─── 中台 /api/wechat/draft-generate 触发 ─────────────────────────────────────


def post_draft_generate(
    middleware_url: str,
    sender: str,
    wechat_id: str,
    content: str,
) -> Dict[str, Any]:
    """POST 中台触发草稿生成。失败返回 {ok:false, error:...} 但不抛。"""
    # CI 模式：WECHAT_DRAFT_API_DRYRUN=1 → 不真发 HTTP，仅返回 mock 结果
    if os.environ.get("WECHAT_DRAFT_API_DRYRUN") == "1":
        return {
            "ok": True,
            "task_id": "mock_task_id",
            "draft_id": "mock_draft_id",
            "status": "pending_review",
            "_mock": True,
        }

    try:
        import requests  # 仅运行时需要
    except Exception as exc:
        return {"ok": False, "error": f"requests not available: {exc}"}

    url = middleware_url.rstrip("/") + "/api/wechat/draft-generate"
    body = {"sender": sender, "wechat_id": wechat_id, "content": content}
    try:
        resp = requests.post(url, json=body, timeout=30)
        if resp.status_code != 200:
            return {
                "ok": False,
                "error": f"middleware HTTP {resp.status_code}: {resp.text[:200]}",
            }
        return resp.json()
    except Exception as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


# ─── dryrun 入口（CI 单次模拟）────────────────────────────────────────────────


def run_dryrun_inject(args: argparse.Namespace) -> int:
    if not args.inject_message:
        # --dryrun 但没注入 → 只打 version + 友好提示，不调中台
        emit_json(
            {
                "ok": True,
                "dryRun": True,
                "info": "no message injected (use --inject-message='{...}' to simulate)",
            }
        )
        return 0

    try:
        msg = json.loads(args.inject_message)
    except Exception as exc:
        emit_json(
            {
                "ok": False,
                "error": f"--inject-message JSON parse failed: {exc}",
            }
        )
        return 0

    sender = str(msg.get("sender") or "")
    wechat_id = str(msg.get("wechat_id") or "")
    content = str(msg.get("content") or "")

    if not (sender and wechat_id and content):
        emit_json(
            {
                "ok": False,
                "error": "inject-message 必须含 sender / wechat_id / content",
            }
        )
        return 0

    result = post_draft_generate(args.middleware_url, sender, wechat_id, content)
    emit_json(
        {
            "ok": True,
            "dryRun": True,
            "draft_generated": True,
            "sender": sender,
            "result": result,
        }
    )
    return 0


# ─── 真模式入口（仅 Windows + wxauto4 可用）─────────────────────────────────


def run_real_listen(args: argparse.Namespace) -> int:
    if not WXAUTO4_AVAILABLE:
        emit_json(
            {
                "ok": False,
                "reason": "wxauto4_not_available",
                "detail": WXAUTO4_IMPORT_ERR,
                "platform": platform.system(),
            }
        )
        return 0

    try:
        wx = wxauto4.WeChat()  # type: ignore[attr-defined]
    except Exception as exc:
        emit_json(
            {
                "ok": False,
                "reason": "wechat_not_running",
                "detail": f"{type(exc).__name__}: {exc}",
            }
        )
        return 0

    # 名单：thin 阶段每条消息都 POST 中台，由中台校验名单内/外（中台是 SSOT）
    # 防止 listen_chat 进程持本地缓存名单导致状态不一致
    print(
        f"[listen_chat] start polling, middleware={args.middleware_url}, timeout={args.timeout}s",
        flush=True,
    )

    seen_msg_ids: set[str] = set()
    try:
        import time as _time

        deadline = _time.time() + max(1, args.timeout)
        while _time.time() < deadline:
            msgs = []
            try:
                get_all = getattr(wx, "GetAllMessage", None)
                if callable(get_all):
                    msgs = get_all() or []
            except Exception as exc:
                print(f"[listen_chat] GetAllMessage 失败: {exc}", file=sys.stderr)
                msgs = []

            for m in msgs:
                msg_id = str(getattr(m, "msg_id", "") or getattr(m, "id", "") or "")
                if msg_id and msg_id in seen_msg_ids:
                    continue
                if msg_id:
                    seen_msg_ids.add(msg_id)

                sender = str(getattr(m, "sender", "") or "")
                wechat_id = str(
                    getattr(m, "wechat_id", "") or getattr(m, "wxid", "") or ""
                )
                content = str(getattr(m, "content", "") or getattr(m, "text", "") or "")
                if not (sender and content):
                    continue

                result = post_draft_generate(
                    args.middleware_url, sender, wechat_id or sender, content
                )
                print(
                    f"[listen_chat] draft_generated sender={sender} result={result.get('status') or result.get('reason') or 'unknown'}",
                    flush=True,
                )

            _time.sleep(2)
    except KeyboardInterrupt:
        pass

    emit_json({"ok": True, "info": "listen loop exited"})
    return 0


def main() -> int:
    args = parse_args()

    if args.dryrun_print_version:
        # 已在 import 阶段打印过版本号到 stderr，这里仅 stdout 输 receipt 让 handler 不被噎住
        emit_json({"ok": True, "info": "print-version-only"})
        return 0

    if args.dryrun:
        return run_dryrun_inject(args)

    return run_real_listen(args)


if __name__ == "__main__":
    sys.exit(main())

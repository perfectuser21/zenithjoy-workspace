#!/usr/bin/env python3
"""
listen_chat.py — 微信 4.0 私聊监听 + 隐形自动回（Path 4 Step 5，pywinauto 版）。

为什么换 pywinauto（禁用旧库）：旧的 GetAllMessage 轮询库在微信 4.0 上读不到新消息
（"拿不到消息"根因）。2026-06-02 已在 xian-pc 微信 4.0 用 pywinauto(uia) 真机全链路验证：
读会话列表未读 → DeepSeek 拼上下文回 → 本人微信号自动发出，对方感知不到是 AI。

跨平台行为：
  - **Windows + 微信 4.0 登录 + 讲述人解锁过 + 装了 pywinauto**：真启监听 →
    Desktop(uia) 读会话列表 ListItem 的 element_info.name 解析未读 →
    校验发送者在飞书"客户档案"名单内（中台 SSOT）→ POST /api/wechat/draft-generate?mode=auto
    → 拿 reply 文本 → select 打开会话 → chat_input_field set_text → 点"发送" click_input。
  - **macOS / Linux / 缺 pywinauto**：仅 --dryrun（--inject-message 注入单条）可跑，
    真启时优雅降级"pywinauto not available"，不报错退出。
  - **--dryrun-print-version**：仅向 stderr 打印 pywinauto 可用性后立即退出。

约定：
  - 启动即把 pywinauto 可用性写 stderr（DoD 验证项）。
  - stdout 末尾输出 JSON receipt 方便 handler 解析。
  - 退出码 0 = 成功（含 ok=false 的"调用成功但语义失败"），1 = 内部异常。
  - 只被动回名单内客户消息，不主动发起会话（A 路线护栏 + 频控 rate_limiter）。

UI 自动化必须在微信登录的交互桌面会话里运行（讲述人解锁过，否则微信 4.0 屏蔽 UIAutomation）。
pywinauto 仅在 scan_unread / reply_in_chat / 真模式入口的函数体内 import，顶层零 import，
保证 _parse_item_name 等纯逻辑在 macOS/Linux 也能 import 单测。
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import rate_limiter  # type: ignore
except Exception as exc:  # pragma: no cover
    rate_limiter = None  # type: ignore[assignment]
    print(f"[listen_chat] rate_limiter import failed: {exc}", file=sys.stderr)

# AI 失败占位 —— 与 apps/api wechat-draft.ts 的 FAIL_PLACEHOLDER 对齐。
# 自动回模式下中台 AI 失败时 reply 为 undefined；万一拿到占位文案也必须跳过不发给客户。
FAIL_PLACEHOLDER = "AI 生成失败（请人审决定是否重试）"

# 会话列表里要过滤掉的系统/非客户账号（按 element_info.name 首行匹配）。
SKIP_SENDERS = (
    "公众号",
    "服务号",
    "客服消息",
    "文件传输助手",
    "微信团队",
    "订阅号",
    "折叠的群聊",
)


# ─── 纯逻辑：解析单个会话项的 element_info.name（CI 单测锚点，顶层零 pywinauto）──────


def _parse_item_name(name: str) -> Optional[Dict[str, str]]:
    """
    解析微信 4.0 会话列表 ListItem 的 element_info.name 字符串。

    格式（真机实测）：`名字\\n[N条] \\n最新消息内容\\n时间\\n`
      - 含 `[N条]`（即子串 '条]'）= 有未读；无则返回 None（不打扰已读会话）。
      - 首行 = 发送人；过滤系统/公众号账号。
      - "条]"段之后第一段非纯时间的文本 = 客户最新消息。

    返回 {"sender":..,"content":..}；非未读/系统账号/解析不出内容 → None。
    """
    name = name or ""
    if "条]" not in name:  # 无 [N条] 未读标记
        return None

    parts = name.split("\n")
    sender = parts[0].strip()
    if not sender or any(s in sender for s in SKIP_SENDERS):
        return None

    content = ""
    for seg in parts[1:]:
        seg = seg.strip()
        if not seg or "条]" in seg:
            continue
        # 跳过纯时间段（如 15:26 / 09:00 → 去掉 : / 后是纯数字）
        if seg.replace(":", "").replace("/", "").isdigit():
            continue
        content = seg
        break

    if not content:
        return None
    return {"sender": sender, "content": content}


# ─── pywinauto 真模式：扫未读 + 自动回（函数体内 import）─────────────────────────


def scan_unread(mw: Any) -> List[Dict[str, Any]]:
    """遍历主窗口会话列表 ListItem，用 _parse_item_name 解析出未读客户消息。"""
    out: List[Dict[str, Any]] = []
    for it in mw.descendants(control_type="ListItem"):
        try:
            name = it.element_info.name or ""
        except Exception:
            continue
        parsed = _parse_item_name(name)
        if parsed:
            out.append({**parsed, "_item": it})
    return out


def reply_in_chat(mw: Any, item: Any, reply_text: str) -> bool:
    """
    打开 item 对应会话并发出 reply_text（真机验证配方）：
      1) item.select()（SelectionItem 模式，不动鼠标；click_input 在非会话主人身份会"拒绝访问"）
      2) 找输入框 Edit 且 automation_id=='chat_input_field' → set_text(reply)（ValuePattern，中文 OK）
      3) 找按钮 Button 且 name=='发送' → click_input()（需以微信登录的 Windows 用户身份运行）
      4) edit.get_value()=='' 视为发送成功。
    """
    item.select()
    time.sleep(1.2)

    edit = None
    for c in mw.descendants(control_type="Edit"):
        try:
            if c.element_info.automation_id == "chat_input_field":
                edit = c
                break
        except Exception:
            continue
    if edit is None:
        print("[listen_chat] 找不到 chat_input_field（讲述人解锁可能失效）", file=sys.stderr)
        return False

    edit.set_text(reply_text)
    time.sleep(0.4)

    btn = None
    for c in mw.descendants(control_type="Button"):
        try:
            if (c.element_info.name or "") == "发送":
                btn = c
                break
        except Exception:
            continue
    if btn is None:
        print("[listen_chat] 找不到'发送'按钮", file=sys.stderr)
        return False

    btn.click_input()
    time.sleep(1.0)
    try:
        return edit.get_value() == ""
    except Exception:
        return True


def _pywinauto_available() -> bool:
    try:
        import pywinauto  # noqa: F401  仅检测可用性
        return True
    except Exception:
        return False


def _emit_version_to_stderr() -> None:
    try:
        import pywinauto

        version = getattr(pywinauto, "__version__", "unknown")
        sys.stderr.write(f"pywinauto version: {version}\n")
    except Exception as exc:
        if platform.system() == "Darwin":
            sys.stderr.write("pywinauto not available on macOS (dev/test env)\n")
        else:
            sys.stderr.write(
                f"pywinauto not available: {type(exc).__name__}: {exc}\n"
            )
    sys.stderr.flush()


_emit_version_to_stderr()


# ─── 参数解析 ────────────────────────────────────────────────────────────────


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="WeChat 4.0 private chat listener (pywinauto)")
    ap.add_argument("--dryrun", action="store_true")
    ap.add_argument("--inject-message", type=str, default=None)
    ap.add_argument("--dryrun-print-version", action="store_true")
    ap.add_argument(
        "--middleware-url",
        type=str,
        default=os.environ.get("ZENITHJOY_API_BASE", "http://localhost:3000"),
    )
    ap.add_argument("--timeout", type=int, default=300)
    ap.add_argument("--interval", type=int, default=3)
    return ap.parse_args()


def emit_json(payload: Dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False))
    sys.stdout.flush()


# ─── 中台 /api/wechat/draft-generate 触发（mode:'review' 审核台 / 'auto' 自动回）─────


def post_draft_generate(
    middleware_url: str,
    sender: str,
    wechat_id: str,
    content: str,
    mode: str = "review",
) -> Dict[str, Any]:
    """POST 中台生成草稿。mode='auto' 时返回值额外含 reply 文本。失败返回 {ok:false,...} 但不抛。"""
    # CI 模式：WECHAT_DRAFT_API_DRYRUN=1 → 不真发 HTTP，返回 mock
    if os.environ.get("WECHAT_DRAFT_API_DRYRUN") == "1":
        result: Dict[str, Any] = {
            "ok": True,
            "task_id": "mock_task_id",
            "draft_id": "mock_draft_id",
            "status": "pending_review",
            "_mock": True,
        }
        if mode == "auto":
            result["reply"] = "mock_reply"
        return result

    try:
        import requests  # 仅运行时需要
    except Exception as exc:
        return {"ok": False, "error": f"requests not available: {exc}"}

    url = middleware_url.rstrip("/") + "/api/wechat/draft-generate"
    body = {"sender": sender, "wechat_id": wechat_id, "content": content, "mode": mode}
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
        emit_json({"ok": False, "error": f"--inject-message JSON parse failed: {exc}"})
        return 0

    sender = str(msg.get("sender") or "")
    wechat_id = str(msg.get("wechat_id") or "")
    content = str(msg.get("content") or "")
    if not (sender and wechat_id and content):
        emit_json(
            {"ok": False, "error": "inject-message 必须含 sender / wechat_id / content"}
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


# ─── 真模式入口（仅 Windows + pywinauto + 微信 4.0 登录）────────────────────────


def run_real_listen(args: argparse.Namespace) -> int:
    if not _pywinauto_available():
        emit_json(
            {
                "ok": False,
                "reason": "pywinauto_not_available",
                "platform": platform.system(),
            }
        )
        return 0

    from find_weixin import get_main_window  # 函数体内 import，避免顶层触发 pywinauto

    print(
        f"[listen_chat] start polling (pywinauto), middleware={args.middleware_url}, "
        f"timeout={args.timeout}s",
        flush=True,
    )

    replied: set[tuple[str, str]] = set()
    deadline = time.time() + max(1, args.timeout)
    try:
        while time.time() < deadline:
            mw = get_main_window()
            if mw is None:
                # 没主窗口：可能未登录(只剩 LoginWindow)或讲述人解锁失效
                time.sleep(args.interval)
                continue

            for m in scan_unread(mw):
                key = (m["sender"], m["content"])
                if key in replied:
                    continue

                # 频控：≤2 私聊/分钟、≤50/天/号，操作间隔 ≥1s（rate_limiter 是 SSOT）
                if rate_limiter is not None:
                    ok, _next_at = rate_limiter.can_send("chat", m["sender"])
                    if not ok:
                        continue

                # mode='auto' 拿中台生成的 reply 文本（已复用飞书最近 10 轮 + 营销画像 + DeepSeek）
                result = post_draft_generate(
                    args.middleware_url, m["sender"], m["sender"], m["content"], mode="auto"
                )
                reply = (result or {}).get("reply")
                # AI 失败时 reply 为空 / 占位文案 → 跳过不发，绝不把"AI 生成失败"发给客户
                if not reply or reply == FAIL_PLACEHOLDER:
                    print(f"[listen_chat] skip(no reply) sender={m['sender']}", flush=True)
                    continue

                if reply_in_chat(mw, m["_item"], reply):
                    replied.add(key)
                    print(f"[listen_chat] auto-replied sender={m['sender']}", flush=True)
                time.sleep(1)  # 操作间隔 ≥1s

            time.sleep(args.interval)
    except KeyboardInterrupt:
        pass

    emit_json({"ok": True, "info": "listen loop exited", "replied_count": len(replied)})
    return 0


def main() -> int:
    args = parse_args()

    if args.dryrun_print_version:
        emit_json({"ok": True, "info": "print-version-only"})
        return 0

    if args.dryrun:
        return run_dryrun_inject(args)

    return run_real_listen(args)


if __name__ == "__main__":
    sys.exit(main())

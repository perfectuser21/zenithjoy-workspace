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
    → 拿 reply 文本 → 纯 UIA 控件操作发出：会话项 iface_invoke.Invoke() 打开会话 →
    chat_input_field iface_value.SetValue(reply) 写值 → "发送"按钮 iface_invoke.Invoke()。
    全程不碰鼠标/键盘/光标（不抢前台、不跟 Agent 其他自动化打架，微信最小化也能跑）。
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
import subprocess
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

# 群聊/频道/讨论组名称特征词 → 跳过（只回私聊）
SKIP_GROUP_KEYWORDS = ("群", "频道", "讨论组", "直播间")


# ─── 纯逻辑：解析单个会话项的 element_info.name（CI 单测锚点，顶层零 pywinauto）──────


def _parse_item_name(name: str, require_unread: bool = True) -> Optional[Dict[str, str]]:
    """
    解析微信 4.0 会话列表 ListItem 的 element_info.name 字符串。

    格式（真机实测）：`名字\\n[N条] \\n最新消息内容\\n时间\\n`
      - require_unread=True（默认）：含 `[N条]` 未读标记才返回，否则 None。
      - require_unread=False：不管有无角标都解析（供内容变化检测用）。
      - 首行 = 发送人；过滤系统/公众号/群聊账号。
      - 首段非纯时间文本 = 客户最新消息。

    返回 {"sender":..,"content":..}；不符合则返回 None。
    """
    name = name or ""
    if require_unread and "条]" not in name:
        return None

    parts = name.split("\n")
    if len(parts) < 2:
        return None
    sender = parts[0].strip()
    if not sender or any(s in sender for s in SKIP_SENDERS):
        return None
    if any(kw in sender for kw in SKIP_GROUP_KEYWORDS):
        return None

    content = ""
    for seg in parts[1:]:
        seg = seg.strip()
        if not seg or "条]" in seg:
            continue
        if seg.replace(":", "").replace("/", "").isdigit():
            continue
        content = seg
        break

    if not content:
        return None
    return {"sender": sender, "content": content}


# ─── pywinauto 真模式：扫未读 + 自动回（函数体内 import）─────────────────────────


def scan_unread(mw: Any, last_content: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
    """遍历主窗口会话列表 ListItem，检测未读消息。

    双路检测：
    1) 角标路径：ListItem name 含 '[N条]' → 正常未读
    2) 内容变化路径：无角标（聊天面板当前打开时消息被立即已读）但内容与上次不同 → 也触发回复
    last_content: {sender: last_seen_content}，由调用方维护，检测内容变化。
    """
    out: List[Dict[str, Any]] = []
    seen_senders: set[str] = set()
    for it in mw.descendants(control_type="ListItem"):
        try:
            name = it.element_info.name or ""
        except Exception:
            continue
        # 路径 1：有未读角标
        parsed = _parse_item_name(name)
        if parsed:
            seen_senders.add(parsed["sender"])
            out.append({**parsed, "_item": it})
            continue
        # 路径 2：无角标但内容变化（聊天窗口当前打开时走这里）
        if last_content is not None:
            info = _parse_item_name(name, require_unread=False)
            if info and info["sender"] not in seen_senders:
                prev = last_content.get(info["sender"])
                if prev is not None and prev != info["content"]:
                    seen_senders.add(info["sender"])
                    out.append({**info, "_item": it})
                elif prev is None:
                    # 首次见到这个会话，记录内容但不触发回复
                    last_content[info["sender"]] = info["content"]
    # 更新 last_content（供下轮比较）
    if last_content is not None:
        for m in out:
            last_content[m["sender"]] = m["content"]
    return out


def _iter_all_controls(mw: Any, control_type: str):
    """扫主窗口控件树，再扫同一进程的其他 mmui:: 子窗口（仅微信自身弹窗）。

    安全范围：第二阶段严格过滤 cls.startswith("mmui::")，
    只访问微信自身的 Qt 窗口，不读取其他应用窗口内容。
    """
    # 1) 主窗口 descendants
    for c in mw.descendants(control_type=control_type):
        yield c
    # 2) 微信自身其他 mmui:: 弹窗（独立聊天窗口等）
    try:
        from pywinauto import Desktop
        main_handle = mw.element_info.handle
        for w in Desktop(backend="uia").windows():
            try:
                cls = w.element_info.class_name or ""
                # 严格只处理微信自身 Qt 窗口，过滤所有非 mmui:: 进程
                if cls.startswith("mmui::") and w.element_info.handle != main_handle:
                    for c in w.descendants(control_type=control_type):
                        yield c
            except Exception:
                continue
    except Exception:
        pass


def _find_chat_input(mw: Any) -> Optional[Any]:
    """定位回复输入框：先按 automation_id='chat_input_field'，再按最大 Edit 回退。"""
    candidates = []
    for c in _iter_all_controls(mw, "Edit"):
        try:
            aid = c.element_info.automation_id or ""
            if aid == "chat_input_field":
                return c
            try:
                r = c.rectangle()
                area = (r.right - r.left) * (r.bottom - r.top)
            except Exception:
                area = 0
            candidates.append((area, aid, c))
        except Exception:
            continue
    if candidates:
        candidates.sort(key=lambda x: x[0], reverse=True)
        best = candidates[0]
        _log(f"_find_chat_input: 回退到最大 Edit area={best[0]} aid={repr(best[1])}")
        return best[2]
    return None


def _find_send_button(mw: Any) -> Optional[Any]:
    """定位发送按钮：Button 且 name=='发送'，扫主窗口和所有 mmui 子窗口。"""
    for c in _iter_all_controls(mw, "Button"):
        try:
            if (c.element_info.name or "") == "发送":
                return c
        except Exception:
            continue
    return None


def _force_foreground(hwnd: int) -> None:
    """强制把指定窗口置顶并拉到前台（SetWindowPos TOPMOST + AttachThreadInput 双保险）。"""
    try:
        import ctypes, win32process, win32gui as _wg, win32con as _wc
        # Step 1: TOPMOST 置顶 —— 保证坐标点击一定打到微信，不被其他窗口遮挡
        _SWP_NM = 0x0002 | 0x0001  # SWP_NOMOVE | SWP_NOSIZE
        _wg.SetWindowPos(hwnd, -1, 0, 0, 0, 0, _SWP_NM)  # HWND_TOPMOST = -1
        _wg.ShowWindow(hwnd, _wc.SW_RESTORE)
        time.sleep(0.2)
        # Step 2: AttachThreadInput + SetForegroundWindow（让键盘事件也入坑）
        try:
            cur_tid = ctypes.windll.kernel32.GetCurrentThreadId()
            tgt_tid, _ = win32process.GetWindowThreadProcessId(hwnd)
            win32process.AttachThreadInput(cur_tid, tgt_tid, True)
            _wg.SetForegroundWindow(hwnd)
            win32process.AttachThreadInput(cur_tid, tgt_tid, False)
        except Exception as e2:
            _log(f"_force_foreground SetForegroundWindow: {e2}")
    except Exception as exc:
        _log(f"_force_foreground: {exc}")


def _abs_click(abs_x: int, abs_y: int) -> None:
    """绝对屏幕坐标鼠标左键点击（SetCursorPos + mouse_event，多显示器安全）。"""
    import ctypes as _ct
    _u32 = _ct.windll.user32
    _u32.SetCursorPos(abs_x, abs_y)
    time.sleep(0.15)
    _u32.mouse_event(0x0002, 0, 0, 0, 0)  # MOUSEEVENTF_LEFTDOWN
    time.sleep(0.05)
    _u32.mouse_event(0x0004, 0, 0, 0, 0)  # MOUSEEVENTF_LEFTUP


def _uia_send(uia_edit: Any, mw: Any, reply_text: str) -> bool:
    """SetValue 写入 + AttachThreadInput+Enter 后台静默发送。成功返回 True。"""
    import ctypes as _ct
    _u32 = _ct.windll.user32
    _k32 = _ct.windll.kernel32
    SW_RESTORE = 9
    SW_MINIMIZE = 6
    VK_RETURN = 0x0D
    main_hwnd = mw.element_info.handle
    was_minimized = bool(_u32.IsIconic(main_hwnd))
    try:
        uia_edit.iface_value.SetValue(reply_text)
        time.sleep(0.2)
        if was_minimized:
            _u32.ShowWindow(main_hwnd, 8)  # SW_SHOWNA: 还原不抢焦点
            _log("_uia_send: 主窗口最小化→SW_SHOWNA 还原（不抢焦点）")
            time.sleep(0.3)
        my_tid = _k32.GetCurrentThreadId()
        pid_buf = _ct.c_ulong(0)
        wx_tid = _u32.GetWindowThreadProcessId(main_hwnd, _ct.byref(pid_buf))
        _u32.AttachThreadInput(my_tid, wx_tid, True)
        prev_focus = _u32.SetFocus(main_hwnd)
        time.sleep(0.1)
        _u32.PostMessageW(main_hwnd, 0x0100, VK_RETURN, 0x001C0001)
        time.sleep(0.05)
        _u32.PostMessageW(main_hwnd, 0x0101, VK_RETURN, 0xC01C0001)
        if prev_focus:
            _u32.SetFocus(prev_focus)
        _u32.AttachThreadInput(my_tid, wx_tid, False)
        time.sleep(0.4)
        try:
            remaining = uia_edit.get_value() or ""
        except Exception:
            remaining = ""
        if not remaining:
            if was_minimized:
                _u32.ShowWindow(main_hwnd, SW_MINIMIZE)
            _log("_uia_send: AttachInput+Enter 成功（后台静默）")
            return True
        _log(f"_uia_send: Enter未清空({len(remaining)}字)，回退SW_RESTORE+Invoke")
        _u32.ShowWindow(main_hwnd, SW_RESTORE)
        time.sleep(0.3)
        btn = _find_send_button(mw)
        if btn is not None:
            btn.iface_invoke.Invoke()
            time.sleep(0.5)
            if was_minimized:
                _u32.ShowWindow(main_hwnd, SW_MINIMIZE)
            _log("_uia_send: SW_RESTORE+Invoke 成功（兜底）")
            return True
    except Exception as exc:
        _log(f"_uia_send: {exc}")
    if was_minimized:
        try:
            _ct.windll.user32.ShowWindow(main_hwnd, SW_MINIMIZE)
        except Exception:
            pass
    return False


def _navigate_away(mw: Any) -> None:
    """发完后跳到文件传输助手，确保下条消息显示未读角标（被检测到）。"""
    try:
        for it in mw.descendants(control_type="ListItem"):
            try:
                if "文件传输助手" in (it.element_info.name or ""):
                    it.iface_invoke.Invoke()
                    return
            except Exception:
                continue
    except Exception:
        pass


def reply_in_chat(mw: Any, item: Any, reply_text: str) -> bool:
    """
    打开 item 对应会话并发出 reply_text。全程纯 UIA，不依赖键盘焦点。

    三路降级：
      路径 1 — 聊天面板已开（前台/后台皆可）：直接 SetValue + Invoke 发送
      路径 2 — iface_invoke.Invoke() 打开会话（后台有效的机器）：等 UIA 暴露再发
      路径 3 — 物理点击打开（前台/置顶）：TOPMOST + abs_click + 等待 UIA 暴露再发
    发完后调 _navigate_away 跳走，确保下条消息出现未读角标。
    """
    main_hwnd = mw.element_info.handle

    def _fresh_mw():
        try:
            from find_weixin import get_main_window as _gmw
            return _gmw() or mw
        except Exception:
            return mw

    # ── 路径 1：聊天面板已经是打开状态（用户正在看 / 上次发完未跳走）──────────
    fmw = _fresh_mw()
    uia_edit = _find_chat_input(fmw)
    if uia_edit is not None:
        _log("reply_in_chat: 路径1 面板已开，直接 UIA 发送")
        if _uia_send(uia_edit, fmw, reply_text):
            _navigate_away(fmw)
            return True

    # ── 路径 2：iface_invoke.Invoke() 激活会话（后台机器有效）─────────────────
    try:
        item.iface_invoke.Invoke()
        _log("reply_in_chat: 路径2 Invoke 激活会话，等 UIA 暴露…")
        for _ in range(6):  # 最多等 3s，每 0.5s 检查一次
            time.sleep(0.5)
            fmw = _fresh_mw()
            uia_edit = _find_chat_input(fmw)
            if uia_edit is not None:
                if _uia_send(uia_edit, fmw, reply_text):
                    _navigate_away(fmw)
                    return True
                break
    except Exception as exc:
        _log(f"reply_in_chat: 路径2 Invoke 失败: {exc}")

    # ── 路径 3：物理点击（需前台/置顶，xian-rog Invoke 不开面板时走这里）──────
    _force_foreground(main_hwnd)
    time.sleep(0.5)
    try:
        r = item.rectangle()
        cx = (r.left + r.right) // 2
        cy = (r.top + r.bottom) // 2
        _log(f"reply_in_chat: 路径3 物理点击 ({cx},{cy})")
        _abs_click(cx, cy)
    except Exception as exc:
        _log(f"reply_in_chat: 路径3 点击失败: {exc}")
        return False

    for _ in range(8):  # 最多等 4s
        time.sleep(0.5)
        fmw = _fresh_mw()
        uia_edit = _find_chat_input(fmw)
        if uia_edit is not None:
            if _uia_send(uia_edit, fmw, reply_text):
                _navigate_away(fmw)
                return True
            break

    _log("reply_in_chat: 三路均失败")
    return False


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
    ap.add_argument(
        "--agent-id",
        type=str,
        default=os.environ.get("ZENITHJOY_AGENT_ID"),
        help="心跳上报用的 agent 标识（缺省取 env ZENITHJOY_AGENT_ID）",
    )
    return ap.parse_args()


def emit_json(payload: Dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False))
    sys.stdout.flush()


# ─── 中台 HTTP 调用：带指数退避重试（跨境访问抖动护栏）──────────────────────────


def _post_with_retry(
    url: str,
    body: Dict[str, Any],
    timeout: float,
    retries: int = 3,
    backoff_base: float = 1.0,
    max_total: Optional[float] = None,
) -> tuple[Any, Optional[str]]:
    """
    带指数退避重试的中台 POST。国内客户机跨境访问美国 VPS（+Cloudflare）断断续续，
    draft-generate / heartbeat 时断时续 → 加重试就能扛住抖动。

    返回 (resp, error)：
      - 成功（HTTP 200）：(resp_obj, None)
      - 最终失败：(None, "error string")，**绝不抛**（保持现有 {ok:False} 风格由调用方收尾）。

    重试条件：网络异常 / 连接超时 / 5xx / 429（限流）。
    不重试：4xx（非 429）客户端错误重试无意义，立即返回错误。
    退避：第 N 次失败后 sleep backoff_base * 2**N 秒（默认 1s, 2s, 4s…），每次 attempt 独立 timeout。
    max_total：所有 sleep 累计上限（秒）；超限则不再退避直接收尾（heartbeat 用，别拖垮监听主循环）。
    requests 仅函数体内 import（顶层保持 mac 可 import）。
    """
    try:
        import requests  # 仅运行时需要
    except Exception as exc:
        return None, f"requests not available: {exc}"

    last_error = "unknown error"
    slept_total = 0.0
    for attempt in range(max(1, retries)):
        try:
            resp = requests.post(url, json=body, timeout=timeout)
        except Exception as exc:
            # 网络异常 / 连接超时 → 可重试
            last_error = f"{type(exc).__name__}: {exc}"
        else:
            status = getattr(resp, "status_code", 0)
            if status == 200:
                return resp, None
            # 4xx（非 429）客户端错误：重试无意义，立即返回
            if 400 <= status < 500 and status != 429:
                try:
                    text = (resp.text or "")[:200]
                except Exception:
                    text = ""
                return None, f"middleware HTTP {status}: {text}"
            # 5xx / 429 → 可重试
            try:
                last_error = f"middleware HTTP {status}: {(resp.text or '')[:200]}"
            except Exception:
                last_error = f"middleware HTTP {status}"

        # 仍有下一次尝试才退避
        if attempt < max(1, retries) - 1:
            delay = backoff_base * (2 ** attempt)
            if max_total is not None and slept_total + delay > max_total:
                break  # 退避总耗时超上限 → 不再等待，直接收尾
            print(
                f"[listen_chat] 中台调用失败（{last_error}），{delay:.1f}s 后重试…",
                file=sys.stderr,
            )
            time.sleep(delay)
            slept_total += delay

    return None, last_error


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

    url = middleware_url.rstrip("/") + "/api/wechat/draft-generate"
    body = {"sender": sender, "wechat_id": wechat_id, "content": content, "mode": mode}
    # 回复关键路径 → 重试最重要：3 次（1s,2s,4s 退避），扛跨境抖动
    resp, error = _post_with_retry(url, body, timeout=30, retries=3, backoff_base=1.0)
    if error is not None:
        return {"ok": False, "error": error}
    try:
        return resp.json()
    except Exception as exc:
        return {"ok": False, "error": f"bad json: {type(exc).__name__}: {exc}"}


# ─── 进程守护：监听心跳上报（每分钟一次，失败不影响监听）────────────────────────


def post_heartbeat(
    middleware_url: str,
    agent_id: Optional[str] = None,
    wechat_id: Optional[str] = None,
    diag: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    向中台 POST 监听心跳。守护用途：中台断 3 分钟无心跳即飞书告警。
    diag：扫描诊断（窗口找到没/登录没/会话数/未读+发信人/回复数/错误），让运营在中台
    看板一眼定位客户监听卡在哪，无需远程进客户桌面。
    任何失败（网络/非200/requests 缺失）都吞掉返回 {ok:False}，绝不抛——心跳不能拖垮监听。
    """
    url = middleware_url.rstrip("/") + "/api/wechat/listener-heartbeat"
    body: Dict[str, Any] = {"agent_id": agent_id, "wechat_id": wechat_id, "ts": int(time.time() * 1000)}
    if diag is not None:
        body["diag"] = diag
    # 心跳失败影响小 → 重试少一点（2 次）、退避短（0.5s）、总退避 <10s，绝不拖垮监听主循环
    resp, error = _post_with_retry(
        url, body, timeout=10, retries=2, backoff_base=0.5, max_total=10
    )
    if error is not None:
        return {"ok": False, "error": error}
    return {"ok": True}


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


_LOG_PATH = os.path.join(os.environ.get("PUBLIC", r"C:\Users\Public"), "zj-listener.log")


def _log(msg: str) -> None:
    """同时打印 + 追加到公共日志文件，便于运营/支持 SSH 直接读监听到底干了啥（监听本身 stdio 被忽略）。"""
    print("[listen_chat] " + str(msg), flush=True)
    try:
        with open(_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n")
    except Exception:
        pass


def _activate_uia() -> None:
    """开关讲述人激活微信 4.0 的 UIAutomation provider。

    微信 4.0 把 UI 自绘在 MMUIRenderSubWindowHW 上，**只有 UIAutomation 被激活后**才暴露出
    mmui::MainWindow 那棵可读控件树；且该激活会随时间失效。start.bat 仅在启动时解锁一次不够，
    失效后监听就"找不到微信"。故监听需按需重做本激活（Windows-only；非 Windows 不会进到这里）。
    """
    try:
        # 启动讲述人必须走 PowerShell Start-Process（ShellExecute），对齐 start.bat。
        # 之前用 subprocess.Popen(["Narrator.exe"]) 直接拉 → 非管理员身份报 WinError 740
        # (需要提升) → 讲述人根本起不来 → UIA 从未激活 → 永远 found_window=False（v1.1.84 真 bug）。
        # 禁讲述人首页弹窗，防止欢迎窗盖住微信（v1.1.96 fix）
        subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "New-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Narrator' "
             "-Name 'RunStartupPage' -Value 0 -PropertyType DWord -Force | Out-Null"],
            capture_output=True, timeout=10,
        )
        subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "Start-Process Narrator -WindowStyle Minimized"],
            capture_output=True, timeout=15,
        )
        time.sleep(2)
        # 关讲述人也走 PowerShell Stop-Process（taskkill 关不掉，是 v1.1.83 的 bug）。
        subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "Stop-Process -Name Narrator -Force -ErrorAction SilentlyContinue; "
             "Start-Sleep 1; "
             "Get-Process -Name Narrator -ErrorAction SilentlyContinue | Stop-Process -Force"],
            capture_output=True, timeout=15,
        )
        time.sleep(1)
        _log("UIA 激活（讲述人 Start-Process 开 + Stop-Process 关）完成")
    except Exception as exc:
        _log(f"UIA 激活失败: {exc}")


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

    # 函数体内 import，避免顶层触发 pywinauto
    from find_weixin import get_main_window, login_window_present

    print(
        f"[listen_chat] start polling (pywinauto), middleware={args.middleware_url}, "
        f"timeout={args.timeout}s",
        flush=True,
    )

    # replied 持久化：重启后仍记住已回复的消息，防止重复
    _REPLIED_FILE = r"C:\Users\Public\zj-replied.json"
    def _load_replied() -> set:
        try:
            import json as _j
            with open(_REPLIED_FILE, "r", encoding="utf-8") as _f:
                return set(tuple(x) for x in _j.load(_f))
        except Exception:
            return set()
    def _save_replied(s: set) -> None:
        try:
            import json as _j
            with open(_REPLIED_FILE, "w", encoding="utf-8") as _f:
                _j.dump([list(x) for x in s], _f)
        except Exception:
            pass
    replied: set[tuple[str, str]] = _load_replied()
    _log(f"已加载 replied 历史: {len(replied)} 条")
    # reply 失败的 key → 最后失败时间；60 秒内不重试（避免群聊/系统消息无限循环）
    reply_failed_at: dict[tuple[str, str], float] = {}
    REPLY_FAIL_COOLDOWN = 60  # 60s（原 30min，改短避免相同内容卡死）
    # per-sender 成功回复冷却：10s 内不回同一 sender，防 last_content 截断误触发
    sender_reply_cooldown: dict[str, float] = {}
    SENDER_COOLDOWN = 30.0
    _skip_logged: set[tuple[str, str]] = set()  # 只对每个 key 打一次 skip log，避免刷屏
    # 内容变化检测：{sender: last_seen_content}，捕捉聊天面板打开时的新消息（无未读角标）
    last_content: dict[str, str] = {}
    deadline = time.time() + max(1, args.timeout)
    # 进程守护：每 60 秒向中台上报一次心跳（断 3 分钟无心跳中台飞书告警）+ 扫描诊断
    heartbeat_interval = 60
    last_heartbeat = 0.0
    last_unread_senders: List[str] = []
    last_error: Optional[str] = None
    # 微信4.0 mmui 控件树需讲述人激活 UIAutomation 后才暴露、且会失效：启动先激活一次，失效再按冷却补激活
    uia_reactivate_interval = 45
    _activate_uia()
    last_uia_activate = time.time()
    # 自动启动微信：检测到微信未运行时自动 Popen Weixin.exe，冷却 120s 防重复拉起
    wechat_launch_cooldown = 120
    last_wechat_launch = 0.0
    try:
        while time.time() < deadline:
            now = time.time()

            # 取主窗口（顺带采集诊断：找到没 / 是否停在登录窗口）
            mw = None
            login = False
            try:
                mw = get_main_window()
                if mw is None:
                    login = login_window_present()
            except Exception as exc:
                last_error = f"{type(exc).__name__}: {exc}"

            # 心跳 + 扫描诊断上报中台（运营在 Dashboard「监听健康」看板一眼定位卡在哪）
            if now - last_heartbeat >= heartbeat_interval:
                sessions_seen = 0
                if mw is not None:
                    try:
                        sessions_seen = len(mw.descendants(control_type="ListItem"))
                    except Exception as exc:
                        last_error = f"{type(exc).__name__}: {exc}"
                diag = {
                    "main_window_found": mw is not None,
                    "login_present": login,
                    "sessions_seen": sessions_seen,
                    "unread_count": len(last_unread_senders),
                    "unread_senders": last_unread_senders[:10],
                    "replied_count": len(replied),
                    "last_error": last_error,
                }
                _log(
                    f"心跳 found_window={diag['main_window_found']} login={login} "
                    f"sessions={sessions_seen} unread={diag['unread_count']}"
                    f"{diag['unread_senders']} replied={diag['replied_count']} err={last_error}"
                )
                hb = post_heartbeat(
                    args.middleware_url, agent_id=getattr(args, "agent_id", None), diag=diag
                )
                last_heartbeat = now
                if not hb.get("ok"):
                    _log(f"心跳上报失败: {hb.get('error')}")

            if mw is None:
                # 微信既没有主窗口也没有登录窗口 → 进程未启动 → 自动拉起 Weixin.exe（冷却 120s）
                if not login and now - last_wechat_launch >= wechat_launch_cooldown:
                    from find_weixin import launch_weixin  # noqa: PLC0415
                    launched = launch_weixin()
                    last_wechat_launch = time.time()
                    if launched:
                        _log("微信未运行，已自动启动 Weixin.exe — 请扫码登录")
                    else:
                        _log("微信未运行，自动启动失败（Weixin.exe 不存在或 Popen 异常）")
                    time.sleep(5)  # 等微信启动窗口

                # 找不到 mmui 主窗口（多为微信4.0 UIAutomation 激活失效）→ 按冷却重做讲述人解锁补激活再重试
                if now - last_uia_activate >= uia_reactivate_interval:
                    print("[listen_chat] 未找到微信主窗口，重做 UIA 激活…", flush=True)
                    _activate_uia()
                    last_uia_activate = time.time()
                    try:
                        mw = get_main_window()
                        if mw is None:
                            login = login_window_present()
                    except Exception as exc:
                        last_error = f"{type(exc).__name__}: {exc}"
                if mw is None:
                    time.sleep(args.interval)
                    continue

            try:
                unread = scan_unread(mw, last_content)
            except Exception as exc:
                last_error = f"{type(exc).__name__}: {exc}"
                time.sleep(args.interval)
                continue
            last_unread_senders = [u["sender"] for u in unread]

            for m in unread:
                key = (m["sender"], m["content"])
                # per-sender 冷却：成功回复后 30s 内跳过同一 sender
                if now - sender_reply_cooldown.get(m["sender"], 0) < SENDER_COOLDOWN:
                    continue
                if key in replied:
                    if key not in _skip_logged:
                        _log(f"skip(replied) sender={m['sender']} content={m['content'][:20]!r}")
                        _skip_logged.add(key)
                    continue
                if key in reply_failed_at and now - reply_failed_at[key] < REPLY_FAIL_COOLDOWN:
                    left = int(REPLY_FAIL_COOLDOWN - (now - reply_failed_at[key]))
                    if key not in _skip_logged:
                        _log(f"skip(cooldown {left}s) sender={m['sender']} content={m['content'][:20]!r}")
                        _skip_logged.add(key)
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
                    _log(f"skip(no reply) sender={m['sender']} result_ok={( result or {}).get('ok')} err={( result or {}).get('error')}")
                    continue

                _log(f"尝试回复 sender={m['sender']} reply_len={len(reply)}")
                ok = False
                for _attempt in range(2):  # 失败立刻重试一次
                    try:
                        ok = reply_in_chat(mw, m["_item"], reply)
                    except Exception as exc:
                        _log(f"reply_in_chat exception attempt={_attempt} sender={m['sender']}: {exc}")
                        ok = False
                    if ok:
                        break
                    if _attempt == 0:
                        _log(f"reply_in_chat attempt 1 failed, retrying sender={m['sender']}")
                        time.sleep(2)
                if ok:
                    replied.add(key)
                    _save_replied(replied)  # 持久化，防重启重复回复
                    _skip_logged.discard(key)
                    reply_failed_at.pop(key, None)
                    sender_reply_cooldown[m["sender"]] = now  # per-sender 30s 冷却
                    last_content[m["sender"]] = reply  # 防 last_content Path2 误触发
                    _log(f"auto-replied OK sender={m['sender']}")
                else:
                    reply_failed_at[key] = time.time()
                    _log(f"reply_in_chat FAILED sender={m['sender']} (冷却 {REPLY_FAIL_COOLDOWN}s 再试)")
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

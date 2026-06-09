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

# WeChat 会话列表 UI 状态标记：置顶/草稿等，不是实际消息内容，提取 content 时跳过。
# 若错误提取为 content → replied[(sender, '已置顶')] 永久封锁该会话（已复现 bug）。
_UI_STATUS_KEYWORDS = ("置顶", "草稿")


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
        if any(kw in seg for kw in _UI_STATUS_KEYWORDS):
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
    """定位回复输入框：先按 automation_id='chat_input_field'，再按位置+面积回退。

    回退逻辑排除窗口上 40% 区域的 Edit（搜索栏固定在顶部 5-8%，
    聊天输入框在底部 85%+），防止搜索栏面积大时被误选。
    获取窗口矩形失败时退化到旧逻辑（按面积最大选）。
    """
    candidates = []
    for c in mw.descendants(control_type="Edit"):
        try:
            aid = c.element_info.automation_id or ""
            if aid == "chat_input_field":
                return c
            try:
                r = c.rectangle()
                area = (r.right - r.left) * (r.bottom - r.top)
            except Exception:
                area = 0
                r = None
            candidates.append((area, aid, c, r))
        except Exception:
            continue
    if not candidates:
        return None

    # 过滤：排除窗口上 40% 的 Edit（搜索栏区域，聊天输入框在底部 85%+）
    try:
        wr = mw.rectangle()
        threshold = wr.top + (wr.bottom - wr.top) * 0.4
        filtered = [
            (area, aid, c, r)
            for area, aid, c, r in candidates
            if r is not None and r.top >= threshold
        ]
        if filtered:
            candidates = filtered
    except Exception:
        pass  # 退化到旧逻辑

    candidates.sort(key=lambda x: x[0], reverse=True)
    best = candidates[0]
    _log(f"_find_chat_input: 回退到最大 Edit area={best[0]} aid={repr(best[1])}")
    return best[2]


def _find_send_button(mw: Any) -> Optional[Any]:
    """定位发送按钮：Button 且 name=='发送'，只扫主窗口防群聊弹窗干扰。"""
    for c in mw.descendants(control_type="Button"):  # 只扫主窗口，防群聊弹窗干扰
        try:
            if (c.element_info.name or "") == "发送":
                return c
        except Exception:
            continue
    return None




def _set_clipboard_text(text: str) -> bool:
    """
    通过 Win32 剪贴板 API 把 text 写入剪贴板，返回是否成功。
    GlobalAlloc/GlobalLock 均声明 restype=c_void_p，防止 amd64 上 64-bit HANDLE 被截断为 32-bit。
    """
    import ctypes
    CF_UNICODETEXT = 13
    GMEM_MOVEABLE = 0x0002
    encoded = (text + "\x00").encode("utf-16-le")
    size = len(encoded)
    k32 = ctypes.windll.kernel32
    u32 = ctypes.windll.user32
    k32.GlobalAlloc.restype = ctypes.c_void_p
    k32.GlobalAlloc.argtypes = [ctypes.c_uint, ctypes.c_size_t]
    k32.GlobalLock.restype = ctypes.c_void_p
    k32.GlobalLock.argtypes = [ctypes.c_void_p]
    k32.GlobalUnlock.restype = ctypes.c_bool
    k32.GlobalUnlock.argtypes = [ctypes.c_void_p]
    u32.SetClipboardData.restype = ctypes.c_void_p
    u32.SetClipboardData.argtypes = [ctypes.c_uint, ctypes.c_void_p]
    try:
        hMem = k32.GlobalAlloc(GMEM_MOVEABLE, size)
        if not hMem:
            return False
        pMem = k32.GlobalLock(hMem)
        if not pMem:
            return False
        ctypes.memmove(pMem, encoded, size)
        k32.GlobalUnlock(hMem)
        u32.OpenClipboard(None)
        u32.EmptyClipboard()
        u32.SetClipboardData(CF_UNICODETEXT, hMem)
        u32.CloseClipboard()
        return True
    except Exception:
        return False


def _uia_send(uia_edit: Any, mw: Any, reply_text: str) -> bool:
    """
    发送策略（后台静默，纯 UIA 路径）：
    0. 微信4.1.x mmui::MainWindow：SetValue 已失效，改用剪贴板+WM_PASTE 路径
       WM_PASTE(0x0302) 直发编辑框，无需 SetFocus/AttachThreadInput → 不抢前台
    1. SetValue 写值 + SW_SHOWNA 还原（不抢焦点）+ AttachThreadInput + PostMessageW(Enter)
    2. 兜底：SW_RESTORE + 发送按钮 Invoke
    成功返回 True。全程禁止 keybd_event / mouse_event（全局事件，后台会话必失败）。
    """
    import ctypes as _ct
    _u32 = _ct.windll.user32
    # 微信4.1.x 主窗口类名 mmui::MainWindow：先尝试剪贴板+WM_PASTE 路径（不抢前台）。
    # WM_PASTE 后必须验证 get_value()：mmui 控件 handle=0 时 PostMessage 无声丢弃，
    # 若输入框仍空则 fall-through 到 SetValue+AttachThreadInput 路径。
    if getattr(mw, 'element_info', None) and getattr(mw.element_info, 'class_name', '') == 'mmui::MainWindow':
        edit_hwnd_raw = uia_edit.element_info.handle or mw.element_info.handle
        _log(f"_uia_send: mmui::MainWindow edit_hwnd={edit_hwnd_raw} (0=主窗口回退，WM_PASTE 可能无效)")
        if _set_clipboard_text(reply_text):
            import ctypes as _ct2
            _u2 = _ct2.windll.user32
            WM_PASTE = 0x0302
            _u2.PostMessageW(edit_hwnd_raw, WM_PASTE, 0, 0)
            time.sleep(0.2)
            # 验证 WM_PASTE 是否真的写入文本（handle=0 时 PostMessage 无效，get_value 仍空）
            try:
                after_paste = uia_edit.get_value() or ""
            except Exception:
                after_paste = ""
            if after_paste:
                VK_RETURN = 0x0D
                _u2.PostMessageW(edit_hwnd_raw, 0x0100, VK_RETURN, 0x001C0001)
                time.sleep(0.05)
                _u2.PostMessageW(edit_hwnd_raw, 0x0101, VK_RETURN, 0xC01C0001)
                time.sleep(0.3)
                _log("_uia_send: mmui::MainWindow WM_PASTE 路径完成（不抢前台）")
                return True
            _log(f"_uia_send: WM_PASTE 无效（get_value 为空，handle={edit_hwnd_raw}），fall-through→SetValue")
    _k32 = _ct.windll.kernel32
    SW_RESTORE = 9
    SW_MINIMIZE = 6
    VK_RETURN = 0x0D
    main_hwnd = mw.element_info.handle
    was_minimized = bool(_u32.IsIconic(main_hwnd))
    edit_hwnd = uia_edit.element_info.handle or main_hwnd
    _log(f"_uia_send: edit_hwnd={edit_hwnd} main_hwnd={main_hwnd} was_min={was_minimized}")
    try:
        # ── 主路径：SetValue + AttachThreadInput+Enter ──
        uia_edit.iface_value.SetValue(reply_text)
        time.sleep(0.2)
        if was_minimized:
            _u32.ShowWindow(main_hwnd, 8)  # SW_SHOWNA: 还原不抢焦点
            _log("_uia_send: 主窗口最小化→SW_SHOWNA 还原（不抢焦点）")
            time.sleep(0.3)
        my_tid = _k32.GetCurrentThreadId()
        pid_buf = _ct.c_ulong(0)
        wx_tid = _u32.GetWindowThreadProcessId(edit_hwnd, _ct.byref(pid_buf))
        _u32.AttachThreadInput(my_tid, wx_tid, True)
        prev_focus = _u32.SetFocus(edit_hwnd)
        time.sleep(0.1)
        _u32.PostMessageW(edit_hwnd, 0x0100, VK_RETURN, 0x001C0001)
        time.sleep(0.05)
        _u32.PostMessageW(edit_hwnd, 0x0101, VK_RETURN, 0xC01C0001)
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
            try:
                remaining2 = uia_edit.get_value() or ""
            except Exception:
                remaining2 = ""
            if not remaining2:
                if was_minimized:
                    _u32.ShowWindow(main_hwnd, SW_MINIMIZE)
                _log("_uia_send: SW_RESTORE+Invoke 成功（兜底）")
                return True
            _log(f"_uia_send: SW_RESTORE+Invoke 失败（输入框仍有{len(remaining2)}字）")
        return False
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


def reply_in_chat(mw: Any, item: Any, reply_text: str, sender: str = "") -> bool:
    """
    打开 item 对应会话并发出 reply_text。全程纯 UIA，禁止任何物理鼠标/键盘操作。

    始终先 item.iface_invoke.Invoke() 激活正确会话（防止 _navigate_away 后面板停在
    文件传输助手导致消息发错对象），再 SetValue + Enter/Invoke 发送。
    sender：目标联系人名，用于验证面板是否切换到正确会话（防止 Invoke() 后 WeChat 面板
    未及时切换就读到了旧会话的输入框，导致发到错误聊天窗口）。
    失败 → 返回 False，下一轮询周期自动重试，全程纯 UIA 不触碰鼠标/键盘事件。
    """
    def _fresh_mw():
        try:
            from find_weixin import get_main_window as _gmw
            return _gmw() or mw
        except Exception:
            return mw

    def _chat_panel_ready(fmw: Any) -> bool:
        """验证 WeChat 右侧面板已切换到 sender 对应的会话。

        原理：Invoke() 打开会话后该 ListItem 的未读角标应消失（WeChat 标记已读）。
        角标消失 = 面板已切换 = 当前 Edit 控件属于目标会话，可以安全写入。
        """
        if not sender:
            return True
        try:
            for it in fmw.descendants(control_type="ListItem"):
                try:
                    name = it.element_info.name or ""
                    if not name.startswith(sender):
                        continue
                    return "条]" not in name
                except Exception:
                    continue
        except Exception:
            pass
        return False

    try:
        item.iface_invoke.Invoke()
        _log("reply_in_chat: Invoke 激活会话，等面板切换…")
        for attempt in range(8):  # 最多等 4s，每 0.5s 检查
            time.sleep(0.5)
            fmw = _fresh_mw()
            if attempt < 6 and not _chat_panel_ready(fmw):
                continue
            uia_edit = _find_chat_input(fmw)
            if uia_edit is not None:
                if _uia_send(uia_edit, fmw, reply_text):
                    _navigate_away(fmw)
                    return True
                break
    except Exception as exc:
        _log(f"reply_in_chat: Invoke 失败: {exc}")

    _log("reply_in_chat: 发送失败，本轮跳过（下次轮询重试）")
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
    body: Dict[str, Any] = {"ts": int(time.time() * 1000)}
    if agent_id is not None:
        body["agent_id"] = agent_id
    if wechat_id is not None:
        body["wechat_id"] = wechat_id
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

# ─── replied 持久化（模块顶层，供单测 monkeypatch）────────────────────────────────
_REPLIED_FILE: str = os.path.join(os.environ.get("PUBLIC", r"C:\Users\Public"), "zj-replied.json")
SENDER_COOLDOWN: float = 30.0  # 成功回复后同一 sender 的冷却秒数
REPLIED_TTL: float = 120  # replied 条目 120s 后过期（2 个轮询周期，防双发但不永久封锁）
_replied_ts: dict = {}  # (sender, content) → 回复时间戳，供 _save_replied 持久化


def _load_replied() -> set:
    """从磁盘加载已回复集合，过滤超过 REPLIED_TTL 的过期条目。

    格式：
    - 新格式 [sender, content, timestamp]（3 元素）— 过期条目自动丢弃
    - 旧格式 [sender, content]（2 元素，无时间戳）— 向后兼容，全部加载
    """
    try:
        with open(_REPLIED_FILE, "r", encoding="utf-8") as _f:
            data = json.load(_f)
        now = time.time()
        s: set = set()
        for x in data:
            if len(x) == 3:
                sender, content, ts = x[0], x[1], float(x[2])
                if now - ts < REPLIED_TTL:
                    key = (sender, content)
                    s.add(key)
                    _replied_ts[key] = ts
            elif len(x) == 2:
                s.add((x[0], x[1]))
        return s
    except Exception:
        return set()


def _save_replied(s: set) -> None:
    """把已回复集合持久化到磁盘（新格式含时间戳，防永久去重）。"""
    try:
        now = time.time()
        data = [[k[0], k[1], _replied_ts.get(k, now)] for k in s]
        with open(_REPLIED_FILE, "w", encoding="utf-8") as _f:
            json.dump(data, _f)
    except Exception:
        pass


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

    # replied 持久化 + 冷却（_load_replied / _save_replied / _REPLIED_FILE / SENDER_COOLDOWN 在模块顶层）
    replied: set[tuple[str, str]] = _load_replied()
    _log(f"已加载 replied 历史: {len(replied)} 条")
    reply_failed_at: dict[tuple[str, str], float] = {}
    REPLY_FAIL_COOLDOWN = 60  # 60s，避免相同内容卡死
    sender_reply_cooldown: dict[str, float] = {}
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
    # replied 过期清理：每小时清一次内存里的过期条目，避免长期运行积累
    last_replied_purge = time.time()
    try:
        while time.time() < deadline:
            now = time.time()

            # 每小时清理内存里的过期 replied 条目，防长期运行内存堆积
            if now - last_replied_purge >= 3600:
                expired_keys = {k for k in replied if now - _replied_ts.get(k, 0) >= REPLIED_TTL}
                if expired_keys:
                    replied -= expired_keys
                    for k in expired_keys:
                        _replied_ts.pop(k, None)
                        _skip_logged.discard(k)
                    _save_replied(replied)
                    _log(f"已清理 {len(expired_keys)} 条过期 replied（TTL {REPLIED_TTL/3600:.0f}h）")
                last_replied_purge = now

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

            # 主动发送指令：写 C:\Users\Public\zj-proactive-send.json → {target:..., message:...}
            _psc = r"C:\Users\Public\zj-proactive-send.json"
            if os.path.exists(_psc):
                try:
                    with open(_psc, "r", encoding="utf-8") as _f:
                        _cmd = json.load(_f)
                    os.remove(_psc)
                    _tgt, _msg = _cmd.get("target", ""), _cmd.get("message", "")
                    if _tgt and _msg:
                        _log(f"[主动发送] target={_tgt!r}")
                        _psi = None
                        for _it in mw.descendants(control_type="ListItem"):
                            try:
                                if _tgt in (_it.element_info.name or "").split("\n")[0]:
                                    _psi = _it
                                    break
                            except Exception:
                                continue
                        if _psi is not None:
                            try:
                                _psi.iface_invoke.Invoke()
                                time.sleep(2.0)  # UIA 树更新需要 ≥2s，少了找不到 chat_input_field
                                _fmw = get_main_window() or mw
                                _ue = _find_chat_input(_fmw)
                                if _ue is not None:
                                    _ok = _uia_send(_ue, _fmw, _msg)
                                    _log(f"[主动发送] ok={_ok}")
                                else:
                                    _log("[主动发送] chat_input_field 未找到")
                            except Exception as _pe:
                                import traceback as _tb
                                _log(f"[主动发送] 异常: {_pe}\n{_tb.format_exc()}")
                        else:
                            _log(f"[主动发送] 找不到会话 {_tgt!r}")
                except Exception as _exc:
                    _log(f"[主动发送] 指令处理异常: {_exc}")

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
                        ok = reply_in_chat(mw, m["_item"], reply, sender=m["sender"])
                    except Exception as exc:
                        _log(f"reply_in_chat exception attempt={_attempt} sender={m['sender']}: {exc}")
                        ok = False
                    if ok:
                        break
                    if _attempt == 0:
                        _log(f"reply_in_chat attempt 1 failed, retrying sender={m['sender']}")
                        time.sleep(2)
                if ok:
                    _replied_ts[key] = now  # 记录时间戳，_save_replied 持久化用
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
        try:
            import pywinauto
            import win32api
            import comtypes
            emit_json({"ok": True, "pywinauto": pywinauto.__version__})
            return 0
        except ImportError as e:
            emit_json({"ok": False, "error": str(e)})
            return 1

    if args.dryrun:
        return run_dryrun_inject(args)

    return run_real_listen(args)


if __name__ == "__main__":
    sys.exit(main())

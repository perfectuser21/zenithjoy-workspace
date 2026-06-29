#!/usr/bin/env python3
"""
listen_chat.py — 微信 4.0 私聊监听 + 隐形自动回（Path 4 Step 5，pywinauto 版）。

为什么换 pywinauto（禁用旧库）：旧的 GetAllMessage 轮询库在微信 4.0 上读不到新消息
（"拿不到消息"根因）。2026-06-02 已在 xian-pc 微信 4.0 用 pywinauto(uia) 真机全链路验证：
读会话列表未读 → DeepSeek 拼上下文回 → 本人微信号自动发出，对方感知不到是 AI。

跨平台行为：
  - **Windows + 微信 4.0 登录 + 屏幕阅读器标志激活过 + 装了 pywinauto**：真启监听 →
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

UI 自动化必须在微信登录的交互桌面会话里运行（屏幕阅读器标志激活过，否则微信 4.0 屏蔽 UIAutomation）。
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
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import rate_limiter  # type: ignore
except Exception as exc:  # pragma: no cover
    rate_limiter = None  # type: ignore[assignment]
    print(f"[listen_chat] rate_limiter import failed: {exc}", file=sys.stderr)

# 无审批自动回复闭环决策层（纯函数：拟人延迟 / 路由 / 去重 / 播报 / 告警 / 回执）。
import auto_reply  # type: ignore  # noqa: E402
# 每客服真发 gate（按 machine_id 拉自己那份配置；真发跟随中台 auto_agent 开关，拉失败强制 dryrun）。
import cs_config_gate  # type: ignore  # noqa: E402

# AI 失败占位 —— 与 apps/api wechat-draft.ts 的 FAIL_PLACEHOLDER 对齐。
# 自动回模式下中台 AI 失败时 reply 为 undefined；万一拿到占位文案也必须跳过不发给客户。
FAIL_PLACEHOLDER = "AI 生成失败（请人审决定是否重试）"

try:
    import config  # type: ignore  # 读 OFFSCREEN_* / 频控 / 版本等配置
except Exception:
    config = None  # type: ignore[assignment]

try:
    from config import (  # type: ignore
        OFFSCREEN_REPLY as _OFFSCREEN_REPLY,
        OFFSCREEN_X as _OFFSCREEN_X,
        OFFSCREEN_Y as _OFFSCREEN_Y,
        SENDER_COOLDOWN_SECONDS as _SENDER_COOLDOWN,
        REPLIED_TTL_SECONDS as _REPLIED_TTL,
        REPLY_FAILURE_COOLDOWN_SECONDS as _REPLY_FAIL_COOLDOWN,
        HEARTBEAT_INTERVAL_SECONDS as _HEARTBEAT_INTERVAL,
        UIA_REACTIVATE_INTERVAL_SECONDS as _UIA_REACTIVATE_INTERVAL,
        UPDATE_LOCK_INTERVAL_SECONDS as _UPDATE_LOCK_INTERVAL,
        WECHAT_LAUNCH_COOLDOWN_SECONDS as _WECHAT_LAUNCH_COOLDOWN,
        WECHAT_STARTUP_WAIT_SECONDS as _WECHAT_STARTUP_WAIT,
        MAIN_LOOP_POLL_INTERVAL_SECONDS as _MAIN_LOOP_POLL,
        INTER_SEND_MIN_INTERVAL_SECONDS as _INTER_SEND_MIN_INTERVAL,
        TITLE_MIN_MATCH_LENGTH as _TITLE_MIN_MATCH_LENGTH,
        OPEN_CHAT_MAX_ATTEMPTS as _OPEN_CHAT_MAX_ATTEMPTS,
        OPEN_CHAT_VERIFY_POLLS as _OPEN_CHAT_VERIFY_POLLS,
        OPEN_CHAT_POLL_INTERVAL as _OPEN_CHAT_POLL_INTERVAL,
        FIND_INPUT_RETRIES as _FIND_INPUT_RETRIES,
        FIND_INPUT_RETRY_SLEEP as _FIND_INPUT_RETRY_SLEEP,
        TRAY_RESTORE_SLEEP as _TRAY_RESTORE_SLEEP,
        MINIMIZED_RESTORE_SLEEP as _MINIMIZED_RESTORE_SLEEP,
        VISIBLE_MOVE_SLEEP as _VISIBLE_MOVE_SLEEP,
        UIA_SETVALUE_SLEEP as _UIA_SETVALUE_SLEEP,
        KEYDOWN_KEYUP_SLEEP as _KEYDOWN_KEYUP_SLEEP,
        SEND_VERIFY_SLEEP as _SEND_VERIFY_SLEEP,
        BUTTON_CLICK_SLEEP as _BUTTON_CLICK_SLEEP,
        OFFSCREEN_RESTORE_BEFORE_SEND_SLEEP as _OFFSCREEN_RESTORE_SLEEP,
        OFFSCREEN_MOVE_SLEEP as _OFFSCREEN_MOVE_SLEEP,
        REPLY_DELAY_SECONDS as REPLY_DELAY_SECONDS,
        HUMAN_PRIORITY_WAIT_SECONDS as HUMAN_PRIORITY_WAIT_SECONDS,
        REPLY_DIRECTION_CHECK as REPLY_DIRECTION_CHECK,
        print_config as _print_config,
    )
except ImportError:
    REPLY_DELAY_SECONDS = 2.0
    HUMAN_PRIORITY_WAIT_SECONDS = 25.0
    REPLY_DIRECTION_CHECK = False
    _OFFSCREEN_REPLY = True
    _OFFSCREEN_X = -2600
    _OFFSCREEN_Y = 60
    _SENDER_COOLDOWN = 30.0
    _REPLIED_TTL = 120
    _REPLY_FAIL_COOLDOWN = 60
    _HEARTBEAT_INTERVAL = 60
    _UIA_REACTIVATE_INTERVAL = 45
    _UPDATE_LOCK_INTERVAL = 300
    _WECHAT_LAUNCH_COOLDOWN = 120
    _WECHAT_STARTUP_WAIT = 5
    _MAIN_LOOP_POLL = 3
    _INTER_SEND_MIN_INTERVAL = 1.0
    _TITLE_MIN_MATCH_LENGTH = 4
    _OPEN_CHAT_MAX_ATTEMPTS = 3
    _OPEN_CHAT_VERIFY_POLLS = 5
    _OPEN_CHAT_POLL_INTERVAL = 0.4
    _FIND_INPUT_RETRIES = 3
    _FIND_INPUT_RETRY_SLEEP = 1.0
    _TRAY_RESTORE_SLEEP = 0.30
    _MINIMIZED_RESTORE_SLEEP = 0.75
    _VISIBLE_MOVE_SLEEP = 0.15
    _UIA_SETVALUE_SLEEP = 0.3
    _KEYDOWN_KEYUP_SLEEP = 0.05
    _SEND_VERIFY_SLEEP = 0.4
    _BUTTON_CLICK_SLEEP = 0.5
    _OFFSCREEN_RESTORE_SLEEP = 0.5
    _OFFSCREEN_MOVE_SLEEP = 0.3
    def _print_config(): pass

# 最小化/可见场景：保存 hwnd → 原始坐标，让 _restore_window_state 还原（v1.0.29）
# _saved_normal_pos: (left, top, right, bottom) —— WINDOWPLACEMENT.rcNormalPosition
# _saved_visible_pos: (left, top) —— GetWindowRect 屏幕实时坐标
_saved_normal_pos: dict = {}
_saved_visible_pos: dict = {}
_saved_normal_pos_lock = threading.Lock()  # 保护两个字典的并发访问

# 会话列表里要过滤掉的系统/非客户账号（按 element_info.name 首行匹配）。
SKIP_SENDERS = (
    "公众号",
    "服务号",
    "客服消息",
    "文件传输助手",
    "文件",  # WeChat 4.x 有时截断 "文件传输助手" → "文件"
    "微信团队",
    "订阅号",
    "折叠的群聊",
)

# 群聊/频道/讨论组名称特征词 → 跳过（只回私聊）
SKIP_GROUP_KEYWORDS = ("群", "频道", "讨论组", "直播间")

# WeChat 会话列表 UI 状态标记：置顶/草稿等，不是实际消息内容，提取 content 时跳过。
# 若错误提取为 content → replied[(sender, '已置顶')] 永久封锁该会话（已复现 bug）。
_UI_STATUS_KEYWORDS = ("置顶", "草稿")


# ─── 纯逻辑：回复等待决策（CI 单测锚点，顶层零 pywinauto，跨平台可测）────────────


def _resolve_real_publish() -> bool:
    """真发判定：同时认 REAL_PUBLISH 和 ZENITHJOY_AGENT_REAL_PUBLISH，任一 =1/true 即真发。

    #818 真机 bug：prod agent 的 module-manager 起长驻 listener 时注入的是
    ZENITHJOY_AGENT_REAL_PUBLISH=1（与抖音/快手 handler 一致），不是 REAL_PUBLISH。
    旧代码只认 REAL_PUBLISH → real_publish=False → 出站走 send_chat mock 假发但中台标
    auto_sent，关键人没收到。两个名都认 → prod 现成 env 直接生效，无需机器加新 env。
    """
    for name in ("REAL_PUBLISH", "ZENITHJOY_AGENT_REAL_PUBLISH"):
        if os.environ.get(name, "").strip().lower() in ("1", "true"):
            return True
    return False


def decide_reply_wait(human_intervened: bool,
                      reply_delay: float = REPLY_DELAY_SECONDS,
                      human_wait: float = HUMAN_PRIORITY_WAIT_SECONDS) -> float:
    """返回本条消息 AI 回复前应等待的秒数。

    human_intervened=True（该会话近期有操作者手动消息）→ 返回 human_wait（约25s，给人工优先）
    否则 → 返回 reply_delay（约2s）。
    调用方在等待窗口结束后需重新检查：若期间人工已回该条 → 跳过不回。

    【边界 / 未实现】识别「操作者手动发出的消息」需要 UIA 读消息方向，是真机
    (windows_wechat) 依赖。本函数只做纯决策，不接线真实的人工介入检测信号；
    调用处目前传 human_intervened=False 占位（见 listen_chat 主循环 TODO）。
    """
    return human_wait if human_intervened else reply_delay


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
    # 注：旧"规则1"（名字含 群/频道/讨论组/直播间 → return None）已删——名字不可靠
    # （人名"李立群"、"群发助手"误伤；客户小群命名也常无"群"字）。群/私聊改由打开会话读右上角
    # 标题 "(人数)" 判定（_is_group_by_header，在 enrich 层），采集端只去精确系统号（规则2）。

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

    # 注：旧"规则3"（按消息预览"成员名: 内容"冒号前缀猜群）已删（rog 真机实证误杀真客户）——
    # 私聊消息本就常以"词+冒号"开头（"提醒：发货"/"链接: http"/"通知：..."）都被误删。
    # 群/私聊不在解析端按名字/预览瞎猜，统一由 enrich 层打开会话读右上角标题 "(人数)" 判定。
    return {"sender": sender, "content": content}


# ─── pywinauto 真模式：扫未读 + 自动回（函数体内 import）─────────────────────────


def _ensure_tray_visible(mw: Any) -> str:
    """若微信在托盘或最小化，将其移到离屏可操作位置。

    返回原始状态字符串（调用方须持有，操作完成后调 _restore_window_state 还原）：
    - 'tray'      系统托盘（IsWindowVisible=False）
    - 'minimized' 最小化到任务栏（IsWindowVisible=True, IsIconic=True）
    - ''          窗口本身已可见，无需操作

    托盘 vs 最小化的还原方式不同（wechat-uia-silent-send SKILL.md）：
    - 托盘：SW_SHOWNA(8) 直接还原到上次位置（不在幽灵坐标）再移出屏幕
    - 最小化：先用 SetWindowPlacement 把 rcNormalPosition 改到 (-2600,60)，再
      SW_SHOWNOACTIVATE(4) 还原——窗口直接出现在屏外，无任何可见闪烁（v1.0.29）。
      禁止直接 SW_SHOWNA(8)：留在幽灵坐标 (-32000,-32000)，UIA 事件无订阅者。
    """
    import ctypes as _ct
    import ctypes.wintypes as _wt
    try:
        _hwnd = mw.element_info.handle
        if not _hwnd:
            return ''
        _is_visible = bool(_ct.windll.user32.IsWindowVisible(_hwnd))
        _is_iconic = bool(_ct.windll.user32.IsIconic(_hwnd))
        if not _is_visible:
            # 托盘：v1.0.33 先 DWM cloak 再 ShowWindow，compositor 层不渲染，用户不可见
            if _OFFSCREEN_REPLY:
                try:
                    _cv = _ct.c_int(1)
                    _ct.windll.dwmapi.DwmSetWindowAttribute(_hwnd, 13, _ct.byref(_cv), 4)
                except Exception:
                    pass
            _ct.windll.user32.ShowWindow(_hwnd, 8)  # SW_SHOWNA = 8：还原但不激活
            time.sleep(0.05)
            if _OFFSCREEN_REPLY:
                _rc = _wt.RECT()
                _ct.windll.user32.GetWindowRect(_hwnd, _ct.byref(_rc))
                if _rc.left > -2000:
                    _SWP = 0x0001 | 0x0004 | 0x0010  # NOSIZE | NOZORDER | NOACTIVATE
                    _ct.windll.user32.SetWindowPos(_hwnd, 0, _OFFSCREEN_X, _OFFSCREEN_Y, 0, 0, _SWP)
            time.sleep(_TRAY_RESTORE_SLEEP)  # 等 Qt 重建 UIA 虚拟列表渲染
            return 'tray'
        elif _is_iconic:
            # 最小化：v1.0.33 先 DWM cloak（防 WeChat 自身 activate 时移回可视区域被用户看到）
            # v1.0.29 SetWindowPlacement 预改 rcNormalPosition → ShowWindow(4) 直接恢复到屏外
            # （v1.0.28 遗留 bug：ShowWindow(4) 先在原始坐标出现 ~50ms 再 SetWindowPos 移走，用户看到弹跳）
            if _OFFSCREEN_REPLY:
                try:
                    _cv = _ct.c_int(1)
                    _ct.windll.dwmapi.DwmSetWindowAttribute(_hwnd, 13, _ct.byref(_cv), 4)
                except Exception:
                    pass
                try:
                    class _WP(_ct.Structure):
                        _fields_ = [
                            ("length", _ct.c_uint), ("flags", _ct.c_uint), ("showCmd", _ct.c_uint),
                            ("ptMinX", _ct.c_long), ("ptMinY", _ct.c_long),
                            ("ptMaxX", _ct.c_long), ("ptMaxY", _ct.c_long),
                            ("rcLeft", _ct.c_long), ("rcTop", _ct.c_long),
                            ("rcRight", _ct.c_long), ("rcBottom", _ct.c_long),
                        ]
                    _wp = _WP()
                    _wp.length = _ct.sizeof(_WP)
                    if _ct.windll.user32.GetWindowPlacement(_hwnd, _ct.byref(_wp)):
                        _w = max(_wp.rcRight - _wp.rcLeft, 400)
                        _h = max(_wp.rcBottom - _wp.rcTop, 300)
                        _saved_normal_pos[_hwnd] = (_wp.rcLeft, _wp.rcTop, _wp.rcRight, _wp.rcBottom)
                        _wp.rcLeft, _wp.rcTop = _OFFSCREEN_X, _OFFSCREEN_Y
                        _wp.rcRight, _wp.rcBottom = _OFFSCREEN_X + _w, _OFFSCREEN_Y + _h
                        _ct.windll.user32.SetWindowPlacement(_hwnd, _ct.byref(_wp))
                except Exception:
                    pass
            _ct.windll.user32.ShowWindow(_hwnd, 4)  # SW_SHOWNOACTIVATE = 4：恢复到 rcNormalPosition（已改为离屏）
            time.sleep(_MINIMIZED_RESTORE_SLEEP)  # 最小化恢复比托盘需要更长 UIA 树重建时间
            return 'minimized'
        else:
            # 可见非最小化（SPI 激活后常见后台状态）：v1.0.33 cloak 仅在确认需要移动时才执行
            # （避免 already-offscreen 时 cloak 无配对 uncloak）
            if _OFFSCREEN_REPLY:
                _rc = _wt.RECT()
                _ct.windll.user32.GetWindowRect(_hwnd, _ct.byref(_rc))
                if _rc.left > -2000:
                    try:
                        _cv = _ct.c_int(1)
                        _ct.windll.dwmapi.DwmSetWindowAttribute(_hwnd, 13, _ct.byref(_cv), 4)
                    except Exception:
                        pass
                    _SWP = 0x0001 | 0x0004 | 0x0010  # NOSIZE | NOZORDER | NOACTIVATE
                    with _saved_normal_pos_lock:
                        _saved_visible_pos[_hwnd] = (_rc.left, _rc.top)
                    _ct.windll.user32.SetWindowPos(_hwnd, 0, _OFFSCREEN_X, _OFFSCREEN_Y, 0, 0, _SWP)
                    time.sleep(_VISIBLE_MOVE_SLEEP)
                    return 'visible'
    except Exception:
        pass
    return ''


def _restore_window_state(mw: Any, original_state: str) -> None:
    """将微信还原到 original_state 指定的状态，须与 _ensure_tray_visible 配对使用。

    'tray'      → SW_HIDE(0) 送回系统托盘
    'minimized' → SW_MINIMIZE(6) 还原到任务栏最小化（v1.0.28 修复：不能用 SW_HIDE(0)）
    ''          → 无操作（窗口本身可见，不需要还原）
    """
    import ctypes as _ct
    try:
        _hwnd = mw.element_info.handle
        if not _hwnd or not original_state:
            return
        if original_state == 'tray':
            _ct.windll.user32.ShowWindow(_hwnd, 0)  # SW_HIDE = 0
        elif original_state == 'minimized':
            _ct.windll.user32.ShowWindow(_hwnd, 6)  # SW_MINIMIZE = 6
            # 还原 rcNormalPosition（v1.0.29）：确保用户手动从任务栏恢复时窗口在原始屏幕位置
            if _OFFSCREEN_REPLY and _hwnd in _saved_normal_pos:
                try:
                    _orig = _saved_normal_pos.pop(_hwnd)
                    class _WP(_ct.Structure):
                        _fields_ = [
                            ("length", _ct.c_uint), ("flags", _ct.c_uint), ("showCmd", _ct.c_uint),
                            ("ptMinX", _ct.c_long), ("ptMinY", _ct.c_long),
                            ("ptMaxX", _ct.c_long), ("ptMaxY", _ct.c_long),
                            ("rcLeft", _ct.c_long), ("rcTop", _ct.c_long),
                            ("rcRight", _ct.c_long), ("rcBottom", _ct.c_long),
                        ]
                    _wp = _WP()
                    _wp.length = _ct.sizeof(_WP)
                    if _ct.windll.user32.GetWindowPlacement(_hwnd, _ct.byref(_wp)):
                        _wp.rcLeft, _wp.rcTop, _wp.rcRight, _wp.rcBottom = _orig
                        _ct.windll.user32.SetWindowPlacement(_hwnd, _ct.byref(_wp))
                except Exception:
                    pass
        elif original_state == 'visible':
            # v1.0.33：移回原始坐标后 uncloak（NOACTIVATE 不抢焦点）
            if _OFFSCREEN_REPLY:
                with _saved_normal_pos_lock:
                    _orig = _saved_visible_pos.pop(_hwnd, None)
                if _orig is not None:
                    try:
                        _SWP = 0x0001 | 0x0004 | 0x0010  # NOSIZE | NOZORDER | NOACTIVATE
                        _ct.windll.user32.SetWindowPos(_hwnd, 0, _orig[0], _orig[1], 0, 0, _SWP)
                    except Exception:
                        pass
        # DWM uncloak（与 _ensure_tray_visible 中的 cloak 配对，v1.0.33）
        if _OFFSCREEN_REPLY and original_state:
            try:
                _cv = _ct.c_int(0)
                _ct.windll.dwmapi.DwmSetWindowAttribute(_hwnd, 13, _ct.byref(_cv), 4)
            except Exception:
                pass
    except Exception:
        pass


def _restore_tray(mw: Any) -> None:
    """将微信送回系统托盘（向后兼容；仅托盘场景用，最小化场景应调 _restore_window_state）。"""
    _restore_window_state(mw, 'tray')


def scan_unread(mw: Any, last_content: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
    """遍历主窗口会话列表 ListItem，检测未读消息。

    双路检测：
    1) 角标路径：ListItem name 含 '[N条]' → 正常未读
    2) 内容变化路径：无角标（聊天面板当前打开时消息被立即已读）但内容与上次不同 → 也触发回复
    last_content: {sender: last_seen_content}，由调用方维护，检测内容变化。

    托盘修复：微信在系统托盘时 IsWindowVisible=False，mmui 虚拟列表 UIA name 不实时更新，
    新消息角标永远扫不到。扫描前 _ensure_tray_visible SW_SHOWNA(8) 短暂还原刷新 UIA，
    扫完再 _restore_tray SW_HIDE(0) 送回托盘（用户几乎无感知）。
    """
    orig_state = _ensure_tray_visible(mw)
    # ⚠️ 绝不在这里切 tab 回顶（回归 2026-06-29，对齐 74654efd「直接读列表」）。
    # 曾经（#955）每轮扫描前 _reset_session_list_to_top（切通讯录→切回微信）回顶，但 rog 真机上
    # 这个切 tab 会失败（找不到「微信」按钮）→ 切去通讯录回不来 → 微信卡在通讯录 tab、无会话列表 →
    # sessions=0 → 之后全收不到 → 用户体感「回一次就不理」。为治"CRM 扫好友滚到底漏顶部"的偶发
    # 问题（CRM 扫描每天/手动才一次），却把最核心的"连续回复"每轮都置于风险，得不偿失。
    # 正确做法：列表始终保持在顶（CRM 扫描收尾自己回顶），scan_unread 直接读即可。
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
    _restore_window_state(mw, orig_state)
    return out


# ─── CRM 好友表行源：列出近期会话联系人（不要求未读）────────────────────────────
#
# 背景（PrepPRD §3.4 / 修正5）：把"客服白名单手填"换成"agent 扫客服机微信近期会话
# 联系人 → 报中台 → 中台拉成客户好友表"。scan_unread 只挑有 [N条] 未读角标的会话，
# 没有"列出全部近期会话联系人"的能力。这里补上：不要求未读，复用同款 SKIP 过滤。


def _collect_recent_contacts(item_names: List[str], limit: int = 100) -> List[Dict[str, str]]:
    """纯函数（CI clean 可跑，顶层零 pywinauto）：把一批 ListItem 的 element_info.name
    解析成 distinct 近期会话联系人。

    - 不要求未读（require_unread=False）：含/不含 [N条] 角标的私聊都收。
    - 只复用 SKIP_SENDERS 去精确系统账号（公众号/服务号等）；群/私聊不在此层判（名字不可靠），
      由 enrich 层打开会话读右上角标题 "(人数)" 判定（_is_group_by_header）。
    - 同一 sender 多次出现只留第一条（列表顶部 = 最近）。
    - 仅有 UI 状态标记（"已置顶"/"草稿"）无真实消息的会话：人仍要列出（这是"列联系人"，
      不是"挑未读"），last_message 给空串。
    - 截断到 limit（取靠前 = 最近的 N 个）。

    返回 [{"name": sender, "last_message": preview}]（last_seen 由真机入口补，纯解析拿不到）。
    """
    out: List[Dict[str, str]] = []
    seen: set[str] = set()
    for name in item_names:
        name = name or ""
        parts = name.split("\n")
        if len(parts) < 2:
            continue
        sender = parts[0].strip()
        if not sender or sender in seen:
            continue
        if any(s in sender for s in SKIP_SENDERS):
            continue
        # 注：旧"规则1"（名字含 群/频道/讨论组/直播间 → 跳过）已删，与 _parse_item_name 同步
        # （名字不可靠，误伤人名/客户小群）。群/私聊由 enrich 层读标题 "(人数)" 判定。
        # 复用 _parse_item_name 拿真实消息预览（不要求未读）；拿不到 = 仅 UI 标记 → 空预览
        parsed = _parse_item_name(name, require_unread=False)
        if parsed is not None:
            # 解析出真实消息预览的私聊：sender 以解析结果为准（去掉潜在空白）
            sender = parsed["sender"]
            if sender in seen:
                continue
            preview = parsed["content"]
        else:
            # 仅 UI 标记 / 无真实消息预览 → 仍列出该联系人（空预览）。
            # 旧"群预览冒号前缀"二次剔群判定已删（与 _parse_item_name 规则3 同根，误杀真客户）。
            preview = ""
        seen.add(sender)
        out.append({"name": sender, "last_message": preview})
        if len(out) >= limit:
            break
    return out


def _is_group_by_header(texts: List[Optional[str]]) -> Optional[int]:
    """纯函数（CI 可测）：从打开会话后右上角标题文本判断是否群聊。

    业务规则（用户拍板 + rog 真机 100% 准）：会话左列名字分不出群/私聊，唯一可靠信号 =
    打开会话后右上角标题——私聊=名字无括号；群=名字带 "(人数)"。
      群：  "华涛数码、徐先生企业自媒体-Ai助力(3)" / "某客户群（5）"
      私聊："中瑞家具 冯涛18192241985" / "Lancelot 。"

    命中 "(纯数字)"（半角或全角括号）→ 返回人数（int，是群）；否则 → None（私聊）。
    """
    import re as _re
    for t in texts:
        if not t:
            continue
        m = _re.search(r'[（(]\s*(\d+)\s*[)）]', t)
        if m:
            try:
                return int(m.group(1))
            except ValueError:
                continue
    return None


class _ScrollAccumulator:
    """滚动扫会话列表的累计器（纯逻辑，顶层零 pywinauto，CI clean 可跑）。

    微信会话列表是 Qt 虚拟滚动：一次 descendants 只渲染可见 ~6 条 ListItem，相邻屏有重叠。
    每滚一屏把可见 ListItem 名字喂进来 feed(page) → 复用 _collect_recent_contacts 的过滤/解析，
    并入保序 distinct 集合，返回「本屏新增了几个」。新增=0 表示这屏全见过（重叠或滚到底）。

    - 保序：先见到的排前（列表顶部 = 最近会话）。
    - distinct：跨屏同名只留首次。
    - limit：累计满 limit 后不再增长，feed 返回 0。
    """

    def __init__(self, limit: int = 100) -> None:
        self._limit = limit
        self._seen: set[str] = set()
        self._contacts: List[Dict[str, str]] = []

    def feed(self, item_names: List[str]) -> int:
        """喂一屏 ListItem 名字，返回本屏新增的 distinct 联系人数。"""
        if len(self._contacts) >= self._limit:
            return 0
        # 复用纯函数解析/过滤本屏（不要求未读）；它自带屏内去重，这里再跨屏去重。
        parsed = _collect_recent_contacts(item_names, limit=self._limit)
        added = 0
        for c in parsed:
            name = c["name"]
            if name in self._seen:
                continue
            if len(self._contacts) >= self._limit:
                break
            self._seen.add(name)
            self._contacts.append(c)
            added += 1
        return added

    def contacts(self) -> List[Dict[str, str]]:
        """已累计的 distinct 联系人（保序，截到 limit）。"""
        return list(self._contacts[: self._limit])


def _should_stop_scroll(no_new_streak: int, max_streak: int) -> bool:
    """（旧）终止判定：连续 max_streak 屏无新增 → 停。已被 _bottom_reached_by_last_item 取代，保留兼容。"""
    return no_new_streak >= max_streak


def _bottom_reached_by_last_item(unchanged_streak: int, max_unchanged: int) -> bool:
    """鲁棒到底判定：末项（最后一个会话名）连续 >= max_unchanged 次不变 → 认为滚到底。

    旧逻辑"连续 2 屏无新增即停"会半路停（滚动偶发 stall 几屏不动 → 误判到底漏底部）。
    改用末项不变 streak，阈值放大（_SCROLL_LAST_ITEM_UNCHANGED_MAX），多滚到底无害绝不少滚。
    """
    return unchanged_streak >= max_unchanged


def _filter_left_column_item_names(items: List[tuple], x_max: int = 460) -> List[str]:
    """只保留会话列表（左列，中心 x < x_max）ListItem 的名字（纯函数）。

    入参 items = [(name, center_x), ...]。开着聊天时右侧聊天面板的消息气泡/时间戳
    （"08:22"/"[preflight-selfcheck]"）会被 descendants 一起读进来当噪音 → 按中心 x 剔除。
    """
    out: List[str] = []
    for name, cx in items:
        try:
            if cx < x_max:
                out.append(name)
        except TypeError:
            continue
    return out


def _find_left_nav_button_point(
    buttons: List[tuple], name: str, left_max: int = 90
) -> Optional[tuple]:
    """在最左导航栏（rect.left < left_max）按 name 找按钮，返回其中心屏幕坐标点（纯函数）。

    入参 buttons = [(name, rect), ...]，rect 有 .left/.top/.right/.bottom。
    用于切 tab 回顶：定位「通讯录」「微信」导航按钮（不写死坐标）。右侧同名控件（x>=left_max）不选。
    """
    for nm, r in buttons:
        if nm != name:
            continue
        try:
            if r.left < left_max:
                return ((r.left + r.right) // 2, (r.top + r.bottom) // 2)
        except AttributeError:
            continue
    return None


def _merge_contact_detail(
    contact: Dict[str, Any],
    wechat_id: Optional[str] = None,
    add_friend_time: Optional[str] = None,
) -> Dict[str, Any]:
    """把真机读到的对方微信号 + 加好友时间合进 contact dict（纯函数，不就地改入参）。

    - wechat_id：开资料页读对方微信号；读不到（None/空串）→ 不塞 key。
    - add_friend_time：滚聊天记录到最顶读最早消息日期（≈加微信时间）；读不到 → 不塞 key。
    缺失字段一律不进 payload（保持干净，后端按缺省处理），绝不塞 None/空串污染。
    """
    out = dict(contact)
    if wechat_id:
        out["wechat_id"] = wechat_id
    if add_friend_time:
        out["add_friend_time"] = add_friend_time
    return out


# 滚动扫会话列表参数：每屏后等 UIA 重建虚拟列表 + 鲁棒到底判定。
_SCROLL_SETTLE_SLEEP = 0.25
_SCROLL_NO_NEW_MAX_STREAK = 2          # 旧无新增阈值（保留兼容，已不用于终止）
_SCROLL_LAST_ITEM_UNCHANGED_MAX = 10   # 末项连续不变达此次数 → 判到底（鲁棒，扛滚动偶发 stall）
_SCROLL_MAX_PAGES = 35                 # 硬上限（多滚到底无害，绝不少滚漏底部）
_SESSION_LIST_X_MAX_FALLBACK = 460     # 左列会话中心 x 上限回退值（取不到 ChatSessionList rect.right 时）


def _session_list_x_max(mw: Any) -> int:
    """会话列表右边界 x（左列过滤阈值）：优先取 mmui::ChatSessionList/XTableView 控件 rect.right，
    取不到回退 _SESSION_LIST_X_MAX_FALLBACK。"""
    try:
        from pywinauto import Desktop  # noqa: F401  仅确认环境
    except Exception:
        return _SESSION_LIST_X_MAX_FALLBACK
    try:
        for c in mw.descendants():
            try:
                cls = c.element_info.class_name or ""
            except Exception:
                continue
            if "ChatSessionList" in cls or "XTableView" in cls:
                try:
                    r = c.rectangle()
                    if r.right > 0:
                        return r.right
                except Exception:
                    continue
    except Exception:
        pass
    return _SESSION_LIST_X_MAX_FALLBACK


def _read_visible_item_names(mw: Any) -> List[str]:
    """读一屏当前渲染的「左列会话」ListItem 名字（虚拟列表只暴露可见项）。

    只保留会话列表所在左列（中心 x < 会话列表右边界）的 ListItem——开着聊天时右侧聊天面板的
    消息气泡/时间戳也会被 descendants 读进来当噪音（"08:22"/"[preflight-selfcheck]"），按 x 剔除。
    """
    x_max = _session_list_x_max(mw)
    items: List[tuple] = []
    for it in mw.descendants(control_type="ListItem"):
        try:
            nm = it.element_info.name or ""
        except Exception:
            continue
        cx = 0  # 默认 0 = 当左列保守收（拿不到/非数字坐标都不误剔真会话）
        try:
            r = it.rectangle()
            cx = int((int(r.left) + int(r.right)) // 2)
        except Exception:
            cx = 0
        items.append((nm, cx))
    return _filter_left_column_item_names(items, x_max=x_max)


def _read_contact_wechat_id(mw: Any) -> Optional[str]:
    """从当前打开会话的资料页读对方微信号（A2）。

    真机：会话标题区/资料卡里「微信号：xxx」文本节点。纯 UIA 文本扫描，找不到 → None。
    不可 CI 测（依赖真机资料页渲染）；这里只做安全的文本提取，任何异常吞掉返回 None。
    """
    try:
        import re as _re
        for c in _iter_all_controls(mw, "Text"):
            try:
                txt = (c.element_info.name or "").strip()
            except Exception:
                continue
            m = _re.search(r'微信号[:：]\s*([A-Za-z0-9_\-]{4,40})', txt)
            if m:
                return m.group(1)
    except Exception as exc:
        _log(f"_read_contact_wechat_id: 读微信号异常: {exc}")
    return None


def _read_contact_earliest_date(mw: Any) -> Optional[str]:
    """滚聊天记录到最顶，读最早一条消息的日期（≈加微信时间，A2）。

    真机：聊天面板顶部时间分隔条文本（"2026年3月12日"/"3月12日" 等）。纯 UIA 文本扫描，
    归一成 YYYY-MM-DD；读不到 → None。任何异常吞掉返回 None（绝不拖垮扫描）。
    """
    try:
        import re as _re
        from datetime import datetime as _dt
        # 滚到最顶：PageUp 若干次（与 PageDown 同款 PostMessage，不抢焦点）
        try:
            import ctypes as _ct
            main_hwnd = mw.element_info.handle
            if main_hwnd:
                _u32 = _ct.windll.user32
                VK_PRIOR = 0x21  # PageUp
                for _ in range(_SCROLL_MAX_PAGES):
                    _u32.PostMessageW(main_hwnd, 0x0100, VK_PRIOR, 0x00490001)
                    time.sleep(0.02)
                    _u32.PostMessageW(main_hwnd, 0x0101, VK_PRIOR, 0xC0490001)
                    time.sleep(0.08)
        except Exception:
            pass
        earliest: Optional[str] = None
        for c in _iter_all_controls(mw, "Text"):
            try:
                txt = (c.element_info.name or "").strip()
            except Exception:
                continue
            # "2026年3月12日" / "3月12日" / "2026-03-12"
            m = _re.search(r'(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日', txt)
            if m:
                year = int(m.group(1)) if m.group(1) else _dt.now().year
                cand = f"{year:04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
            else:
                m2 = _re.search(r'(\d{4})-(\d{1,2})-(\d{1,2})', txt)
                if not m2:
                    continue
                cand = f"{int(m2.group(1)):04d}-{int(m2.group(2)):02d}-{int(m2.group(3)):02d}"
            if earliest is None or cand < earliest:
                earliest = cand
        return earliest
    except Exception as exc:
        _log(f"_read_contact_earliest_date: 读最早消息日期异常: {exc}")
        return None


# 标题区判定参数：聊天面板标题在窗口右侧上方（会话列表在左列，标题在其右）。
_HEADER_TOP_MAX = 210     # 标题 Text 控件 rect.top 上限（顶部标题栏）
_HEADER_LEFT_MIN = 460    # 标题 Text 控件 rect.left 下限（会话列表右侧）


def _read_chat_header_texts(mw: Any) -> List[str]:
    """读当前打开会话右上角标题区的 Text 文本（供 _is_group_by_header 判群）。

    真机：标题在聊天面板顶部、会话列表右侧 → 过滤 rect.top<_HEADER_TOP_MAX 且 left>=_HEADER_LEFT_MIN
    的 Text 控件名。拿不到 rect 的也收（宽松，纯函数那层只认 "(N)"）。任何异常吞掉返回 []。
    """
    out: List[str] = []
    try:
        for c in _iter_all_controls(mw, "Text"):
            try:
                txt = (c.element_info.name or "").strip()
            except Exception:
                continue
            if not txt:
                continue
            try:
                r = c.rectangle()
                if r.top >= _HEADER_TOP_MAX or r.left < _HEADER_LEFT_MIN:
                    continue
            except Exception:
                pass  # 拿不到坐标 → 仍纳入候选（_is_group_by_header 只认 "(N)"）
            out.append(txt)
    except Exception as exc:
        _log(f"_read_chat_header_texts: 读标题异常: {exc}")
    return out


def enrich_contacts_with_details(mw: Any, contacts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """逐个打开会话：读右上角标题判群（群剔除，不进 CRM）+ 读微信号/加好友时间（A2）。

    业务规则（用户拍板）：群不进 CRM，客户=纯一对一私聊。开会话后读右上角标题，标题带 "(人数)"
    → 群 → 该联系人从结果剔除（不进 ingest）；无括号 → 私聊 → 保留。
    复用 _open_chat 切到目标会话（防串台）。任何单个失败只跳过该联系人的判定/字段，绝不抛、
    绝不拖垮整批（保持与 post_friend_scan 同纪律）。

    注：A2 的微信号/加好友时间读取维持现状（资料卡那条另有 PR），本层只新增"读标题判群+剔群"。
    """
    enriched: List[Dict[str, Any]] = []
    for c in contacts:
        wid: Optional[str] = None
        aft: Optional[str] = None
        name = c.get("name") or ""
        try:
            item = _find_session_item(mw, name)
            if item is not None and _open_chat(mw, item, name):
                # 群判定（唯一可靠信号）：读右上角标题 "(人数)" → 是群 → 剔除（不进 CRM）。
                group_size = _is_group_by_header(_read_chat_header_texts(mw))
                if group_size is not None:
                    _log(f"enrich_contacts_with_details: {name!r} 标题带({group_size})=群，剔除不进 CRM")
                    continue
                wid = _read_contact_wechat_id(mw)
                aft = _read_contact_earliest_date(mw)
        except Exception as exc:
            _log(f"enrich_contacts_with_details: {name!r} 读细节异常: {exc}")
        enriched.append(_merge_contact_detail(c, wechat_id=wid, add_friend_time=aft))
    return enriched


def _find_session_item(mw: Any, sender: str) -> Optional[Any]:
    """在会话列表里按 sender 名字找到对应 ListItem（供 enrich 打开会话）。"""
    try:
        for it in mw.descendants(control_type="ListItem"):
            try:
                nm = it.element_info.name or ""
            except Exception:
                continue
            if nm.split("\n")[0].strip() == sender:
                return it
    except Exception:
        pass
    return None


_WHEEL_PULSES_PER_PAGE = 4      # 每翻一屏投几次 wheel（单次滚不够一屏）
_WHEEL_DELTA = -360             # 负=向下滚（每 120 = 一档，3 档/次）
_WHEEL_PULSE_SLEEP = 0.12       # 两次 wheel 之间间隔


def _session_list_screen_point(mw: Any) -> Optional[tuple]:
    """算会话列表控件内一点的屏幕坐标（供 WM_MOUSEWHEEL lParam 用）。

    真机：会话列表 = 左列（mmui::XTableView），ListItem 的 rect x≈100-457。
    取所有会话项中心 x 的中位数作 x、第一个会话项中心 y 作 y（真机实测 (278,195) 可滚）。
    拿不到任何会话项 rect → 返回 None（调用方退化/不投）。
    """
    try:
        centers_x: List[int] = []
        first_y: Optional[int] = None
        for it in mw.descendants(control_type="ListItem"):
            try:
                r = it.rectangle()
                cx = (r.left + r.right) // 2
                cy = (r.top + r.bottom) // 2
            except Exception:
                continue
            centers_x.append(cx)
            if first_y is None:
                first_y = cy
        if not centers_x or first_y is None:
            return None
        centers_x.sort()
        mid_x = centers_x[len(centers_x) // 2]
        return (mid_x, first_y)
    except Exception:
        return None


def _session_list_center_point(mw: Any) -> Optional[tuple]:
    """算会话列表中心屏幕坐标（供真硬件滚轮 SetCursorPos 用）：会话项中心 x 中位数 + 中心 y 中位数。"""
    try:
        cxs: List[int] = []
        cys: List[int] = []
        for it in mw.descendants(control_type="ListItem"):
            try:
                r = it.rectangle()
                cxs.append((int(r.left) + int(r.right)) // 2)
                cys.append((int(r.top) + int(r.bottom)) // 2)
            except Exception:
                continue
        if not cxs or not cys:
            return None
        cxs.sort()
        cys.sort()
        return (cxs[len(cxs) // 2], cys[len(cys) // 2])
    except Exception:
        return None


# 真硬件滚轮档数：clicks 负=下滚，每 click=120（一档）。-3 ≈ 旧 _WHEEL_DELTA -360。
_WHEEL_CLICKS = -3


def _scroll_session_list_wheel(mw: Any) -> None:
    """滚动会话列表翻屏（不抢前台焦点）。

    主路径 = **真硬件滚轮**（rog 真机实证）：长列表 PostMessage WM_MOUSEWHEEL 合成消息滚到某点
    卡死（加力 12 次不动，只覆盖 16 条），手鼠标硬件滚轮能流畅滚全 → 合成消息非硬件级输入，
    微信 4.1.8 Qt 虚拟列表响应不完整、到点不再 fetch 下一批。改用：
    - SetCursorPos(会话列表中心屏幕坐标) 把光标移到列表上；
    - mouse_event(MOUSEEVENTF_WHEEL=0x0800, 0,0, c_int(120*clicks).value, 0)，clicks 负=下滚。
    扫描前 GetCursorPos 存光标、滚完 SetCursorPos 还原（不干扰运营正在用的鼠标）。

    回退路径：SetCursorPos 失败（无桌面输入权，PsExec 探测态）→ 回退原 PostMessage 合成滚轮
    （WM_MOUSEMOVE 建悬停 + WM_MOUSEWHEEL），别硬崩。

    每屏滚 _WHEEL_PULSES_PER_PAGE 次（单次不够一屏）。失败吞掉（滚不动 = 累计按无新增自然终止）。
    """
    try:
        import ctypes as _ct
        main_hwnd = mw.element_info.handle
        if not main_hwnd:
            return
        center = _session_list_center_point(mw)
        if center is None:
            _log("_scroll_session_list_wheel: 拿不到会话列表中心坐标，跳过本次滚动")
            return
        cx, cy = center
        _u32 = _ct.windll.user32

        # ── 主路径：真硬件滚轮 ──────────────────────────────────────
        class _POINT(_ct.Structure):
            _fields_ = [("x", _ct.c_long), ("y", _ct.c_long)]

        saved = _POINT()
        had_cursor = False
        try:
            had_cursor = bool(_u32.GetCursorPos(_ct.byref(saved)))
        except Exception:
            had_cursor = False

        moved = False
        try:
            moved = bool(_u32.SetCursorPos(int(cx), int(cy)))
        except Exception:
            moved = False

        if moved:
            MOUSEEVENTF_WHEEL = 0x0800
            delta = _ct.c_int(120 * _WHEEL_CLICKS).value  # 负=下滚
            try:
                for _ in range(_WHEEL_PULSES_PER_PAGE):
                    # 每次重置光标到列表中心（防运营或前面操作把光标挪走）再发真滚轮。
                    _u32.SetCursorPos(int(cx), int(cy))
                    _u32.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta, 0)
                    time.sleep(_WHEEL_PULSE_SLEEP)
            finally:
                # 还原光标，不干扰运营正在用的鼠标。
                if had_cursor:
                    try:
                        _u32.SetCursorPos(saved.x, saved.y)
                    except Exception:
                        pass
            return

        # ── 回退路径：无桌面输入权 → PostMessage 合成滚轮 ──────────────
        _log("_scroll_session_list_wheel: SetCursorPos 失败（无输入权），回退 PostMessage 合成滚轮")
        WM_MOUSEMOVE = 0x0200
        WM_MOUSEWHEEL = 0x020A
        wparam = (_WHEEL_DELTA << 16) & 0xFFFFFFFF       # 高 16 位 = 负 delta
        lparam = ((cy & 0xFFFF) << 16) | (cx & 0xFFFF)   # 屏幕坐标（高=Y 低=X）
        for _ in range(_WHEEL_PULSES_PER_PAGE):
            _u32.PostMessageW(main_hwnd, WM_MOUSEMOVE, 0, lparam)   # 建悬停（Qt 按悬停路由滚轮）
            _u32.PostMessageW(main_hwnd, WM_MOUSEWHEEL, wparam, lparam)
            time.sleep(_WHEEL_PULSE_SLEEP)
    except Exception as exc:
        _log(f"_scroll_session_list_wheel: 滚动异常: {exc}")


def _click_screen_point(mw: Any, pt: tuple) -> bool:
    """对屏幕坐标 pt 在渲染子窗口 client 坐标 PostMessage 左键点击（同 _post_click_item 写法）。

    WM_LBUTTON* 的 lParam 是 client 坐标 → ScreenToClient + 投 MMUIRenderSubWindow 渲染子窗口。
    无 windll（单测）/拿不到子窗口 → 安全返回 False。
    """
    import ctypes as _ct
    wd = getattr(_ct, "windll", None)
    if wd is None:
        return False
    try:
        main_hwnd = mw.element_info.handle
    except Exception:
        return False
    if not main_hwnd:
        return False
    target = _find_render_subwindow(main_hwnd) or main_hwnd
    u32 = wd.user32

    class _POINT(_ct.Structure):
        _fields_ = [("x", _ct.c_long), ("y", _ct.c_long)]

    p = _POINT(int(pt[0]), int(pt[1]))
    try:
        if not u32.ScreenToClient(target, _ct.byref(p)):
            return False
        lp = ((p.y & 0xFFFF) << 16) | (p.x & 0xFFFF)
        WM_MOUSEMOVE, WM_LBUTTONDOWN, WM_LBUTTONUP = 0x0200, 0x0201, 0x0202
        u32.PostMessageW(target, WM_MOUSEMOVE, 0, lp)
        u32.PostMessageW(target, WM_LBUTTONDOWN, 1, lp)
        time.sleep(0.05)
        u32.PostMessageW(target, WM_LBUTTONUP, 0, lp)
        return True
    except Exception as exc:
        _log(f"_click_screen_point: 点击异常: {exc}")
        return False


def _reset_session_list_to_top(mw: Any) -> bool:
    """把会话列表弹回真顶 = 切 tab：点左侧导航「通讯录」→ 再点「微信」（rog 真机唯一验证有效的回顶法）。

    真因：会话列表向上滚彻底失效（正 delta wheel / Home / Ctrl+Home / WM_VSCROLL SB_TOP / 拖滚动条
    全试过不动）。切到通讯录再切回微信，会话列表重建并停在真顶。按钮用 UIA Button name + 左列 x<90
    动态定位（不写死坐标），render 子窗口 client 坐标点击。失败吞掉返回 False（不拖垮扫描）。
    """
    try:
        buttons: List[tuple] = []
        for b in _iter_all_controls(mw, "Button"):
            try:
                nm = (b.element_info.name or "").strip()
                r = b.rectangle()
            except Exception:
                continue
            buttons.append((nm, r))
        # 原子：先找齐「通讯录」+「微信」两个按钮再切。绝不"切去通讯录又找不到微信按钮回不来"——
        # 那会把微信卡在通讯录 tab、会话列表消失（回归根因）。任一按钮缺失 → 直接跳过不切。
        pt_contacts = _find_left_nav_button_point(buttons, "通讯录", left_max=90)
        pt_wechat = _find_left_nav_button_point(buttons, "微信", left_max=90)
        if pt_contacts is None or pt_wechat is None:
            _log(
                f"_reset_session_list_to_top: 导航按钮不全("
                f"通讯录={pt_contacts is not None},微信={pt_wechat is not None})，跳过切tab(不卡死会话列表)"
            )
            return False
        # 切通讯录 → 切回微信；务必收尾在微信 tab（点不回就再试一次，绝不留在通讯录）。
        if not _click_screen_point(mw, pt_contacts):
            return False
        time.sleep(0.3)
        ok = _click_screen_point(mw, pt_wechat)
        time.sleep(0.3)
        if not ok:
            ok = _click_screen_point(mw, pt_wechat)  # 兜底重试，确保回到微信
            time.sleep(0.3)
        return ok
    except Exception as exc:
        _log(f"_reset_session_list_to_top: 切 tab 回顶异常: {exc}")
        return False


def scan_recent_contacts(mw: Any, limit: int = 100) -> List[Dict[str, str]]:
    """滚动遍历主窗口会话列表 ListItem，列出全部近期会话联系人（CRM 好友表行源）。

    与 scan_unread 的区别：scan_unread 只挑未读；本函数列"近期会话联系人"（不要求未读），
    供中台拉成客户好友表（默认全接管 + 黑名单排除）。

    扫全三件套（rog 真机实证）：
    1. 扫前切 tab（通讯录→微信）把会话列表弹回真顶（向上滚彻底失效，列表停哪从哪扫会漏上半截）。
    2. 只读左列会话（_read_visible_item_names 已按 x 过滤右侧聊天面板噪音）。
    3. 鲁棒到底：末项连续 _SCROLL_LAST_ITEM_UNCHANGED_MAX 次不变才判到底（旧 2 屏无新增半路停漏底）。

    虚拟滚动（A1）：Qt 虚拟列表一次 descendants 只渲染可见 ~6 条；边滚（WM_MOUSEWHEEL）边累计去重。

    托盘/最小化场景同 scan_unread：扫描前 _ensure_tray_visible 短暂移出离屏刷新 UIA，
    扫完 _restore_window_state 还原（后台无感知）。
    """
    orig_state = _ensure_tray_visible(mw)
    try:
        # 件套 1：扫前回真顶（切 tab）。失败也继续扫（至少扫当前窗口，不拖垮）。
        _reset_session_list_to_top(mw)
        time.sleep(_SCROLL_SETTLE_SLEEP)

        acc = _ScrollAccumulator(limit=limit)
        last_item: Optional[str] = None
        unchanged_streak = 0
        for _ in range(_SCROLL_MAX_PAGES):
            names = _read_visible_item_names(mw)
            acc.feed(names)
            # 件套 3：末项不变 streak 判到底（鲁棒，扛滚动偶发 stall 几屏不动）。
            cur_last = names[-1] if names else None
            if cur_last is not None and cur_last == last_item:
                unchanged_streak += 1
            else:
                unchanged_streak = 0
            last_item = cur_last
            if len(acc.contacts()) >= limit or _bottom_reached_by_last_item(
                unchanged_streak, _SCROLL_LAST_ITEM_UNCHANGED_MAX
            ):
                break
            _scroll_session_list_wheel(mw)
            time.sleep(_SCROLL_SETTLE_SLEEP)
        return acc.contacts()
    finally:
        # CRM 扫描把列表滚到了底；扫完回顶一次，让下一轮 scan_unread（已不再自己切 tab）从顶部读到。
        # _reset 已原子化：找不齐导航按钮就不切，不会把微信卡在通讯录。
        _reset_session_list_to_top(mw)
        _restore_window_state(mw, orig_state)


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

    WeChat 4.1.8 不在后台 UIA 树暴露 chat_input_field；回退策略：
    1. 先过滤窗口下半区（聊天输入框在底部，搜索栏在顶部）取面积最大者；
    2. 下半区为空时退化到全局面积最大者（兼容旧场景）。
    """
    try:
        win_rect = mw.rectangle()
        win_mid_y = win_rect.top + (win_rect.bottom - win_rect.top) * 0.5
    except Exception:
        win_mid_y = None

    candidates = []
    for c in _iter_all_controls(mw, "Edit"):
        try:
            aid = c.element_info.automation_id or ""
            if aid == "chat_input_field":
                return c
            try:
                r = c.rectangle()
                area = (r.right - r.left) * (r.bottom - r.top)
                top_y = r.top
            except Exception:
                area = 0
                top_y = 0
            candidates.append((area, aid, top_y, c))
        except Exception:
            continue

    if not candidates:
        return None

    if win_mid_y is not None:
        bottom_half = [e for e in candidates if e[2] >= win_mid_y]
        if bottom_half:
            bottom_half.sort(key=lambda x: x[0], reverse=True)
            best = bottom_half[0]
            _log(f"_find_chat_input: 下半区 Edit area={best[0]} aid={repr(best[1])}")
            return best[3]

    candidates.sort(key=lambda x: x[0], reverse=True)
    best = candidates[0]
    _log(f"_find_chat_input: 回退到最大 Edit area={best[0]} aid={repr(best[1])}")
    return best[3]


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


def _get_foreground_window() -> int:
    """读当前前台窗口 hwnd（操作前记录，操作后据此还焦点）。非 Windows/失败 → 0。"""
    import ctypes as _ct
    wd = getattr(_ct, "windll", None)
    if wd is None:
        return 0
    try:
        return int(wd.user32.GetForegroundWindow())
    except Exception:
        return 0


def _set_foreground_window(hwnd: int) -> None:
    """把前台焦点还给 hwnd（不抢用户正在用的窗口）。空 hwnd / 非 Windows → noop。

    真机修正（2026-06-21 xian-pc 实测 NOT SILENT）：裸 SetForegroundWindow 受 Windows 限制——
    非前台进程切不动别的窗口（切会话后微信占前台，焦点没还回）。用 AttachThreadInput 把当前
    线程附到「当前前台窗口」线程后再 SetForegroundWindow，绕过限制，焦点归还才真生效。
    """
    if not hwnd:
        return
    import ctypes as _ct
    wd = getattr(_ct, "windll", None)
    if wd is None:
        return
    u32 = wd.user32
    try:
        fg = u32.GetForegroundWindow()  # 当前前台（切会话后通常是微信）
        my_tid = wd.kernel32.GetCurrentThreadId()
        fg_tid = u32.GetWindowThreadProcessId(fg, None)      # 当前前台（微信）线程
        tgt_tid = u32.GetWindowThreadProcessId(hwnd, None)   # 目标（操作前窗口）线程
        # 同时附到当前前台线程 + 目标线程，输入状态共享后 SetForegroundWindow 才不被 Windows 拦
        u32.AttachThreadInput(my_tid, fg_tid, True)
        u32.AttachThreadInput(my_tid, tgt_tid, True)
        try:
            u32.SetForegroundWindow(hwnd)
            u32.BringWindowToTop(hwnd)
        finally:
            u32.AttachThreadInput(my_tid, tgt_tid, False)
            u32.AttachThreadInput(my_tid, fg_tid, False)
    except Exception:
        try:
            u32.SetForegroundWindow(hwnd)
        except Exception:
            pass


def _safe_hwnd(mw: Any) -> int:
    try:
        return int(mw.element_info.handle or 0)
    except Exception:
        return 0


def _should_restore_foreground(prev_fg: int, wechat_hwnd: int) -> bool:
    """窗口可见模式：操作后要不要把前台焦点还给操作前的前台窗口（不抢用户正在用的窗口）。

    Qt 上切会话只能 Select()，会短暂抢前台 ~2s → 操作完把焦点还回去抵消（PrepPRD 需求 2）。
    仅当操作前前台是「别的窗口」（prev_fg 有效且 != 微信）才还；前台本来就是微信、或拿不到
    （prev_fg=0）则不动。顶层零-pywinauto 纯函数。
    """
    return bool(prev_fg) and prev_fg != wechat_hwnd


def _focus_steal_verdict(
    fg_before: int, fg_after: int, steal_samples: int, total_samples: int
) -> dict:
    """焦点「静默」判定（替代旧『窗口不碰可见区』）：操作后前台焦点是否归还。

    新定义（PrepPRD §0 / memory wechat_qt_uia_works_dont_downgrade）：silent = 不抢前台焦点。
    切会话瞬间 Select() 会短暂抢（steal_samples 量化露头次数，仅诊断），只要操作后焦点最终
    归还到操作前那个窗口即算 SILENT。
      - fg_before 已知：要求 fg_after == fg_before（还给原来那个窗口）。
      - fg_before 未知（0）：只要 fg_after 非零（焦点没被卡死在无效态）即容忍判 SILENT。
    顶层零-pywinauto 纯函数。
    """
    restored = (fg_after == fg_before) if fg_before else (fg_after != 0)
    return {
        "silent": bool(restored),
        "restored": bool(restored),
        "steal_samples": steal_samples,
        "total_samples": total_samples,
    }


def _force_foreground(hwnd: int) -> None:
    """TOPMOST + AttachThreadInput + SetForegroundWindow 三步拉前台。"""
    import ctypes as _ct
    _u32 = _ct.windll.user32
    HWND_TOPMOST = -1
    HWND_NOTOPMOST = -2
    SWP_FLAGS = 0x0002 | 0x0001  # SWP_NOMOVE | SWP_NOSIZE
    try:
        _u32.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_FLAGS)
        _u32.SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_FLAGS)
        my_tid = _ct.windll.kernel32.GetCurrentThreadId()
        fg_hwnd = _u32.GetForegroundWindow()
        fg_tid = _u32.GetWindowThreadProcessId(fg_hwnd, None)
        _u32.AttachThreadInput(my_tid, fg_tid, True)
        _u32.SetForegroundWindow(hwnd)
        _u32.AttachThreadInput(my_tid, fg_tid, False)
    except Exception as e2:
        try:
            _u32.SetForegroundWindow(hwnd)
        except Exception:
            pass


def _uia_send(uia_edit: Any, mw: Any, reply_text: str) -> bool:
    """
    后台发送：SW_RESTORE 还原窗口 → SetValue 写入并验证 → PostMessageW(WM_KEYDOWN/UP)。
    WeChat 4.1.x 的聊天输入框 hwnd=0，直接对 main_hwnd PostMessageW(Enter) 有效
    （xian-pc 2026-06-10 实测验证），不需要 SendInput，不抢前台。
    """
    import ctypes as _ct
    _u32 = _ct.windll.user32
    SW_MINIMIZE = 6
    main_hwnd = mw.element_info.handle
    was_minimized = bool(_u32.IsIconic(main_hwnd))
    edit_hwnd = uia_edit.element_info.handle or main_hwnd
    _log(f"_uia_send: edit_hwnd={edit_hwnd} main_hwnd={main_hwnd} was_min={was_minimized}")
    try:
        # 1. 还原窗口（最小化时 SetValue 静默失败）并刷新 UIA 引用
        if was_minimized:
            if _OFFSCREEN_REPLY:
                import ctypes.wintypes as _wt
                _u32.ShowWindow(main_hwnd, 8)  # SW_SHOWNA=8：还原不激活不抢前台
                time.sleep(_OFFSCREEN_RESTORE_SLEEP)
                _rc = _wt.RECT()
                _u32.GetWindowRect(main_hwnd, _ct.byref(_rc))
                if _rc.left > -2000:
                    _SWP = 0x0001 | 0x0004 | 0x0010  # NOSIZE | NOZORDER | NOACTIVATE
                    _u32.SetWindowPos(main_hwnd, 0, _OFFSCREEN_X, _OFFSCREEN_Y, 0, 0, _SWP)
                time.sleep(_OFFSCREEN_MOVE_SLEEP)
            else:
                _u32.ShowWindow(main_hwnd, 9)  # SW_RESTORE=9（弹窗模式保留原始行为）
                time.sleep(_MINIMIZED_RESTORE_SLEEP)
            _refound = _find_chat_input(mw)
            if _refound is not None:
                uia_edit = _refound
                edit_hwnd = uia_edit.element_info.handle or main_hwnd
        # 2. SetValue 写入
        uia_edit.iface_value.SetValue(reply_text)
        time.sleep(_UIA_SETVALUE_SLEEP)
        # 3. 验证写入（防假阳性：hwnd=0 时 SetValue 可能静默失败）
        try:
            written = uia_edit.get_value() or ""
        except Exception:
            written = ""
        if not written:
            _log("_uia_send: SetValue后输入框仍空，中止")
            if was_minimized:
                _u32.ShowWindow(main_hwnd, SW_MINIMIZE)
            return False
        _log(f"_uia_send: 已写入 {len(written)} 字，尝试发送")
        # 4. PostMessageW WM_KEYDOWN+UP → 直投 main_hwnd 消息队列（不抢前台，不依赖 hwnd=0 的控件）
        VK_RETURN = 0x0D
        try:
            _u32.PostMessageW(main_hwnd, 0x0100, VK_RETURN, 0x001C0001)  # WM_KEYDOWN
            time.sleep(0.05)
            _u32.PostMessageW(main_hwnd, 0x0101, VK_RETURN, 0xC01C0001)  # WM_KEYUP
            time.sleep(0.4)
            try:
                remaining = uia_edit.get_value() or ""
            except Exception:
                remaining = ""
            if not remaining:
                if was_minimized:
                    _u32.ShowWindow(main_hwnd, SW_MINIMIZE)
                _log("_uia_send: PostMessage Enter 成功")
                return True
            _log(f"_uia_send: PostMessage后仍有{len(remaining)}字，降级发送按钮")
        except Exception as _ke:
            _log(f"_uia_send: PostMessage 异常: {_ke}")
        # 5. 降级：发送按钮 iface_invoke.Invoke()（UIA 控件调用，不依赖前台焦点）
        btn = _find_send_button(mw)
        _log(f"_uia_send: send_btn={'found' if btn else 'None'}")
        if btn is not None:
            try:
                btn.iface_invoke.Invoke()
                time.sleep(0.5)
                try:
                    remaining2 = uia_edit.get_value() or ""
                except Exception:
                    remaining2 = ""
                if not remaining2:
                    if was_minimized:
                        _u32.ShowWindow(main_hwnd, SW_MINIMIZE)
                    _log("_uia_send: btn iface_invoke.Invoke() 成功")
                    return True
                _log(f"_uia_send: btn click后仍有{len(remaining2)}字，失败")
            except Exception as _be:
                _log(f"_uia_send: btn iface_invoke.Invoke() 异常: {_be}")
        _log("_uia_send: 所有发送方式均失败")
        if was_minimized:
            try:
                _u32.ShowWindow(main_hwnd, SW_MINIMIZE)
            except Exception:
                pass
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


def _chat_title_matches(mw: Any, sender: str) -> Optional[bool]:
    """当前打开会话的顶部标题是否 == sender（收件人身份校验，防串台/发错人）。

    返回 True=标题命中 sender；False=找到标题但不是 sender；None=没找到任何标题文本（无法判定）。
    标题位置：窗口上部（top < 顶部+150）且在会话列表右侧（left > 左边+窗宽/4），与会话列表项区分。
    实现对齐 wechat-uia-silent-send skill 的 _chat_title_matches（2026-06-10 三人路由验证通过）。
    """
    try:
        wr = mw.rectangle()
    except Exception:
        return None
    width = wr.right - wr.left
    saw_any_title = False
    found_texts: list = []
    want = (sender or "").strip()
    for t in mw.descendants(control_type="Text"):
        try:
            r = t.rectangle()
            nm = (t.element_info.name or "").strip()
        except Exception:
            continue
        # 只看右侧上部区域的文本（聊天面板标题），排除左侧会话列表项的名字
        if r.left > wr.left + width // 4 and r.top < wr.top + 150 and nm:
            saw_any_title = True
            found_texts.append(nm)
            # WeChat 4.x 有时在标题栏截断长名：nm 是 want 的前缀且 ≥4 字也算命中
            if nm == want or (len(nm) >= 4 and want.startswith(nm)):
                return True
    if saw_any_title:
        _log(f"_chat_title_matches: 找到标题 {found_texts!r} 但均不匹配 {want!r}")
    return False if saw_any_title else None


def _last_bubble_direction(mw: Any) -> Optional[str]:
    """读「聊天面板内最底部」一条消息气泡，按水平中心相对聊天面板中线判方向（不回自己/不回操作者）。

    返回值：
      "incoming"：气泡水平中心在中线**左侧** → 对方发来 → 应回
      "outgoing"：气泡水平中心在中线**右侧或压线** → 我方/AI/操作者 → 跳过（压线倾向判我方更安全）
      None：聊天面板内读不到任何气泡（空会话/读不到） → 安全跳过（宁可漏回不可回错）

    区域约定复用 _chat_title_matches（listen_chat.py 同一窗口 rectangle / descendants("Text") 写法）：
      - chat_left = 窗口左 + 窗宽//4（排除左侧会话列表）
      - midline = (chat_left + 窗口右) // 2（聊天面板中线）
      - 「消息气泡」= Text 控件且 r.left > chat_left（在聊天面板内）且 r.top >= 窗口顶+150
        （标题区下方，沿用 150px 约定）且 name 非空
      - 「最后一条」= 上述气泡里 r.top 最大（最底部）的那条
    读 Text/rectangle() 抛异常 → 该控件跳过；窗口 rectangle() 抛异常 → 返回 None。
    顶层零-pywinauto 纯函数（同 _parse_item_name CI 锚点约定），纯 Fake 注入可测。
    """
    try:
        wr = mw.rectangle()
    except Exception:
        return None
    width = wr.right - wr.left
    chat_left = wr.left + width // 4
    midline = (chat_left + wr.right) // 2
    last_rect = None
    last_top = None
    for t in mw.descendants(control_type="Text"):
        try:
            r = t.rectangle()
            nm = (t.element_info.name or "").strip()
        except Exception:
            continue
        # 消息气泡：聊天面板内（left>chat_left）、标题区下方（top>=顶+150）、name 非空
        if r.left > chat_left and r.top >= wr.top + 150 and nm:
            if last_top is None or r.top > last_top:
                last_top = r.top
                last_rect = r
    if last_rect is None:
        return None
    center = (last_rect.left + last_rect.right) // 2
    # 压线（center == midline）倾向判「我方」更安全 → >= 判 outgoing
    return "outgoing" if center >= midline else "incoming"


def _delivery_confirmed(readback_text: str, sent_text: str) -> bool:
    """读回目标会话最后气泡/预览文本，确认发送原文真出现（替代 _uia_send 的 sent=True 自报）。

    血泪修正（06211342 sprint）：_uia_send 返回 True 只是"输入框清空 + 发了 Enter"的自报，
    不等于真送达。发完必须读回会话确认原文出现才算 DELIVERED；读不到 → 判未送达，下轮重试。

    规范化（去全部空白）后命中规则：
      - 发送原文整体出现在读回文本里 → 命中。
      - 微信会话列表预览会截断长消息 → 发送原文前 16 字符（足够独特防误判、又短于预览长度）
        作为前缀命中也算送达。
    读不到回读文本 / 发送原文为空 → False（保守，宁可判未送达重试，不假报成功）。
    顶层零-pywinauto 纯函数（同 _parse_item_name CI 锚点约定），纯 Fake 注入可测。
    """
    s = "".join((sent_text or "").split())
    r = "".join((readback_text or "").split())
    if not s or not r:
        return False
    if s in r:
        return True
    if len(s) >= 16:
        return s[:16] in r
    return False


# 送达读回【轮询】参数（decision/rog E2E 2026-06-29）：微信会话列表预览异步更新 + 刚 _open_chat
# 切完会话那刻 UIA 读偶发空 → 单次 _read_session_preview 读空 ≠ 未送达。轮询几轮给预览更新留时间。
_DELIVERY_READBACK_POLLS = 5            # 最多读回 5 轮
_DELIVERY_READBACK_POLL_SLEEP = 0.6     # 每轮间隔(约 3s 总窗口,够预览异步落定)


def _confirm_delivery(read_preview_fn, sent_text, polls, sleep_fn):
    """轮询读回确认送达：任一轮 _delivery_confirmed 命中即 (True, preview)；polls 轮都没命中
    才 (False, 最后一次 preview)。

    治假阴性（rog E2E 实地）：_uia_send 自报成功后，会话预览异步更新 + UIA 读偶发空，
    单次读空就判未送达会误报 send_failed（消息其实送达了）。轮询给预览更新留时间。
    不引入假阳性：仍要求发送原文真出现在读回里（_delivery_confirmed 不放宽）。
    纯逻辑：read_preview_fn/sleep_fn 注入，CI Fake 可测，顶层零 pywinauto。
    """
    preview = ""
    n = max(1, polls)
    for i in range(n):
        preview = read_preview_fn()
        if _delivery_confirmed(preview, sent_text):
            return True, preview
        if i < n - 1:
            sleep_fn()
    return False, preview


def _read_session_preview(mw: Any, sender: str) -> str:
    """读 sender 会话项的 element_info.name（含最后消息预览），供真送达验证读回（PrepPRD §5）。

    真机证据：发完读"默忆"会话项 name = '默忆\\nTest 1234 verify\\n12:45'（含最后消息）。
    会话项 name 首行 == sender 即命中该会话；读不到/sender 空 → 返回 ''（调用方判未送达）。
    顶层零-pywinauto 纯函数，纯 Fake 注入可测。
    """
    want = (sender or "").strip()
    if not want:
        return ""
    try:
        items = mw.descendants(control_type="ListItem")
    except Exception:
        return ""
    for it in items:
        try:
            nm = it.element_info.name or ""
        except Exception:
            continue
        if nm.split("\n")[0].strip() == want:
            return nm
    return ""


def _post_click_item(item: Any, target_hwnd: int) -> bool:
    """对 item 在 target_hwnd 客户区坐标 PostMessage 左键点击（不抢前台、不依赖焦点）。

    后台/离屏模式下 item.Invoke() 只切内部状态、不触发面板重绘，PostMessage 模拟点击才真正切换。
    windll 缺失（非 Windows，单测）时安全返回 False。
    """
    import ctypes as _ct
    u32 = getattr(_ct, "windll", None)
    if u32 is None or not target_hwnd:
        return False
    u32 = u32.user32
    try:
        r = item.rectangle()
        cx = (r.left + r.right) // 2
        cy = (r.top + r.bottom) // 2
    except Exception:
        return False

    class _POINT(_ct.Structure):
        _fields_ = [("x", _ct.c_long), ("y", _ct.c_long)]

    pt = _POINT(cx, cy)
    try:
        if not u32.ScreenToClient(target_hwnd, _ct.byref(pt)):
            return False
        lp = ((pt.y & 0xFFFF) << 16) | (pt.x & 0xFFFF)
        WM_MOUSEMOVE, WM_LBUTTONDOWN, WM_LBUTTONUP = 0x0200, 0x0201, 0x0202
        u32.PostMessageW(target_hwnd, WM_MOUSEMOVE, 0, lp)
        u32.PostMessageW(target_hwnd, WM_LBUTTONDOWN, 1, lp)
        time.sleep(0.05)
        u32.PostMessageW(target_hwnd, WM_LBUTTONUP, 0, lp)
        _log(f"_open_chat: PostMessage点击 hwnd={target_hwnd} client=({pt.x},{pt.y})")
        return True
    except Exception as exc:
        _log(f"_open_chat: PostMessage点击异常: {exc}")
        return False


def _find_render_subwindow(main_hwnd: int) -> int:
    """EnumChildWindows 找 MMUIRenderSubWindowHW 渲染子窗口 hwnd（微信 4.0 自绘层）；找不到/无 windll 返回 0。"""
    import ctypes as _ct
    wd = getattr(_ct, "windll", None)
    if wd is None or not main_hwnd:
        return 0
    u32 = wd.user32
    found = {"hwnd": 0}
    try:
        WNDENUMPROC = _ct.WINFUNCTYPE(_ct.c_bool, _ct.c_void_p, _ct.c_void_p)

        def _cb(hwnd, _lparam):
            try:
                buf = _ct.create_unicode_buffer(256)
                u32.GetClassNameW(hwnd, buf, 256)
                if "MMUIRenderSubWindow" in (buf.value or ""):
                    found["hwnd"] = hwnd
                    return False
            except Exception:
                pass
            return True

        u32.EnumChildWindows(main_hwnd, WNDENUMPROC(_cb), 0)
    except Exception:
        pass
    return found["hwnd"]


def _open_chat(mw: Any, item: Any, sender: str, expect_content: str = "") -> bool:
    """切到 sender 的会话并验证归属（防串台核心）。三策略切换 × 标题/选中验证，全失败返回 False。

    对齐 wechat-uia-silent-send skill 的 _open_chat（2026-06-10 三人路由验证通过）。
    切换策略按 attempt 升级（裸 Invoke 在离屏后台切不动 → 必须 PostMessage 模拟点击会话项）：
      attempt 0：iface_selection_item.Select()（无则 Invoke()）—— 最轻量
      attempt 1：PostMessage 点击 MMUIRenderSubWindowHW 渲染子窗口
      attempt 2：PostMessage 点击主窗口
    每次切换后等 2s，再用 标题==sender / 会话项处于选中态 任一验证；命中即返回 True。
    """
    import ctypes as _ct
    try:
        main_hwnd = mw.element_info.handle
    except Exception:
        main_hwnd = 0

    def _verify(attempt: int) -> bool:
        if sender and _chat_title_matches(mw, sender) is True:
            _log(f"_open_chat: {sender!r} 切换成功（验证=title, attempt={attempt}）")
            return True
        try:
            if item.iface_selection_item.CurrentIsSelected:
                _log(f"_open_chat: {sender!r} 切换成功（验证=selected, attempt={attempt}）")
                return True
        except Exception:
            pass
        return False

    # tray 恢复后 UIA 坐标可能仍停在离屏占位值（~31989,32000），PostMessage 打不到真实位置。
    # 检测到离屏则重新扫描列表找到新 item 引用，避免后续三次 PostMessage 全部打空。
    try:
        r = item.rectangle()
        if abs(r.left) > 20000 or abs(r.top) > 20000:
            _log(f"_open_chat: {sender!r} item 坐标离屏 ({r.left},{r.top})，Select() 激活后重扫…")
            # Qt 虚拟列表只渲染可视区，离屏 item 不在 descendants 里。
            # 先 Select() 强制虚拟列表把目标项滚进可视区渲染出有效坐标，再重扫。
            try:
                item.iface_selection_item.Select()
                time.sleep(0.3)
            except Exception:
                pass
            for _new_it in mw.descendants(control_type="ListItem"):
                try:
                    _first_line = (_new_it.element_info.name or "").split("\n")[0].strip()
                    if _first_line == sender:
                        item = _new_it
                        _log(f"_open_chat: 重扫找到 {sender!r} 新 item")
                        break
                except Exception:
                    continue
    except Exception:
        pass

    for attempt in range(_OPEN_CHAT_MAX_ATTEMPTS):
        try:
            if attempt == 0:
                try:
                    item.iface_selection_item.Select()
                except Exception:
                    item.iface_invoke.Invoke()
            elif attempt == 1:
                rhwnd = _find_render_subwindow(main_hwnd)
                if not _post_click_item(item, rhwnd):
                    item.iface_invoke.Invoke()  # 渲染子窗口缺失 → 回退 Invoke
            else:
                if not _post_click_item(item, main_hwnd):
                    item.iface_invoke.Invoke()
        except Exception as exc:
            _log(f"_open_chat: 切换异常(attempt={attempt}): {exc}")
        # 轮询验证（替代死等 2s）：切中立刻返回，最多等 ~2s。快的时候 ~0.4s 就走，多人排队提速关键。
        for _ in range(_OPEN_CHAT_VERIFY_POLLS):
            time.sleep(_OPEN_CHAT_POLL_INTERVAL)
            if _verify(attempt):
                return True
        _log(f"_open_chat: 切窗后未确认是 {sender!r}（attempt={attempt}），重试…")

    _log(f"_open_chat: 全部策略都无法切到 {sender!r}，放弃（绝不发进错误聊天）")
    return False


def reply_in_chat(mw: Any, item: Any, reply_text: str, sender: str = "") -> bool:
    """
    打开 item 对应会话并发出 reply_text。全程纯 UIA，禁止任何物理鼠标/键盘操作。
    Invoke() 后等 2s（CRITICAL：UIA 树更新需要时间，少了找不到 chat_input_field）。

    收件人身份闸门（防串台核心，2026-06-11 加）：item.Invoke() 在后台/离屏会话里只切内部状态、
    不触发面板重绘，叠加会话列表实时重排 → 回复发错人。故用 _open_chat 三策略切换（含 PostMessage
    点击会话项）真正切到 sender 并验证标题命中，命中才发；切不到则中止本轮（绝不盲发，下轮重试）。

    托盘坐标修复（2026-06-12）：微信托盘时 item.rectangle() 返回离屏坐标(~32878,~32679)，
    _post_click_item PostMessage 打不到列表项。回复前 _ensure_tray_visible 让坐标有效，
    回复后（无论成功/失败）_restore_tray 还原托盘状态。
    """
    def _fresh_mw():
        try:
            from find_weixin import get_main_window as _gmw
            return _gmw() or mw
        except Exception:
            return mw

    # 不抢前台焦点（PrepPRD 需求 2）：先记录操作前的前台窗口，操作完还回去。
    prev_fg = _get_foreground_window()
    wechat_hwnd = _safe_hwnd(mw)
    # 确保窗口可见，UIA 坐标才有效（_open_chat PostMessage 点击依赖有效坐标）
    orig_state = _ensure_tray_visible(mw)
    try:
        fmw = _fresh_mw()
        if sender:
            if not _open_chat(fmw, item, sender):
                _log(f"reply_in_chat: 无法切到 {sender!r} 的会话，中止本轮（防串台，绝不发给错误的人）")
                return False
        else:
            # 无 sender 信息：退回旧行为（仅 Invoke），不阻塞
            try:
                item.iface_invoke.Invoke()
            except Exception as _ie:
                _log(f"reply_in_chat: Invoke 异常: {_ie}")
            time.sleep(2.0)

        uia_edit = None
        for _poll in range(_FIND_INPUT_RETRIES):  # UIA 树更新有延迟，最多 N 次轮询
            fmw = _fresh_mw()
            uia_edit = _find_chat_input(fmw)
            if uia_edit is not None:
                break
            if _poll < _FIND_INPUT_RETRIES - 1:
                _log(f"reply_in_chat: 第{_poll + 1}次轮询未找到输入框，等 {_FIND_INPUT_RETRY_SLEEP}s 重试…")
                time.sleep(_FIND_INPUT_RETRY_SLEEP)
        if uia_edit is not None:
            # 发送前最后一道复核：找输入框期间窗口可能被新消息切走 → 再确认一次会话归属
            if sender and _chat_title_matches(fmw, sender) is False:
                _log(f"reply_in_chat: 发送前复核会话标题≠{sender!r}，中止（防串台）")
                return False
            if _uia_send(uia_edit, fmw, reply_text):
                # 真送达验证（替代 _uia_send 的 sent=True 自报，治假阳性）：读回目标会话预览，
                # 确认发送原文真出现才算 DELIVERED；读不到 → 判未送达，本轮返回 False 下轮重试。
                # sender 为空（fallback 路径，无目标会话可读）时保持旧行为不强验。
                if sender:
                    # 轮询读回（治假阴性）：预览异步更新 + 刚切完会话 UIA 读偶发空，单次读空≠未送达。
                    delivered, preview = _confirm_delivery(
                        lambda: _read_session_preview(_fresh_mw(), sender),
                        reply_text,
                        _DELIVERY_READBACK_POLLS,
                        lambda: time.sleep(_DELIVERY_READBACK_POLL_SLEEP),
                    )
                    if not delivered:
                        _log(
                            f"reply_in_chat: _uia_send 自报成功但读回未确认送达"
                            f"(轮询{_DELIVERY_READBACK_POLLS}次 preview={preview!r})，判未送达，下轮重试"
                        )
                        return False
                    _log(f"reply_in_chat: 真送达确认 DELIVERED(sender={sender!r})")
                _navigate_away(fmw)
                return True
    except Exception as exc:
        _log(f"reply_in_chat: 失败: {exc}")
    finally:
        _restore_window_state(mw, orig_state)
        # Qt 上切会话 Select() 会短暂抢前台 ~2s → 操作完把焦点还给操作前的窗口，不抢用户键鼠焦点
        if _should_restore_foreground(prev_fg, wechat_hwnd):
            # 等切会话 / _navigate_away 的前台激活落定，再还焦点（否则被晚到的激活覆盖，焦点留在微信）
            time.sleep(0.3)
            _set_foreground_window(prev_fg)
            _log(f"reply_in_chat: 焦点已归还操作前前台窗口(hwnd={prev_fg})")

    _log("reply_in_chat: 发送失败，本轮跳过（下次轮询重试）")
    return False


def _pywinauto_available() -> bool:
    try:
        import pywinauto  # noqa: F401  仅检测可用性
        return True
    except Exception:
        return False


def _emit_version_to_stderr() -> None:
    # pythonw 下 sys.stderr 为 None：直接 .write 会抛 AttributeError → import 顶层调用时
    # 整个模块崩溃却不报错，上层脚本读到上次 python.exe 的旧输出 → 假"成功"信号（PrepPRD §5）。
    if sys.stderr is None:
        return
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
        "--verify-silent",
        action="store_true",
        help="真机静默自检（接缝断言，B 方案）：窗口可见模式下后台采样前台焦点，跑一次真实 "
        "reply_in_chat，验操作后焦点是否归还操作前窗口（不抢焦点）。SILENT→退出码0，NOT SILENT→1。",
    )
    ap.add_argument(
        "--target",
        type=str,
        default=None,
        help="--verify-silent 的目标会话名（缺省取会话列表第一个）。",
    )
    ap.add_argument(
        "--message",
        type=str,
        default="[verify-silent] 静默自检",
        help="--verify-silent 真实发送的文本。",
    )
    ap.add_argument(
        "--no-send",
        action="store_true",
        help="--verify-silent 只读模式：窗口可见 + 采样前台焦点，不开会话不发消息（开机自检用，"
        "测核心不变量「前台焦点不被微信卡住」）。",
    )
    ap.add_argument(
        "--silent-sample-seconds",
        type=int,
        default=2,
        help="--verify-silent --no-send 只读采样时长（秒）。",
    )
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
    ap.add_argument(
        "--machine-id",
        type=str,
        default=os.environ.get("ZENITHJOY_MACHINE_ID"),
        help="本机 machine_id：按它向中台拉「自己那份」每客服配置（决策 143f5d00，缺省取 env ZENITHJOY_MACHINE_ID）。"
             "设了即走每客服 gate（真发跟随中台 auto_agent 开关）；不设则回落旧 env 真发判定。",
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
    agent_id: Optional[str] = None,
) -> Dict[str, Any]:
    """POST 中台生成草稿。mode='auto' 时返回值额外含 reply 文本。失败返回 {ok:false,...} 但不抛。

    agent_id：listen_chat 自身的 agent 标识。中台缺显式 tenant_id 时由此反查
    agents.tenant_id 推导租户（修 NO_TENANT_CONTEXT 全拒），符合「租户绑定时已定」架构。
    """
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
    if agent_id:
        body["agent_id"] = agent_id
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


# ─── CRM 好友扫描上报：scan_recent_contacts → 中台 ingest ───────────────────────────


def _service_auth_headers() -> Dict[str, str]:
    """构造 agent→中台 service 路径鉴权头（ingest / pending / onboarding 回写共用）。

    Gap1（2026-06-25）：agent 自证身份，不再依赖客户端 .env 烧共享 internal token。
      · X-License-Key：本机 license（ZENITHJOY_LICENSE，注册/心跳已用 license 认证）。
        后端按 license→tenant 鉴权放行，并校验 cs_wechat_id 属该 tenant——真 agent 只有 license
        也能写进 CRM（共享 internal token 不该下发到每台客户端，泄漏即全租户沦陷）。
      · X-Internal-Token：若 env 设了 internal token（如内网服务/CI）仍带上，兼容老 token 通道。
    两者都没有（dev/CI 未设）→ 不带头，后端 dev 模式放行。
    """
    headers: Dict[str, str] = {}
    _lic = os.environ.get("ZENITHJOY_LICENSE", "").strip()
    if _lic:
        headers["X-License-Key"] = _lic
    _token = os.environ.get("ZENITHJOY_INTERNAL_TOKEN", "").strip()
    if _token:
        headers["X-Internal-Token"] = _token
    return headers


def post_friend_scan(
    middleware_url: str,
    cs_wechat_id: str,
    contacts: List[Dict[str, Any]],
    timeout: int = 15,
) -> Dict[str, Any]:
    """上报近期会话联系人到中台 ingest 端点（CRM 好友表行源）。

    契约（PrepPRD §3.2 + Gap1 2026-06-25）：
      POST /api/crm/friend-scan/ingest
      鉴权：X-License-Key 自证（env ZENITHJOY_LICENSE；后端按 license→tenant 放行 + 校验
            cs_wechat_id 属该 tenant）。兼容 X-Internal-Token。两者皆无 → dev 放行。见 _service_auth_headers()。
      body：{ cs_wechat_id, contacts:[{name, last_message?, last_seen?}] }
      幂等：后端按 (tenant_id, cs_wechat_id, contact) upsert。

    纪律（同 post_heartbeat）：任何失败吞掉返回 {ok:false}，绝不抛——上报不能拖垮监听。
    - 空 contacts → 不发 HTTP（无意义），返回 {ok:true, ingested:0}。
    - 缺 cs_wechat_id → 不知上报给谁 → {ok:false}，不发 HTTP。
    """
    if not cs_wechat_id:
        return {"ok": False, "error": "missing cs_wechat_id"}
    if not contacts:
        return {"ok": True, "ingested": 0}
    try:
        import requests  # 仅运行时需要
    except Exception as exc:
        return {"ok": False, "error": f"requests not available: {exc}"}

    url = middleware_url.rstrip("/") + "/api/crm/friend-scan/ingest"
    body = {"cs_wechat_id": cs_wechat_id, "contacts": contacts}
    headers = _service_auth_headers()
    try:
        resp = requests.post(url, json=body, timeout=timeout, headers=headers)
    except Exception as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    status = getattr(resp, "status_code", 0)
    if status != 200:
        try:
            text = (resp.text or "")[:200]
        except Exception:
            text = ""
        return {"ok": False, "error": f"middleware HTTP {status}: {text}"}
    try:
        data = resp.json()
    except Exception:
        data = {}
    result: Dict[str, Any] = {"ok": True}
    if isinstance(data, dict):
        for k in ("ingested", "new", "scanned_count"):
            if k in data:
                result[k] = data[k]
    return result


def fetch_friend_scan_pending(
    middleware_url: str,
    cs_wechat_id: str,
    timeout: int = 10,
) -> Dict[str, Any]:
    """查询中台「立即扫好友」强制标志（运营在 Dashboard 点了"立即扫好友"按钮）。

    契约（line04-cs-consolidation-contract §cs-agent / 与 cs-be 对齐）：
      GET /api/crm/friend-scan/pending?cs_wechat_id=<wid>
      鉴权：X-License-Key 自证（env ZENITHJOY_LICENSE）+ 兼容 X-Internal-Token；
            与 post_friend_scan 同范式（见 _service_auth_headers()，Gap1 2026-06-25）。
      返回：{ force: <bool>, requested_at: <ts|null> }
            force=true 表示 force_scan_requested_at 仍未被消费（> 上次成功 scan）。

    消费逻辑（主循环）：force=true → 无视 24h 间隔立刻 scan_recent_contacts + post_friend_scan；
    ingest 成功后由后端清 force_scan_requested_at（agent 不另调清除端点）。

    纪律（同 fetch_outbound_tasks / post_friend_scan）：任何失败保守返回
    {ok:False, force:False}，绝不抛——拉指令不能拖垮监听，也绝不误触发扫描。
    - 缺 cs_wechat_id → 不知道查谁 → 不发 HTTP，{ok:False, force:False}。
    - 非 200 / 连接异常 / body 非 JSON → 保守 force=False。
    """
    if not cs_wechat_id:
        return {"ok": False, "force": False, "error": "missing cs_wechat_id"}
    try:
        import requests  # 仅运行时需要
    except Exception as exc:
        return {"ok": False, "force": False, "error": f"requests not available: {exc}"}

    url = middleware_url.rstrip("/") + "/api/crm/friend-scan/pending"
    headers = _service_auth_headers()
    try:
        resp = requests.get(
            url, params={"cs_wechat_id": cs_wechat_id}, timeout=timeout, headers=headers
        )
    except Exception as exc:
        return {"ok": False, "force": False, "error": f"{type(exc).__name__}: {exc}"}
    if getattr(resp, "status_code", 0) != 200:
        return {"ok": False, "force": False, "error": f"middleware HTTP {getattr(resp, 'status_code', 0)}"}
    try:
        data = resp.json()
    except Exception:
        return {"ok": False, "force": False, "error": "bad json"}
    if not isinstance(data, dict):
        return {"ok": False, "force": False, "error": "unexpected payload"}
    return {
        "ok": True,
        "force": bool(data.get("force")),  # 缺字段 → False（保守，绝不误触发扫描）
        "requested_at": data.get("requested_at"),
    }


# ─── 关键人出站任务（上下线播报 + 失败告警）：拉取 → 真机发送 → 回执 ──────────────────
#
# C1 尾巴接线：中台把「主动发给关键人」的出站任务入库（status=approved/system），
# listen_chat 每轮拉取 → 调 send_chat_message 真机 UIA 发送（target=关键人）→ 回写回执。
# 真机 UIA 发送是接缝（xian-rog 真验）；这里负责把「中台任务 → 真机发送」链路接通，不留 orphan。


def fetch_outbound_tasks(
    middleware_url: str, agent_id: Optional[str], timeout: int = 10
) -> List[Dict[str, Any]]:
    """GET 中台待发给关键人的出站任务。失败返回 []（不抛，不拖垮监听）。"""
    if not agent_id:
        return []
    try:
        import requests  # 仅运行时需要
    except Exception as exc:
        print(f"[listen_chat] outbound: requests not available: {exc}", file=sys.stderr)
        return []
    url = middleware_url.rstrip("/") + "/api/wechat/cs/outbound"
    try:
        resp = requests.get(url, params={"agent_id": agent_id}, timeout=timeout)
        if getattr(resp, "status_code", 0) != 200:
            return []
        data = resp.json()
        tasks = data.get("tasks") if isinstance(data, dict) else None
        return tasks if isinstance(tasks, list) else []
    except Exception as exc:
        print(f"[listen_chat] outbound fetch 失败: {exc}", file=sys.stderr)
        return []


def post_outbound_receipt(
    middleware_url: str, task_id: str, ok: bool, timeout: int = 10
) -> None:
    """回写出站任务回执（auto_sent / send_failed）。失败吞掉不抛。"""
    url = middleware_url.rstrip("/") + f"/api/wechat/cs/outbound/{task_id}/receipt"
    resp, error = _post_with_retry(
        url, {"ok": ok}, timeout=timeout, retries=2, backoff_base=0.5, max_total=10
    )
    if error is not None:
        print(f"[listen_chat] outbound receipt 失败 task={task_id}: {error}", file=sys.stderr)


def post_failure_alert(
    middleware_url: str,
    agent_id: Optional[str],
    key_contact: str,
    reason: str,
    timeout: int = 10,
) -> None:
    """发送失败/掉线 → 让中台入一条关键人告警出站任务（中台侧去重）。失败吞掉。"""
    if not agent_id or not key_contact:
        return
    url = middleware_url.rstrip("/") + "/api/wechat/cs/alert"
    body = {"agent_id": agent_id, "key_contact": key_contact, "reason": reason}
    _post_with_retry(url, body, timeout=timeout, retries=2, backoff_base=0.5, max_total=10)


def process_outbound_once(
    middleware_url: str, agent_id: Optional[str], real_publish: bool
) -> int:
    """拉取关键人出站任务 → 逐条真机发送 → 回执。返回成功发送条数。

    复用 send_chat.send_chat_message（纯 UIA 真发配方，target=关键人，支持 _find_session_item）。
    REAL_PUBLISH=0（默认 / CI）走 send_chat mock 路径，链路照样接通可测。
    """
    tasks = fetch_outbound_tasks(middleware_url, agent_id)
    if not tasks:
        return 0
    try:
        from send_chat import send_chat_message  # 函数体内 import，复用真发配方
    except Exception as exc:
        print(f"[listen_chat] outbound: send_chat import 失败: {exc}", file=sys.stderr)
        return 0

    sent = 0
    for t in tasks:
        task_id = str(t.get("task_id") or "")
        target = str(t.get("target") or "")
        message = str(t.get("message") or "")
        if not task_id or not target or not message:
            continue
        try:
            # 关键人主动发送：wechat_id 复用 target（关键人无独立 wxid 时以 target 作频控键）
            result = send_chat_message(target, target, message, real_publish)
            ok = bool(result.get("ok"))
        except Exception as exc:
            print(f"[listen_chat] outbound 发送异常 target={target}: {exc}", file=sys.stderr)
            ok = False
        post_outbound_receipt(middleware_url, task_id, ok)
        if ok:
            sent += 1
        else:
            # 关键人播报/告警自身发送失败 → 再报一条告警（中台去重防刷屏）
            post_failure_alert(middleware_url, agent_id, target, "key_contact_send_failed")
    return sent


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

    result = post_draft_generate(
        args.middleware_url, sender, wechat_id, content,
        agent_id=getattr(args, "agent_id", None),
    )
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

# 自愈件4：本地健康文件 —— line04 模块（Node）读它合成 listen_chat 真实健康（found_window /
# last_delivery_ts）经 IPC 上报 core → 随心跳上报中台。每轮心跳写一次，损坏/失败吞掉不拖垮监听。
_HEALTH_FILE = os.path.join(os.environ.get("PUBLIC", r"C:\Users\Public"), "zj-listener-health.json")


def write_health_file(diag: Dict[str, Any], last_delivery_ts: Optional[int]) -> None:
    """把扫描诊断 + 最近送达时间写本地健康文件。任何失败吞掉（健康文件不能拖垮监听）。"""
    try:
        payload = {
            "ts": int(time.time() * 1000),
            "found_window": bool(diag.get("main_window_found")),
            "login_present": bool(diag.get("login_present")),
            "sessions_seen": diag.get("sessions_seen"),
        }
        if last_delivery_ts is not None:
            payload["last_delivery_ts"] = last_delivery_ts
        with open(_HEALTH_FILE, "w", encoding="utf-8") as f:
            json.dump(payload, f)
    except Exception:
        pass

# ─── replied 持久化（模块顶层，供单测 monkeypatch）────────────────────────────────
_REPLIED_FILE: str = os.path.join(os.environ.get("PUBLIC", r"C:\Users\Public"), "zj-replied.json")
SENDER_COOLDOWN: float = _SENDER_COOLDOWN
REPLIED_TTL: float = _REPLIED_TTL
_replied_ts: dict = {}  # (sender, content) → 回复时间戳，供 _save_replied 持久化


def _load_replied() -> set:
    """从磁盘加载已回复集合，过滤超过 REPLIED_TTL 的过期条目。

    格式：
    - 新格式 [sender, content, timestamp]（3 元素）— 过期条目自动丢弃
    - 旧格式 [sender, content]（2 元素，无时间戳）— 向后兼容，全部加载
    """
    try:
        with open(_REPLIED_FILE, "r", encoding="utf-8-sig") as _f:
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
    """设置系统屏幕阅读器标志，激活微信 4.0 的 UIAutomation provider（替代讲述人）。

    微信 4.0 把 UI 自绘在 MMUIRenderSubWindowHW 上，只有"屏幕阅读器模式"被打开后才暴露
    mmui::MainWindow 那棵可读控件树。旧实现靠启动 Windows 讲述人来打开这个开关，但讲述人
    会在屏幕上画满跟随焦点的高亮框 + 朗读声，严重干扰客户机使用。

    新实现直接用 ctypes 调 SystemParametersInfo 设 SPI_SETSCREENREADER 标志——这才是讲述人
    背后真正打开"屏幕阅读器模式"的系统开关。纯系统调用，无窗口/无框/无声；标志在进程退出后
    持久保持，也不会反向招起讲述人。已在 xian-pc 真机验证：不开讲述人即读到 mmui::MainWindow
    + 92 控件。

    2026-06-24：对 4.1.10+ 的 Qt 窗口（Qt51514QWindowIcon）同样设此标志——6-21 真机验证
    Qt 框下 UIA 子树照样可读、消息照样能发，不因版本跳过激活。本函数无版本分支，恒设标志。
    """
    try:
        import ctypes

        SPI_SETSCREENREADER = 0x0047
        SPIF_SENDCHANGE = 0x0002
        ctypes.windll.user32.SystemParametersInfoW(
            SPI_SETSCREENREADER, True, None, SPIF_SENDCHANGE
        )
        _log("UIA 激活（屏幕阅读器系统标志已设，无需讲述人）完成")
    except Exception as exc:
        _log(f"UIA 激活失败: {exc}")


def _is_uia_flag_set() -> bool:
    """读取 SPI_GETSCREENREADER (0x0046) 标志当前值，非 Windows 返回 True。"""
    if platform.system() != "Windows":
        return True
    try:
        import ctypes
        val = ctypes.c_bool(False)
        ctypes.windll.user32.SystemParametersInfoW(0x0046, 0, ctypes.byref(val), 0)
        return bool(val.value)
    except Exception:
        return True


def _ensure_uia_flag() -> bool:
    """检查 UIA 屏幕阅读器标志；若已被 Windows 清除则立即补设。

    返回 True = 标志原本就在；False = 标志丢了，已重新补设。
    在轮询循环每轮开头调用，确保 WeChat UIA provider 始终可读，
    无需等待 45 秒冷却。
    """
    if _is_uia_flag_set():
        return True
    _log("UIA 屏幕阅读器标志已失效，立即补设…")
    _activate_uia()
    return False


# ─── 微信 mmui 无障碍树塌缩自愈（decision 4ab9b6f7，xian-rog 4.1.8.107 实地坐实 2026-06-29）──
# 根因：微信 mmui a11y 树【仅在微信进程启动时 SPI_SETSCREENREADER 标志已置位】才构建。
# autologon/外部启动的微信若启动时标志没设 → mmui::MainWindow 的 UIA 子树永久塌缩到只剩
# 1 个 MMUIRenderSubWindowHW 空 Pane（descendants=1、ListItem=0），会话列表完全不暴露 →
# sessions 永远 0 → 永不回复。事后 _activate_uia(SPIF_SENDCHANGE 广播)/OFF→ON 翻转/SetForeground/
# set_focus 全部无法让【已运行进程】重建树（逐一实测失败）。唯一根因修法 = 重启微信，让 mmui
# 在 screenreader 激活态下重建完整树（实测 descendants 1→71、ListItem 0→6、默忆[5条] 读出）。
_COLLAPSED_TREE_MAX_DESCENDANTS = 2      # 整树 descendants ≤ 此值 = 塌缩(仅 render pane);树建好即便0会话也有几十控件
_COLLAPSED_SUSTAIN_SECONDS = 90         # 树持续塌缩 ≥ 此时长才重启(避开启动过渡/瞬时态)
_WECHAT_RESTART_COOLDOWN_SECONDS = 600  # 两次重启间隔 ≥ 10min(重启重而慢,防抖)
_WECHAT_RESTART_MAX = 5                 # 单 listener 进程生命周期内最多重启 5 次(防无限重启 loop)


def _is_uia_tree_collapsed(descendants_count: int) -> bool:
    """纯函数(CI可测)：mmui::MainWindow 整树是否塌缩(无障碍树未构建)。

    塌缩态(实地观测) = 整棵子树只剩 1 个 MMUIRenderSubWindowHW 空 Pane(descendants≤2)。
    与"树已建但暂无会话"区分：后者即便 0 会话也有搜索框/导航/按钮等几十个控件(descendants 远>2)，
    所以不能只靠 ListItem==0 判定(会误伤刚开机/真无会话的正常态)。
    """
    return descendants_count <= _COLLAPSED_TREE_MAX_DESCENDANTS


def _should_restart_for_collapsed_tree(
    now: float, last_restart_at: float, cooldown_s: float,
    restarts_done: int, max_restarts: int,
) -> bool:
    """纯函数(CI可测)：塌缩已持续达阈值后，是否现在重启微信。

    冷却(防抖：重启重而慢，别每轮都杀) + 单进程重启上限(防"重启也修不好"时无限 loop，
    留给进程级/人工介入)。调用方负责"塌缩已持续 _COLLAPSED_SUSTAIN_SECONDS"的前置判断。
    """
    if restarts_done >= max_restarts:
        return False
    if now - last_restart_at < cooldown_s:
        return False
    return True


def _restart_wechat_for_uia() -> bool:
    """微信进程在跑但 mmui 无障碍树塌缩(UIA 读不到会话)时，重启微信以重建 a11y 树。

    步骤：① _activate_uia() 确保 screenreader 标志已置位(这样微信重启时就能读到 → mmui 构建完整树)
         ② taskkill /F Weixin.exe(微信吞 WM_CLOSE，优雅退无效，只能强杀；实测 /F + 等待 + 重启不崩)
         ③ launch_weixin() 重启。返回是否成功发起重启。非 Windows 直接 False。
    """
    if platform.system() != "Windows":
        return False
    try:
        _activate_uia()  # 杀之前先置标志：微信重启时读到 screenreader=on → mmui 构建完整 a11y 树
        import subprocess
        subprocess.run(
            ["taskkill", "/F", "/IM", "Weixin.exe", "/T"],
            capture_output=True, timeout=20,
        )
        time.sleep(6)  # 等进程真正退出 + 文件锁释放(防紧接重启崩 crashpad)
        from find_weixin import launch_weixin
        ok = launch_weixin()
        _log(f"UIA树塌缩→已重启微信(重建a11y树): launch_weixin={ok}")
        return bool(ok)
    except Exception as exc:
        _log(f"重启微信(重建UIA树)失败: {exc}")
        return False


def _relock_update() -> None:
    """每轮（按 UPDATE_LOCK_INTERVAL 冷却）重施"关死微信自动更新"+ verify。

    微信会恢复更新器（install-dir + AppData xwechat 两处），故 agent 必须周期重施。
    诚实：腾讯更新硬，做不到 100%，wechat_update_lock 会如实标 locked=True/False。
    任何异常吞掉（关更新失败绝不拖垮监听主循环）。
    """
    try:
        from wechat_update_lock import run_update_lock
        r = run_update_lock(dry_run=False)
        _log(f"关更新重施: locked={r.get('locked')} {r.get('detail', '')}")
    except Exception as exc:
        _log(f"关更新重施异常（已吞，不拖垮监听）: {exc}")


def run_real_listen(args: argparse.Namespace) -> int:
    from find_weixin import assert_supported_version
    assert_supported_version()

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
    from find_weixin import get_main_window, login_window_present, is_privacy_locked

    print(
        f"[listen_chat] start polling (pywinauto), middleware={args.middleware_url}, "
        f"timeout={args.timeout}s",
        flush=True,
    )

    # replied 持久化 + 冷却（_load_replied / _save_replied / _REPLIED_FILE / SENDER_COOLDOWN 在模块顶层）
    replied: set[tuple[str, str]] = _load_replied()
    _log(f"已加载 replied 历史: {len(replied)} 条")
    reply_failed_at: dict[tuple[str, str], float] = {}
    REPLY_FAIL_COOLDOWN = _REPLY_FAIL_COOLDOWN
    sender_reply_cooldown: dict[str, float] = {}
    _skip_logged: set[tuple[str, str]] = set()  # 只对每个 key 打一次 skip log，避免刷屏
    # 内容变化检测：{sender: last_seen_content}，捕捉聊天面板打开时的新消息（无未读角标）
    last_content: dict[str, str] = {}
    deadline = time.time() + max(1, args.timeout)
    # 进程守护：向中台上报心跳（断 3 分钟无心跳中台飞书告警）+ 扫描诊断
    heartbeat_interval = _HEARTBEAT_INTERVAL
    last_heartbeat = 0.0
    last_unread_senders: List[str] = []
    last_error: Optional[str] = None
    # 自愈件4：最近一次出站/回复成功送达的时间戳（ms），写进健康文件供模块/中台看模块真实健康
    last_delivery_ts: Optional[int] = None
    # 微信4.0 mmui 控件树需设屏幕阅读器标志激活 UIAutomation 后才暴露、且会失效：启动先激活一次，失效再按冷却补激活
    uia_reactivate_interval = _UIA_REACTIVATE_INTERVAL
    _activate_uia()
    last_uia_activate = time.time()
    # 关死微信自动更新：启动先施一次，之后每 UPDATE_LOCK_INTERVAL 重施（微信会恢复更新器）
    update_lock_interval = _UPDATE_LOCK_INTERVAL
    _relock_update()
    last_update_lock = time.time()
    # 自动启动微信：检测到微信未运行时自动 Popen Weixin.exe，冷却防重复拉起
    wechat_launch_cooldown = _WECHAT_LAUNCH_COOLDOWN
    last_wechat_launch = time.time() - wechat_launch_cooldown + 30  # 30s grace before first launch
    # UIA 树塌缩自愈（decision 4ab9b6f7）：微信在跑+主窗口找到但 a11y 树未构建(descendants≤2)→
    # 会话永远扫不到。持续 _COLLAPSED_SUSTAIN_SECONDS 后重启微信重建树（冷却+上限保护）。
    collapsed_tree_since: Optional[float] = None
    last_wechat_restart = 0.0
    wechat_restart_count = 0
    # replied 过期清理：每 REPLIED_TTL 扫一次，确保过期条目在 TTL 后立即清除
    last_replied_purge = time.time()
    # 每客服配置：按 machine_id 周期性拉「自己那份」→ 缓存（断网用缓存继续判定，强制 dryrun）。
    cs_config: Optional[Dict[str, Any]] = None
    cs_pull_ok = False
    last_cs_pull = 0.0
    CS_PULL_INTERVAL = 30  # 秒；与心跳同量级，开关一改约 30s 内生效
    # CRM 好友扫描上报（PrepPRD §3.4 / 决策 3）：onboarding 必跑一次 + 每日一次低频。
    # 低频是因为扫描要短暂移窗刷新 UIA，频繁会扰动；每日一次足以维护好友表。
    last_friend_scan = 0.0
    friend_scan_done_once = False
    FRIEND_SCAN_INTERVAL = 24 * 3600  # 每日一次
    # 「立即扫好友」强制标志（运营在 Dashboard 点按钮 → 中台置 force_scan_requested_at）。
    # 主循环每轮 poll 太频（~3s），按 FORCE_SCAN_POLL_INTERVAL 节流拉 pending，
    # force=true 时本轮无视 24h 间隔立刻扫一遍；ingest 成功后由后端清标志。
    last_force_scan_poll = 0.0
    FORCE_SCAN_POLL_INTERVAL = 20  # 秒；点了按钮后约 20s 内客服机响应
    try:
        while time.time() < deadline:
            now = time.time()

            # 每客服 gate：machine_id 在册 → 周期拉自己那份 → 真发跟随中台 auto_agent 开关；
            # 不在册 → 回落旧 env 真发判定（向后兼容）。拉失败 resolve_send_mode 强制 dryrun，绝不误真发。
            _machine_id = getattr(args, "machine_id", None)
            if _machine_id and now - last_cs_pull >= CS_PULL_INTERVAL:
                _fresh, _ok = cs_config_gate.fetch_cs_config(args.middleware_url, _machine_id)
                cs_config = cs_config_gate.resolve_active_config(_fresh, cs_config, _ok)
                cs_pull_ok = _ok
                last_cs_pull = now
                _log(f"[每客服] 拉配置 pull_ok={_ok} mode={cs_config_gate.resolve_send_mode(cs_config, cs_pull_ok)}")
            if _machine_id:
                _real_publish = cs_config_gate.resolve_send_mode(cs_config, cs_pull_ok) == "real"
            else:
                _real_publish = _resolve_real_publish()

            # 每 REPLIED_TTL 清理过期 replied 条目（不能等 3600s，否则 TTL'd 条目死锁）
            if now - last_replied_purge >= REPLIED_TTL:
                expired_keys = {k for k in replied if now - _replied_ts.get(k, 0) >= REPLIED_TTL}
                if expired_keys:
                    replied -= expired_keys
                    for k in expired_keys:
                        _replied_ts.pop(k, None)
                        _skip_logged.discard(k)
                    _save_replied(replied)
                    _log(f"已清理 {len(expired_keys)} 条过期 replied（TTL {REPLIED_TTL}s）")
                last_replied_purge = now

            # 每轮检查 UIA 标志是否仍在；Windows 会话锁定等场景会清除该标志
            _ensure_uia_flag()

            # 周期性重施"关死微信自动更新"（微信会恢复更新器，按 UPDATE_LOCK_INTERVAL 冷却重施 + verify）
            if now - last_update_lock >= update_lock_interval:
                _relock_update()
                last_update_lock = now

            # 取主窗口（顺带采集诊断：找到没 / 是否停在登录窗口 / 是否隐私锁屏）
            mw = None
            login = False
            screen_locked = False
            try:
                mw = get_main_window()
                if mw is None:
                    screen_locked = is_privacy_locked()
                    if not screen_locked:
                        login = login_window_present()
                else:
                    # 主窗口已就绪时若仍有登录窗口（残留），自动关闭
                    if login_window_present():
                        try:
                            import ctypes as _ctc
                            _hwnd_login = _ctc.windll.user32.FindWindowW("mmui::LoginWindow", None)
                            if _hwnd_login:
                                _ctc.windll.user32.PostMessageW(_hwnd_login, 0x0010, 0, 0)
                                _log(f"检测到多余登录窗口(hwnd={_hwnd_login})，已发 WM_CLOSE 自动关闭")
                        except Exception as _ce:
                            _log(f"自动关闭登录窗口失败: {_ce}")
            except Exception as exc:
                last_error = f"{type(exc).__name__}: {exc}"

            # 心跳 + 扫描诊断上报中台（运营在 Dashboard「监听健康」看板一眼定位卡在哪）
            if now - last_heartbeat >= heartbeat_interval:
                sessions_seen = 0
                tree_size: Optional[int] = None  # mmui::MainWindow 整树控件数（塌缩自愈判定用）
                if mw is not None:
                    try:
                        sessions_seen = len(mw.descendants(control_type="ListItem"))
                        tree_size = len(mw.descendants())
                    except Exception as exc:
                        last_error = f"{type(exc).__name__}: {exc}"
                diag = {
                    "main_window_found": mw is not None,
                    "login_present": login,
                    "screen_locked": screen_locked,
                    "sessions_seen": sessions_seen,
                    "unread_count": len(last_unread_senders),
                    "unread_senders": last_unread_senders[:10],
                    "replied_count": len(replied),
                    "last_error": last_error,
                }
                lock_suffix = " [隐私锁屏！请在微信设置里关闭隐私保护]" if screen_locked else ""
                _log(
                    f"心跳 found_window={diag['main_window_found']} login={login} "
                    f"locked={screen_locked} sessions={sessions_seen} unread={diag['unread_count']}"
                    f"{diag['unread_senders']} replied={diag['replied_count']} err={last_error}"
                    f"{lock_suffix}"
                )
                hb = post_heartbeat(
                    args.middleware_url, agent_id=getattr(args, "agent_id", None), diag=diag
                )
                # 自愈件4：写本地健康文件（line04 模块读它合成真实健康 → IPC 上报 core）
                write_health_file(diag, last_delivery_ts)
                last_heartbeat = now
                if not hb.get("ok"):
                    _log(f"心跳上报失败: {hb.get('error')}")

                # UIA 树塌缩自愈（decision 4ab9b6f7）：主窗口找到(mw非空)但整树塌缩(descendants≤2,
                # mmui a11y 树未构建,会话列表完全不暴露)→ sessions 永远 0 → 永不回复。事后置标志/
                # 广播都救不了已运行进程，唯一根因修法 = 重启微信(标志已置位态下 mmui 重建完整树)。
                # 持续 _COLLAPSED_SUSTAIN_SECONDS 才动手(避开启动过渡)，且冷却+上限防抖防无限重启。
                if mw is not None and tree_size is not None and _is_uia_tree_collapsed(tree_size):
                    if collapsed_tree_since is None:
                        collapsed_tree_since = now
                        _log(
                            f"检测到微信 UIA 树塌缩(descendants={tree_size},mmui a11y 树未构建,会话不可见)，"
                            f"持续 {_COLLAPSED_SUSTAIN_SECONDS}s 未恢复将重启微信重建树"
                        )
                else:
                    collapsed_tree_since = None
                if (
                    collapsed_tree_since is not None
                    and now - collapsed_tree_since >= _COLLAPSED_SUSTAIN_SECONDS
                    and _should_restart_for_collapsed_tree(
                        now, last_wechat_restart, _WECHAT_RESTART_COOLDOWN_SECONDS,
                        wechat_restart_count, _WECHAT_RESTART_MAX,
                    )
                ):
                    if _restart_wechat_for_uia():
                        last_wechat_restart = now
                        last_wechat_launch = now  # 防主循环 auto-launch 紧接重复拉起
                        wechat_restart_count += 1
                    collapsed_tree_since = None  # 重启后重新计时(失败也别每轮狂杀,等下个塌缩周期)
                    time.sleep(args.interval)
                    continue

            if mw is None:
                # 隐私锁屏：账号已登录但微信屏幕被锁，无法操作 → 等待用户手动解锁，不做 UIA 激活
                if screen_locked:
                    time.sleep(args.interval)
                    continue

                # 微信既没有主窗口也没有登录窗口 → 进程未启动 → 自动拉起 Weixin.exe（冷却 120s）
                if not login and now - last_wechat_launch >= wechat_launch_cooldown:
                    from find_weixin import launch_weixin, is_weixin_running  # noqa: PLC0415
                    if is_weixin_running():
                        _log("微信进程已在运行但 UIA 找不到主窗口（UIA 未就绪），跳过重复启动，等待下次激活")
                    else:
                        launched = launch_weixin()
                        last_wechat_launch = time.time()
                        if launched:
                            _log("微信未运行，已自动启动 Weixin.exe — 请扫码登录")
                        else:
                            _log("微信未运行，自动启动失败（Weixin.exe 不存在或 Popen 异常）")
                        time.sleep(5)  # 等微信启动窗口

                # 找不到 mmui 主窗口（多为微信4.0 UIAutomation 激活失效）→ 按冷却重做屏幕阅读器标志补激活再重试
                if now - last_uia_activate >= uia_reactivate_interval:
                    print("[listen_chat] 未找到微信主窗口，重做 UIA 激活…", flush=True)
                    _activate_uia()
                    last_uia_activate = time.time()
                    try:
                        mw = get_main_window()
                        if mw is None:
                            screen_locked = is_privacy_locked()
                            if not screen_locked:
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

            # CRM 好友扫描上报（onboarding 必跑一次 + 每日一次低频，决策 3）：
            # machine_id 在册且已拉到自己 wechat_id → scan_recent_contacts → POST 中台 ingest。
            # 失败吞掉不拖垮监听（post_friend_scan 内部已处理）。
            _cs_wid = (cs_config or {}).get("wechat_id") if getattr(args, "machine_id", None) else None

            # 「立即扫好友」强制标志：运营在 Dashboard 点了按钮 → 中台 force_scan_requested_at。
            # 节流拉 pending（复用现有拉指令模式，参考 process_outbound_once）；force=true 则本轮
            # 无视 24h 间隔立刻扫一遍。失败保守 force=False（绝不误触发），绝不拖垮监听。
            _force_scan = False
            if _cs_wid and now - last_force_scan_poll >= FORCE_SCAN_POLL_INTERVAL:
                last_force_scan_poll = now
                try:
                    _pending = fetch_friend_scan_pending(args.middleware_url, _cs_wid)
                    _force_scan = bool(_pending.get("force"))
                    if _force_scan:
                        _log(f"[CRM好友扫描] 收到「立即扫好友」指令(requested_at={_pending.get('requested_at')}) → 本轮强制扫描")
                except Exception as _fpexc:
                    _log(f"[CRM好友扫描] 拉强制标志异常: {_fpexc}")

            if _cs_wid and (
                _force_scan
                or not friend_scan_done_once
                or now - last_friend_scan >= FRIEND_SCAN_INTERVAL
            ):
                try:
                    _contacts = scan_recent_contacts(mw, limit=100)
                    # A2：逐个补对方微信号 + 加好友时间（资料页 + 聊天记录最顶日期）。
                    # 失败只跳过该字段，base 列表不受影响。
                    _contacts = enrich_contacts_with_details(mw, _contacts)
                    _res = post_friend_scan(args.middleware_url, _cs_wid, _contacts)
                    if _res.get("ok"):
                        friend_scan_done_once = True
                        last_friend_scan = now
                        # 强制扫已消费：后端在 ingest 成功后清 force_scan_requested_at（agent 不另调清除端点）。
                        _trig = "强制" if _force_scan else "周期"
                        _log(f"[CRM好友扫描] ({_trig})扫到 {len(_contacts)} 人 → 上报 ingested={_res.get('ingested')}")
                    else:
                        _log(f"[CRM好友扫描] 上报失败: {_res.get('error')}（下轮重试）")
                except Exception as _fsexc:
                    _log(f"[CRM好友扫描] 异常: {_fsexc}")

            # 关键人出站任务（上下线播报 + 失败告警）：拉中台待发任务 → 真机 UIA 发送 → 回执。
            # 与「被动回名单内客户」同循环，但走 send_chat 真发配方（target=关键人）。失败吞掉不拖垮监听。
            try:
                _ob = process_outbound_once(
                    args.middleware_url,
                    getattr(args, "agent_id", None),
                    _real_publish,
                )
                if _ob:
                    _log(f"[关键人出站] 发送 {_ob} 条")
                    # 自愈件4：记录最近一次成功送达时间（写进健康文件给中台看模块真实健康）
                    last_delivery_ts = int(time.time() * 1000)
            except Exception as _obexc:
                _log(f"[关键人出站] 处理异常: {_obexc}")

            # 主动发送指令：写 %PUBLIC%\zj-proactive-send.json → {target:..., message:...}
            _public = os.environ.get("PUBLIC", r"C:\Users\Public")
            _psc = os.path.join(_public, "zj-proactive-send.json")
            if os.path.exists(_psc):
                try:
                    with open(_psc, "r", encoding="utf-8-sig") as _f:
                        _raw = _f.read()
                    os.remove(_psc)  # 先删除再解析，防格式错误导致无限重试
                    _cmd = json.loads(_raw)
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

            # 每客服 gate（入站自动回复）：machine_id 在册且本轮非真发（中台该客服 auto_agent
            # OFF / 拉配置失败）→ 整轮不自动回复（演练），绝不在开关关着时真回客户。
            if getattr(args, "machine_id", None) and not _real_publish:
                if unread:
                    _log(f"[每客服] auto_agent OFF/拉配置失败 → 本轮跳过 {len(unread)} 条自动回复(dryrun)")
                time.sleep(args.interval)
                continue

            # ── Phase 1: 过滤可回复的未读 + 并行生成草稿 ──────────────────────────────
            # 生成草稿是纯网络调用、不碰微信窗口，可并发；多人同时来时不再逐个排队等模型，
            # 把"生成"从串行链路里拿出来并行做，最后只串行做"切窗+发送"（单窗口物理限制）。
            # 接管名单门（CRM 重做：黑名单主模型 + whitelist 兼容回退，见 cs_config_gate.should_reply）：
            # - blacklist 模式（takeover_mode='blacklist'）：默认全接管，sender∈blacklist 才跳过。
            # - whitelist 模式 / 无 takeover_mode 存量配置：配了 whitelist 则只回名单内；没配（空）→ 不限，保持现状。
            # 是否启用名单门：machine_id 在册 且（blacklist 模式 或 配了非空 whitelist）。
            _cs_cfg = cs_config if getattr(args, "machine_id", None) else None
            _cs_mode = (_cs_cfg or {}).get("takeover_mode")
            _cs_whitelist = (_cs_cfg or {}).get("whitelist")
            _roster_gate_on = bool(_cs_cfg) and (_cs_mode == "blacklist" or bool(_cs_whitelist))
            eligible = []
            for m in unread:
                key = (m["sender"], m["content"])
                if _roster_gate_on and not cs_config_gate.should_reply(_cs_cfg, m["sender"]):
                    if key not in _skip_logged:
                        _reason = "黑名单内" if _cs_mode == "blacklist" else "不在该客服白名单"
                        _log(f"skip({_reason}) sender={m['sender']}")
                        _skip_logged.add(key)
                    continue
                # UIA 重复读防护：同 (联系人, 文本) 在去重时间窗内只回一次（auto_reply.is_duplicate
                # 是 SSOT；pywinauto 轮询常把同一条未读重复读出来，这里挡掉防重复发）。
                if auto_reply.is_duplicate(m["sender"], m["content"], now):
                    if key not in _skip_logged:
                        _log(f"skip(dup) sender={m['sender']} content={m['content'][:20]!r}")
                        _skip_logged.add(key)
                    continue
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
                    ok_rl, _next_at = rate_limiter.can_send("chat", m["sender"])
                    if not ok_rl:
                        _log(f"rate_limiter: {m['sender']} 24h限额已满，跳过回复（下次允许: {_next_at}）")
                        continue
                eligible.append(m)

            # 并行向中台要草稿文本（最多 5 路同时，避免压垮中台）；按 id(m) 存回复
            drafts = {}
            if eligible:
                import concurrent.futures

                def _gen_draft(mm):
                    return post_draft_generate(
                        args.middleware_url, mm["sender"],
                        mm.get("wxid") or mm.get("sender_wxid") or mm.get("sender", ""),
                        mm["content"], mode="auto",
                        agent_id=getattr(args, "agent_id", None),
                    )

                with concurrent.futures.ThreadPoolExecutor(max_workers=min(5, len(eligible))) as _ex:
                    _futs = {_ex.submit(_gen_draft, m): m for m in eligible}
                    for _fut in concurrent.futures.as_completed(_futs):
                        m = _futs[_fut]
                        try:
                            result = _fut.result()
                        except Exception as exc:
                            _log(f"draft-generate 异常 sender={m['sender']}: {exc}")
                            continue
                        reply = (result or {}).get("reply")
                        # AI 失败时 reply 为空 / 占位文案 → 不发，绝不把"AI 生成失败"发给客户
                        if not reply or reply == FAIL_PLACEHOLDER:
                            _log(f"skip(no reply) sender={m['sender']} result_ok={(result or {}).get('ok')} err={(result or {}).get('error')}")
                            continue
                        drafts[id(m)] = reply

            # ── Phase 2: 串行发送（单微信窗口，切窗+发送只能逐个；_open_chat 身份闸门防串台）──
            for m in eligible:
                reply = drafts.get(id(m))
                if not reply:
                    continue
                key = (m["sender"], m["content"])
                # 不回自己/不回操作者：读聊天面板最底部气泡方向，仅「对方发来(incoming)」才回。
                #   incoming  → 对方发来 → 进入发送（human_intervened=False，拟人延迟约 2s）
                #   outgoing  → 我方/AI/操作者最右气泡 → 跳过本条（human_intervened=True，人工优先）
                #   None      → 读不到气泡 → 跳过（安全，宁可漏回不可回错）
                # REPLY_DIRECTION_CHECK=False（默认）→ 完全跳过方向判断：真机气泡阈值未校准前，
                #   方向检测会把收到的消息误判成 outgoing 而永不回，关掉后对所有未读消息正常回。
                human_intervened = False
                if REPLY_DIRECTION_CHECK:
                    direction = _last_bubble_direction(mw)
                    human_intervened = direction == "outgoing"  # 操作者最右气泡=人工介入信号
                    if direction != "incoming":
                        _wait = decide_reply_wait(human_intervened=human_intervened)
                        _log(f"skip(direction={direction!r}) sender={m['sender']} "
                             f"human_intervened={human_intervened} (wait={_wait}s)")
                        continue
                # 拟人回复延迟：确认要回这条之后、实际发送之前等待。
                #   - 名单内自动回（human_intervened=False）→ auto_reply.pick_reply_delay() 随机 1~5s（拟人，防机械等距）
                #   - 人工介入（outgoing）→ decide_reply_wait 给人工优先的长等待
                _wait = (
                    auto_reply.pick_reply_delay()
                    if not human_intervened
                    else decide_reply_wait(human_intervened=human_intervened)
                )
                time.sleep(_wait)
                _log(f"尝试回复 sender={m['sender']} reply_len={len(reply)} (等待 {_wait}s)")
                ok = False
                try:
                    ok = reply_in_chat(mw, m["_item"], reply, sender=m["sender"])
                except Exception as exc:
                    _log(f"reply_in_chat exception sender={m['sender']}: {exc}")
                    ok = False
                # 回执（auto_reply.build_receipt 是 SSOT）：成功 auto_sent / 失败 send_failed 不重发。
                receipt = auto_reply.build_receipt("auto", ok=ok, reason=None if ok else "send_failed")
                if ok:
                    _replied_ts[key] = time.time()  # 记录时间戳，_save_replied 持久化用
                    replied.add(key)
                    _save_replied(replied)  # 持久化，防重启重复回复
                    _skip_logged.discard(key)
                    reply_failed_at.pop(key, None)
                    sender_reply_cooldown[m["sender"]] = time.time()  # per-sender 30s 冷却
                    last_content.pop(m["sender"], None)  # 删除防自回复风暴（存 reply 反而触发 Path2 截断误判）
                    _log(f"auto-replied OK sender={m['sender']} receipt={receipt['status']}")
                else:
                    reply_failed_at[key] = time.time()
                    # 读回失败/掉线告警：auto_reply.alert_on_failure 产出关键人告警 payload（决策 SSOT）。
                    # 关键人由中台配置（auto_agent.key_contact_wechat）下发；agent 侧拿不到则 target 留空。
                    key_contact = getattr(args, "key_contact", "") or os.environ.get("ZJ_KEY_CONTACT", "")
                    alert = auto_reply.alert_on_failure("reply_in_chat_failed", key_contact)
                    _log(
                        f"reply_in_chat FAILED sender={m['sender']} receipt={receipt['status']} "
                        f"alert_target={alert['target']!r} (冷却 {REPLY_FAIL_COOLDOWN}s 再试)"
                    )
                    # 真机主动告警接线：让中台入一条关键人告警出站任务（中台去重）→ 下一轮
                    # process_outbound_once 真机 UIA 发给关键人。同时随心跳 diag 上报留痕。
                    try:
                        post_failure_alert(
                            args.middleware_url,
                            getattr(args, "agent_id", None),
                            key_contact,
                            "reply_in_chat_failed",
                        )
                        post_heartbeat(
                            args.middleware_url,
                            agent_id=getattr(args, "agent_id", None),
                            diag={"alert": alert, "receipt": receipt},
                        )
                    except Exception as _hbexc:
                        _log(f"[告警上报] 异常: {_hbexc}")
                time.sleep(1)  # 操作间隔 ≥1s

            time.sleep(args.interval)
    except KeyboardInterrupt:
        pass

    emit_json({"ok": True, "info": "listen loop exited", "replied_count": len(replied)})
    return 0


# ─── 静默自检（接缝断言，真机跑，不进 CI）──────────────────────────────────────


def run_verify_silent(args: argparse.Namespace) -> int:
    """真机静默自检（B 方案重定义）：窗口可见模式下，客观验证一次真实发送全程「不抢前台焦点」
    （操作完焦点归还操作前的窗口），而非旧「窗口藏屏外不碰可见区」。

    新「静默」语义（PrepPRD §0 / memory wechat_qt_uia_works_dont_downgrade）：silent = 不抢焦点。
    窗口留屏上可见；Qt 上切会话 Select() 会短暂抢前台（focus_steal 量化露头），只要操作后焦点
    还回操作前那个窗口即 SILENT。这是接缝断言——代码碰真实世界那个点（真微信 + 真前台焦点），
    必须由 lead 在 session 1 真机跑出 SILENT 才算 done。

    流程：
      1. 记录操作前前台窗口 fg_before = GetForegroundWindow()；
      2. 开后台采样线程每 5ms GetForegroundWindow，统计 focus_steal（前台 == 微信主窗口的次数）；
      3. 默认：跑一次真实 reply_in_chat（内部发完会把焦点还给 fg_before + 真送达读回确认）；
         --no-send 只读模式（开机自检用）：不开会话不发消息，固定采样 N 秒，验前台不被微信卡住；
      4. 操作后 fg_after = GetForegroundWindow()；_focus_steal_verdict 判 restored
         → SILENT 退出码 0 / NOT SILENT（焦点未归还）退出码 1。
    """
    if platform.system() != "Windows":
        emit_json({"ok": False, "error": "verify-silent 必须在 Windows 真机 session 1 运行"})
        return 1
    if not _pywinauto_available():
        emit_json({"ok": False, "error": "pywinauto 不可用，无法做静默自检"})
        return 1

    import ctypes as _ct

    _u32 = _ct.windll.user32

    # 微信 4.x 需先激活 SPI_SETSCREENREADER 才暴露 UIA 控件树。真模式 main loop 会激活，
    # 但独立跑 verify-silent（哨兵/开机自检）必须自激活，否则 get_main_window 找不到窗口（NO_WINDOW）。
    _activate_uia()
    time.sleep(0.5)

    try:
        from find_weixin import get_main_window as _gmw
        mw = _gmw()
    except Exception as exc:
        emit_json({"ok": False, "error": f"找不到微信主窗口: {exc}"})
        return 1
    if mw is None:
        emit_json({"ok": False, "error": "NO_WINDOW（微信未登录 / 不在当前 session）"})
        return 1
    main_hwnd = mw.element_info.handle

    no_send = getattr(args, "no_send", False)

    # 选目标会话（只读模式 --no-send 不需要：不开会话不发消息）
    target = args.target
    item = None
    if no_send:
        _log("verify-silent: 只读模式(--no-send)，不开会话不发消息，只验前台焦点不被微信卡住")
    else:
        try:
            for it in mw.descendants(control_type="ListItem"):
                first = (it.element_info.name or "").split("\n")[0].strip()
                if not first:
                    continue
                if target is None:
                    target, item = first, it
                    break
                if first == target:
                    item = it
                    break
        except Exception as exc:
            emit_json({"ok": False, "error": f"枚举会话列表失败: {exc}"})
            return 1
        if item is None or not target:
            emit_json({"ok": False, "error": f"找不到目标会话（target={args.target!r}）"})
            return 1
        _log(f"verify-silent: 目标会话 = {target!r}")

    # 记录操作前前台窗口（窗口可见模式不移动窗口；自检完焦点应归还到它，由 reply_in_chat 内部完成）
    try:
        fg_before = int(_u32.GetForegroundWindow())
    except Exception:
        fg_before = 0
    _log(f"verify-silent: 操作前前台 hwnd={fg_before}（微信主窗口={main_hwnd}）")

    # 后台采样线程：每 5ms 采前台窗口，前台 == 微信主窗口则计 steal（微信抢了前台焦点）
    SAMPLE_INTERVAL = 0.005
    stop_flag = {"stop": False}
    stats = {"samples": 0, "steal": 0}

    def _sampler():
        while not stop_flag["stop"]:
            try:
                fg = int(_u32.GetForegroundWindow())
            except Exception:
                time.sleep(SAMPLE_INTERVAL)
                continue
            stats["samples"] += 1
            if fg == main_hwnd:
                stats["steal"] += 1
            time.sleep(SAMPLE_INTERVAL)

    th = threading.Thread(target=_sampler, daemon=True)
    th.start()

    # no_send：只读采样固定时长（不碰会话不发消息）；否则跑一次真实发送（含还焦点 + 真送达读回）
    sent = False
    try:
        if no_send:
            sample_s = max(1, getattr(args, "silent_sample_seconds", 2))
            _log(f"verify-silent: 只读采样 {sample_s}s（验前台不被微信卡住）")
            time.sleep(sample_s)
        else:
            sent = reply_in_chat(mw, item, args.message, sender=target)
    except Exception as exc:
        _log(f"verify-silent: {'只读采样' if no_send else 'reply_in_chat'} 异常: {exc}")
    finally:
        stop_flag["stop"] = True
        th.join(timeout=2)

    # 操作后前台窗口（reply_in_chat 内部已尝试把焦点还给 fg_before）。等焦点切换落定再读最终态。
    time.sleep(0.5)
    try:
        fg_after = int(_u32.GetForegroundWindow())
    except Exception:
        fg_after = 0

    verdict = _focus_steal_verdict(fg_before, fg_after, stats["steal"], stats["samples"])
    silent = verdict["silent"]
    steal = stats["steal"]
    samples = stats["samples"]
    est_ms = steal * SAMPLE_INTERVAL * 1000

    print(
        f"操作前前台={fg_before} / 操作后前台={fg_after} / 微信窗口={main_hwnd} / "
        f"采样{samples}次 / 微信占前台={steal}次（≈{est_ms:.0f}ms）",
        flush=True,
    )
    if silent:
        print("SILENT", flush=True)
    else:
        print(
            f"NOT SILENT（焦点未归还操作前窗口：操作后前台={fg_after}≠操作前={fg_before}）",
            flush=True,
        )
    emit_json(
        {
            "ok": True,
            "silent": silent,
            "restored": verdict["restored"],
            "target": target,
            "sent": sent,
            "fg_before": fg_before,
            "fg_after": fg_after,
            "wechat_hwnd": main_hwnd,
            "samples": samples,
            "focus_steal_samples": steal,
            "focus_steal_est_ms": est_ms,
        }
    )
    return 0 if silent else 1


def main() -> int:
    args = parse_args()
    _print_config()  # 启动时打印有效配置，方便排查

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

    if args.verify_silent:
        return run_verify_silent(args)

    if args.dryrun:
        return run_dryrun_inject(args)

    return run_real_listen(args)


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
auto_reply.py — 微信客服「无审批自动回复闭环」纯决策层（Line 04）。

本模块是环境无关的决策核心：路由真值表 / 营业时间（含跨午夜）/ 拟人延迟 /
去重幂等 / LLM 超时跳过 / 开关跳变上下线播报 / 失败告警 / 回执。所有函数纯
（或半纯：去重用进程内缓存），不碰 pywinauto / 不发 HTTP / 不读 DB，便于在
Linux CI 用 pytest 全覆盖（逻辑断言）；真送达接缝走 listen_chat.py + e2e-verify.ps1。

由 listen_chat.py 在自动回闭环里调用：
  decide_reply_route → 决定 auto / review / pending_human / skip_offhours
  within_business_hours → 营业时间窗判定（含 end="24:00" 与跨午夜）
  pick_reply_delay → 拟人随机延迟（发送前 sleep）
  is_duplicate → UIA 重复读防护（同 contact+text+时间窗只回一次）
  llm_timeout_skip → DeepSeek 生成超时则跳过不发占位
  broadcast_action → 开关跳变给关键人发上/下线播报
  alert_on_failure → 读回失败/掉线给关键人告警 + 写飞书
  build_receipt → 自动发回执（auto_sent / send_failed 不重发）

契约: sprints/06220821-line04-cs-no-approval-auto-reply/contract-draft.md
oracle: services/agent/wechat-rpa/tests/test_auto_reply_route.py
"""
from __future__ import annotations

import datetime as dt
import random
import threading
from typing import Any, Dict, Optional

# ── 常量 ─────────────────────────────────────────────────────────────────────

# 拟人回复延迟区间（秒）。名单内消息确认要回之后、实际发送之前随机等待。
REPLY_DELAY_MIN_SECONDS = 1.0
REPLY_DELAY_MAX_SECONDS = 5.0

# LLM（DeepSeek via ToAPI）生成超时阈值（毫秒）。超时即跳过不发占位。
LLM_TIMEOUT_MS = 20000

# 去重时间窗（秒）。同 (联系人, 文本) 在此窗口内视为重复读，只回一次。
DEDUP_WINDOW_SECONDS = 300.0

# 上/下线播报文案（关键人微信收到的内容）。
ONLINE_TEXT = "🟢 智能客服已上线，自动接待中"
OFFLINE_TEXT = "🔴 智能客服已下线，转人工"

# 路由字面量（禁用同义替换词，见 contract「禁用字段名/值」）。
ROUTE_AUTO = "auto"
ROUTE_REVIEW = "review"
ROUTE_PENDING_HUMAN = "pending_human"
ROUTE_SKIP_OFFHOURS = "skip_offhours"


# ── ① 路由真值表 ──────────────────────────────────────────────────────────────


def decide_reply_route(
    in_whitelist: bool,
    business_hours_ok: bool,
    auto_agent_on: bool,
    daily_count: int,
    daily_limit: int,
) -> str:
    """决定一条来消息的处理路由。返回值 ⊆ 4 字面量。

    优先级（与 contract 真值表逐行对齐）：
      1. 自动代理 OFF → review（监控态，出草稿不自动发，优先级最高）
      2. 名单外 → pending_human（不自动回陌生人）
      3. 营业时间外 → skip_offhours（记 pending 待上班）
      4. daily_limit>0 且已达上限 → pending_human（当天不再自动回）
      5. 全绿 → auto（拟人延迟自动回）
    """
    if not auto_agent_on:
        return ROUTE_REVIEW
    if not in_whitelist:
        return ROUTE_PENDING_HUMAN
    if not business_hours_ok:
        return ROUTE_SKIP_OFFHOURS
    if daily_limit > 0 and daily_count >= daily_limit:
        return ROUTE_PENDING_HUMAN
    return ROUTE_AUTO


# ── ② 营业时间（含 end="24:00" 与跨午夜）────────────────────────────────────────


def _hhmm_to_minutes(hhmm: str) -> int:
    """'HH:MM' → 当天分钟数；'24:00' → 1440（一天结束）。格式非法抛 ValueError。"""
    if not isinstance(hhmm, str):
        raise ValueError(f"invalid time literal: {hhmm!r}")
    parts = hhmm.split(":")
    if len(parts) != 2:
        raise ValueError(f"invalid HH:MM: {hhmm!r}")
    hour = int(parts[0])  # int('bad') → ValueError，被调用方兜
    minute = int(parts[1])
    if not (0 <= hour <= 24 and 0 <= minute <= 59):
        raise ValueError(f"out of range HH:MM: {hhmm!r}")
    if hour == 24 and minute != 0:
        # 24:00 是唯一合法的「午夜」哨兵；24:01~24:59 非法，防 UI 漏校验写脏值
        raise ValueError(f"24:00 is the only valid 24-hour sentinel: {hhmm!r}")
    return hour * 60 + minute


def within_business_hours(
    start_hhmm: str, end_hhmm: str, now_time: Optional[dt.time]
) -> bool:
    """now_time 是否落在 [start, end) 营业时间窗内。

    - end='24:00' → 视为当天 1440 分钟（全天到午夜）。
    - 跨午夜（start > end，如 22:00–02:00）→ now >= start OR now < end。
    - 非法时间格式抛 ValueError；now_time 缺失抛 ValueError（由调用方兜，不崩主链路）。
    """
    start = _hhmm_to_minutes(start_hhmm)
    end = _hhmm_to_minutes(end_hhmm)
    if now_time is None:
        raise ValueError("now_time is required")
    now = now_time.hour * 60 + now_time.minute

    if start <= end:
        # 普通区间（含 end=24:00=1440）：闭开 [start, end)
        return start <= now < end
    # 跨午夜：例如 22:00–02:00
    return now >= start or now < end


# ── ③ 拟人延迟 ────────────────────────────────────────────────────────────────


def pick_reply_delay() -> float:
    """返回 [1.0, 5.0] 秒区间内的随机拟人延迟（每次不同，非常量）。"""
    return random.uniform(REPLY_DELAY_MIN_SECONDS, REPLY_DELAY_MAX_SECONDS)


# ── ④ 去重幂等（进程内缓存，线程安全）────────────────────────────────────────────

_dedup_lock = threading.Lock()
_dedup_seen: Dict[tuple, float] = {}


def is_duplicate(
    contact: str,
    text: str,
    now_ts: float,
    window_seconds: float = DEDUP_WINDOW_SECONDS,
) -> bool:
    """同 (联系人, 文本) 在 window_seconds 内是否已处理过（UIA 重复读防护）。

    首次出现 → 记录时间戳返回 False；窗口内再次出现同 (contact, text) → True（只回一次）。
    不同文本 / 超窗 → False（视为新消息）。
    """
    key = (contact, text)
    with _dedup_lock:
        # 顺手驱逐超窗 key，防 7×24 长跑监听进程里 dict 随 (contact,text) 无限膨胀
        expired = [k for k, ts in _dedup_seen.items() if (now_ts - ts) > window_seconds]
        for k in expired:
            del _dedup_seen[k]
        last = _dedup_seen.get(key)
        if last is not None and (now_ts - last) <= window_seconds:
            return True
        _dedup_seen[key] = now_ts
        return False


def reset_dedup() -> None:
    """清空去重缓存（测试 / 长跑进程定期回收用）。"""
    with _dedup_lock:
        _dedup_seen.clear()


# ── ⑤ LLM 超时跳过 ───────────────────────────────────────────────────────────


def llm_timeout_skip(elapsed_ms: float, timeout_ms: float = LLM_TIMEOUT_MS) -> bool:
    """生成耗时是否超过阈值（默认 20s）。超时 → 跳过不发占位（不外发 FAIL_PLACEHOLDER）。"""
    return elapsed_ms > timeout_ms


# ── ⑥ 开关跳变上/下线播报 ──────────────────────────────────────────────────────


def broadcast_action(prev_on: bool, next_on: bool, key_contact: str) -> Dict[str, Any]:
    """自动代理开关跳变时，给关键人发什么播报。

    - 关键人未配置（空）→ skip（记日志不阻塞开关切换）。
    - 无跳变（prev==next）→ skip（不重复播报）。
    - OFF→ON → online（发上线播报）；ON→OFF → offline（发下线播报）。
    """
    if not key_contact:
        return {"action": "skip", "target": "", "reason": "key_contact_unconfigured"}
    if prev_on == next_on:
        return {"action": "skip", "target": key_contact, "reason": "no_change"}
    if next_on:
        return {"action": "online", "target": key_contact, "text": ONLINE_TEXT}
    return {"action": "offline", "target": key_contact, "text": OFFLINE_TEXT}


# ── ⑦ 失败/掉线告警 ──────────────────────────────────────────────────────────


def alert_on_failure(reason: str, key_contact: str) -> Dict[str, Any]:
    """发送失败（读回失败）/ 微信掉线时，产出给关键人的告警 payload。

    要求同时写飞书（also_feishu=True）；不重发原消息（防刷屏），只告警。
    """
    return {
        "target": key_contact,
        "reason": reason,
        "channel": "wechat",
        "also_feishu": True,
        "text": f"⚠️ 智能客服异常：{reason}",
    }


# ── ⑧ 回执（成功 auto_sent / 失败 send_failed 不重发）────────────────────────────


def build_receipt(route: str, ok: bool, reason: Optional[str] = None) -> Dict[str, Any]:
    """自动发完成后的回执。成功 → auto_sent；失败 → send_failed 且 retry=False（不重发，防刷屏）。"""
    status = "auto_sent" if ok else "send_failed"
    return {"status": status, "route": route, "reason": reason, "retry": False}

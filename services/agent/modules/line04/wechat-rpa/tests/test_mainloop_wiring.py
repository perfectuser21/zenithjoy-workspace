# -*- coding: utf-8 -*-
"""
主循环接线守卫 — scan_unread 锚点扫描新参数必须真接进主循环。

背景（0702 扫描机制重构 Task 5 收尾）：scan_unread 已长出
record_skip / should_open 两个参数（锚点推进 + roster 谓词拦开窗），
但主循环调用处若不接线，等于新机制白做：
  - record_skip 不接 → bubble_read_empty / anchor_stall 观测黑洞，心跳 diag 看不见；
  - should_open 不接 → 黑名单内部人员也开窗，清掉操作者本人未读角标 +
    烧光 SCAN_OPEN_BUDGET（对抗审查 ISSUE-2）；
  - 终态 skip（replied/dup/roster_gate）不提交触发态 → 每轮重开同一会话白烧预算。

本文件用源码文本断言守住接线（模式同 test_dedup_regression.py 的源码守卫），
任何人把接线改掉/删掉 → 测试红 → CI 拦截。禁止删除本文件。
"""
from __future__ import annotations

import io
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
LISTEN_CHAT_PATH = os.path.abspath(os.path.join(HERE, "..", "listen_chat.py"))


def _source() -> str:
    with io.open(LISTEN_CHAT_PATH, "r", encoding="utf-8") as f:
        return f.read()


def test_scan_call_wires_record_skip_and_should_open():
    """主循环 scan_unread 调用必须带 record_skip=_skip_counter.record 和 should_open=。"""
    src = _source()
    m = re.search(r"unread = scan_unread\(", src)
    assert m is not None, "主循环里找不到 unread = scan_unread( 调用"
    # 调用可能跨多行：取调用起点后一段窗口做断言
    window = src[m.start(): m.start() + 400]
    assert "record_skip=_skip_counter.record" in window, (
        "scan_unread 主循环调用没接 record_skip=_skip_counter.record —— "
        "bubble_read_empty/anchor_stall 观测断线"
    )
    assert "should_open=" in window, (
        "scan_unread 主循环调用没接 should_open= —— "
        "黑名单 sender 会被开窗（清角标+烧 SCAN_OPEN_BUDGET）"
    )


def test_terminal_skip_commits_trigger_state():
    """终态 skip（replied/dup/roster_gate）必须紧跟 _commit_reply_success 提交触发态。

    暂态 skip（sender_cooldown/cooldown/rate_limited）不得提交 —— 冷却结束要能自动重试。
    """
    src = _source()
    pattern = re.compile(
        r'if _reason in \("replied", "dup", "roster_gate"\):\s*\n'
        r'\s*_commit_reply_success\(m, last_preview\)'
    )
    assert pattern.search(src) is not None, (
        "classify 循环里缺少『终态 skip → _commit_reply_success(m, last_preview)』接线 —— "
        "已回过/重复/名单拦截的会话会每轮重开白烧预算"
    )


def test_roster_gate_computed_before_scan():
    """_roster_gate_on 的赋值必须出现在 unread = scan_unread 之前（should_open 谓词依赖它）。"""
    src = _source()
    gate_idx = src.find("_roster_gate_on = ")
    scan_idx = src.find("unread = scan_unread(")
    assert gate_idx != -1, "找不到 _roster_gate_on 赋值"
    assert scan_idx != -1, "找不到 unread = scan_unread( 调用"
    assert gate_idx < scan_idx, (
        f"_roster_gate_on 赋值（index {gate_idx}）必须在 scan 调用（index {scan_idx}）之前，"
        "否则 should_open 谓词拿不到本轮 gate"
    )


def test_fast_heal_wired_into_scan_loop_not_heartbeat():
    """真塌快速自愈必须接在 scan 主循环（1-3s 周期，~15s 恢复），不能只留在 60s 心跳块。

    背景（2026-07-18 用户反馈"检测到坍塌→重启很慢"）：#950 的树塌自愈原先只在心跳块
    （每 60s 一轮）触发，最坏要等一整个心跳周期才开始召唤。挪进 scan 主循环后，塌缩后
    ~15s（_HIDDEN_COLLAPSED_SUSTAIN_SECONDS）就召唤恢复。任何人把这段接线删回心跳块/删掉
    → scan_collapse_since 失去用武之地 → 恢复退回 ~60s → 本测试红 → CI 拦截。
    """
    src = _source()
    # 1) scan 块必须用 scan_collapse_since 作为 collapsed_since 实参调用快速自愈判定
    m = re.search(
        r"_should_fast_heal_hidden_collapsed\(\s*\n?\s*now,\s*scan_collapse_since,",
        src,
    )
    assert m is not None, (
        "找不到 scan 主循环的 _should_fast_heal_hidden_collapsed(now, scan_collapse_since, ...) 调用 —— "
        "快速自愈没接进 scan 主循环，恢复会退回 ~60s 心跳周期"
    )
    # 2) 该调用必须出现在 scan 块 last_readable_scan_at = now 之后（证明在 scan 循环内，不是心跳块）
    readable_idx = src.find("last_readable_scan_at = now")
    heal_idx = m.start()
    assert readable_idx != -1 and readable_idx < heal_idx, (
        "scan 快速自愈调用必须紧跟 scan 块的 last_readable_scan_at = now —— "
        "位置错了说明没接在 scan 循环里"
    )
    # 3) 命中真塌先走热键召唤（Ctrl+Alt+W，handoff 0719 发现1：托盘图标坐标跨机器不稳定），
    #    失败才退回托盘双击召唤，再失败才退回重启兜底
    window = src[heal_idx: heal_idx + 900]
    hotkey_idx = window.find("_summon_wechat_via_hotkey()")
    tray_idx = window.find("_summon_wechat_from_tray()")
    assert hotkey_idx != -1, (
        "scan 快速自愈没先试 _summon_wechat_via_hotkey() —— "
        "handoff 0719 发现1(热键召唤)未接进主循环，召唤主路仍是跨机器不稳定的托盘坐标识别"
    )
    assert tray_idx != -1, (
        "scan 快速自愈缺 _summon_wechat_from_tray() 兜底 —— 热键召唤失败后应降级托盘双击，不能直接跳重启"
    )
    assert hotkey_idx < tray_idx, (
        "热键召唤必须先于托盘召唤尝试（召唤主路=热键，托盘降级为兜底）"
    )


def test_desktop_mutex_yield_wired_at_loop_top():
    """桌面互斥让位必须接在主循环最顶部（早于心跳/扫描/发送/UIA 标志），CI 持租时整轮让位。

    背景（2026-07-18 实证）：rog 持续真塌只在 CI 抢占 session-1 交互桌面把监听饿死时发生。
    CI 抢桌面前 acquire 高优先级租约；监听主循环顶部查 `_should_yield_desktop(desktop_lease_status())`，
    他人持更高优先级租约 → `continue` 整轮让位。任何人把这段删掉/挪到扫描之后 → 让位失效 → 与 CI
    硬撞 → 本测试红。
    """
    src = _source()
    m = re.search(r"_should_yield_desktop\(\s*desktop_lease_status\(\)", src)
    assert m is not None, (
        "主循环缺 _should_yield_desktop(desktop_lease_status(), ...) 让位检查 —— "
        "CI 抢桌面时监听不会让位，回到硬撞真塌"
    )
    # 必须在心跳块（tree_size = ... descendants）之前，证明"整轮让位"而非只跳发送
    yield_idx = m.start()
    heartbeat_idx = src.find("_really_collapsed")
    scan_idx = src.find("unread = scan_unread(")
    assert heartbeat_idx == -1 or yield_idx < heartbeat_idx, (
        "让位检查必须在心跳塌缩判定之前（loop 顶），否则 CI 持租时监听仍跑心跳读树抢桌面"
    )
    assert scan_idx == -1 or yield_idx < scan_idx, (
        "让位检查必须在 scan_unread 之前（loop 顶），否则 CI 持租时监听仍扫描抢前台"
    )
    # 让位分支必须 continue 跳过本轮（不是只 log）
    window = src[yield_idx: yield_idx + 400]
    assert "continue" in window, "让位分支必须 continue 整轮跳过"


def test_classify_already_replied_bypasses_anchor():
    """classify_unread 调用里 already_replied 必须带 'and not m.get(\"_anchor\")' 旁路。

    若缺失：同内容重发（客户重发相同文本）在 replied set 里会被永久静默不回，
    因为 (sender, content) key 已存在 → already_replied=True → 终态 skip → 触发态被消费。
    锚点机制已保证只回最后 outgoing 之后的 incoming，_anchor 旁路是安全的。
    """
    src = _source()
    assert 'and not m.get("_anchor")' in src, (
        'classify_unread 调用缺 \'and not m.get("_anchor")\' 旁路 —— '
        "同内容重发会被 replied 永久静默"
    )

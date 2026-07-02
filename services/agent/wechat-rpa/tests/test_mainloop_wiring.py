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

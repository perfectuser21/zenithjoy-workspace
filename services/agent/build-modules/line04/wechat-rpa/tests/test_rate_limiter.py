"""
TDD RED 阶段 — `rate_limiter.can_send('chat', ...)` 分钟上限单测。

【放置路径】Generator commit-1 必须把本文件原样写到
  services/agent/wechat-rpa/tests/test_rate_limiter.py

【关键约束】rate_limiter.py:48 `MIN_INTERVAL_SECONDS = 1`。
  每次 can_send 之间**必须** time.sleep(1.1)，否则第二次调用会被间隔限制（而非分钟上限）
  拒绝，导致测试断言失败（误判）。

【RED 阶段】rate_limiter.py 在 ws3 阶段已存在但本 sprint 之前无此 case 覆盖。
  Generator commit-1 添加本测试，commit-2 不改 rate_limiter.py（已就绪）。
  → 本测试在 commit-1 时应直接 GREEN（既有实现已支持），不阻 TDD 流程。
  → 真正 RED 的是 test_scan_unread.py 和 wechat-draft-auto-reply.test.ts。
"""
from __future__ import annotations

import os
import sys
import time
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

from rate_limiter import can_send, reset  # noqa: E402


def _unique_id() -> str:
    """每个测试用独立 wechat_id，避免持久化状态污染相邻测试。"""
    return f"test_chat_freq_{uuid.uuid4().hex[:8]}"


def test_chat_per_minute_limit():
    """
    PRD §验收第 2 条：分钟内调用 ≤ CHAT_PER_MINUTE(=2)。
    前 2 次返回 (True, None)；第 3 次返回 (False, next_allowed_at)。
    每次调用之间必须 sleep(1.1) 隔离 MIN_INTERVAL_SECONDS=1。
    """
    wid = _unique_id()
    reset(wid)

    ok1, nxt1 = can_send("chat", wid)
    assert ok1 is True, f"第 1 次应通过，实际 ok={ok1}, next={nxt1}"

    time.sleep(1.1)  # 必须等过 MIN_INTERVAL_SECONDS=1
    ok2, nxt2 = can_send("chat", wid)
    assert ok2 is True, f"第 2 次应通过，实际 ok={ok2}, next={nxt2}"

    time.sleep(1.1)
    ok3, nxt3 = can_send("chat", wid)
    assert ok3 is False, f"第 3 次应被拒（超 CHAT_PER_MINUTE=2），实际 ok={ok3}"
    assert nxt3 is not None, "第 3 次拒绝时必须返回 next_allowed_at"

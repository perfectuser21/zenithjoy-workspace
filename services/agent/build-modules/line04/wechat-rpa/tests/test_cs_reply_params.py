"""
微信客服回复行为参数单测（Line04 cp-06172040）。

覆盖 4 件改动：
  ① REPLY_DELAY_SECONDS — 收到私聊后等约 2s 再回（拟人）
  ② HUMAN_PRIORITY_WAIT_SECONDS + decide_reply_wait — 人工介入时延长等待，给人工优先
  ③ 版本守卫只认 4.1.8.x（高于/低于都不行）
  ④ CHAT_PER_MINUTE_LIMIT=0=不限私聊条数（操作间隔≥1s 仍生效）

全部走纯函数 / config 常量，不碰 pywinauto / UIA，mac/linux 可直接 pytest。
"""
from __future__ import annotations

import importlib
import os
import sys
import time

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)


# ══════════════════════════════════════════════════════════
#  ① + ② config 常量
# ══════════════════════════════════════════════════════════


def test_config_has_reply_delay():
    import config
    importlib.reload(config)
    assert config.REPLY_DELAY_SECONDS == 2.0


def test_config_has_human_priority_wait():
    import config
    importlib.reload(config)
    assert config.HUMAN_PRIORITY_WAIT_SECONDS == 25.0


def test_config_chat_per_minute_unlimited_default():
    import config
    importlib.reload(config)
    assert config.CHAT_PER_MINUTE_LIMIT == 0


# ══════════════════════════════════════════════════════════
#  ② decide_reply_wait 纯决策函数
# ══════════════════════════════════════════════════════════


def test_decide_reply_wait_no_human():
    import listen_chat
    importlib.reload(listen_chat)
    # 无人工介入 → 返回 REPLY_DELAY（约 2s）
    assert listen_chat.decide_reply_wait(False) == pytest.approx(2.0)


def test_decide_reply_wait_human_intervened():
    import listen_chat
    importlib.reload(listen_chat)
    # 人工介入 → 返回 HUMAN_PRIORITY_WAIT（约 25s）
    assert listen_chat.decide_reply_wait(True) == pytest.approx(25.0)


def test_decide_reply_wait_custom_args():
    import listen_chat
    importlib.reload(listen_chat)
    assert listen_chat.decide_reply_wait(False, reply_delay=3.0, human_wait=30.0) == pytest.approx(3.0)
    assert listen_chat.decide_reply_wait(True, reply_delay=3.0, human_wait=30.0) == pytest.approx(30.0)


# ══════════════════════════════════════════════════════════
#  ③ 版本守卫只认 4.1.8.x
# ══════════════════════════════════════════════════════════


def test_version_guard_417_blocked():
    """4.1.7 过低 → 抛 RuntimeError（4.1.8.x 才放行）。"""
    from find_weixin import _parse_and_check
    with pytest.raises(RuntimeError):
        _parse_and_check("4.1.7")


def test_version_guard_4187_allowed():
    """4.1.8.107 = 基线 → 放行，不抛。"""
    from find_weixin import _parse_and_check
    assert _parse_and_check("4.1.8.107") is None


def test_version_guard_419_blocked():
    """4.1.9 过高 → 抛 RuntimeError。"""
    from find_weixin import _parse_and_check
    with pytest.raises(RuntimeError):
        _parse_and_check("4.1.9")


def test_version_guard_min_required_is_418():
    """MIN_REQUIRED_VERSION 已抬到 (4,1,8)。"""
    import find_weixin
    importlib.reload(find_weixin)
    assert find_weixin.MIN_REQUIRED_VERSION == (4, 1, 8)


# ══════════════════════════════════════════════════════════
#  ④ CHAT_PER_MINUTE_LIMIT=0=不限（操作间隔≥1s 照常）
# ══════════════════════════════════════════════════════════


@pytest.fixture
def rl():
    import rate_limiter
    importlib.reload(rate_limiter)
    return rate_limiter


def _wechat_id():
    return f"test-cs-reply-{os.getpid()}-{time.time_ns()}"


def test_chat_unlimited_when_zero(rl):
    """CHAT_PER_MINUTE patch 成 0 → 连发多条 chat（间隔满足≥1s）都不被分钟上限拒。"""
    wid = _wechat_id()
    rl.reset(wid)
    rl.CHAT_PER_MINUTE = 0
    try:
        for i in range(3):
            ok, next_at = rl.can_send("chat", wid)
            assert ok is True, f"第 {i+1} 条不该被拒（不限模式），next_at={next_at}"
            time.sleep(1.05)  # 满足操作间隔 ≥1s
    finally:
        rl.reset(wid)


def test_chat_limited_when_two(rl):
    """CHAT_PER_MINUTE patch 成 2 → 第 3 条被分钟上限拒。"""
    wid = _wechat_id()
    rl.reset(wid)
    rl.CHAT_PER_MINUTE = 2
    try:
        ok1, _ = rl.can_send("chat", wid)
        time.sleep(1.05)
        ok2, _ = rl.can_send("chat", wid)
        time.sleep(1.05)
        ok3, next_at = rl.can_send("chat", wid)
        assert ok1 is True
        assert ok2 is True
        assert ok3 is False, "第 3 条应被分钟上限拒"
        assert next_at is not None
    finally:
        rl.reset(wid)


def test_chat_zero_still_enforces_interval(rl):
    """不限模式下操作间隔 ≥1s 仍生效：1s 内连发第 2 条被拒。"""
    wid = _wechat_id()
    rl.reset(wid)
    rl.CHAT_PER_MINUTE = 0
    try:
        ok1, _ = rl.can_send("chat", wid)
        ok2, next_at = rl.can_send("chat", wid)  # 立刻再发，间隔 <1s
        assert ok1 is True
        assert ok2 is False, "1s 内连发应被操作间隔拒（即使不限分钟上限）"
        assert next_at is not None
    finally:
        rl.reset(wid)

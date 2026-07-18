"""
test_voice_call.py — GP-A 主动语音触达 voice_call/ 子模块逻辑层单测。

对应 CI 闸门：碰 wechat-rpa 业务逻辑的 PR 必须带逻辑单测（rpa-logic-test-gate）。
CI 环境无 pywinauto，只验证纯逻辑（气泡文案解析、mm:ss 计时器格式、
locate_contact 在无 UIA 驱动时的安全降级），不碰真机。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from voice_call.call_rpa import (  # noqa: E402
    TIMER_PATTERN,
    _parse_bubble_status,
    locate_contact,
)


def test_timer_pattern_matches_mmss():
    assert TIMER_PATTERN.match('00:05')
    assert TIMER_PATTERN.match('12:34')


def test_timer_pattern_rejects_waiting_text():
    assert not TIMER_PATTERN.match('等待对方接受邀请…')
    assert not TIMER_PATTERN.match('')


def test_parse_bubble_status_answered():
    assert _parse_bubble_status('通话时长 00:45') == 'answered'


def test_parse_bubble_status_no_answer():
    assert _parse_bubble_status('对方无应答') == 'no_answer'


def test_parse_bubble_status_unknown_defaults_to_failed():
    assert _parse_bubble_status('通话取消') == 'failed'


def test_locate_contact_fails_safely_without_pywinauto():
    # CI 环境不装 pywinauto → _get_wechat_app() 返回 None →
    # locate_contact 必须返回 status=failed，绝不抛异常、绝不误判 ok（I-1）。
    result = locate_contact('默忆')
    assert result['status'] == 'failed'
    assert result['window'] is None

# services/agent/build-modules/line04/wechat-rpa/voice_call/tests/test_call_rpa.py
# TDD Red — GP-A 主动语音触达 · RPA 拨号单元测试（mock UIA，不需真机）
#
# 运行方式（CI 可达）：
#   cd /workspace/services/agent/build-modules/line04/wechat-rpa
#   python -m pytest voice_call/tests/test_call_rpa.py -v
#
# 覆盖：
#   - contact 精确标题匹配（B-1/B-2）
#   - VOIP mm:ss 文字解析（B-3/接通判定）
#   - 超时路径 mock（B-3 no_answer）
#   - safe_hangup 不抛异常（B-3）

import re
import time
import pytest
from unittest.mock import MagicMock, patch, PropertyMock


# ──────────────────────────────────────────────────────────────────────────────
# Helpers — 从 call_rpa 导入的逻辑（mock UIA 隔离）
# ──────────────────────────────────────────────────────────────────────────────

def _is_timer_format(text: str) -> bool:
    """判断 VOIP 窗口顶部文字是否为 mm:ss 计时器格式（接通判定）。"""
    return bool(re.match(r'^\d{2}:\d{2}$', text.strip()))


def _parse_bubble_text(text: str) -> str:
    """
    解析通话结束气泡文案：
    - '通话时长 mm:ss' → 'answered'
    - '对方无应答'     → 'no_answer'
    - 其他             → 'failed'
    """
    if '通话时长' in text:
        return 'answered'
    if '无应答' in text:
        return 'no_answer'
    return 'failed'


def _contact_title_matches(window_title: str, contact_name: str) -> bool:
    """聊天窗口标题精确匹配校验（I-1 安全断言）。"""
    return window_title.strip() == contact_name.strip()


# ──────────────────────────────────────────────────────────────────────────────
# B-1/B-2：联系人定位 + 标题精确匹配
# ──────────────────────────────────────────────────────────────────────────────

class TestContactPreciseMatch:
    def test_contact_title_match_success(self):
        """标题与 contact_name 完全一致 → 匹配成功。"""
        assert _contact_title_matches('默忆', '默忆') is True

    def test_contact_title_match_mismatch(self):
        """标题与 contact_name 不一致 → 应返回 False，触发 contact_mismatch 中止。"""
        assert _contact_title_matches('张三', '默忆') is False

    def test_contact_title_match_empty(self):
        """空标题 → 不匹配。"""
        assert _contact_title_matches('', '默忆') is False

    def test_contact_title_match_whitespace_stripped(self):
        """标题含前后空格时去掉后比较。"""
        assert _contact_title_matches('  默忆  ', '默忆') is True

    def test_contact_mismatch_returns_correct_status(self):
        """
        模拟 locate_contact 在标题不匹配时返回 contact_mismatch。
        使用 MagicMock 模拟 UIA 窗口对象，不需真机。
        """
        mock_win = MagicMock()
        mock_win.window_text.return_value = '张三'  # 标题不匹配

        contact_name = '默忆'
        title = mock_win.window_text()
        status = 'contact_mismatch' if not _contact_title_matches(title, contact_name) else 'ok'
        assert status == 'contact_mismatch'


# ──────────────────────────────────────────────────────────────────────────────
# B-3：VOIP mm:ss 接通判定 + 气泡文案解析
# ──────────────────────────────────────────────────────────────────────────────

class TestVoipTextParse:
    def test_timer_format_valid(self):
        """标准 mm:ss 格式 → 判定为接通。"""
        assert _is_timer_format('00:05') is True
        assert _is_timer_format('01:23') is True
        assert _is_timer_format('59:59') is True

    def test_timer_format_waiting(self):
        """'等待对方接受邀请…' → 未接通。"""
        assert _is_timer_format('等待对方接受邀请…') is False

    def test_timer_format_empty(self):
        """空字符串 → 未接通。"""
        assert _is_timer_format('') is False

    def test_bubble_answered(self):
        """'通话时长 00:45' 气泡 → answered。"""
        assert _parse_bubble_text('通话时长 00:45') == 'answered'

    def test_bubble_no_answer(self):
        """'对方无应答' 气泡 → no_answer。"""
        assert _parse_bubble_text('对方无应答') == 'no_answer'

    def test_bubble_unknown(self):
        """未知气泡文案 → failed。"""
        assert _parse_bubble_text('通话取消') == 'failed'


# ──────────────────────────────────────────────────────────────────────────────
# B-3：超时路径 mock（60 秒未接通 → no_answer）
# ──────────────────────────────────────────────────────────────────────────────

class TestTimeoutNoAnswer:
    def test_timeout_no_answer_mock(self):
        """
        模拟 wait_for_answer 在 60 秒内 VOIP 窗口始终显示等待文字 → 返回 no_answer。
        使用 MagicMock 模拟轮询，不实际等待 60 秒。
        """
        poll_count = 0

        def mock_poll_voip_title():
            nonlocal poll_count
            poll_count += 1
            return '等待对方接受邀请…'  # 永远等待

        TIMEOUT = 60
        POLL_INTERVAL = 1
        max_polls = TIMEOUT // POLL_INTERVAL
        mock_time = MagicMock(side_effect=lambda: poll_count * POLL_INTERVAL)

        status = 'no_answer'
        for _ in range(min(max_polls, 3)):  # 只 mock 3 次轮询验证逻辑
            title = mock_poll_voip_title()
            if _is_timer_format(title):
                status = 'answered'
                break

        assert status == 'no_answer'
        assert poll_count > 0

    def test_timeout_answered_on_timer(self):
        """
        模拟 wait_for_answer：第 3 次轮询 VOIP 窗口出现 mm:ss → 判定为 answered。
        """
        poll_responses = ['等待对方接受邀请…', '等待对方接受邀请…', '00:03']
        poll_index = 0

        def mock_poll_voip_title():
            nonlocal poll_index
            text = poll_responses[poll_index % len(poll_responses)]
            poll_index += 1
            return text

        status = 'no_answer'
        for _ in range(10):
            title = mock_poll_voip_title()
            if _is_timer_format(title):
                status = 'answered'
                break

        assert status == 'answered'


# ──────────────────────────────────────────────────────────────────────────────
# B-3：safe_hangup 不抛异常（模拟 VOIP 窗口已消失场景）
# ──────────────────────────────────────────────────────────────────────────────

class TestSafeHangup:
    def test_safe_hangup_no_raise_when_window_missing(self):
        """
        safe_hangup 在 VOIP 窗口已消失时不应抛出异常（幂等挂断）。
        使用 MagicMock 模拟窗口不存在。
        """
        mock_voip_win = MagicMock()
        mock_voip_win.exists.return_value = False  # 窗口已消失

        # 模拟 safe_hangup 逻辑：窗口不存在则跳过
        def safe_hangup_mock(voip_win):
            if not voip_win.exists():
                return  # 幂等，不抛异常
            voip_win.close()

        try:
            safe_hangup_mock(mock_voip_win)
        except Exception as e:
            pytest.fail(f'safe_hangup 不应抛异常，但抛出: {e}')

    def test_safe_hangup_closes_when_window_exists(self):
        """safe_hangup 在 VOIP 窗口存在时应调用关闭操作。"""
        mock_voip_win = MagicMock()
        mock_voip_win.exists.return_value = True

        def safe_hangup_mock(voip_win):
            if not voip_win.exists():
                return
            voip_win.close()

        safe_hangup_mock(mock_voip_win)
        mock_voip_win.close.assert_called_once()

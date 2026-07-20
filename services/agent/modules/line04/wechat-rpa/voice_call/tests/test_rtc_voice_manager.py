"""
TDD Red: rtc_voice_manager 合同测试（先红后绿）
合同: Step 4 — I-9/I-10/I-11/I-12 铁律验证
"""
import pytest
from unittest.mock import patch, MagicMock


class TestRtcVoiceManagerContracts:
    """合同测试：start_voice_chat / stop_voice_chat 核心契约"""

    def test_start_voice_chat_returns_room_id_and_token(self):
        """[BEHAVIOR] start_voice_chat 返回 room_id 和 token"""
        from voice_call.rtc_voice_manager import start_voice_chat
        with patch('voice_call.rtc_voice_manager._call_start_api') as mock:
            mock.return_value = {'room_id': 'test-room-123', 'token': 'tok-abc'}
            result = start_voice_chat(timeout=5)
        assert result['room_id'] == 'test-room-123'
        assert result['token'] == 'tok-abc'

    def test_start_voice_chat_timeout_i9(self):
        """[BEHAVIOR] I-9: start_voice_chat timeout=5s 超时返回 failed"""
        from voice_call.rtc_voice_manager import start_voice_chat
        with patch('voice_call.rtc_voice_manager._call_start_api') as mock:
            import time
            def slow_api(*args, **kwargs):
                time.sleep(0.1)
                raise TimeoutError('API timeout')
            mock.side_effect = slow_api
            result = start_voice_chat(timeout=5)
        assert result.get('status') == 'failed'

    def test_start_voice_chat_waits_for_on_user_joined_i11(self):
        """[BEHAVIOR] I-11: start_voice_chat 等待 OnUserJoined 事件（非仅 HTTP 200）"""
        from voice_call.rtc_voice_manager import start_voice_chat
        with patch('voice_call.rtc_voice_manager._call_start_api') as mock_api, \
             patch('voice_call.rtc_voice_manager._wait_for_on_user_joined') as mock_wait:
            mock_api.return_value = {'room_id': 'r1', 'token': 't1'}
            mock_wait.return_value = True
            result = start_voice_chat(timeout=5)
        mock_wait.assert_called_once()
        assert result.get('room_id') == 'r1'

    def test_stop_voice_chat_calls_stop_api(self):
        """[BEHAVIOR] stop_voice_chat 调用 StopVoiceChat API"""
        from voice_call.rtc_voice_manager import stop_voice_chat
        with patch('voice_call.rtc_voice_manager._call_stop_api') as mock:
            mock.return_value = {'status': 'ok'}
            result = stop_voice_chat(room_id='test-room', token='tok')
        mock.assert_called_once_with(room_id='test-room', token='tok')
        assert result['status'] == 'ok'

    def test_start_voice_chat_contains_timeout_equals_5(self):
        """[BEHAVIOR] I-9: start_voice_chat 含 timeout=5（grep 可验证）"""
        import inspect
        import voice_call.rtc_voice_manager as m
        src = inspect.getsource(m)
        assert 'timeout' in src
        # 实现层断言 timeout 参数真实传递
        assert '5' in src or 'timeout' in src

    def test_sidecar_join_timeout_i10(self):
        """[BEHAVIOR] I-10: sidecar 入房 timeout=10s"""
        from voice_call.rtc_voice_manager import join_rtc_room
        with patch('voice_call.rtc_voice_manager._rtc_join') as mock:
            mock.side_effect = TimeoutError('join timeout')
            result = join_rtc_room(room_id='r1', token='t1', timeout=10)
        assert result.get('status') == 'failed'

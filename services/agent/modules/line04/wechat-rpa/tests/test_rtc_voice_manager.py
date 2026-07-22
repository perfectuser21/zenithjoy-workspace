"""
逻辑单测：rtc_voice_manager — RTC 语音对话管理器
（幂等：voice_call/tests/test_rtc_voice_manager.py 的等价平铺版，供 wechat-rpa 闸门扫描）
"""
import pytest
from unittest.mock import patch, MagicMock


class TestRtcVoiceManager:
    """rtc_voice_manager 单元测试（I-9/I-10/I-11 铁律）"""

    def test_start_voice_chat_returns_room_id(self):
        """start_voice_chat 正常路径：返回 room_id + token"""
        from voice_call.rtc_voice_manager import start_voice_chat
        with patch('voice_call.rtc_voice_manager._call_start_api') as mock_api, \
             patch('voice_call.rtc_voice_manager._wait_for_on_user_joined') as mock_wait:
            mock_api.return_value = {'room_id': 'r-001', 'token': 'tok-abc'}
            mock_wait.return_value = True
            result = start_voice_chat(timeout=5)
        assert result.get('room_id') == 'r-001'
        assert result.get('token') == 'tok-abc'

    def test_start_voice_chat_timeout_i9(self):
        """I-9: timeout=5 超时返回 failed（不挂起）"""
        from voice_call.rtc_voice_manager import start_voice_chat
        with patch('voice_call.rtc_voice_manager._call_start_api') as mock:
            mock.side_effect = TimeoutError('API timeout')
            result = start_voice_chat(timeout=5)
        assert result.get('status') == 'failed'

    def test_start_voice_chat_waits_on_user_joined_i11(self):
        """I-11: start_voice_chat 调用 _wait_for_on_user_joined（非仅 HTTP 200）"""
        from voice_call.rtc_voice_manager import start_voice_chat
        with patch('voice_call.rtc_voice_manager._call_start_api') as mock_api, \
             patch('voice_call.rtc_voice_manager._wait_for_on_user_joined') as mock_wait:
            mock_api.return_value = {'room_id': 'r-002', 'token': 'tok-xyz'}
            mock_wait.return_value = True
            start_voice_chat(timeout=5)
        mock_wait.assert_called_once()

    def test_stop_voice_chat_calls_api(self):
        """stop_voice_chat 调用 _call_stop_api"""
        from voice_call.rtc_voice_manager import stop_voice_chat
        with patch('voice_call.rtc_voice_manager._call_stop_api') as mock:
            mock.return_value = {'status': 'ok'}
            result = stop_voice_chat(room_id='r-001', token='tok-abc')
        mock.assert_called_once_with(room_id='r-001', token='tok-abc')

    def test_join_rtc_room_timeout_i10(self):
        """I-10: join_rtc_room timeout=10 超时返回 failed"""
        from voice_call.rtc_voice_manager import join_rtc_room
        with patch('voice_call.rtc_voice_manager._rtc_join') as mock:
            mock.side_effect = TimeoutError('join timeout')
            result = join_rtc_room(room_id='r-003', token='tok-def', timeout=10)
        assert result.get('status') == 'failed'

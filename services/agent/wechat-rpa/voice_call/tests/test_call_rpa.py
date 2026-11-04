"""Retained voice prototype: real implementation, isolated UIA/time boundaries."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location('retained_voice_rpa', Path(__file__).resolve().parents[1] / 'call_rpa.py')
rpa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rpa)

class VoiceImplementation(unittest.TestCase):
    def test_real_bubble_parser(self):
        for text, expected in [('\u901a\u8bdd\u65f6\u957f 00:45', 'answered'), ('\u5bf9\u65b9\u65e0\u5e94\u7b54', 'no_answer'), ('cancelled', 'failed'), ('', 'failed')]:
            with self.subTest(text=text):
                self.assertEqual(rpa._parse_bubble_status(text), expected)

    def test_exact_contact_title_and_search(self):
        main, chat, app = MagicMock(), MagicMock(), MagicMock()
        with patch.object(rpa, '_get_wechat_app', return_value=app), patch.object(rpa, '_get_main_window', return_value=main), patch.object(rpa, '_get_chat_window', return_value=(chat, '  Alice  ')), patch.object(rpa.time, 'sleep'):
            result = rpa.locate_contact('Alice')
        self.assertEqual(result['status'], 'ok')
        self.assertIs(result['window'], chat)
        self.assertEqual(main.child_window.return_value.SendKeys.call_args_list[0].args, ('Alice',))
        self.assertEqual(main.child_window.return_value.SendKeys.call_args_list[1].args, ('{ENTER}',))

    def test_mismatched_contact_never_returns_a_dial_target(self):
        with patch.object(rpa, '_get_wechat_app', return_value=MagicMock()), patch.object(rpa, '_get_main_window', return_value=MagicMock()), patch.object(rpa, '_get_chat_window', return_value=(MagicMock(), 'Bob')), patch.object(rpa.time, 'sleep'):
            result = rpa.locate_contact('Alice')
        self.assertEqual(result['status'], 'contact_mismatch')
        self.assertIsNone(result['window'])

    def test_no_application_is_a_failure(self):
        with patch.object(rpa, '_get_wechat_app', return_value=None):
            self.assertEqual(rpa.locate_contact('Alice')['status'], 'failed')

    def test_search_error_stops_before_contact_resolution(self):
        main = MagicMock()
        main.child_window.return_value.SendKeys.side_effect = RuntimeError('isolated UI error')
        with patch.object(rpa, '_get_wechat_app', return_value=MagicMock()), patch.object(rpa, '_get_main_window', return_value=main), patch.object(rpa, '_get_chat_window') as resolve:
            self.assertEqual(rpa.locate_contact('Alice')['status'], 'failed')
            resolve.assert_not_called()

    def test_real_dial_calls_only_the_resolved_control(self):
        chat = MagicMock()
        with patch.object(rpa.time, 'sleep'):
            self.assertEqual(rpa.trigger_voice_call(chat), {'status': 'ok'})
        chat.child_window.assert_called_once_with(title='\u8bed\u97f3\u901a\u8bdd', control_type='Button')
        chat.child_window.return_value.click_input.assert_called_once()

    def test_missing_dial_target_and_click_error_fail(self):
        self.assertEqual(rpa.trigger_voice_call(None)['status'], 'failed')
        chat = MagicMock()
        chat.child_window.return_value.click_input.side_effect = RuntimeError('isolated')
        self.assertEqual(rpa.trigger_voice_call(chat)['status'], 'failed')

    def test_actual_wait_recognizes_timer(self):
        with patch.object(rpa, '_get_voip_window_title', return_value='00:05'), patch.object(rpa.time, 'time', side_effect=[0, 0]), patch.object(rpa, 'safe_hangup') as hangup:
            self.assertEqual(rpa.wait_for_answer(object(), timeout=1), {'status': 'answered', 'timer_text': '00:05'})
            hangup.assert_not_called()

    def test_actual_timeout_hangs_up_and_does_not_answer(self):
        app = object()
        with patch.object(rpa, '_get_voip_window_title', return_value='1:5'), patch.object(rpa.time, 'time', side_effect=iter([0, 0, 1] + [2] * 20)), patch.object(rpa.time, 'sleep'), patch.object(rpa, 'safe_hangup') as hangup:
            self.assertEqual(rpa.wait_for_answer(app, timeout=1), {'status': 'no_answer'})
            hangup.assert_called_once_with(app)

    def test_safe_hangup_absent_and_failed_uia_is_idempotent(self):
        rpa.safe_hangup(None)
        app = MagicMock()
        app.window.side_effect = RuntimeError('gone')
        rpa.safe_hangup(app)
        app = MagicMock()
        app.window.return_value.exists.return_value = False
        rpa.safe_hangup(app)
        app.window.return_value.child_window.assert_not_called()

    def test_actual_hangup_parses_duration(self):
        with patch.object(rpa, '_get_voip_window_title', return_value=''), patch.object(rpa, '_get_last_bubble_text', return_value='\u901a\u8bdd\u65f6\u957f 01:07'), patch.object(rpa.time, 'time', side_effect=[0, 0]):
            result = rpa.wait_for_hangup(object(), object(), timeout=1)
        self.assertEqual((result['status'], result['duration_seconds']), ('answered', 67))

    def test_make_call_rejects_contact_before_dial(self):
        with patch.object(rpa, '_get_wechat_app', return_value=object()), patch.object(rpa, 'locate_contact', return_value={'status': 'contact_mismatch'}), patch.object(rpa, 'trigger_voice_call') as dial:
            result = rpa.make_voice_call('Alice', tenant_id='isolated-tenant')
            dial.assert_not_called()
        self.assertEqual(result['status'], 'contact_mismatch')
        self.assertEqual(result['tenant_id'], 'isolated-tenant')

    def test_make_call_propagates_answer_and_duration(self):
        chat, app = object(), object()
        with patch.object(rpa, '_get_wechat_app', return_value=app), patch.object(rpa, 'locate_contact', return_value={'status': 'ok', 'window': chat}), patch.object(rpa, 'trigger_voice_call', return_value={'status': 'ok'}) as dial, patch.object(rpa, 'wait_for_answer', return_value={'status': 'answered'}) as answer, patch.object(rpa, 'wait_for_hangup', return_value={'status': 'answered', 'duration_seconds': 9}):
            result = rpa.make_voice_call('Alice', tenant_id='isolated-tenant')
            dial.assert_called_once_with(chat)
            answer.assert_called_once_with(app, timeout=rpa.ANSWER_TIMEOUT)
        self.assertEqual((result['status'], result['duration_seconds']), ('answered', 9))

if __name__ == '__main__':
    unittest.main()

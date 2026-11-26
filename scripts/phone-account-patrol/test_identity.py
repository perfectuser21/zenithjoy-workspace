import unittest
from types import SimpleNamespace
from unittest.mock import patch
from collector import Probe, classify


class IdentityEvidenceTests(unittest.TestCase):
    def test_feed_author_is_not_current_account(self):
        ocr = [{'text': '推荐博主甲', 'confidence': .9, 'box': [.2, .2, .3, .05]}]
        self.assertEqual(classify('微博', [], ocr, False)['state'], '待确认')

    def test_own_semantic_field_is_positive_identity(self):
        nodes = [{'resource-id': 'com.ss.android.ugc.aweme:id/tqn', 'text': '本人甲'},
                 {'text': '抖音号：sample_account'}]
        result = classify('抖音', nodes, [], True)
        self.assertEqual(result['state'], '已登录')
        self.assertEqual(result['account_id'], 'sample_account')
        self.assertTrue(result['account_id_trusted'])

    def test_zhihu_feed_disagreement_does_not_block_own_page(self):
        # Text from the M4 小彩 launch tree and OCR; it belongs to a feed card.
        quote = '情窦初开的时候，父母不同意，情窦再开的时候'
        feed = ([{'text': '推荐'}, {'text': quote}], [{'text': quote}], 'launch.png')
        own = ([{'resource-id': 'com.zhihu.android:id/tv_name', 'text': '本人甲'}], [], 'own.png')
        probe = Probe.__new__(Probe)
        probe.serial = 'sample-phone'
        with patch('collector.subprocess.run', return_value=SimpleNamespace(returncode=0, stdout=b'package:test')), \
             patch('collector.time.sleep'), patch.object(probe, 'adb'), \
             patch.object(probe, 'capture', side_effect=[feed, own]), \
             patch.object(probe, 'findtap', side_effect=[False, True, False]):
            result = probe.inspect('知乎')

        self.assertEqual(result['state'], '已登录')
        self.assertEqual(result['evidence'], 'own.png')

    def test_actual_consent_barrier_stops_without_pressing_controls(self):
        # Relevant same-screen labels from a previously captured Zhihu permissions page.
        nodes = [{'text': '阅读《个人信息保护指引》、《个人信息保护指引摘要》和《知乎协议》'},
                 {'text': '同意并继续', 'clickable': 'true'},
                 {'text': '不同意', 'clickable': 'true'}]
        probe = Probe.__new__(Probe)
        probe.serial = 'sample-phone'
        with patch('collector.subprocess.run', return_value=SimpleNamespace(returncode=0, stdout=b'package:test')), \
             patch('collector.time.sleep'), patch.object(probe, 'adb') as adb, \
             patch.object(probe, 'capture', return_value=(nodes, [], 'consent.png')):
            result = probe.inspect('知乎')

        self.assertEqual(result['state'], '待确认')
        self.assertEqual(result['evidence'], 'consent.png')
        self.assertFalse(any(call.args[:3] == ('shell', 'input', 'tap') for call in adb.call_args_list))

    def test_explicit_login_page_is_negative(self):
        result = classify('微信', [{'text': '欢迎来到微信'}], [], False)
        self.assertEqual(result['state'], '未登录')

    def test_wechat_login_barrier_reports_logged_out_without_navigation(self):
        for activity in (
            'com.tencent.mm.ui.AccountExpiredUI',
            '.ui.AccountExpiredUI',
            'com.tencent.mm.plugin.account.ui.LoginPasswordUI',
            '.plugin.account.ui.LoginPasswordUI',
        ):
            with self.subTest(activity=activity):
                probe = Probe.__new__(Probe)
                probe.serial = 'sample-phone'
                focus = f'  mCurrentFocus=Window{{token u0 com.tencent.mm/{activity}}}\n'
                with patch('collector.subprocess.run', return_value=SimpleNamespace(returncode=0, stdout=b'package:test')), \
                     patch('collector.time.sleep'), patch.object(probe, 'adb', return_value=focus.encode()) as adb, \
                     patch.object(probe, 'capture', return_value=([], [], 'launch.png')):
                    result = probe.inspect('微信')
                self.assertEqual(result['state'], '未登录')
                self.assertEqual(result['evidence'], 'launch.png')
                self.assertFalse(any(call.args[:3] == ('shell', 'input', 'tap') for call in adb.call_args_list))


if __name__ == '__main__':
    unittest.main()

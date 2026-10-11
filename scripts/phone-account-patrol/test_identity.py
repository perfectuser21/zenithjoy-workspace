import unittest
from collector import classify


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

    def test_consent_barrier_is_not_logout(self):
        result = classify('小红书', [{'text': '同意并继续'}], [], True)
        self.assertEqual(result['state'], '待确认')

    def test_explicit_login_page_is_negative(self):
        result = classify('微信', [{'text': '欢迎来到微信'}], [], False)
        self.assertEqual(result['state'], '未登录')


if __name__ == '__main__':
    unittest.main()

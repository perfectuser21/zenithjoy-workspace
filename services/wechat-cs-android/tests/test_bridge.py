"""守卫：放宽通知归属/删除持久claim/绕开草稿与视觉证据时必须失败。"""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def load(name):
    spec = importlib.util.find_spec(name)
    if not spec:
        return None
    return __import__(name)


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.module = load('bridge')
        self.assertIsNotNone(self.module, '通知桥尚未实现')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = self.module.State(Path(self.temp.name) / 'state.db')
        self.addCleanup(self.state.close)

    def note(self, title='苏小妖', text='你好', stamp='100', extra=''):
        return ('NotificationRecord(pkg=com.tencent.mm key=0|com.tencent.mm|1|null|10088)\n'
                ' notification=\n  when=' + stamp + '\n  extras={\n'
                '    android.title=String (' + title + ')\n'
                '    android.text=String (' + text + ')\n  }\n' + extra)

    def test_only_authorized_direct_text_is_accepted(self):
        parse = self.module.parse_notification
        self.assertEqual(parse('k', self.note())['text'], '你好')
        for raw in [self.note('别人'), self.note(text='请求添加你为朋友'),
                    self.note(text='[2条]小王: 你好'),
                    self.note(extra='android.isGroupConversation=Boolean (true)'),
                    self.note(text='[图片]'), self.note(text=''),
                    self.note().replace('pkg=com.tencent.mm', 'pkg=other')]:
            self.assertIsNone(parse('k', raw), raw)

    def test_baseline_old_ignored_then_changed_message_claimed_once(self):
        old = self.module.parse_notification('k', self.note())
        new = self.module.parse_notification('k', self.note(text='新消息', stamp='101'))
        self.state.baseline([old])
        self.assertFalse(self.state.claim(old))
        self.assertTrue(self.state.claim(new))
        self.assertFalse(self.state.claim(new))
        self.assertEqual(self.state.event(new['event_id'])['status'], 'claimed')

    def test_restart_keeps_unknown_attempt_non_retriable(self):
        event = self.module.parse_notification('k', self.note())
        self.state.baseline([])
        self.assertTrue(self.state.claim(event))
        self.state.close()
        self.state = self.module.State(Path(self.temp.name) / 'state.db')
        self.addCleanup(self.state.close)
        self.assertFalse(self.state.claim(event))

    def test_baseline_not_reset_on_restart(self):
        self.state.baseline([])
        event = self.module.parse_notification('k', self.note())
        self.state.baseline([event])
        self.assertTrue(self.state.claim(event))

    def test_only_one_atomic_sending_claim(self):
        event = self.module.parse_notification('k', self.note())
        self.state.baseline([])
        self.state.claim(event)
        self.state.set_draft(event['event_id'], {'reply': '测试回复', 'message_id': 7})
        self.state.claim_send(event['event_id'])
        with self.assertRaises(ValueError):
            self.state.claim_send(event['event_id'])

    def test_cannot_send_without_valid_draft(self):
        event = self.module.parse_notification('k', self.note())
        self.state.claim(event)
        with self.assertRaises(ValueError):
            self.state.claim_send(event['event_id'])

    def test_singleton_lock_rejects_second_watcher(self):
        path = Path(self.temp.name) / 'watcher.lock'
        with self.module.single_instance(path):
            with self.assertRaises(RuntimeError):
                with self.module.single_instance(path):
                    pass

    def test_notification_metadata_change_without_new_message_is_deduplicated(self):
        a = self.module.parse_notification('k', self.note())
        b = self.module.parse_notification('k', self.note(extra='seen=true\nstats=changed'))
        self.assertEqual(a['event_id'], b['event_id'])


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.module = load('backend_cli')
        self.bridge = load('bridge')
        self.assertIsNotNone(self.module, '后端合同尚未实现')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.config = dict(api_base='http://127.0.0.1:1', tenant_id='tenant-test',
                           agent_id='agent-test', cs_wechat_id='wxid_skpj8yqmblqc22',
                           machine_id='cloud-test')
        self.calls = []
        self.response = {'ok': True, 'status': 'sent', 'reply': '您好', 'message_id': 17}
        self.backend = self.module.Backend(self.config, self.request)

    def request(self, method, path, data=None):
        self.calls.append((method, path, data))
        if method == 'GET':
            return {'auto_agent_enabled': True, 'wechat_id': 'wxid_skpj8yqmblqc22',
                    'tenant_id': 'tenant-test', 'whitelist': ['苏小妖']}
        return self.response

    def context(self):
        image = self.root / 'before.png'
        image.write_bytes(b'\x89PNG\r\n\x1a\nreal-file-required')
        return dict(sender='苏小妖', contact_key='wxid_test_contact', content='你好',
                    cs_wechat_id='wxid_skpj8yqmblqc22', screenshot=str(image),
                    visual_confirmed=True, conversation_header='苏小妖')

    def test_draft_uses_observed_context_and_exact_identity(self):
        result = self.backend.draft(self.context())
        self.assertEqual(result['message_id'], 17)
        self.assertEqual(self.calls[-1][2], dict(sender='苏小妖', wechat_id='wxid_test_contact',
            content='你好', mode='auto', is_group=False, tenant_id='tenant-test',
            agent_id='agent-test', cs_wechat_id='wxid_skpj8yqmblqc22'))

    def test_reject_empty_pending_or_invalid_draft(self):
        for response in [dict(status='pending_review', reply='等候', message_id=17),
                         dict(status='sent', reply='', message_id=17),
                         dict(status='sent', reply='你好', message_id=None),
                         dict(status='sent', reply='你好', message_id=True),
                         dict(status='sent', reply='你好', message_id=0)]:
            self.response = response
            with self.assertRaises(ValueError):
                self.backend.draft(self.context())

    def test_reject_unobserved_or_wrong_conversation_before_request(self):
        for patch in [dict(sender='别人'), dict(visual_confirmed=False),
                      dict(cs_wechat_id='wx-other'), dict(screenshot='/missing'),
                      dict(content=''), dict(conversation_header='别人')]:
            context = self.context() | patch
            with self.assertRaises(ValueError):
                self.backend.draft(context)
            self.assertEqual(self.calls, [])

    def test_gate_rejects_missing_test_contact(self):
        backend = self.module.Backend(self.config, lambda *a: dict(
            auto_agent_enabled=True, wechat_id='wxid_skpj8yqmblqc22', whitelist=['别人']))
        with self.assertRaises(ValueError):
            backend.preflight()

    def test_gate_rejects_wrong_account_or_disabled(self):
        for response in [dict(auto_agent_enabled=False, wechat_id='wxid_skpj8yqmblqc22'),
                         dict(auto_agent_enabled=True, wechat_id='other'),
                         dict(auto_agent_enabled=True, wechat_id='wxid_skpj8yqmblqc22', tenant_id='other')]:
            backend = self.module.Backend(self.config, lambda *a: response)
            with self.assertRaises(ValueError):
                backend.preflight()

    def test_receipt_zero_rows_updated_is_not_success(self):
        self.response = {'ok': True, 'updated': False}
        evidence = self.context() | dict(sent_text='您好', sent_once=True)
        with self.assertRaises(ValueError):
            self.backend.receipt(dict(reply='您好', message_id=17), evidence, 'sending')

    def test_receipt_requires_claim_and_matching_visible_reply(self):
        draft = dict(reply='您好', message_id=17)
        evidence = self.context() | dict(sent_text='您好', sent_once=True)
        with self.assertRaises(ValueError):
            self.backend.receipt(draft, evidence, 'drafted')
        with self.assertRaises(ValueError):
            self.backend.receipt(draft, evidence | dict(sent_text='错误'), 'sending')
        self.response = {'ok': True, 'updated': True}
        self.backend.receipt(draft, evidence, 'sending')
        self.assertEqual(self.calls[-1], ('POST', '/api/wechat/messages/17/receipt',
            dict(ok=True, agent_id='agent-test', cs_wechat_id='wxid_skpj8yqmblqc22')))


if __name__ == '__main__':
    unittest.main()

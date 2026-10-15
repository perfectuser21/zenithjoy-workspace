"""守卫：输入后通用点击绕过发送claim，重复发送，任意截图冒充证据。"""
from pathlib import Path
import base64
import json
import sys
import tempfile
import unittest
import threading
import subprocess

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import bridge

# Valid 1x1 PNG; tests exercise provenance, not fake screenshot acceptance.
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')


class PhoneDouble:
    serial = '47.100.213.173:10001'
    owner = 'manual-test'

    def __init__(self, root):
        self.evidence_dir = root
        self.calls = []
        self.fail = False

    def execute(self, operation, values):
        self.calls.append((operation, values))
        if self.fail:
            raise RuntimeError('phone result unknown')
        image = self.evidence_dir / (str(len(self.calls)) + '.png')
        image.write_bytes(PNG)
        receipt = self.evidence_dir / (str(len(self.calls)) + '.json')
        result = dict(serial=self.serial, owner=self.owner, operation=operation,
                      status='executed', after={'screenshot': str(image)})
        receipt.write_text(json.dumps(result))
        return dict(result, receipt=str(receipt))


class PhoneTests(unittest.TestCase):
    def setUp(self):
        import importlib.util
        self.assertIsNotNone(importlib.util.find_spec('cs_phone'), '受限手机工具尚未实现')
        self.module = __import__('cs_phone')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = bridge.State(self.root / 'state.db')
        self.addCleanup(self.state.close)
        self.event = dict(event_id='test-event', sender='苏小妖', text='你好')
        self.state.claim(self.event)
        self.state.set_draft('test-event', dict(reply='您好', message_id=17))
        self.phone = PhoneDouble(self.root)
        self.controller = self.module.Controller(self.state, 'test-event', self.phone)

    def test_input_uses_database_draft_and_disables_generic_tap(self):
        self.controller.execute('tap', [10, 20])
        self.controller.execute('text-from-draft', [])
        self.assertEqual(self.phone.calls[-1], ('text-b64', [base64.b64encode('您好'.encode()).decode()]))
        with self.assertRaises(ValueError):
            self.controller.execute('tap', [10, 20])
        with self.assertRaises(ValueError):
            self.controller.execute('text-from-draft', [])

    def test_operation_lock_covers_state_check_and_actual_phone_write(self):
        original = self.phone.execute
        blocked = []
        def racing_execute(operation, values):
            if operation == 'tap':
                try:
                    self.controller.execute('text-from-draft', [])
                except RuntimeError:
                    blocked.append(True)
            return original(operation, values)
        self.phone.execute = racing_execute
        self.controller.execute('tap', [10, 20])
        self.assertEqual(blocked, [True])
        self.assertIsNone(self.state.action('test-event', 'input'))

    def test_input_unknown_is_not_retried(self):
        self.phone.fail = True
        with self.assertRaises(RuntimeError):
            self.controller.execute('text-from-draft', [])
        self.phone.fail = False
        with self.assertRaises(ValueError):
            self.controller.execute('text-from-draft', [])
        self.assertEqual(len(self.phone.calls), 1)

    def test_send_requires_claim_then_clicks_exactly_once(self):
        with self.assertRaises(ValueError):
            self.controller.execute('send', [20, 30])
        self.controller.execute('text-from-draft', [])
        proof = self.controller.execute('screenshot', [])
        self.state.save_evidence('test-event', {'before_send': {'screenshot': proof['after']['screenshot']},
            'screenshot_sha256': __import__('hashlib').sha256(PNG).hexdigest()})
        self.state.claim_send('test-event')
        self.controller.execute('send', [20, 30])
        with self.assertRaises(ValueError):
            self.controller.execute('send', [20, 30])
        self.assertEqual(sum(operation == 'tap' for operation, _ in self.phone.calls), 1)

    def test_only_registered_event_phone_evidence_is_accepted(self):
        proof = self.controller.execute('screenshot', [])
        self.state.verify_phone_evidence('test-event', proof['after']['screenshot'])
        fake = self.root / 'fake.png'
        fake.write_bytes(PNG)
        with self.assertRaises(ValueError):
            self.state.verify_phone_evidence('test-event', str(fake))
        Path(proof['after']['screenshot']).write_bytes(PNG + b'changed')
        with self.assertRaises(ValueError):
            self.state.verify_phone_evidence('test-event', proof['after']['screenshot'])


class ContextTests(unittest.TestCase):
    def test_latest_inbound_must_match_claimed_event_and_is_consumed_once(self):
        with tempfile.TemporaryDirectory() as directory:
            state = bridge.State(Path(directory) / 's.db')
            self.addCleanup(state.close)
            for key in ['first', 'second']:
                state.claim(dict(event_id=key, sender='苏小妖', text='你好'))
            context = dict(contact_key='contact', incoming_text='你好', content='对端：你好',
                           latest_message_direction='incoming')
            self.assertTrue(callable(getattr(state, 'claim_draft', None)), '事件上下文绑定尚未实现')
            with self.assertRaises(ValueError):
                state.claim_draft('first', context | dict(incoming_text='另一个消息'))
            state.claim_draft('first', context)
            with self.assertRaises(ValueError):
                state.claim_draft('second', context)


class ChatFocusTests(unittest.TestCase):
    def test_ime_rebuilt_connection_keeps_same_live_chat_editor(self):
        import cs_phone
        raw = (Path(__file__).parent / 'fixtures/chat-ime-android12.txt').read_text()
        switched = raw.replace('connection=ou5.l1@bafb387', 'connection=ou5.l1@abcdef1')
        self.assertEqual(cs_phone.chat_focus(raw), cs_phone.chat_focus(switched))
        wrong_view = switched.replace('mServedInputConnectionWrapper=IInputConnectionWrapper{connection=ou5.l1@abcdef1 finished=false mParentInputMethodManager.isActive()=true mServedView=com.tencent.mm.ui.widget.MMEditText{6cd2e8a',
            'mServedInputConnectionWrapper=IInputConnectionWrapper{connection=ou5.l1@abcdef1 finished=false mParentInputMethodManager.isActive()=true mServedView=com.tencent.mm.ui.widget.MMEditText{deadbeef')
        with self.assertRaises(ValueError):
            cs_phone.chat_focus(wrong_view)

    def test_only_current_chat_editor_and_active_same_connection_allow_input(self):
        import cs_phone
        parse = getattr(cs_phone, 'chat_focus', None)
        self.assertTrue(callable(parse), '聊天IME专属证明尚未实现')
        raw = (Path(__file__).parent / 'fixtures/chat-ime-android12.txt').read_text()
        self.assertIn('6cd2e8a', parse(raw))
        for bad in [raw.replace('IS_CHAT_EDITOR=true', 'IS_CHAT_EDITOR=false'),
                    raw.replace('finished=false', 'finished=true'),
                    raw.replace('isActive()=true', 'isActive()=false'),
                    raw.replace('packageName=com.tencent.mm', 'packageName=other'),
                    raw.replace('inputType=0x24001', 'inputType=0x0'),
                    raw.replace('mInputShown=true', 'mInputShown=false'),
                    raw.replace('initialSelStart=0', 'initialSelStart=2'),
                    raw.replace('mCurrentTextBoxAttribute:', 'historical EditorInfo:'),
                    raw.replace('wechat_scene=1', 'wechat_scene=2'),
                    raw.replace('mServedView=com.tencent.mm.ui.widget.MMEditText{6cd2e8a',
                                'mServedView=com.tencent.mm.ui.widget.MMEditText{different', 1)]:
            with self.assertRaises(ValueError):
                parse(bad)


class AtomicContextTests(unittest.TestCase):
    def test_concurrent_claims_for_one_event_generate_only_one_draft(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 's.db'
            state = bridge.State(path)
            state.claim(dict(event_id='one-event', sender='苏小妖', text='你好'))
            state.close()
            barrier = threading.Barrier(2)
            results = []
            class RacingState(bridge.State):
                def event(self, key):
                    row = super().event(key)
                    barrier.wait(timeout=5)
                    return row
            def run(prefix):
                candidate = RacingState(path)
                try:
                    candidate.claim_draft('one-event', dict(incoming_text='你好',
                        latest_message_direction='incoming', content=prefix + '你好', contact_key='contact'))
                    results.append('accepted')
                except ValueError:
                    results.append('rejected')
                finally:
                    candidate.close()
            threads = [threading.Thread(target=run, args=(prefix,)) for prefix in ['上下文A', '上下文B']]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=10)
            self.assertEqual(sorted(results), ['accepted', 'rejected'])


class CancellationTests(unittest.TestCase):
    def test_sigterm_unwinds_phone_cleanup_instead_of_abrupt_exit(self):
        code = """
import os, signal, threading, time
import cs_phone
cs_phone.install_cancel_handler()
threading.Timer(0.05, lambda: os.kill(os.getpid(), signal.SIGTERM)).start()
try:
    time.sleep(5)
except KeyboardInterrupt:
    print('cancelled')
finally:
    print('cleanup')
"""
        result = subprocess.run([sys.executable, '-c', code], cwd=str(Path(__file__).resolve().parents[1]),
                                capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines(), ['cancelled', 'cleanup'])

class InboundBatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = bridge.State(Path(self.temp.name) / 's.db')
        self.addCleanup(self.state.close)
        # 2026-10-15 18:10 Asia/Shanghai, hand-derived from 10:10 UTC.
        self.when = str(int(__import__('datetime').datetime(2026, 10, 15, 10, 10,
            tzinfo=__import__('datetime').timezone.utc).timestamp() * 1000))
        self.state.claim(dict(event_id='batch-one', sender='苏小妖', text='你好', notification_when=self.when))
        self.batch = [dict(type='text', text='你好'), dict(type='text', text='我想咨询智能客服'), dict(type='image')]
        self.context = dict(contact_key='suxiaoyao121', incoming_text='你好',
            content='你好\n我想咨询智能客服\n用户发了一张截图（未解读）',
            inbound_batch=self.batch, anchor_time_minute='2026-10-15 18:10',
            latest_message=dict(type='image'), latest_message_direction='incoming',
            replied_after_anchor=False)

    def test_notification_anchor_can_wake_full_unreplied_text_and_image_batch(self):
        self.state.claim_draft('batch-one', self.context)
        self.assertEqual(self.state.event('batch-one')['status'], 'drafting')

    def test_wrong_time_missing_anchor_or_outgoing_after_anchor_rejects(self):
        bads = [dict(anchor_time_minute='2026-10-15 18:11'),
                dict(inbound_batch=[dict(type='text', text='其他消息')],
                     latest_message=dict(type='text', text='其他消息')),
                dict(replied_after_anchor=True),
                dict(latest_message_direction='outgoing'),
                dict(latest_message=dict(type='text', text='你好'))]
        for patch in bads:
            with self.assertRaises(ValueError):
                self.state.claim_draft('batch-one', self.context | patch)
        self.assertEqual(self.state.event('batch-one')['status'], 'claimed')

    def test_different_notifications_for_same_batch_consume_once(self):
        self.state.claim(dict(event_id='batch-two', sender='苏小妖', text='我想咨询智能客服',
                              notification_when=self.when))
        self.state.claim_draft('batch-one', self.context)
        with self.assertRaises(ValueError):
            self.state.claim_draft('batch-two', self.context | dict(incoming_text='我想咨询智能客服'))

    def test_send_context_changed_since_draft_is_rejected(self):
        self.state.claim_draft('batch-one', self.context)
        self.state.set_draft('batch-one', dict(reply='您好，请问您希望了解哪方面？', message_id=17), self.context)
        check = getattr(self.state, 'check_send_context', None)
        self.assertTrue(callable(check), '发送前批次一致性校验尚未实现')
        check('batch-one', self.context)
        changed = self.batch + [dict(type='text', text='还有新消息')]
        with self.assertRaises(ValueError):
            check('batch-one', self.context | dict(inbound_batch=changed,
                latest_message=changed[-1]))

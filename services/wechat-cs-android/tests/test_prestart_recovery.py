"""启动前重启恢复只允许原run完整空执行历史与独立重启记录共同证明。"""
import copy
from datetime import datetime, timezone, timedelta
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bridge import State, private_json, single_instance
from recover_unattempted import recover


class PrestartRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path = self.root / 'live' / 'state.db'
        self.state = State(self.path)
        self.addCleanup(self.state.close)
        self.event_id = 'b' * 64
        self.session = '446445d9-c321-43eb-a5e3-de0b35234bbc'
        self.key = 'agent:zenithjoy-moments:explicit:' + self.session
        self.run = 'ba785449-d93b-4093-be46-204ba9293cee'
        self.state.claim(dict(event_id=self.event_id, sender='苏小妖', text='你好'))
        self.state.pause('gateway_outcome_unknown')
        self.binding = self.root / 'phone-evidence' / self.event_id / 'gateway-session.json'
        private_json(self.binding, dict(session_id=self.session, event_id=self.event_id))
        now = datetime.now(timezone.utc)
        accepted = now - timedelta(seconds=60)
        self.accepted_ms = int(accepted.timestamp() * 1000)
        self.history = dict(sessionKey=self.key, sessionId=self.session, hasMore=False,
            totalMessages=1, messages=[dict(role='user', content='任务', timestamp=self.accepted_ms,
                                         idempotencyKey=self.run + ':user')],
            pendingInputs=dict(items=[], total=0, queuedCount=0),
            sessionInfo=dict(key=self.key, sessionId=self.session, snapshotAt=int(now.timestamp()*1000),
                             hasActiveRun=False, activeRunIds=[]))
        self.history_path = self.root / 'history.json'
        private_json(self.history_path, self.history)
        self.abort_path = self.root / 'abort.json'
        private_json(self.abort_path, dict(ok=True, status='no-active-run', abortedRunId=None))
        self.log_path = self.root / 'gateway.jsonl'
        self.logs = [self.log(accepted-timedelta(seconds=30), 'native runtime: {"pid":100}'),
                     self.log(accepted, '⇄ res ✓ agent 167ms runId=' + self.run, 'gateway/ws'),
                     self.log(accepted+timedelta(seconds=3), 'received SIGTERM; shutting down'),
                     self.log(accepted+timedelta(seconds=20), 'native runtime: {"pid":200}'),
                     self.log(accepted+timedelta(seconds=21), 'http server listening (8 plugins)'),
                     self.log(accepted+timedelta(seconds=22), 'gateway ready')]
        self.write_logs()
        self.proof = self.root / 'proof.json'
        self.data = dict(schema_version=2, recovery_mode='gateway_restart_before_execution',
                         event_id=self.event_id, session_key=self.key, run_id=self.run,
                         watcher_stopped=True, terminal_state_receipt=str(self.history_path),
                         abort_receipt=str(self.abort_path), gateway_log_receipt=str(self.log_path))
        private_json(self.proof, self.data)

    def log(self, at, message, subsystem='gateway'):
        return {'0': json.dumps({'subsystem': subsystem}), '1': message, 'message': message,
                '_meta': {'date': at.isoformat(), 'hostname': 'test-mmv'}, 'hostname': 'test-mmv'}

    def write_logs(self):
        self.log_path.write_text(''.join(json.dumps(x) + '\n' for x in self.logs))
        self.log_path.chmod(0o600)

    def run_recovery(self):
        return recover(self.path, self.event_id, self.proof, '操作者核实启动前重启',
                       event_session_receipt=self.binding)

    def assert_refused(self):
        with self.assertRaises(ValueError):
            self.run_recovery()
        with self.assertRaises(RuntimeError):
            self.state.require_ready()
        self.assertEqual(self.state.db.execute('SELECT count(*) FROM actions').fetchone()[0], 0)

    def test_fresh_complete_user_only_history_and_restart_clears_pause_without_reclaim(self):
        before = self.state.event(self.event_id)
        try:
            result = self.run_recovery()
        except (TypeError, ValueError) as exc:
            self.fail('完整未执行重启证据应允许恢复：' + str(exc))
        self.assertTrue(result['recovered'])
        self.assertEqual(self.state.event(self.event_id), before)
        self.state.require_ready()
        audit = json.loads(self.state.db.execute('SELECT audit_json FROM recovery_audit').fetchone()[0])
        self.assertEqual(audit['evidence']['proof']['run_id'], self.run)
        self.assertEqual(len(audit['evidence']['gateway_log_sha256']), 64)
        self.assertEqual(audit['evidence']['restart']['old_pid'], 100)
        self.assertEqual(audit['evidence']['restart']['new_pid'], 200)

    def test_assistant_tool_incomplete_stale_wrong_run_or_pending_history_refused(self):
        changes = [dict(messages=self.history['messages'] + [dict(role='assistant', content='工具')], totalMessages=2),
                   dict(messages=[self.history['messages'][0] | {'role':'tool'}]),
                   dict(hasMore=True), dict(totalMessages=2),
                   dict(messages=[self.history['messages'][0] | {'idempotencyKey':'other:user'}]),
                   dict(sessionKey='other'),
                   dict(pendingInputs=dict(items=[], total=0, queuedCount=1)),
                   dict(sessionInfo=self.history['sessionInfo'] | {'snapshotAt':1}),
                   dict(sessionInfo=self.history['sessionInfo'] | {'hasActiveRun':True}),
                   dict(sessionInfo=self.history['sessionInfo'] | {'activeRunIds':[self.run]})]
        for change in changes:
            with self.subTest(change=change):
                private_json(self.history_path, self.history | change)
                self.assert_refused()

    def test_missing_reordered_wrong_host_same_pid_restart_or_acceptance_refused(self):
        original = copy.deepcopy(self.logs)
        bads = [original[1:], original[:2]+original[3:], original[:-1],
                original[:1]+original[2:]]
        same = copy.deepcopy(original); same[3]['message']='native runtime: {"pid":100}'; bads.append(same)
        foreign = copy.deepcopy(original); foreign[2]['hostname']='other'; bads.append(foreign)
        for logs in bads:
            with self.subTest(logs=logs):
                self.logs=logs; self.write_logs(); self.assert_refused()

    def test_draft_input_send_and_other_unresolved_events_refused(self):
        for column, value in [('draft_json','{}'),('context_hash','h'),('contact_key','k'),
                              ('evidence_json','{}'),('status','sending')]:
            self.state.db.execute('UPDATE events SET '+column+'=?', (value,)); self.state.db.commit()
            self.assert_refused()
            self.state.db.execute('UPDATE events SET '+column+'=?', ('claimed' if column=='status' else None,))
            self.state.db.commit()
        for kind in ['input', 'send']:
            self.state.claim_action(self.event_id, kind)
            with self.assertRaises(ValueError): self.run_recovery()
            self.state.db.execute('DELETE FROM actions'); self.state.db.commit()
        self.state.claim(dict(event_id='c'*64, sender='苏小妖', text='另一条'))
        self.assert_refused()

    def test_phone_evidence_without_actions_refuses_recovery(self):
        self.state.db.execute('INSERT INTO phone_evidence VALUES (?,?,?,?,?,?,?)',
            ('/private/screenshot.png', self.event_id, 'sha', '{}', 'serial', 'owner', 'screenshot'))
        self.state.db.commit()
        self.assert_refused()

    def test_listener_before_new_runtime_refuses_recovery(self):
        self.logs[4]['_meta']['date'] = (datetime.fromisoformat(
            self.logs[2]['_meta']['date']) + timedelta(seconds=1)).isoformat()
        self.write_logs()
        self.assert_refused()

    def test_custom_evidence_root_watcher_lock_prevents_recovery(self):
        with single_instance(self.binding.parent.parent / 'watcher.lock'):
            with self.assertRaises(RuntimeError):
                self.run_recovery()

    def test_watcher_or_event_lock_and_missing_proof_refused(self):
        for lock in [self.path.parent/'watcher.lock', self.path.parent/(self.event_id+'.operation.guard')]:
            with single_instance(lock):
                with self.assertRaises(RuntimeError): self.run_recovery()
        self.log_path.unlink()
        with self.assertRaises((OSError, ValueError)): self.run_recovery()


if __name__ == '__main__': unittest.main()

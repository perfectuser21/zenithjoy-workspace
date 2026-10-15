"""恢复只能显式处理已终态、完全未尝试回复的同一事件。"""
import copy
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bridge import State, private_json, single_instance


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(importlib.util.find_spec('recover_unattempted'), '显式恢复工具尚未实现')
        self.module = __import__('recover_unattempted')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path = self.root / 'state.db'
        self.state = State(self.path)
        self.addCleanup(self.state.close)
        self.event_id = 'a' * 64
        self.state.claim(dict(event_id=self.event_id, sender='苏小妖', text='你好'))
        self.state.pause('gateway_outcome_unknown')
        self.session = 'c1f25fc0-82db-4dab-a9b7-2c868c6aa809'
        self.key = 'agent:zenithjoy-moments:explicit:' + self.session
        private_json(self.root / self.event_id / 'gateway-session.json',
                     dict(session_id=self.session, event_id=self.event_id))
        self.abort = self.root / 'abort.json'
        private_json(self.abort, dict(ok=True, aborted=True, runIds=['run-aborted']))
        self.terminal = self.root / 'terminal.json'
        self.snapshot = dict(at=datetime.now(timezone.utc).isoformat(), session_key=self.key,
            in_flight=False, pending_inputs=dict(items=[], total=0, queuedCount=0),
            session_info=dict(key=self.key, sessionId=self.session, status='killed',
                abortedLastRun=True, lastRunId='run-aborted', hasActiveRun=False,
                activeRunIds=[], endedAt=1792059389996))
        private_json(self.terminal, self.snapshot)
        self.proof = self.root / 'proof.json'
        self.proof_data = dict(schema_version=1, event_id=self.event_id, session_key=self.key,
            terminal_state_receipt=str(self.terminal), abort_receipt=str(self.abort), watcher_stopped=True)
        private_json(self.proof, self.proof_data)

    def recover(self, proof=None):
        return self.module.recover(self.path, self.event_id, proof or self.proof,
                                   '操作者已核实原会话终止，继续同一未尝试事件')

    def test_claimed_with_real_matching_terminal_receipts_clears_only_pause(self):
        before = self.state.event(self.event_id)
        result = self.recover()
        self.assertTrue(result['recovered'])
        self.assertEqual(self.state.event(self.event_id), before)
        self.state.require_ready()
        self.assertFalse(self.state.claim(before['event_json']))
        record = self.state.db.execute('SELECT * FROM recovery_audit').fetchone()
        self.assertIsNotNone(record)
        self.assertIn('terminal_sha256', record.keys())
        with self.assertRaises(sqlite3.IntegrityError):
            self.state.db.execute('DELETE FROM recovery_audit')

    def test_missing_proof_is_rejected_and_pause_retained(self):
        with self.assertRaises((ValueError, OSError)):
            self.recover(self.root / 'missing.json')
        with self.assertRaises(RuntimeError):
            self.state.require_ready()

    def test_input_attempt_or_draft_or_context_consumption_cannot_be_recovered(self):
        for mutation, rollback in [
            (lambda: self.state.claim_action(self.event_id, 'input'),
             lambda: self.state.db.execute('DELETE FROM actions')),
            (lambda: self.state.db.execute("UPDATE events SET draft_json='{}'"),
             lambda: self.state.db.execute('UPDATE events SET draft_json=NULL')),
            (lambda: self.state.db.execute("INSERT INTO contexts VALUES ('hash',?)", (self.event_id,)),
             lambda: self.state.db.execute('DELETE FROM contexts')),
            (lambda: self.state.db.execute("UPDATE events SET status='sending'"),
             lambda: self.state.db.execute("UPDATE events SET status='claimed'"))]:
            mutation()
            self.state.db.commit()
            with self.assertRaises(ValueError):
                self.recover()
            rollback()
            self.state.db.commit()

    def test_mismatched_or_active_or_unaborted_gateway_receipts_are_rejected(self):
        bads = [self.snapshot | dict(session_key='another-session'),
                self.snapshot | dict(in_flight=True),
                self.snapshot | dict(pending_inputs=dict(items=['queued'], total=1, queuedCount=1)),
                self.snapshot | dict(session_info=self.snapshot['session_info'] | dict(lastRunId='other-run')),
                self.snapshot | dict(session_info=self.snapshot['session_info'] | dict(hasActiveRun=True)),
                self.snapshot | dict(at='2000-01-01T00:00:00Z')]
        for bad in bads:
            private_json(self.terminal, bad)
            with self.assertRaises(ValueError):
                self.recover()
        private_json(self.terminal, self.snapshot)
        private_json(self.abort, dict(ok=True, aborted=False, runIds=['run-aborted']))
        with self.assertRaises(ValueError):
            self.recover()

    def test_watcher_or_phone_operation_still_running_prevents_recovery(self):
        for lock in [self.root / 'watcher.lock', self.root / (self.event_id + '.operation.guard')]:
            with single_instance(lock):
                with self.assertRaises(RuntimeError):
                    self.recover()

    def test_same_proof_cannot_clear_a_later_pause(self):
        self.recover()
        self.state.pause('later_outcome_unknown')
        with self.assertRaises(ValueError):
            self.recover()
        with self.assertRaises(RuntimeError):
            self.state.require_ready()


if __name__ == '__main__':
    unittest.main()

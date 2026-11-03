"""专用101恢复只承认原leaf close链，拒绝普通停止猜测。"""
import importlib.util
import json
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('discovery_review_proof', HERE / 'discovery-review-maintenance-proof.py')
proof = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proof)


def leaf():
    intent = {'sequence': 1, 'argv_sha256': 'a' * 64, 'intent_at': 10,
              'boundary': 'darwin-sandbox-deny-process-fork-v1'}
    started = {**intent, 'pid': 123, 'started_at': 11}
    return [{**intent, 'phase': 'intent'}, {**started, 'phase': 'started'},
            {**started, 'phase': 'exit', 'ended_at': 12, 'code': 0, 'signal': None,
             'tainted': False, 'dump_crash_returned': False, 'request_returned': True}]


class DiscoveryReviewTest(unittest.TestCase):
    def check(self, rows):
        return proof.verify_leaf_log(''.join(json.dumps(row) + '\n' for row in rows))

    def test_complete_leaf_close(self):
        self.assertEqual(self.check(leaf()), {'leaves': 1, 'first_intent': 10, 'last_exit': 12})

    def test_missing_duplicate_unknown_and_unreturned_leaf_rejected(self):
        rows = leaf()
        bad = [rows[:-1], rows + rows, [*rows, {'phase': 'unknown'}],
               [*rows[:-1], {**rows[-1], 'request_returned': False}],
               [*rows[:-1], {**rows[-1], 'signal': 'SIGKILL'}],
               [*rows[:-1], {**rows[-1], 'tainted': True}],
               [*rows[:-1], {**rows[-1], 'ended_at': 9}],
               [rows[0], {**rows[1], 'argv_sha256': 'b' * 64}, rows[-1]]]
        for changed in bad:
            with self.subTest(changed=changed):
                with self.assertRaises(ValueError):
                    self.check(changed)
        with self.assertRaises(ValueError):
            proof.verify_leaf_log(json.dumps(rows[0]))

    def test_maintenance_claim_is_exact(self):
        task = {**proof.TASK, 'payload': {'headed_manual': 'true'}}
        proof.verify_task(task)
        for key in proof.TASK:
            with self.subTest(key=key):
                with self.assertRaises(ValueError):
                    proof.verify_task({**task, key: 'foreign'})

    def test_old_owners_cannot_be_selected(self):
        self.assertEqual(proof.SCOPE['serial'], 'ANGYVB4311010223')
        self.assertEqual(proof.SCOPE['owner'], 'ys261104032759_101')
        self.assertEqual(proof.SCOPE['source_commit'], '252225f13a47ed36e95c248e916373c4c462fffd')


if __name__ == '__main__':
    unittest.main()

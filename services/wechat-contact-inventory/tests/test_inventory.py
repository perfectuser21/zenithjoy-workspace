"""Behavioral smoke tests for private contact inventory and manual review."""
import copy
import base64
import csv
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

CLI = Path(__file__).resolve().parents[1] / 'cli.py'


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.db = self.root / 'inventory.sqlite'
        self.evidence = self.root / 'source.png'
        self.evidence.write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='))
        self.payload = {
            'schema_version': '1.0.0', 'run_id': 'probe-001',
            'observed_at': '2026-10-24T10:00:00+08:00',
            'account': {'tenant_id': 'tenant-a', 'wechat_account_id': 'self-a', 'device_serial': 'device-a'},
            'account_verified': True, 'account_evidence_ids': ['account-proof'],
            'preflight': {'status': 'ready', 'login_status': 'verified', 'call_state': 'idle'},
            'coverage': {'scope': 'visible_excerpt', 'complete': False,
                         'pages_observed': ['contacts-first-page'], 'not_covered': ['remaining-pages']},
            'evidence': [{'evidence_id': 'account-proof', 'run_id': 'probe-001', 'kind': 'screenshot',
                          'path': str(self.evidence), 'sha256': hashlib.sha256(self.evidence.read_bytes()).hexdigest()}],
            'observations': [self.observation('person-1', 'person', 'Customer One', 'wxid-one')],
        }

    def tearDown(self):
        self.tmp.cleanup()

    def observation(self, oid, kind, name, stable=None):
        return {'observation_id': oid, 'kind': kind, 'display_name': name,
                'stable_id': stable, 'identity_verified': stable is not None,
                'identity_evidence_ids': ['account-proof'] if stable else [],
                'evidence_ids': ['account-proof']}

    def command(self, action, payload=None, account_key=None, suffix='json', ok=True, actor=None):
        out = self.root / ('out-' + action + '.' + suffix)
        args = [sys.executable, str(CLI), action, '--db', str(self.db), '--out', str(out)]
        if payload is not None:
            inp = self.root / 'input.json'
            inp.write_text(json.dumps(payload, ensure_ascii=False))
            args += ['--input', str(inp)]
        if account_key:
            args += ['--account-key', account_key]
        if actor:
            args += ['--actor', actor]
        result = subprocess.run(args, capture_output=True, text=True)
        if ok:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            return json.loads(out.read_text()) if suffix == 'json' else out
        self.assertNotEqual(result.returncode, 0)
        return result

    def ingest(self, payload=None):
        return self.command('ingest', payload or self.payload)

    def review(self, account_key):
        return self.command('export-review', account_key=account_key)

    def test_cli_ingests_real_evidence_and_exports_pending_without_reply(self):
        result = self.ingest()
        review = self.review(result['account_key'])
        row = review['records'][0]
        self.assertEqual(row['classification'], 'pending')
        self.assertFalse(row['collect_enabled'])
        self.assertFalse(row['auto_reply_enabled'])
        self.assertEqual(review['coverage']['complete'], False)
        self.assertEqual(self.db.stat().st_mode & 0o777, 0o600)
        self.assertEqual((self.root / 'out-export-review.json').stat().st_mode & 0o777, 0o600)

    def test_same_name_unverified_people_are_distinct_and_replay_is_idempotent(self):
        self.payload['observations'] = [self.observation('a', 'person', 'Same'), self.observation('b', 'person', 'Same')]
        first = self.ingest()
        again = self.ingest()
        rows = self.review(first['account_key'])['records']
        self.assertEqual(len(rows), 2)
        self.assertEqual(len({r['record_id'] for r in rows}), 2)
        self.assertTrue(again['replayed'])
        self.assertTrue(all(r['requires_identity_confirmation'] for r in rows))

    def test_changed_same_run_or_evidence_hash_is_rejected_without_write(self):
        result = self.ingest()
        changed = copy.deepcopy(self.payload)
        changed['observations'][0]['display_name'] = 'Changed'
        self.command('ingest', changed, ok=False)
        self.assertEqual(self.review(result['account_key'])['records'][0]['display_name'], 'Customer One')
        self.evidence.write_bytes(b'changed')
        self.command('ingest', self.payload, ok=False)

    def test_cross_account_same_stable_id_remains_isolated(self):
        one = self.ingest()
        two = copy.deepcopy(self.payload)
        two['account']['wechat_account_id'] = 'self-b'
        other = self.ingest(two)
        self.assertNotEqual(one['account_key'], other['account_key'])
        self.assertNotEqual(self.review(one['account_key'])['records'][0]['record_id'],
                            self.review(other['account_key'])['records'][0]['record_id'])

    def test_verified_same_account_can_move_devices_without_losing_decisions(self):
        first = self.ingest()
        review = self.review(first['account_key'])
        original_id = review['records'][0]['record_id']
        review['records'][0].update(classification='customer', customer_refs=['customer-a'], collect_enabled=True)
        self.command('apply-review', review, actor='operator-a')
        moved = copy.deepcopy(self.payload)
        moved['run_id'] = 'moved-002'
        moved['evidence'][0]['run_id'] = 'moved-002'
        moved['observed_at'] = '2026-10-24T11:00:00+08:00'
        moved['account']['device_serial'] = 'new-device'
        result = self.ingest(moved)
        self.assertEqual(result['account_key'], first['account_key'])
        row = self.review(result['account_key'])['records'][0]
        self.assertEqual(row['record_id'], original_id)
        self.assertEqual(row['classification'], 'customer')
        self.assertTrue(row['collect_enabled'])

    def test_review_can_classify_multi_customer_group_but_never_enable_reply(self):
        self.payload['observations'] = [self.observation('g', 'group', 'Project group', 'group@chatroom')]
        ingested = self.ingest()
        review = self.review(ingested['account_key'])
        row = review['records'][0]
        row.update(classification='customer', customer_refs=['customer-a', 'customer-b'],
                   project_refs=['project-one'], collect_enabled=True)
        applied = self.command('apply-review', review, actor='operator-a')
        self.assertEqual(applied['updated'], 1)
        eligible = self.command('eligible', account_key=ingested['account_key'])
        self.assertEqual(eligible['eligible_count'], 1)
        self.assertEqual(eligible['records'][0]['customer_refs'], ['customer-a', 'customer-b'])
        self.assertFalse(eligible['records'][0]['auto_reply_enabled'])
        replay = self.command('apply-review', review, actor='operator-a')
        self.assertTrue(replay['replayed'])
        with sqlite3.connect(self.db) as conn:
            self.assertEqual(conn.execute('select count(*) from review_audit').fetchone()[0], 1)

    def test_pending_and_unverified_items_never_become_collectible(self):
        self.payload['observations'] = [self.observation('a', 'person', 'Unknown')]
        result = self.ingest()
        review = self.review(result['account_key'])
        review['records'][0].update(classification='customer', customer_refs=['customer-a'], collect_enabled=True)
        self.command('apply-review', review, actor='operator-a', ok=False)
        self.assertEqual(self.command('eligible', account_key=result['account_key'])['eligible_count'], 0)

    def test_rescan_preserves_classification_and_revocation_is_audited(self):
        result = self.ingest()
        review = self.review(result['account_key'])
        review['records'][0].update(classification='customer', customer_refs=['customer-a'], collect_enabled=True)
        self.command('apply-review', review, actor='operator-a')
        another = copy.deepcopy(self.payload)
        another['run_id'] = 'probe-002'
        another['evidence'][0]['run_id'] = 'probe-002'
        another['observed_at'] = '2026-10-24T11:00:00+08:00'
        another['observations'][0]['display_name'] = 'Renamed Customer'
        self.ingest(another)
        current = self.review(result['account_key'])
        self.assertEqual(len(current['records']), 1)
        self.assertEqual(current['records'][0]['classification'], 'customer')
        self.assertEqual(current['records'][0]['display_name'], 'Renamed Customer')
        current['records'][0]['collect_enabled'] = False
        self.command('apply-review', current, actor='operator-a')
        self.assertEqual(self.command('eligible', account_key=result['account_key'])['eligible_count'], 0)
        with sqlite3.connect(self.db) as conn:
            self.assertEqual(conn.execute('select count(*) from review_audit').fetchone()[0], 2)

    def test_stale_review_and_cross_account_review_roll_back_whole_batch(self):
        self.payload['observations'].append(self.observation('two', 'person', 'Two', 'wxid-two'))
        result = self.ingest()
        old = self.review(result['account_key'])
        new = self.review(result['account_key'])
        new['records'][0].update(classification='private')
        self.command('apply-review', new, actor='operator-a')
        old['records'][1].update(classification='customer', customer_refs=['customer-b'], collect_enabled=True)
        self.command('apply-review', old, actor='operator-b', ok=False)
        rows = self.review(result['account_key'])['records']
        self.assertEqual(rows[1]['classification'], 'pending')
        foreign = self.review(result['account_key'])
        foreign['account_key'] = 'other-account'
        self.command('apply-review', foreign, actor='operator-a', ok=False)

    def test_tampered_reply_or_missing_customer_relation_rejected(self):
        result = self.ingest()
        review = self.review(result['account_key'])
        review['records'][0]['auto_reply_enabled'] = True
        self.command('apply-review', review, actor='operator-a', ok=False)
        review['records'][0].update(auto_reply_enabled=False, classification='customer', collect_enabled=True)
        self.command('apply-review', review, actor='operator-a', ok=False)

    def test_csv_review_is_formula_safe_and_can_be_applied(self):
        self.payload['observations'][0]['display_name'] = '=HYPERLINK("bad")'
        result = self.ingest()
        out = self.command('export-review', account_key=result['account_key'], suffix='csv')
        with out.open(newline='') as handle:
            rows = list(csv.DictReader(handle))
        self.assertTrue(rows[0]['display_name'].startswith("'="))
        rows[0]['classification'] = 'internal'
        with out.open('w', newline='') as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
        applied_out = self.root / 'csv-applied.json'
        cmd = subprocess.run([sys.executable, str(CLI), 'apply-review', '--db', str(self.db),
                              '--input', str(out), '--actor', 'operator-a', '--out', str(applied_out)], capture_output=True, text=True)
        self.assertEqual(cmd.returncode, 0, cmd.stdout + cmd.stderr)
        self.assertEqual(self.review(result['account_key'])['records'][0]['classification'], 'internal')

    def test_csv_roundtrip_preserves_all_formula_escaped_identifiers_and_quotes(self):
        self.payload['run_id'] = '=run-001'
        self.payload['evidence'][0]['run_id'] = '=run-001'
        self.payload['observations'][0].update(stable_id='@stable-id', display_name="'=literal-name")
        result = self.ingest()
        out = self.command('export-review', account_key=result['account_key'], suffix='csv')
        receipt = self.root / 'escaped-applied.json'
        command = subprocess.run([sys.executable, str(CLI), 'apply-review', '--db', str(self.db),
                                  '--input', str(out), '--actor', 'operator-a', '--out', str(receipt)],
                                 capture_output=True, text=True)
        self.assertEqual(command.returncode, 0, command.stdout + command.stderr)
        row = self.review(result['account_key'])['records'][0]
        self.assertEqual(row['stable_id'], '@stable-id')
        self.assertEqual(row['display_name'], "'=literal-name")

    def test_whitespace_identity_aliases_are_rejected_instead_of_splitting_records(self):
        first = self.ingest()
        for field in ['stable_id', 'observation_id', 'run_id']:
            payload = copy.deepcopy(self.payload)
            payload['run_id'] = 'new-run-' + field
            payload['evidence'][0]['run_id'] = payload['run_id']
            if field == 'run_id':
                payload['run_id'] = ' new-run '
                payload['evidence'][0]['run_id'] = payload['run_id']
            else:
                payload['observations'][0][field] = ' ' + payload['observations'][0][field] + ' '
            self.command('ingest', payload, ok=False)
        self.assertEqual(len(self.review(first['account_key'])['records']), 1)

    def test_output_cannot_replace_database_input_or_evidence(self):
        inp = self.root / 'safe-input.json'
        inp.write_text(json.dumps(self.payload))
        original = self.evidence.read_bytes()
        for target in [self.db, inp, self.evidence]:
            result = subprocess.run([sys.executable, str(CLI), 'ingest', '--db', str(self.db),
                                     '--input', str(inp), '--out', str(target)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(self.evidence.read_bytes(), original)
        self.assertFalse(self.db.exists())

    def test_empty_and_unverified_identity_are_not_silently_promoted(self):
        empty = copy.deepcopy(self.payload)
        empty['observations'] = []
        self.command('ingest', empty, ok=False)
        self.assertFalse(self.db.exists())
        invalid = copy.deepcopy(self.payload)
        invalid['observations'][0]['identity_verified'] = False
        self.command('ingest', invalid, ok=False)

    def test_manual_review_cannot_change_identity_and_invalid_row_rolls_back(self):
        self.payload['observations'].append(self.observation('two', 'person', 'Two', 'wxid-two'))
        result = self.ingest()
        review = self.review(result['account_key'])
        review['records'][0]['classification'] = 'private'
        review['records'][1]['stable_id'] = 'forged-id'
        self.command('apply-review', review, actor='operator-a', ok=False)
        rows = self.review(result['account_key'])['records']
        self.assertEqual([r['classification'] for r in rows], ['pending', 'pending'])

    def test_concurrent_reviews_never_apply_two_different_decisions(self):
        result = self.ingest()
        review = self.review(result['account_key'])
        commands = []
        for i, classification in enumerate(['private', 'internal']):
            payload = copy.deepcopy(review)
            payload['records'][0]['classification'] = classification
            inp = self.root / ('concurrent-' + str(i) + '.json')
            inp.write_text(json.dumps(payload))
            commands.append(subprocess.Popen([sys.executable, str(CLI), 'apply-review', '--db', str(self.db),
                                              '--input', str(inp), '--actor', 'operator-a', '--out',
                                              str(self.root / ('applied-' + str(i) + '.json'))],
                                             stdout=subprocess.PIPE, stderr=subprocess.PIPE))
        for command in commands:
            command.communicate(timeout=15)
        self.assertEqual(sorted(c.returncode for c in commands), [0, 2])
        with sqlite3.connect(self.db) as conn:
            self.assertEqual(conn.execute('select count(*) from review_audit').fetchone()[0], 1)

    def test_wrong_run_unverified_account_and_fake_full_coverage_are_rejected(self):
        for change in ('wrong_run', 'unverified_account', 'full_coverage', 'login_required'):
            payload = copy.deepcopy(self.payload)
            if change == 'wrong_run':
                payload['evidence'][0]['run_id'] = 'other-run'
            elif change == 'unverified_account':
                payload['account_verified'] = False
            elif change == 'full_coverage':
                payload['coverage']['complete'] = True
            else:
                payload['preflight']['status'] = 'login_required'
                payload['observations'] = []
            self.command('ingest', payload, ok=False)


if __name__ == '__main__':
    unittest.main()

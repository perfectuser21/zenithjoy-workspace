import base64
from contextlib import ExitStack, nullcontext
import importlib.util
import io
import json
import os
from pathlib import Path
import plistlib
import pwd
import subprocess
import socket
import tempfile
import types
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).resolve().parents[1] / 'maintenance-install-host.py'
spec = importlib.util.spec_from_file_location('maintenance_install_host', SOURCE)
host_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host_module)


class HostCommandTextTests(unittest.TestCase):
    def test_real_read_paths_return_text_without_stdin(self):
        def run(argv, *, input, text, capture_output, check, timeout):
            self.assertTrue(capture_output)
            raw = '342 /usr/bin/python3 adb-host-service.py run --config x\n' if argv[0] == '/bin/ps' else '15 2 * * * harvest-cron.sh\n'
            return types.SimpleNamespace(stdout=raw if text else raw.encode(),
                                         stderr='' if text else b'', returncode=0)

        with patch.object(host_module.subprocess, 'run', side_effect=run):
            self.assertIsInstance(host_module.cron_raw(), str)
            self.assertIsInstance(host_module.process_table(), str)
            self.assertIsInstance(host_module.launch('print', 'system/com.zenithjoy.adb-host').stderr, str)


class SafetyHostTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve()
        self.old = self.home / 'legacy-locks'
        self.old.mkdir()
        for serial in ('SERIAL1', 'SERIAL2'):
            (self.old / (serial + '.guard')).touch()
            lock = self.old / (serial + '.lock')
            lock.mkdir()
            (lock / 'owner').write_text(serial + '-old\n')
            (lock / 'standalone_review_required').write_text(serial + '-old\n')
            (lock / 'acquired_at').write_text('123\n')
        (self.home / 'bin-harvest').mkdir()
        (self.home / 'bin-harvest/deployment-manifest.json').write_text('{"production":"old"}')
        (self.home / 'bin-harvest/outreach-tick.sh').write_text(
            'legacy_outreach_canonical="$HOME/bin-harvest"\n'
            'if [[ "${0:A:h}" == "${legacy_outreach_canonical:A}" ]]; then\n'
            '  echo OUTREACH_TICK_RETIRED\n  exit 1\nfi\n'
            'C=~/.local/bin/douyin-phone-adb\n')
        registry = self.home / '.config/openclaw/douyin-phone-profiles.tsv'
        registry.parent.mkdir(parents=True)
        registry.write_text('#profile\tserial\tenabled\np1\tSERIAL1\ttrue\np2\tSERIAL2\ttrue\n')
        runtime = self.home / '.local/share/zenithjoy/phone-candidates' / ('b' * 40) / 'runtime'
        runtime.mkdir(parents=True)
        (self.home / '.local/share/zenithjoy/phone-candidate-runs').mkdir(parents=True)
        (runtime / 'adb-host-service.py').write_bytes(b'old adb service\n')
        (runtime / 'adb-existing-route.py').write_bytes(b'old adb dependency\n')
        self.plist = self.home / 'adb-host.plist'
        self.plist.write_bytes(plistlib.dumps({'Label': host_module.ADB_LABEL, 'UserName': 'service-user',
                                               'ProgramArguments': ['/usr/bin/python3', str(runtime / 'adb-host-service.py'),
                                                                    'run', '--config', str(self.home / '.config/zenithjoy/adb-service.json')],
                                               'KeepAlive': True}))
        self.cron = ''.join(f'15 {hour} * * * /bin/zsh /Users/service-user/bin-harvest/harvest-cron.sh p1 SERIAL1 query 6 1\n'
                            for hour in (2, 6, 22))
        self.cron += ''.join(f'45 {hour} * * * /bin/zsh /Users/service-user/bin-harvest/harvest-cron.sh p2 SERIAL2 query 6 1\n'
                             for hour in (2, 6, 22))
        self.cron += f'*/30 * * * * /bin/zsh {self.home}/bin-harvest/outreach-tick.sh\n'
        self.state = {'cron': self.cron, 'adb_loaded': True, 'recovery_disabled': False,
                      'recovery_loaded': True, 'fence': False, 'fail_second_seal': True,
                      'fail_stable_bootstrap': False, 'old_process_visible': True,
                      'adb_script': str(runtime / 'adb-host-service.py'), 'launches': []}
        self.sha = 'a' * 40
        self.transaction = 'phone-safety-' + self.sha[:24]
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(host_module, 'ADB_PLIST', self.plist))
        self.stack.enter_context(patch.object(host_module.pwd, 'getpwuid',
                                              return_value=types.SimpleNamespace(pw_dir=str(self.home), pw_name='service-user', pw_uid=0)))
        self.stack.enter_context(patch.object(host_module, 'command', side_effect=self.command))
        self.stack.enter_context(patch.object(host_module, 'launch', side_effect=self.launch))
        self.stack.enter_context(patch.object(socket, 'create_connection', side_effect=self.socket_connect))
        self.stack.enter_context(patch.object(host_module.recovery, 'service_state', side_effect=self.recovery_state))
        self.stack.enter_context(patch.object(host_module.recovery, 'prepare', side_effect=self.prepare_recovery))
        self.stack.enter_context(patch.object(host_module.recovery, 'suspend_review', side_effect=self.suspend_recovery))
        self.stack.enter_context(patch.object(host_module.lock_root, 'migrate', side_effect=self.migrate_review))
        self.stack.enter_context(patch.object(host_module.lock_root, 'verify_review', return_value={'verified': True}))
        self.stack.enter_context(patch.object(host_module.maintenance, 'acquire', return_value={'mode': 'review-preserve'}))
        self.stack.enter_context(patch.object(host_module.maintenance, 'verify', return_value={'mode': 'review-preserve'}))
        self.stack.enter_context(patch.object(host_module.fence, 'seal', side_effect=self.seal))
        self.stack.enter_context(patch.object(host_module.fence, 'verify', side_effect=self.verify_fence))

    def command(self, args, *, input=None, check=True, timeout=30):
        if args == ['/usr/bin/crontab', '-l']:
            return types.SimpleNamespace(stdout=self.state['cron'])
        if args == ['/usr/bin/crontab', '-']:
            self.state['cron'] = input
            return types.SimpleNamespace(stdout='')
        if args[:2] == ['/bin/ps', '-axo']:
            script = self.state['adb_script']
            visible = self.state['old_process_visible'] or '/adb-host-stable/' in script
            return types.SimpleNamespace(stdout=('342 /usr/bin/python3 ' + script + ' run --config x\n')
                                         if self.state['adb_loaded'] and visible else '')
        if args[:2] == ['sudo', '-n'] and any('root-adb-write' in arg for arg in args):
            self.assertIn(args[-2], ('root-adb-write', 'root-adb-write-restore'))
            self.assertEqual(args[-1], self.transaction)
            data = json.loads(input)
            self.assertEqual(host_module.sha(self.plist.read_bytes()), data['old_sha256'])
            self.assertEqual(data['transaction'], self.transaction)
            self.plist.write_bytes(base64.b64decode(data['new_plist_b64']))
            return types.SimpleNamespace(stdout='')
        if 'status' in args and '--config' in args:
            script = plistlib.loads(self.plist.read_bytes())['ProgramArguments'][1]
            if '/adb-host-stable/' in script and self.state.get('stable_device_observations'):
                devices = self.state['stable_device_observations'].pop(0)
                return types.SimpleNamespace(stdout=json.dumps({'host_id': 'm4',
                    'endpoint': 'tcp:127.0.0.1:5037', 'port': 5037, 'devices': devices}))
            if '/adb-host-stable/' in script and self.state.get('transient_stable_status_failures', 0):
                self.state['transient_stable_status_failures'] -= 1
                raise subprocess.CalledProcessError(2, args)
            return types.SimpleNamespace(stdout=json.dumps({'host_id': 'm4', 'endpoint': 'tcp:127.0.0.1:5037',
                                                              'port': 5037, 'devices': [{'serial': 'SERIAL1', 'state': 'device'}]}))
        raise AssertionError(args)

    def socket_connect(self, address, timeout):
        self.assertEqual(address[0], '127.0.0.1')
        self.assertLessEqual(timeout, 1)
        if self.state.get('foreign_socket') or (address[1] == 5037 and self.state['adb_loaded']):
            return nullcontext()
        raise ConnectionRefusedError()

    def launch(self, action, *args, check=True, timeout=30):
        self.state['launches'].append(action)
        if action == 'print':
            loaded = self.state['adb_loaded']
            pending = self.state.get('unload_pending', 0)
            if pending:
                self.state['unload_pending'] -= 1
                if pending == 1:
                    self.state['adb_loaded'] = False
            arguments = plistlib.loads(self.plist.read_bytes())['ProgramArguments']
            arguments[1] = self.state['adb_script']
            return types.SimpleNamespace(returncode=0 if loaded else 1,
                                         stdout='\tprogram = ' + self.state.get('program_override', arguments[0]) + '\n\tstate = ' + ('SIGTERMed' if pending else 'running') + '\n\targuments = {\n\t\t' + '\n\t\t'.join(arguments) + '\n\t}\n',
                                         stderr='' if loaded else 'Could not find service')
        if action == 'bootout':
            if self.state.get('bootout_notfound_race'):
                self.state['bootout_notfound_race'] = False
                self.state['adb_loaded'] = False
                if check:
                    raise subprocess.CalledProcessError(113, 'launchctl bootout', stderr='Could not find service')
                return types.SimpleNamespace(returncode=113, stderr='Could not find service')
            self.state['unload_pending'] = self.state.get('bootout_lag', 0)
            if not self.state['unload_pending']:
                self.state['adb_loaded'] = False
        elif action == 'bootstrap':
            self.assertFalse(self.state['adb_loaded'], 'bootstrap must wait for complete unload')
            if self.state['fail_stable_bootstrap'] and b'adb-host-stable' in self.plist.read_bytes():
                self.state['fail_stable_bootstrap'] = False
                raise subprocess.CalledProcessError(1, 'launchctl bootstrap')
            self.state['adb_loaded'] = True
            self.state['adb_script'] = plistlib.loads(self.plist.read_bytes())['ProgramArguments'][1]
        else:
            raise AssertionError(action)
        return types.SimpleNamespace(returncode=0, stderr='')

    def recovery_state(self):
        return {'file': {'kind': 'file'}, 'disabled': self.state['recovery_disabled'],
                'loaded': self.state['recovery_loaded']}

    def prepare_recovery(self, path, after_file, get):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('{}')

    def suspend_recovery(self, path, get, set_disabled, set_loaded):
        self.state['recovery_disabled'] = True
        self.state['recovery_loaded'] = False

    def migrate_review(self, old, durable):
        durable.mkdir(parents=True)

    def seal(self, home, transaction):
        if self.state['fail_second_seal']:
            self.state['fail_second_seal'] = False
            raise OSError('interrupted second root')
        self.state['fence'] = True
        return {'state': 'sealed'}

    def verify_fence(self, home, transaction):
        if not self.state['fence']:
            raise ValueError('fence incomplete')
        return {'state': 'sealed'}

    def test_crash_replay_keeps_manifest_and_review_and_no_auto_entry(self):
        manifest = (self.home / 'bin-harvest/deployment-manifest.json').read_bytes()
        host = host_module.SafetyHost(self.home, self.transaction, self.sha, legacy_root=self.old)
        with self.assertRaisesRegex(OSError, 'second root'):
            host.run()
        self.assertEqual(host.journal['completed'], list(host_module.sequence.STEPS[:-1]))
        self.assertTrue(self.state['recovery_disabled'])
        self.assertFalse(self.state['recovery_loaded'])
        self.assertNotIn('harvest-cron.sh', self.state['cron'])
        self.assertEqual((self.home / 'bin-harvest/deployment-manifest.json').read_bytes(), manifest)
        resumed = host_module.SafetyHost(self.home, self.transaction, self.sha, legacy_root=self.old)
        result = resumed.run()
        self.assertTrue(result['secured'])
        self.assertEqual((self.home / 'bin-harvest/deployment-manifest.json').read_bytes(), manifest)
        self.assertEqual(resumed.journal['completed'], list(host_module.sequence.STEPS))

    def test_root_writer_rejects_unrecorded_stable_bytes_and_forged_journal(self):
        host = host_module.SafetyHost(self.home, self.transaction, self.sha, legacy_root=self.old)
        stable = Path(host.journal['adb_stable_dir'])
        stable.mkdir(parents=True)
        alternate = {name: b'altered ' + name.encode() for name in host.journal['adb_sources_b64']}
        for name, raw in alternate.items():
            (stable / name).write_bytes(raw)
        payload = {'old_sha256': host_module.sha(self.plist.read_bytes()),
                   'new_plist_b64': host.journal['adb_plist_after_b64'],
                   'account': 'service-user', 'transaction': self.transaction,
                   'source_hashes': {name: host_module.sha(raw) for name, raw in alternate.items()}}
        account = types.SimpleNamespace(pw_dir=str(self.home), pw_name='service-user', pw_uid=os.getuid())
        with patch.object(host_module.os, 'geteuid', return_value=0), \
             patch.object(host_module.pwd, 'getpwnam', return_value=account), \
             patch.object(host_module.sys, 'stdin', io.StringIO(json.dumps(payload))):
            with self.assertRaisesRegex(ValueError, 'ROOT_JOURNAL_SOURCE'):
                host_module.root_adb_write()
        record = json.loads(host.journal_path.read_text())
        record['adb_stable_dir'] = str(self.home / 'different')
        host.journal_path.write_text(json.dumps(record))
        with patch.object(host_module.os, 'geteuid', return_value=0), \
             patch.object(host_module.pwd, 'getpwnam', return_value=account), \
             patch.object(host_module.sys, 'stdin', io.StringIO(json.dumps(payload))):
            with self.assertRaisesRegex(ValueError, 'ROOT_JOURNAL_IDENTITY'):
                host_module.root_adb_write()

    def test_async_old_job_unload_must_finish_before_new_bootstrap(self):
        self.state['bootout_lag'] = 3
        self.state['fail_second_seal'] = False
        host = host_module.SafetyHost(self.home, self.transaction, self.sha, legacy_root=self.old)
        with patch.object(host_module.time, 'sleep', return_value=None):
            self.assertTrue(host.run()['secured'])
        self.assertIn('/adb-host-stable/', self.state['adb_script'])
        self.assertEqual(self.state['launches'].count('bootstrap'), 1)

    def test_restore_waits_for_async_stable_unload_before_old_bootstrap(self):
        self.state['bootout_lag'] = 3
        host = host_module.SafetyHost(self.home, self.transaction, self.sha, legacy_root=self.old)
        host.apply('close_review_cron')
        host.journal['completed'] = ['close_review_cron']
        stable = Path(host.journal['adb_stable_dir'])
        stable.mkdir(parents=True)
        for name, raw in host._stable_sources().items():
            (stable / name).write_bytes(raw)
        self.plist.write_bytes(host._new_adb())
        self.state['adb_script'] = str(stable / 'adb-host-service.py')
        with patch.object(host_module.time, 'sleep', return_value=None):
            host._restore_adb_prebarrier()
        self.assertEqual(self.plist.read_bytes(), host._old_adb())
        self.assertIn('/phone-candidates/', self.state['adb_script'])
        self.assertTrue(self.state['adb_loaded'])
        self.assertNotIn('harvest-cron.sh', self.state['cron'])

    def test_unknown_loaded_job_is_never_stopped_or_replaced(self):
        self.state['adb_script'] = '/unrelated/adb-host-service.py'
        host = host_module.SafetyHost(self.home, self.transaction, self.sha, legacy_root=self.old)
        with self.assertRaisesRegex(ValueError, 'SOURCE'):
            host.apply('relocate_adb')
        self.assertNotIn('bootout', self.state['launches'])
        self.assertNotIn('bootstrap', self.state['launches'])
        self.assertEqual(self.plist.read_bytes(), host._old_adb())
        records = list(host.folder.glob('adb-activation-*.json'))
        self.assertEqual(len(records), 1)
        self.assertIn('SOURCE_UNKNOWN', json.loads(records[0].read_bytes())['error'])

    def test_same_arguments_with_foreign_program_never_stops_unknown_manager(self):
        self.state['program_override'] = '/unrelated/python'
        host = host_module.SafetyHost(self.home, self.transaction, self.sha, legacy_root=self.old)
        with self.assertRaisesRegex(ValueError, 'SOURCE_UNKNOWN'):
            host.apply('relocate_adb')
        self.assertNotIn('bootout', self.state['launches'])
        self.assertNotIn('bootstrap', self.state['launches'])
        self.assertEqual(self.plist.read_bytes(), host._old_adb())

    def test_restore_does_not_accept_loaded_old_job_that_is_still_sigtermed(self):
        host = host_module.SafetyHost(self.home, self.transaction, self.sha, legacy_root=self.old)
        host.apply('close_review_cron')
        host.journal['completed'] = ['close_review_cron']
        self.state['unload_pending'] = 3
        with patch.object(host_module.time, 'sleep', return_value=None):
            host._restore_adb_prebarrier()
        self.assertTrue(self.state['adb_loaded'])
        self.assertEqual(self.state['launches'].count('bootstrap'), 1)
        self.assertEqual(self.state['unload_pending'], 0)

    def test_bootout_notfound_race_requires_absence_readback_before_bootstrap(self):
        self.state['bootout_notfound_race'] = True
        self.state['fail_second_seal'] = False
        host = host_module.SafetyHost(self.home, self.transaction, self.sha, legacy_root=self.old)
        self.assertTrue(host.run()['secured'])
        self.assertEqual(self.state['launches'].count('bootstrap'), 1)
        self.assertIn('/adb-host-stable/', self.state['adb_script'])

    def test_quiescence_exhaustion_is_bounded_and_cannot_write_or_bootstrap(self):
        self.state['foreign_socket'] = True
        host = host_module.SafetyHost(self.home, self.transaction, self.sha, legacy_root=self.old)
        clock = {'now': 0.0}
        def advance(seconds):
            clock['now'] += seconds
        with patch.object(host_module.time, 'monotonic', side_effect=lambda: clock['now']), \
             patch.object(host_module.time, 'sleep', side_effect=advance):
            with self.assertRaisesRegex(ValueError, 'QUIESCENCE'):
                host.apply('relocate_adb')
        self.assertLessEqual(clock['now'], 20)
        self.assertEqual(self.plist.read_bytes(), host._old_adb())
        self.assertNotIn('bootstrap', self.state['launches'])
        records = [json.loads(p.read_bytes()) for p in host.folder.glob('adb-quiescence-*.json')]
        self.assertEqual(records[0]['phase'], 'relocate')
        self.assertFalse(records[0]['verified'])

    def test_notfound_bootout_without_absence_readback_cannot_proceed(self):
        host = host_module.SafetyHost(self.home, self.transaction, self.sha, legacy_root=self.old)
        def still_loaded(action, *args, check=True, timeout=30):
            if action == 'bootout':
                self.state['launches'].append(action)
                return types.SimpleNamespace(returncode=113, stderr='Could not find service')
            return self.launch(action, *args, check=check, timeout=timeout)
        with patch.object(host_module, 'launch', side_effect=still_loaded):
            with self.assertRaisesRegex(ValueError, 'BOOTOUT_UNKNOWN'):
                host.apply('relocate_adb')
        self.assertNotIn('bootstrap', self.state['launches'])
        self.assertEqual(self.plist.read_bytes(), host._old_adb())

    def test_initial_identity_probe_is_included_in_quiescence_deadline(self):
        self.state['foreign_socket'] = True
        host = host_module.SafetyHost(self.home, self.transaction, self.sha, legacy_root=self.old)
        clock = {'now': 0.0}
        def advance(seconds):
            clock['now'] += seconds
        def slow_launch(action, *args, check=True, timeout=30):
            if action == 'print':
                advance(min(2, timeout))
            return self.launch(action, *args, check=check, timeout=timeout)
        with patch.object(host_module.time, 'monotonic', side_effect=lambda: clock['now']), \
             patch.object(host_module.time, 'sleep', side_effect=advance), \
             patch.object(host_module, 'launch', side_effect=slow_launch):
            with self.assertRaisesRegex(ValueError, 'QUIESCENCE'):
                host.apply('relocate_adb')
        self.assertLessEqual(clock['now'], 20)
        self.assertNotIn('bootstrap', self.state['launches'])

    def test_foreign_socket_is_not_killed_or_bootstrapped_over(self):
        self.state['foreign_socket'] = True
        host = host_module.SafetyHost(self.home, self.transaction, self.sha, legacy_root=self.old)
        with patch.object(host_module.time, 'sleep', return_value=None):
            with self.assertRaisesRegex(ValueError, 'QUIESCENCE'):
                host.apply('relocate_adb')
        self.assertNotIn('bootstrap', self.state['launches'])
        self.assertEqual(self.plist.read_bytes(), host._old_adb())

    def test_adb_bootstrap_failure_restores_old_plist_and_service_with_cron_closed(self):
        original = self.plist.read_bytes()
        self.state['fail_stable_bootstrap'] = True
        host = host_module.SafetyHost(self.home, self.transaction, self.sha, legacy_root=self.old)
        with self.assertRaises(subprocess.CalledProcessError):
            host.run()
        self.assertEqual(self.plist.read_bytes(), original)
        self.assertTrue(self.state['adb_loaded'])
        self.assertNotIn('harvest-cron.sh', self.state['cron'])
        self.assertEqual(host.journal['completed'], ['close_review_cron'])
        self.assertFalse(self.state['recovery_disabled'])

    def test_restore_does_not_claim_success_if_old_daemon_has_no_process(self):
        self.state['fail_stable_bootstrap'] = True
        self.state['old_process_visible'] = False
        host = host_module.SafetyHost(self.home, self.transaction, self.sha, legacy_root=self.old)
        with self.assertRaisesRegex(ValueError, 'RESTORE_ADB_FAILED'):
            host.run()
        self.assertNotIn('harvest-cron.sh', self.state['cron'])

    def test_transient_adb_status_after_bootstrap_retries_before_success(self):
        self.state['transient_stable_status_failures'] = 1
        self.state['fail_second_seal'] = False
        host = host_module.SafetyHost(self.home, self.transaction, self.sha, legacy_root=self.old)
        result = host.run()
        self.assertTrue(result['secured'])
        self.assertEqual(host.journal['completed'], list(host_module.sequence.STEPS))
        self.assertEqual(self.state['transient_stable_status_failures'], 0)

    def test_persistent_adb_status_failure_keeps_cron_closed_and_old_service(self):
        self.state['transient_stable_status_failures'] = 100
        self.state['fail_second_seal'] = False
        host = host_module.SafetyHost(self.home, self.transaction, self.sha, legacy_root=self.old)
        with patch.object(host_module.time, 'sleep', return_value=None):
            with self.assertRaisesRegex(ValueError, 'maintenance-only step not independently verified: relocate_adb'):
                host.run()
        self.assertEqual(host.journal['completed'], ['close_review_cron'])
        self.assertNotIn('harvest-cron.sh', self.state['cron'])
        self.assertIn('/phone-candidates/', plistlib.loads(self.plist.read_bytes())['ProgramArguments'][1])

    def test_usb_enumeration_can_finish_after_first_successful_status(self):
        self.state['stable_device_observations'] = [[], [{'serial': 'SERIAL1', 'state': 'offline'}]]
        self.state['fail_second_seal'] = False
        host = host_module.SafetyHost(self.home, self.transaction, self.sha, legacy_root=self.old)
        with patch.object(host_module.time, 'sleep', return_value=None):
            self.assertTrue(host.run()['secured'])
        self.assertEqual(self.state['stable_device_observations'], [])
        self.assertEqual(host.journal['completed'], list(host_module.sequence.STEPS))

    def test_missing_usb_device_never_advances_and_restores_old_service(self):
        self.state['stable_device_observations'] = [[] for _ in range(100)]
        host = host_module.SafetyHost(self.home, self.transaction, self.sha, legacy_root=self.old)
        with patch.object(host_module.time, 'sleep', return_value=None):
            with self.assertRaisesRegex(ValueError, 'step not independently verified: relocate_adb'):
                host.run()
        self.assertEqual(host.journal['completed'], ['close_review_cron'])
        self.assertNotIn('harvest-cron.sh', self.state['cron'])
        self.assertIn('/phone-candidates/', plistlib.loads(self.plist.read_bytes())['ProgramArguments'][1])
        records = [json.loads(p.read_text()) for p in host.folder.glob('adb-readiness-*.json')]
        self.assertGreaterEqual(len(records), 2)
        self.assertTrue(all(p.stat().st_mode & 0o777 == 0o600
                            for p in host.folder.glob('adb-readiness-*.json')))
        self.assertTrue(any(r['reason'] == 'readiness_exhausted' and not r['verified']
                            and r['observations'][-1]['devices'] == [] for r in records))

    def test_health_timeout_consumes_remaining_budget_without_unbounded_polling(self):
        host = host_module.SafetyHost(self.home, self.transaction, self.sha, legacy_root=self.old)
        script = Path(plistlib.loads(self.plist.read_bytes())['ProgramArguments'][1])
        clock = {'now': 0.0}

        def timed_out(script, python_bin, *, timeout=10):
            clock['now'] += timeout
            raise subprocess.TimeoutExpired('read-only status', timeout)

        def advance(seconds):
            clock['now'] += seconds

        with patch.object(host_module.time, 'monotonic', side_effect=lambda: clock['now']), \
             patch.object(host_module.time, 'sleep', side_effect=advance), \
             patch.object(host, '_adb_health', side_effect=timed_out):
            self.assertFalse(host._adb_process_matches(script))
        self.assertLessEqual(clock['now'], 20)
        records = [json.loads(p.read_text()) for p in host.folder.glob('adb-readiness-*.json')]
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]['reason'], 'readiness_exhausted')
        self.assertTrue(any(o.get('error_class') == 'TimeoutExpired' for o in records[0]['observations']))

    def test_wrong_adb_host_identity_cannot_pass_with_complete_devices(self):
        host = host_module.SafetyHost(self.home, self.transaction, self.sha, legacy_root=self.old)
        script = Path(plistlib.loads(self.plist.read_bytes())['ProgramArguments'][1])
        wrong = {'host_id': 'other-host', 'endpoint': 'tcp:127.0.0.1:5037', 'port': 5037,
                 'devices': [{'serial': 'SERIAL1', 'state': 'device'}]}
        with patch.object(host, '_adb_health', return_value=wrong):
            self.assertFalse(host._adb_process_matches(script))
        records = [json.loads(p.read_text()) for p in host.folder.glob('adb-readiness-*.json')]
        self.assertEqual(records[0]['reason'], 'host_identity_mismatch')

    def test_invalid_health_response_records_failure_before_restore(self):
        host = host_module.SafetyHost(self.home, self.transaction, self.sha, legacy_root=self.old)
        script = Path(plistlib.loads(self.plist.read_bytes())['ProgramArguments'][1])
        with patch.object(host, '_adb_health', side_effect=ValueError('malformed response')):
            self.assertFalse(host._adb_process_matches(script))
        records = [json.loads(p.read_text()) for p in host.folder.glob('adb-readiness-*.json')]
        self.assertEqual(records[0]['reason'], 'health_response_invalid')
        self.assertEqual(records[0]['observations'][0]['error_class'], 'ValueError')

    def test_invalid_json_shapes_from_real_status_handler_are_recorded(self):
        host = host_module.SafetyHost(self.home, self.transaction, self.sha, legacy_root=self.old)
        script = Path(plistlib.loads(self.plist.read_bytes())['ProgramArguments'][1])
        for value in (None, [], {'host_id': 'm4', 'endpoint': 'tcp:127.0.0.1:5037',
                                'port': 5037, 'devices': [None]}):
            with self.subTest(value=value):
                def boundary(args, **kwargs):
                    if 'status' in args:
                        return types.SimpleNamespace(stdout=json.dumps(value))
                    return self.command(args, **kwargs)
                with patch.object(host_module, 'command', side_effect=boundary):
                    self.assertFalse(host._adb_process_matches(script))
        records = [json.loads(p.read_text()) for p in host.folder.glob('adb-readiness-*.json')]
        self.assertEqual(len(records), 3)
        self.assertTrue(all(r['reason'] == 'health_response_invalid' for r in records))

    def test_root_writer_rejects_wrong_plist_permissions_before_mutation(self):
        host = host_module.SafetyHost(self.home, self.transaction, self.sha, legacy_root=self.old)
        stable = Path(host.journal['adb_stable_dir'])
        stable.mkdir(parents=True)
        sources = host._stable_sources()
        for name, raw in sources.items():
            (stable / name).write_bytes(raw)
        original = self.plist.read_bytes()
        self.plist.chmod(0o600)
        payload = {'old_sha256': host_module.sha(original),
                   'new_plist_b64': host.journal['adb_plist_after_b64'],
                   'account': 'service-user', 'transaction': self.transaction,
                   'source_hashes': {name: host_module.sha(raw) for name, raw in sources.items()}}
        account = types.SimpleNamespace(pw_dir=str(self.home), pw_name='service-user', pw_uid=os.getuid())
        with patch.object(host_module.os, 'geteuid', return_value=0), \
             patch.object(host_module.pwd, 'getpwnam', return_value=account), \
             patch.object(host_module.sys, 'stdin', io.StringIO(json.dumps(payload))):
            with self.assertRaisesRegex(ValueError, 'ROOT_PLIST_PERMISSIONS'):
                host_module.root_adb_write()
        self.assertEqual(self.plist.read_bytes(), original)

    def test_outreach_comment_without_canonical_exit_guard_is_not_retired(self):
        script = self.home / 'bin-harvest/outreach-tick.sh'
        script.write_text('legacy_outreach_canonical="$HOME/bin-harvest"\n'
                          '# OUTREACH_TICK_RETIRED someday\nC=~/.local/bin/douyin-phone-adb\n')
        with self.assertRaisesRegex(ValueError, 'retired guard'):
            host_module.SafetyHost(self.home, self.transaction, self.sha, legacy_root=self.old)


if __name__ == '__main__':
    unittest.main()

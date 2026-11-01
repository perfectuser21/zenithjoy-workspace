#!/usr/bin/env python3
"""M4 safety-only install: freeze review evidence and old automatic entries without business release writes."""

import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import pwd
import re
import stat
import subprocess
import sys
import time


HERE = Path(__file__).resolve().parent
ADB_LABEL = 'com.zenithjoy.adb-host'
ADB_PLIST = Path('/Library/LaunchDaemons') / (ADB_LABEL + '.plist')
RECOVERY_LABEL = 'com.zenithjoy.phonerecovery'


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


tx = load('phone_tx', 'deployment-transaction.py')
lock_root = load('phone_root', 'phone-lock-root.py')
maintenance = load('phone_maintenance', 'deployment-maintenance.py')
recovery = load('phone_recovery_service', 'deployment-service.py')
fence = load('phone_candidate_fence', 'deployment-candidate-fence.py')
window = load('phone_maintenance_window', 'maintenance-install-window.py')
sequence = load('phone_maintenance_sequence', 'maintenance-install-transaction.py')


def require(ok, reason):
    if not ok:
        raise ValueError('MAINTENANCE_ONLY_' + reason)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def command(argv, *, input=None, check=True, timeout=30):
    return subprocess.run(argv, input=input, text=True,
                          capture_output=True, check=check, timeout=timeout)


def launch(*args, check=True):
    return command(['sudo', '-n', '/bin/launchctl', *args], check=check)


def cron_raw():
    return command(['/usr/bin/crontab', '-l']).stdout


def process_table():
    return command(['/bin/ps', '-axo', 'pid=,command=']).stdout


def root_adb_write(restore=False):
    require(os.geteuid() == 0, 'ROOT_WRITER_REQUIRED')
    data = json.load(sys.stdin)
    require(set(data) == {'old_sha256', 'new_plist_b64', 'account', 'source_hashes', 'transaction'}, 'ROOT_INPUT_SHAPE')
    account = pwd.getpwnam(data['account'])
    journal_path = Path(account.pw_dir) / '.config/zenithjoy/maintenance-only' / data['transaction'] / 'journal.json'
    tx.safe_path(Path(account.pw_dir), str(journal_path.relative_to(account.pw_dir)))
    journal = json.loads(tx.regular(journal_path)[0])
    digest = journal.pop('sha256', None)
    require(digest == tx.digest(tx.canonical(journal)) and
            journal.get('transaction') == data['transaction'] and journal.get('home') == account.pw_dir and
            re.fullmatch(r'[a-f0-9]{40}', journal.get('source_commit', '')) and
            data['transaction'] == 'phone-safety-' + journal['source_commit'][:24], 'ROOT_JOURNAL_IDENTITY')
    if restore:
        require(journal.get('completed', []) in ([], ['close_review_cron'],
                ['close_review_cron', 'relocate_adb']), 'ROOT_RESTORE_AFTER_BARRIER')
    expected_before = base64.b64decode(journal['adb_plist_after_b64' if restore else 'adb_plist_before_b64'], validate=True)
    expected_after = base64.b64decode(journal['adb_plist_before_b64' if restore else 'adb_plist_after_b64'], validate=True)
    require(data['old_sha256'] == sha(expected_before) and
            base64.b64decode(data['new_plist_b64'], validate=True) == expected_after,
            'ROOT_JOURNAL_PLIST_MISMATCH')
    recorded = {name: sha(base64.b64decode(raw, validate=True))
                for name, raw in journal['adb_sources_b64'].items()}
    require(set(recorded) == {'adb-host-service.py', 'adb-existing-route.py'} and
            data['source_hashes'] == recorded, 'ROOT_JOURNAL_SOURCE')
    old = ADB_PLIST.read_bytes()
    require(sha(old) == data['old_sha256'], 'ROOT_PLIST_CAS')
    new = base64.b64decode(data['new_plist_b64'], validate=True)
    require(len(new) < 65536, 'ROOT_PLIST_SIZE')
    before, after = plistlib.loads(old), plistlib.loads(new)
    require(before.get('Label') == after.get('Label') == ADB_LABEL and
            before.get('UserName') == after.get('UserName') == data['account'], 'ROOT_PLIST_IDENTITY')
    bargs, aargs = before.get('ProgramArguments'), after.get('ProgramArguments')
    require(isinstance(bargs, list) and len(bargs) == 5 and isinstance(aargs, list) and
            len(aargs) == 5 and bargs[:1] == aargs[:1] and bargs[2:] == aargs[2:] and
            {**before, 'ProgramArguments': aargs} == after, 'ROOT_PLIST_ONLY_SCRIPT_PATH')
    target = Path(aargs[1])
    stable = Path(account.pw_dir) / '.config/zenithjoy/adb-host-stable'
    candidates = Path(account.pw_dir) / '.local/share/zenithjoy/phone-candidates'
    source = Path(bargs[1])
    require(target.name == source.name == 'adb-host-service.py' and
            (candidates in target.parents if restore else candidates in source.parents) and
            (stable in source.parents if restore else stable in target.parents) and
            journal['adb_stable_dir'] == str(source.parent if restore else target.parent),
            'ROOT_SCRIPT_DIRECTION')
    require(target.is_file() and target.stat().st_uid == account.pw_uid, 'ROOT_SOURCE_MISSING')
    tx.safe_path(Path(account.pw_dir), str(target.relative_to(account.pw_dir)))
    require(set(data['source_hashes']) == {'adb-host-service.py', 'adb-existing-route.py'} and
            all(re.fullmatch('[a-f0-9]{64}', digest) and
                sha(tx.regular((source if restore else target).parent / name)[0]) == digest
                for name, digest in data['source_hashes'].items()), 'ROOT_STABLE_BYTES')
    require(stat.S_IMODE(ADB_PLIST.stat().st_mode) == 0o644 and ADB_PLIST.stat().st_uid == 0,
            'ROOT_PLIST_PERMISSIONS')
    fd, temp = __import__('tempfile').mkstemp(prefix='.adb-host-', dir=ADB_PLIST.parent)
    try:
        with os.fdopen(fd, 'wb') as out:
            out.write(new)
            out.flush()
            os.fchown(out.fileno(), 0, 0)
            os.fchmod(out.fileno(), 0o644)
            os.fsync(out.fileno())
        require(sha(ADB_PLIST.read_bytes()) == data['old_sha256'], 'ROOT_PLIST_CAS')
        os.replace(temp, ADB_PLIST)
        tx.sync_directory(ADB_PLIST.parent)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)
    require(ADB_PLIST.read_bytes() == new, 'ROOT_PLIST_READBACK')


class SafetyHost:
    def __init__(self, home, transaction, source_commit, *, legacy_root=Path('/private/tmp/openclaw-phone/locks')):
        self.home = Path(home)
        require(re.fullmatch(r'[a-f0-9]{40}', source_commit or '') and
                transaction == 'phone-safety-' + source_commit[:24], 'IDENTITY')
        require(self.home == Path(pwd.getpwuid(os.geteuid()).pw_dir).resolve() and
                not self.home.is_symlink() and os.geteuid() != 0, 'SYSTEM_ACCOUNT')
        self.transaction, self.source_commit = transaction, source_commit
        self.folder = self.home / '.config/zenithjoy/maintenance-only' / transaction
        self.journal_path = self.folder / 'journal.json'
        self.legacy = Path(legacy_root)
        self.durable = self.home / '.local/share/zenithjoy/phone-locks'
        self.registry = self.home / '.config/openclaw/douyin-phone-profiles.tsv'
        self.manifest = self.home / 'bin-harvest/deployment-manifest.json'
        self.service_journal = tx.transaction_directory(self.home, transaction) / 'service.json'
        self.journal = self._open_journal()

    def _read_journal(self):
        value = json.loads(tx.regular(self.journal_path)[0])
        digest = value.pop('sha256', None)
        require(digest == tx.digest(tx.canonical(value)), 'JOURNAL_DIGEST')
        require(value.get('transaction') == self.transaction and value.get('source_commit') == self.source_commit and
                value.get('home') == str(self.home), 'JOURNAL_IDENTITY')
        return value

    def _save(self, value):
        record = {**value, 'sha256': tx.digest(tx.canonical(value))}
        tx.atomic_bytes(self.journal_path, tx.canonical(record))

    def _open_journal(self):
        active = tx.active_file(self.home)
        if self.journal_path.exists():
            journal = self._read_journal()
            if not active.exists() and not active.is_symlink() and not journal['completed']:
                tx.durable_mkdir(active.parent)
                fd = os.open(active, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                with os.fdopen(fd, 'wb') as out:
                    out.write(tx.canonical({'transaction': self.transaction}))
                    out.flush()
                    os.fsync(out.fileno())
                tx.sync_directory(active.parent)
            tx.owned(self.home, self.transaction)
            return journal
        require(not active.exists() and not active.is_symlink(), 'OTHER_TRANSACTION_PENDING')
        require(self.manifest.is_file(), 'PRODUCTION_MANIFEST_MISSING')
        before_manifest = sha(tx.regular(self.manifest)[0])
        owners = sorted(self.legacy.glob('*.lock'))
        require(owners, 'REVIEW_OWNERS_MISSING')
        serials = []
        for owner in owners:
            require(owner.is_dir() and not owner.is_symlink() and
                    (self.legacy / (owner.stem + '.guard')).is_file(), 'REVIEW_OWNER_INVALID')
            require(tx.regular(owner / 'owner')[0] == tx.regular(owner / 'standalone_review_required')[0],
                    'REVIEW_MARKER_INVALID')
            serials.append(owner.stem)
        cron_before = cron_raw()
        retired = self._outreach_retired()
        cron_after, removed = window.select_cron(cron_before, set(serials), outreach_retired=retired)
        require(len(removed) == 6, 'REVIEW_CRON_COUNT_CHANGED')
        adb_before = tx.regular(ADB_PLIST)[0]
        plist = plistlib.loads(adb_before)
        user = pwd.getpwuid(os.geteuid())
        require(plist.get('Label') == ADB_LABEL and plist.get('UserName') == user.pw_name and
                plist.get('KeepAlive') is True, 'ADB_PLIST_IDENTITY')
        args = plist.get('ProgramArguments')
        require(isinstance(args, list) and len(args) == 5 and
                '/phone-candidates/' in args[1] and args[1].startswith(str(self.home) + '/'),
                'ADB_CANDIDATE_SOURCE')
        old_dir = Path(args[1]).parent
        old_source = {name: tx.regular(old_dir / name)[0] for name in ('adb-host-service.py', 'adb-existing-route.py')}
        adb_health_before = self._adb_health(old_dir / 'adb-host-service.py', args[0])
        stable = self.home / '.config/zenithjoy/adb-host-stable' / sha(old_source['adb-host-service.py'])[:16]
        window.verify_adb_relocation(old_source, old_source, str(stable / 'adb-host-service.py'),
                                     str(self.home / '.local/share/zenithjoy/phone-candidates'))
        new_plist = plistlib.dumps({**plist, 'ProgramArguments': [args[0], str(stable / 'adb-host-service.py'), *args[2:]]})
        journal = {'schema_version': 1, 'transaction': self.transaction, 'source_commit': self.source_commit,
                   'home': str(self.home), 'completed': [], 'manifest_sha256': before_manifest,
                   'review_serials': serials, 'cron_before': cron_before, 'cron_after': cron_after,
                   'cron_removed': removed, 'outreach_sha256': sha((self.home / 'bin-harvest/outreach-tick.sh').read_bytes()),
                   'adb_plist_before_b64': base64.b64encode(adb_before).decode(),
                   'adb_plist_after_b64': base64.b64encode(new_plist).decode(),
                   'adb_health_before': adb_health_before,
                   'adb_python': args[0],
                   'adb_sources_b64': {name: base64.b64encode(raw).decode() for name, raw in old_source.items()},
                   'adb_stable_dir': str(stable)}
        tx.durable_mkdir(self.folder)
        self._save(journal)
        tx.durable_mkdir(active.parent)
        fd = os.open(active, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as out:
            out.write(tx.canonical({'transaction': self.transaction}))
            out.flush()
            os.fsync(out.fileno())
        tx.sync_directory(active.parent)
        return journal

    def _outreach_retired(self):
        path = self.home / 'bin-harvest/outreach-tick.sh'
        raw = tx.regular(path)[0]
        canonical = raw.find(b'legacy_outreach_canonical="$HOME/bin-harvest"')
        guard = raw.find(b'if [[ "${0:A:h}" == "${legacy_outreach_canonical:A}" ]]; then')
        marker = raw.find(b'OUTREACH_TICK_RETIRED')
        retired_exit = raw.find(b'\n  exit 1\nfi\n', marker)
        action = raw.find(b'C=~/.local/bin/douyin-phone-adb')
        return 0 <= canonical < guard < marker < retired_exit < action

    def _old_adb(self):
        return base64.b64decode(self.journal['adb_plist_before_b64'], validate=True)

    def _new_adb(self):
        return base64.b64decode(self.journal['adb_plist_after_b64'], validate=True)

    def _adb_loaded(self):
        result = launch('print', 'system/' + ADB_LABEL, check=False)
        require(result.returncode == 0 or 'Could not find service' in result.stderr,
                'ADB_SERVICE_STATE_UNKNOWN')
        return result.returncode == 0

    def _stable_sources(self):
        return {name: base64.b64decode(raw, validate=True)
                for name, raw in self.journal['adb_sources_b64'].items()}

    def _adb_health(self, script, python_bin):
        config = self.home / '.config/zenithjoy/adb-service.json'
        result = command([python_bin, str(script), 'status', '--config', str(config)], timeout=10)
        value = json.loads(result.stdout)
        require(value.get('port') == 5037 and isinstance(value.get('devices'), list) and
                isinstance(value.get('host_id'), str) and value['host_id'], 'ADB_HEALTH_INVALID')
        return value

    def _adb_process_matches(self, script):
        for _ in range(20):
            rows = [line for line in process_table().splitlines()
                    if str(script) in line and ' run ' in line]
            if len(rows) == 1:
                try:
                    observed = self._adb_health(script, self.journal['adb_python'])
                except subprocess.CalledProcessError:
                    # The service process can appear before its ADB server answers status.
                    time.sleep(.25)
                    continue
                previous = self.journal['adb_health_before']
                before_devices = {row['serial'] for row in previous['devices'] if row.get('state') == 'device'}
                after_devices = {row['serial'] for row in observed['devices'] if row.get('state') == 'device'}
                return (all(observed.get(key) == previous.get(key) for key in ('host_id', 'endpoint', 'port'))
                        and before_devices <= after_devices)
            time.sleep(.25)
        return False

    def _root_adb_change(self, current, *, restore=False):
        payload = {'old_sha256': sha(current),
                   'new_plist_b64': self.journal['adb_plist_before_b64' if restore else 'adb_plist_after_b64'],
                   'account': pwd.getpwuid(os.geteuid()).pw_name,
                   'source_hashes': {name: sha(raw) for name, raw in self._stable_sources().items()},
                   'transaction': self.transaction}
        command(['sudo', '-n', '/usr/bin/python3', str(HERE / 'maintenance-install-host.py'),
                 'root-adb-write-restore' if restore else 'root-adb-write', self.transaction],
                input=json.dumps(payload))

    def _restore_adb_prebarrier(self):
        require(self.journal['completed'] == ['close_review_cron'], 'RESTORE_AFTER_BARRIER')
        state = recovery.service_state()
        require(state['disabled'] is False and state['loaded'] is True, 'RESTORE_RECOVERY_CHANGED')
        current = tx.regular(ADB_PLIST)[0]
        require(current in (self._old_adb(), self._new_adb()), 'RESTORE_PLIST_CONFLICT')
        if current == self._new_adb():
            if self._adb_loaded():
                launch('bootout', 'system/' + ADB_LABEL)
            self._root_adb_change(current, restore=True)
        if not self._adb_loaded():
            launch('bootstrap', 'system', str(ADB_PLIST))
        old_script = plistlib.loads(self._old_adb())['ProgramArguments'][1]
        require(tx.regular(ADB_PLIST)[0] == self._old_adb() and self._adb_loaded() and
                self._adb_process_matches(Path(old_script)),
                'RESTORE_ADB_FAILED')
        # Keep six harvest cron entries closed; this is service recovery, not a business reopen.
        require(cron_raw() == self.journal['cron_after'], 'RESTORE_CRON_CHANGED')

    def apply(self, name):
        if name == 'close_review_cron':
            current = cron_raw()
            require(current in (self.journal['cron_before'], self.journal['cron_after']), 'CRON_CONFLICT')
            if current != self.journal['cron_after']:
                command(['/usr/bin/crontab', '-'], input=self.journal['cron_after'])
        elif name == 'relocate_adb':
            stable = Path(self.journal['adb_stable_dir'])
            tx.safe_path(self.home, str(stable.relative_to(self.home)))
            tx.durable_mkdir(stable)
            for filename, raw in self._stable_sources().items():
                path = stable / filename
                if path.exists():
                    require(tx.regular(path)[0] == raw, 'ADB_STABLE_BYTES_CONFLICT')
                else:
                    tx.atomic_bytes(path, raw)
            window.verify_adb_relocation(self._stable_sources(),
                                         {name: tx.regular(stable / name)[0] for name in self._stable_sources()},
                                         str(stable / 'adb-host-service.py'),
                                         str(self.home / '.local/share/zenithjoy/phone-candidates'))
            current = tx.regular(ADB_PLIST)[0]
            require(current in (self._old_adb(), self._new_adb()), 'ADB_PLIST_CONFLICT')
            if current == self._old_adb():
                if self._adb_loaded():
                    launch('bootout', 'system/' + ADB_LABEL)
                self._root_adb_change(current)
            if not self._adb_loaded():
                launch('bootstrap', 'system', str(ADB_PLIST))
        elif name == 'disable_recovery':
            state = recovery.service_state()
            recovery.prepare(self.service_journal, state['file'], recovery.service_state)
            recovery.suspend_review(self.service_journal, recovery.service_state,
                                    recovery.cli_disabled, recovery.cli_loaded)
        elif name == 'migrate_review':
            self._assert_auto_closed()
            if not self.durable.exists():
                lock_root.migrate(self.legacy, self.durable)
            lock_root.verify_review(self.legacy, self.durable)
            maintenance.acquire(self.home, self.transaction, self.registry, self.durable)
        elif name == 'seal_candidates':
            self._assert_auto_closed()
            fence.seal(self.home, self.transaction)
        else:
            raise ValueError('MAINTENANCE_ONLY_UNKNOWN_STEP')

    def _assert_auto_closed(self):
        state = recovery.service_state()
        window.verify_automatic_quiescence(cron_raw(), set(self.journal['review_serials']),
                                            recovery_disabled=state['disabled'], recovery_loaded=state['loaded'],
                                            process_table=process_table())

    def verify(self, name):
        require(sha(tx.regular(self.manifest)[0]) == self.journal['manifest_sha256'],
                'PRODUCTION_MANIFEST_CHANGED')
        if name == 'close_review_cron':
            return cron_raw() == self.journal['cron_after']
        if name == 'relocate_adb':
            stable = Path(self.journal['adb_stable_dir'])
            if tx.regular(ADB_PLIST)[0] != self._new_adb() or not self._adb_loaded():
                return False
            window.verify_adb_relocation(self._stable_sources(),
                                         {filename: tx.regular(stable / filename)[0] for filename in self._stable_sources()},
                                         str(stable / 'adb-host-service.py'),
                                         str(self.home / '.local/share/zenithjoy/phone-candidates'))
            # LaunchDaemon must actually run from the new stable byte-identical source.
            return self._adb_process_matches(stable / 'adb-host-service.py')
        if name == 'disable_recovery':
            state = recovery.service_state()
            return state['disabled'] is True and state['loaded'] is False
        if name == 'migrate_review':
            result = lock_root.verify_review(self.legacy, self.durable)
            admission = maintenance.verify(self.home, self.transaction, self.registry, self.durable)
            self._assert_auto_closed()
            return result['verified'] is True and admission['mode'] == 'review-preserve'
        if name == 'seal_candidates':
            self._assert_auto_closed()
            return fence.verify(self.home, self.transaction)['state'] == 'sealed'
        raise ValueError('MAINTENANCE_ONLY_UNKNOWN_STEP')

    def run(self):
        try:
            sequence.run_steps(self.apply, self.verify, self.journal, record=self._save)
        except Exception:
            if self.journal['completed'] == ['close_review_cron']:
                self._restore_adb_prebarrier()
            raise
        for step in sequence.STEPS:
            require(self.verify(step) is True, 'FINAL_PROOF_'+step)
        return {'transaction': self.transaction, 'source_commit': self.source_commit,
                'secured': True, 'review_serials': self.journal['review_serials'],
                'production_manifest_sha256': self.journal['manifest_sha256'],
                'old_candidate_direct_call': 'remains possible during two-root exchange; auto entries closed'}


if __name__ == '__main__':
    try:
        require(len(sys.argv) == 3, 'ARGUMENTS')
        action, transaction = sys.argv[1:3]
        if action in ('root-adb-write', 'root-adb-write-restore'):
            require(re.fullmatch(r'phone-safety-[a-f0-9]{24}', transaction), 'ROOT_TRANSACTION')
            root_adb_write(restore=action == 'root-adb-write-restore')
        elif action in ('install', 'recover'):
            value = json.load(sys.stdin)
            host = SafetyHost(Path(pwd.getpwuid(os.geteuid()).pw_dir).resolve(),
                              transaction, value['source_commit'])
            print(json.dumps(host.run(), sort_keys=True))
        else:
            raise ValueError('MAINTENANCE_ONLY_INVALID_ACTION')
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)

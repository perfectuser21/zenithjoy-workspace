#!/usr/bin/env python3
"""Exact historical preflight quarantine supersession; never old execution recovery.

The unknown remote operation is only the pinned, fixed read-only SDK query.
Closed original caller/producer domains have no Worker or later write capability.
This noninterference authority preserves stopped=false and all original bytes.
No phone, central write, old-run resume or generic unknown-stop exception.
"""
import contextlib
import fcntl
import hashlib
import http.client
import types
import io
import json
import os
from pathlib import Path
import pwd
import re
import stat
import sys
import tarfile
import subprocess

TASK = 'c4bab9ac-d487-4689-a26d-cf169066ec07'
FIX_TASK = '85d0e7ee-e7e3-49d0-a0e7-9fd68827aca7'
CLAIM = {'claimed_by': 'codex-cloud7-nonreplay-authority', 'claimed_at': '2026-11-07T19:33:17.015Z'}
COMMIT = '69c40526d2ba0ecffae10b566bb5e10b707e1268'
TAG = 'potato20261107_101_cloud7'
RUN = 'douyin_video_discovery-' + TAG + '__a1'
BINDING = '5d2a142a-04b7-4583-96eb-4e3c9a99e422'
EPOCH = '37802167-65cf-47ca-a7ce-d6bf086d9907'
SERIAL = '47.100.213.173:10001'
IDENTITY = dict(task_id=TASK, run_id=RUN, binding_id=BINDING, source_commit=COMMIT,
                profile='cloud-phone-test', serial=SERIAL, owner=TAG, epoch=EPOCH)
SUCCESSOR = dict(run_tag='potato20261107_101_cloud8', workflow_key='douyin_video_discovery',
                 host='mmv', broker_host='mmv', profile='cloud-phone-test', serial=SERIAL,
                 adb_endpoint='tcp:127.0.0.1:5041', expected_account='77980009922', line='yuesheng')
LOCK_FIELDS = dict(owner=TAG, preflight_epoch=EPOCH, preflight_proof_required=EPOCH,
                   standalone_review_required=TAG, preflight_quarantined=EPOCH, acquired_at='1794075630')
PROTOCOL = 'cloud7-preflight-sdk-quarantine-supersession/v1'
MAX_FILE = 32 * 1024 * 1024
PINS = {'manifest': 'c8365c09cdabc000a41d739cc66e9117807ca76e56128f1e711a0b4595378b8c', 'archive': '7f167420a8f494fa857a2737278f2005ea9ef5ca4f7dae2dc96dec1e86bb977a', 'launch': 'ec0206853767ebb752adccce3c40e6d78ada03667b6c7075980ef8e79af50aae', 'exit': '08bb6b48fe1701be5afa51fe664fad6841e3dd7860ac04954a1df76761831e11', 'preservation': '171e116a84fd1017a0717d6b2be43035a1dbb07bd192466f9c65d00845b29c3e', 'loss': '4662dd5bee18133e3517164d1349c563c1f5e07d314f7f2f5647c22f32dcb9b6', 'trace': '6071ff491e562b30a2aeec1a8da0cc5a44f77cfe9c6678f7ea46b0093ebb0dbf', 'marker': '93f87e8203feda81381ab49c8e303351a67529c5264c04047053f01e6b03a05a'}

def need(value, code):
    if not value:
        raise ValueError('CLOUD7_SUPERSESSION_' + code)


def sha(value):
    return hashlib.sha256(value).hexdigest()


def encode(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def system_home():
    return Path(pwd.getpwuid(os.geteuid()).pw_dir)


def directory(path, private=False):
    need(path.is_absolute() and path.resolve() == path, 'PATH')
    s = path.lstat()
    need(stat.S_ISDIR(s.st_mode) and s.st_uid == os.geteuid() and not s.st_mode & 0o022, 'DIRECTORY')
    if private:
        need(stat.S_IMODE(s.st_mode) == 0o700, 'DIRECTORY_PRIVATE')
    return s


def read_bytes(path, private=False):
    need(path.is_absolute() and path.resolve() == path, 'PATH')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        a = os.fstat(fd)
        need(stat.S_ISREG(a.st_mode) and a.st_uid == os.geteuid() and a.st_nlink == 1
             and a.st_size <= MAX_FILE and not a.st_mode & 0o022, 'FILE')
        if private:
            need(stat.S_IMODE(a.st_mode) == 0o600, 'FILE_PRIVATE')
        with os.fdopen(os.dup(fd), 'rb') as stream:
            value = stream.read(MAX_FILE + 1)
        b, c = os.fstat(fd), path.lstat()
        need(len(value) == a.st_size and all(getattr(a, k) == getattr(b, k) == getattr(c, k)
             for k in ['st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns']), 'FILE_CHANGED')
        return value
    finally:
        os.close(fd)


def load(path):
    return json.loads(read_bytes(path))


def lines(path):
    return [json.loads(line) for line in read_bytes(path).splitlines()]


def relative(value):
    need(isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*', value)
         and not any(x in ('.', '..') for x in value.split('/')), 'RELATIVE_PATH')
    return value


def layout():
    home = system_home()
    directory(home)
    root = home / '.local/share/zenithjoy/phone-locks'
    directory(root, True)
    run = home / '.local/share/zenithjoy/phone-candidate-runs' / COMMIT / 'ledger' / ('douyin_video_discovery-' + TAG)
    evidence = home / 'perfect21/runner-deploy-evidence/potato-runner-commander-20261107/cloud-drive7'
    return home, root, run, evidence


def brain_get(path):
    need(path in ('/tasks/' + TASK, '/tasks/' + FIX_TASK, '/device-locks'), 'BRAIN_SCOPE')
    raw = read_bytes(system_home() / '.credentials/cecelia-internal.env', True).decode()
    matches = re.findall(r'^(?:export )?CECELIA_INTERNAL_TOKEN=([^\r\n]+)$', raw, re.M)
    need(len(matches) == 1, 'CREDENTIAL')
    token = matches[0].strip().strip('\'"')
    need(token and '\r' not in token and '\n' not in token, 'CREDENTIAL')
    connection = http.client.HTTPConnection('127.0.0.1', 5221, timeout=10)
    try:
        connection.request('GET', '/api/brain' + path,
                           headers={'X-Internal-Token': token, 'Connection': 'close'})
        with connection.getresponse() as response:
            need(response.status == 200 and response.getheader('Content-Type', '').startswith('application/json'), 'BRAIN_READ')
            body = response.read(1024 * 1024 + 1)
            need(len(body) <= 1024 * 1024, 'BRAIN_LIMIT')
        return json.loads(body)
    finally:
        connection.close()


def brain_authority():
    old = brain_get('/tasks/' + TASK)
    old = old.get('task', old)
    current = brain_get('/tasks/' + FIX_TASK)
    current = current.get('task', current)
    need(old.get('id') == TASK and old.get('status') == 'blocked', 'ORIGINAL_TASK')
    need(current.get('id') == FIX_TASK and current.get('status') == 'in_progress'
         and all(current.get(k) == v for k, v in CLAIM.items()), 'FIX_CLAIM')
    locks = brain_get('/device-locks')
    found = [x for x in locks.get('locks', []) if x.get('device_name') == SERIAL]
    need(locks.get('success') is True and len(found) == 1, 'CENTRAL_READBACK')
    # This is a concurrency condition, never evidence that the old SDK stopped.
    need(found[0].get('locked_by') is None, 'CENTRAL_FOREIGN_OWNER')
    return dict(original_task=TASK, original_status='blocked', fix_task=FIX_TASK, claim=CLAIM, central_owner=None)


def check_identity(value, keys):
    need(all(value.get(k) == IDENTITY[k] for k in keys), 'IDENTITY')


def source_authority():
    repo = Path(__file__).resolve().parents[2]
    def git(*args):
        return subprocess.check_output(['git', '-C', str(repo), *args], timeout=10, stderr=subprocess.DEVNULL)
    commit = git('rev-parse', 'HEAD').decode().strip()
    need(re.fullmatch('[a-f0-9]{40}', commit), 'RECOVERY_SOURCE')
    git('merge-base', '--is-ancestor', commit, 'origin/main')
    files = {}
    for name in ['cloud7-quarantine-supersession.py', 'config/native-phone-reviews/cloud-phone-test-sdk31.md',
                 'config/native-phone-command-sources.json']:
        path = 'services/phone-adb-controller/' + name
        b = read_bytes(repo / path)
        need(b == git('show', commit + ':' + path), 'RECOVERY_SOURCE_DIRTY')
        files[path] = sha(b)
    return dict(commit=commit, files=files)


def verify_evidence():
    home, root, run, evidence = layout()
    blobs = {}
    paths = dict(manifest=evidence/'runtime-manifest.json', archive=evidence/'runtime-evidence.tar.gz',
                 launch=evidence/'launch.json', exit=evidence/'exit.json', preservation=evidence/'preservation-readback.json',
                 loss=evidence.parent/'sdk-outcome-fix8/failure-chain-and-recovery-contract.json',
                 trace=evidence.parent/'sdk-outcome-fix8/adb-historical-trace-readback.json', marker=root/'.migration-complete.json')
    for key, path in paths.items():
        blobs[key] = read_bytes(path)
        need(sha(blobs[key]) == PINS[key], key.upper() + '_HASH')
    manifest = json.loads(blobs['manifest'])
    need(manifest.get('root') == str(run) and manifest.get('run_id') == RUN
         and manifest.get('archive_sha256') == PINS['archive'], 'MANIFEST_SCOPE')
    entries = manifest['files']
    need(isinstance(entries, dict) and entries, 'MANIFEST_SCOPE')
    actual = set()
    for f in run.rglob('*'):
        need(not f.is_symlink(), 'RUN_SYMLINK')
        if f.is_file(): actual.add(f.relative_to(run).as_posix())
    need(actual == set(entries), 'RUN_INVENTORY')
    for name, expected in entries.items():
        b = read_bytes(run / relative(name))
        need(sha(b) == expected['sha256'] and len(b) == expected['bytes'], 'ORIGINAL_HASH')
    with tarfile.open(fileobj=io.BytesIO(blobs['archive']), mode='r:gz') as archive:
        members = archive.getmembers()
        prefix = run.name + '/'
        need(all(m.name == run.name or m.name.startswith(prefix) for m in members), 'ARCHIVE_ROOT')
        names = [m.name[len(prefix):] for m in members if m.isfile()]
        need(len(names) == len(set(names)) and set(names) == set(entries)
             and all(m.isfile() or m.isdir() for m in members), 'ARCHIVE_INVENTORY')
        for member in members:
            relative(member.name.rstrip('/'))
            if member.isfile():
                expected = entries[member.name[len(prefix):]]
                need(member.size == expected['bytes'] and member.size <= MAX_FILE
                     and sha(archive.extractfile(member).read(MAX_FILE+1)) == expected['sha256'], 'ARCHIVE_HASH')
    frozen = load(run / 'run-definition.json')
    need(frozen.get('deployment', {}).get('source_commit') == COMMIT, 'FROZEN_SCOPE')
    for name, digest in frozen['files'].items():
        need(sha(read_bytes(run / relative(name))) == digest, 'FROZEN_HASH')
    original = load(run / 'activity-preflight.json')
    need(original.get('execution_stopped') is False and original.get('status') == 'needs_review'
         and original.get('error') == 'AGENT_TOOL_COMMIT_UNKNOWN_READBACK_REQUIRED', 'ORIGINAL_UNKNOWN_CHANGED')
    scope = load(run / 'skill-primary/preflight/launch-intent.json')['scope']
    check_identity(scope, ['task_id', 'run_id', 'binding_id', 'source_commit', 'profile', 'serial'])
    need(scope.get('workflow') == 'douyin_video_discovery' and scope.get('activity') == 'preflight'
         and scope.get('run') == TAG and scope.get('line') == 'yuesheng', 'PREFLIGHT_SCOPE')
    need(load(run/'activity-collect_videos.json').get('status') == 'blocked', 'BUSINESS_STARTED')
    quarantine = load(run/'resource-quarantine.json')
    need(quarantine.get('verified') is True and quarantine.get('videos') == []
         and quarantine.get('claim_receipt_unknown') is False
         and quarantine.get('device', {}).get('physical_actions') == 0, 'BUSINESS_EFFECT')
    # Sealed caller domains prove no Worker can dispatch more operations. These
    # receipts cover callers only, not the unknown remote command's termination.
    finals = list(run.rglob('official-caller-final-*.json'))
    need(len(finals) == 3, 'CALLER_INVENTORY')
    for final in finals:
        v = load(final)
        check_identity(v, ['task_id', 'run_id', 'binding_id', 'source_commit'])
        need(v.get('protocol') == 'official-caller-final/v1' and v.get('not_recovery_authority') is True
             and v.get('activity_key') == 'preflight' and v.get('journal_closed') is True
             and v.get('evidence_complete') is True and v.get('raw_turns') == [], 'CALLER_STOP')
        snap = v['snapshot']
        need(all(snap.get(k) is True for k in ['sealed','execution_stopped','caller_execution_stopped'])
             and snap.get('pending') == 0 and all(snap.get(k) is False for k in
             ['execution_unknown','external_effect_unknown','previous_caller_stop_unproven','final_record_failed']), 'CALLER_STOP')
        for a in [v['ledger'], *v['artifacts']]:
            b = read_bytes(final.parent / relative(a['file']))
            need(sha(b) == a['sha256'] and len(b) == a['bytes'], 'CALLER_JOURNAL')
        pending = []
        for event in lines(final.parent/v['ledger']['file']):
            need(event.get('event') in ['read_intent','read_returned','raw_parent_authority','task_claim_projected'], 'CALLER_WRITE')
            if event['event'] == 'read_intent': pending.append((event['path'], event['epoch']))
            if event['event'] == 'read_returned':
                pair = (event['path'], event['epoch'])
                need(pair in pending, 'READ_PAIR'); pending.remove(pair)
        need(not pending, 'CALLER_PENDING')
    domain = lines(run/'preflight-native-domain-close.jsonl')
    need(len(domain) == 1, 'PHYSICAL_INVENTORY')
    d = domain[0]; check_identity(d, list(IDENTITY))
    need(d.get('agent_not_launched') is True and d.get('official_stopped') is False
         and d.get('resource_unknown') is False, 'WORKER_STARTED')
    p, c = d['physical'], d['control']
    need(p.get('execution_stopped') is True and p.get('pending') == 0 and p.get('command_failures') == 0
         and c.get('sealed') is True and c.get('execution_stopped') is True and c.get('pending') == 0, 'PARENT_STOP')
    tools = list((run/'agent-tools').rglob('*.intent.json'))
    need(len(tools) == 1 and load(tools[0]).get('operation') == 'resource_prepare', 'BUSINESS_INTENT')
    native = run/'native-phone/preflight'
    need({f.name for f in native.iterdir()} == {'source','command-0','local'}, 'COMMAND_INVENTORY')
    cmd = native/'command-0'
    need({f.name for f in cmd.iterdir()} == {'lifecycle.intent.json','socket-0.intent.json','socket-1.intent.json',
         'write-0.intent.json','write-1.intent.json','write-2.intent.json','write-3.intent.json'}, 'COMMAND_INVENTORY')
    service = b"shell,v2,raw:exec /system/bin/getprop 'ro.build.version.sdk'"
    services = [('host-serial:'+SERIAL+':features').encode(), ('host:transport:'+SERIAL).encode(), service]
    writes = [f'{len(b):04x}'.encode()+b for b in services] + [bytes.fromhex('0400000000')]
    for i, b in enumerate(writes):
        need(load(cmd/f'write-{i}.intent.json') == dict(schema_version=1, bytes=len(b), sha256=sha(b)), 'READONLY_COMMAND')
    reads = sorted((native/'source').glob('read-*.returned.json'))
    need(len(reads) == 19, 'SOURCE_INVENTORY')
    for f in reads:
        value = load(f)
        need(value.get('peer_eof') is True and value.get('socket_closed') is True, 'SOURCE_RETURN')
    local = list((native/'local').glob('*.jsonl'))
    need(len(local) == 1, 'LOCAL_INVENTORY')
    local_rows = lines(local[0])
    need(local_rows[-1] == dict(event='final', unknown=False, leaves=2), 'LOCAL_STOP')
    for role, code in [('calibration-positive',0),('calibration-negative',128)]:
        terminal = [v for v in local_rows if v.get('event') == 'returned' and v.get('role') == role]
        need(len(terminal) == 1 and terminal[0].get('code') == code and terminal[0].get('stdio_closed') is True, 'LOCAL_STOP')
    loss, trace = json.loads(blobs['loss']), json.loads(blobs['trace'])
    need(loss.get('original_run_id') == RUN and loss.get('old_ledger_information_loss_proven') is True
         and loss.get('exact_command') == "exec /system/bin/getprop 'ro.build.version.sdk'"
         and loss.get('historical_recovery', {}).get('code') == 'CLOUD7_SDK_HISTORICAL_STOP_EVIDENCE_UNRECOVERABLE'
         and loss['historical_recovery'].get('original_execution_stopped') is False, 'INFORMATION_LOSS')
    need(trace.get('verdict') == 'NO_MATCHING_HISTORICAL_SDK_STREAM_EVIDENCE'
         and trace.get('cloud7_window_records') == [] and trace.get('command_trace_records') == [], 'HISTORICAL_STOP')
    launch, exited = json.loads(blobs['launch']), json.loads(blobs['exit'])
    need(launch.get('task_id') == TASK and launch.get('source_commit') == COMMIT
         and launch.get('host') == launch.get('broker_host') == 'mmv'
         and launch.get('adb_endpoint') == SUCCESSOR['adb_endpoint'] and exited.get('exit_code') == 1, 'LAUNCH_SCOPE')
    # No PID census or lease expiry is consulted as command-stop evidence.
    return dict(protocol=PROTOCOL, identity=IDENTITY, successor=SUCCESSOR, pins=PINS,
                frozen_sha256=entries['run-definition.json']['sha256'], original_execution_stopped=False,
                authority_basis='sealed-preflight-only-fixed-readonly-sdk-noninterference',
                historical_stop='UNRECOVERABLE', recovery_source=source_authority())


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def durable(path, value):
    data = encode(value)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(os.dup(fd), 'wb') as stream:
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
    finally:
        os.close(fd)
    sync_dir(path.parent)


@contextlib.contextmanager
def device_guard():
    _, root, _, _ = layout()
    root_identity = directory(root, True)
    marker_path = root / '.migration-complete.json'
    marker_bytes = read_bytes(marker_path)
    need(sha(marker_bytes) == PINS['marker'], 'MARKER_HASH')
    marker = json.loads(marker_bytes)
    need(marker.get('schema_version') == 1 and marker.get('state') == 'complete'
         and isinstance(marker.get('legacy_root'), str), 'GUARD_MIGRATION')
    legacy = Path(marker['legacy_root'])
    # The historical migration permits an owned 0755 legacy root. Both roots
    # must be canonical and deny group/world writes; only durable requires 0700.
    legacy_identity = directory(legacy)
    need(legacy != root, 'GUARD_ROOTS')
    paths = [root / (SERIAL + '.guard'), legacy / (SERIAL + '.guard')]
    fd = os.open(paths[0], os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        owned = os.fstat(fd)

        def assert_current():
            current_root = directory(root, True)
            need((current_root.st_dev, current_root.st_ino) ==
                 (root_identity.st_dev, root_identity.st_ino), 'ROOT_CHANGED')
            current_legacy = directory(legacy)
            need((current_legacy.st_dev, current_legacy.st_ino) ==
                 (legacy_identity.st_dev, legacy_identity.st_ino), 'LEGACY_ROOT_CHANGED')
            need(read_bytes(marker_path) == marker_bytes, 'GUARD_MIGRATION_CHANGED')
            opened = os.fstat(fd)
            guards = [opened]
            for path in paths:
                need(path.resolve() == path, 'GUARD_CHANGED')
                try:
                    guards.append(path.lstat())
                except OSError:
                    need(False, 'GUARD_PEER_MISSING')
            for current in guards:
                need(stat.S_ISREG(current.st_mode) and current.st_uid == os.geteuid()
                     and stat.S_IMODE(current.st_mode) == 0o600 and current.st_size == 0
                     and current.st_nlink == 2 and (current.st_dev, current.st_ino) ==
                     (owned.st_dev, owned.st_ino), 'GUARD_CHANGED')
            # Only the two marker-authorized paths may share this empty inode.
            # Evidence readers still require nlink=1. Every checkpoint retains
            # this original descriptor's lock across both migration roots.
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                need(False, 'GUARD_BUSY')

        assert_current()
        yield root, assert_current
    finally:
        os.close(fd)


def boundary(facts, assert_guard):
    # Network authorization is work, not permission to commit facts which
    # changed during that work. No HTTP read occurs after this checkpoint and
    # before its guarded filesystem mutation.
    assert_guard()
    need(verify_evidence() == facts, 'EVIDENCE_CHANGED')
    assert_guard()


def lock_snapshot(path):
    s = directory(path, True)
    need({p.name for p in path.iterdir()} == set(LOCK_FIELDS), 'LOCK_INVENTORY')
    fields = {}
    for name, value in LOCK_FIELDS.items():
        b = read_bytes(path / name, True)
        need(b == (value + '\n').encode(), 'LOCK_OWNER_EPOCH')
        fields[name] = sha(b)
    return dict(dev=s.st_dev, ino=s.st_ino, fields=fields)


def journal_dir(root):
    path = root / ('.quarantine-supersession-cloud7-' + EPOCH)
    if not path.exists():
        path.mkdir(mode=0o700); sync_dir(root)
    directory(path, True)
    need({p.name for p in path.iterdir()} <= {'plan.json', 'apply.intent.json', 'apply.returned.json'}, 'JOURNAL_INVENTORY')
    return path


def archive_path(root):
    return root / ('.quarantine-supersession-cloud7-' + EPOCH + '.superseded')


def validate_plan(root, journal, evidence):
    p = json.loads(read_bytes(journal / 'plan.json', True))
    need(set(p) == {'protocol', 'state', 'identity', 'evidence', 'lock', 'superseded_path', 'machine_authority'}
         and p['protocol'] == PROTOCOL and p['state'] == 'planned' and p['identity'] == IDENTITY
         and p['evidence'] == evidence and p['superseded_path'] == str(archive_path(root)), 'PLAN_DRIFT')
    authority = p['machine_authority']
    need(authority.get('original_task') == TASK and authority.get('original_status') == 'blocked'
         and authority.get('fix_task') == FIX_TASK and authority.get('claim') == CLAIM
         and authority.get('central_owner') is None, 'PLAN_AUTHORITY')
    return p


def plan():
    with device_guard() as (root, assert_guard):
        facts = verify_evidence(); assert_guard()
        machine_authority = brain_authority(); boundary(facts, assert_guard)
        journal = journal_dir(root)
        if (journal / 'plan.json').exists():
            value = validate_plan(root, journal, facts)
            held, retired = root / (SERIAL + '.lock'), archive_path(root)
            need(held.exists() != retired.exists(), 'LOCK_LOCATION')
            if retired.exists():
                need((journal / 'apply.intent.json').exists(), 'ARCHIVE_WITHOUT_INTENT')
                expected = dict(protocol=PROTOCOL, plan_sha256=sha(read_bytes(journal / 'plan.json', True)), identity=IDENTITY)
                need(json.loads(read_bytes(journal / 'apply.intent.json', True)) == expected, 'INTENT_DRIFT')
            need(lock_snapshot(held if held.exists() else retired) == value['lock'], 'PLAN_LOCK_DRIFT')
            boundary(facts, assert_guard)
            return value
        need(not archive_path(root).exists() and not archive_path(root).is_symlink(), 'ARCHIVE_EXISTS')
        value = dict(protocol=PROTOCOL, state='planned', identity=IDENTITY, evidence=facts,
                     lock=lock_snapshot(root / (SERIAL + '.lock')), superseded_path=str(archive_path(root)),
                     machine_authority=machine_authority)
        boundary(facts, assert_guard)
        durable(journal / 'plan.json', value)
        assert_guard()
        return value


def free_readback(root, run, facts):
    # Execute only the original frozen/pinned local verifier, never a phone CLI.
    path = run / 'runtime/phone-lock-root.py'
    frozen_bytes = read_bytes(run / 'run-definition.json')
    need(sha(frozen_bytes) == facts['frozen_sha256'], 'FROZEN_HASH')
    code = read_bytes(path)
    need(sha(code) == json.loads(frozen_bytes)['files']['runtime/phone-lock-root.py'], 'FROZEN_HASH')
    module = types.ModuleType('cloud7_original_lock_root')
    module.__file__ = str(path)
    exec(compile(code, str(path), 'exec'), module.__dict__)
    value = module.check_serial(root, SERIAL)
    need(value == dict(serial=SERIAL, state='free', migration='verified'), 'FREE_READBACK')
    return value


def apply():
    with device_guard() as (root, assert_guard):
        facts = verify_evidence(); assert_guard()
        brain_authority(); boundary(facts, assert_guard)
        journal = journal_dir(root)
        need((journal / 'plan.json').exists(), 'PLAN_REQUIRED')
        p = validate_plan(root, journal, facts)
        intent = dict(protocol=PROTOCOL, plan_sha256=sha(read_bytes(journal / 'plan.json', True)), identity=IDENTITY)
        i = journal / 'apply.intent.json'
        if i.exists():
            need(json.loads(read_bytes(i, True)) == intent, 'INTENT_DRIFT')
        else:
            need(not (journal / 'apply.returned.json').exists(), 'RETURN_WITHOUT_INTENT')
            need((root / (SERIAL + '.lock')).is_dir() and not archive_path(root).exists(), 'ARCHIVE_WITHOUT_INTENT')
            assert_guard()
            durable(i, intent)
        assert_guard()
        active, retired = root / (SERIAL + '.lock'), archive_path(root)
        need(active.exists() != retired.exists() and not active.is_symlink() and not retired.is_symlink(), 'LOCK_LOCATION')
        if active.exists():
            need(not (journal / 'apply.returned.json').exists() and lock_snapshot(active) == p['lock'], 'LOCK_DRIFT')
            # All immutable evidence and current machine authority are checked
            # again immediately before the single filesystem mutation.
            boundary(facts, assert_guard)
            brain_authority(); boundary(facts, assert_guard)
            need(lock_snapshot(active) == p['lock'], 'LOCK_DRIFT')
            assert_guard()
            os.rename(active, retired); sync_dir(root)
            assert_guard()
        need(lock_snapshot(retired) == p['lock'], 'RETIRED_DRIFT')
        assert_guard()
        _, _, run, _ = layout()
        local = free_readback(root, run, facts)
        central = brain_authority()  # No central release: preserve the actual readback.
        boundary(facts, assert_guard)
        need(not active.exists() and lock_snapshot(retired) == p['lock'], 'RETIRED_DRIFT')
        local = free_readback(root, run, facts)
        assert_guard()
        result = dict(protocol=PROTOCOL, state='superseded', identity=IDENTITY, plan_sha256=intent['plan_sha256'],
                      superseded_path=str(retired), local_readback=local, central_readback=central, original_execution_stopped=False, successor=SUCCESSOR, authority_basis=facts['authority_basis'])
        returned = journal / 'apply.returned.json'
        if returned.exists():
            need(json.loads(read_bytes(returned, True)) == result, 'RETURN_DRIFT')
        else:
            assert_guard()
            durable(returned, result)
        assert_guard()
        return result


def main():
    need(len(sys.argv) == 2 and sys.argv[1] in ('plan','apply'), 'USAGE: cloud7-quarantine-supersession.py plan|apply')
    print(json.dumps(plan() if sys.argv[1] == 'plan' else apply(), ensure_ascii=False, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else 'CLOUD7_SUPERSESSION_IO_UNKNOWN', file=sys.stderr)
        sys.exit(2)

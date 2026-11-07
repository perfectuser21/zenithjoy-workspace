#!/usr/bin/env python3
"""One historical source-only quarantine recovery. No phone or central writes.

The pinned originals retain needs_review, the missing successful read_returned,
and execution_stopped=false. This command only retires their exact local lock
once the independently bounded stop domains and current owner checks hold.
"""
import contextlib
import datetime
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

TASK = '16b2887e-310e-4882-a4e5-1b3840e766c9'
FIX_TASK = '786eb515-3c57-4216-a82b-4bb950250778'
CLAIM = {'claimed_by': 'codex-native-source-authority', 'claimed_at': '2026-11-07T16:54:38.750Z'}
COMMIT = 'db11c6bbf884ccdcd84fbf027c3c7c6436e148c7'
TAG = 'potato20261107_101_cloud6'
RUN = 'douyin_video_discovery-' + TAG + '__a1'
BINDING = '6d79dde7-7481-4e11-bf1b-1a05aa737617'
EPOCH = '5d282615-87f7-40ee-91f2-10b18671ccec'
SERIAL = '47.100.213.173:10001'
IDENTITY = dict(task_id=TASK, run_id=RUN, binding_id=BINDING, source_commit=COMMIT,
                profile='cloud-phone-test', serial=SERIAL, owner=TAG, epoch=EPOCH)
PINS = {
    'manifest': '6784957636f4a6010161f8fc92c8af38e2a067b8d50e052bb1cb6329dc5077bf',
    'archive': '542fafebc91aec07e304b919f7638e9c561f5fb2a443fbff2fe7ca173364809e',
    'launch': 'bac274b66a21f1496aca639c3fc62ee77f7fc3b0b7ecdd2edd0a32368f11ac31',
    'exit': 'ebba086544e9f53ad79c43e613cbcaeca66ccf299c338c4dd37fecd63f0be4e9',
    'marker': '93f87e8203feda81381ab49c8e303351a67529c5264c04047053f01e6b03a05a',
}
LOCK_FIELDS = dict(owner=TAG, preflight_epoch=EPOCH, preflight_proof_required=EPOCH,
                   standalone_review_required=TAG, preflight_quarantined=EPOCH, acquired_at='1794068935')
PROTOCOL = 'cloud6-source-only-lock-retirement/v1'
MAX_FILE = 16 * 1024 * 1024


def need(value, code):
    if not value:
        raise ValueError('CLOUD6_SOURCE_REVIEW_' + code)


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
    evidence = home / 'perfect21/runner-deploy-evidence/potato-runner-commander-20261107/cloud-drive6'
    return home, root, run, evidence


def process_exists(pid):
    need(type(pid) is int and pid > 1, 'PID')
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


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
    lock = found[0]
    need(lock.get('locked_by') in (None, TASK), 'CENTRAL_FOREIGN_OWNER')
    if lock.get('locked_by') == TASK:
        try:
            expiry = datetime.datetime.fromisoformat(lock['expires_at'].replace('Z', '+00:00'))
            need(expiry.tzinfo is not None and expiry <= datetime.datetime.now(datetime.timezone.utc), 'CENTRAL_NOT_EXPIRED')
        except (KeyError, TypeError, AttributeError):
            need(False, 'CENTRAL_EXPIRY')
    return dict(original_task=TASK, original_status=old['status'], fix_task=FIX_TASK,
                claim=CLAIM, central_owner=lock.get('locked_by'), central_expires_at=lock.get('expires_at'))


def check_identity(value, keys):
    need(all(value.get(k) == IDENTITY[k] for k in keys), 'EVIDENCE_IDENTITY')


def verify_evidence():
    home, root, run, evidence = layout()
    marker = read_bytes(root / '.migration-complete.json')
    need(sha(marker) == PINS['marker'], 'MARKER_HASH')
    blobs = {}
    for key, name in [('manifest', 'runtime-evidence-manifest.json'), ('archive', 'runtime-evidence.tar.gz'),
                      ('launch', 'launch.json'), ('exit', 'exit.json')]:
        blobs[key] = read_bytes(evidence / name)
        need(sha(blobs[key]) == PINS[key], key.upper() + '_HASH')
    manifest = json.loads(blobs['manifest'])
    need(manifest.get('run_dir') == str(run) and len(manifest.get('files', [])) == 85, 'MANIFEST_SCOPE')
    entries = {relative(x['path']): x for x in manifest['files']}
    need(len(entries) == 85, 'MANIFEST_DUPLICATE')
    with tarfile.open(fileobj=io.BytesIO(blobs['archive']), mode='r:gz') as archive:
        members = archive.getmembers()
        need(len(members) == 85 and all(x.isfile() for x in members)
             and {x.name for x in members} == set(entries), 'ARCHIVE_INVENTORY')
        for member in members:
            expected = entries[member.name]
            need(member.size == expected['bytes'] and member.size <= MAX_FILE, 'ARCHIVE_BYTES')
            b = archive.extractfile(member).read(MAX_FILE + 1)
            need(sha(b) == expected['sha256'], 'ARCHIVE_HASH')
    for name, expected in entries.items():
        path = Path(str(run) + '.native-task-lease') / name.split('/', 1)[1] if name.startswith('native-task-lease/') else run / name
        b = read_bytes(path)
        need(sha(b) == expected['sha256'] and len(b) == expected['bytes'], 'ORIGINAL_HASH')
    # Reject new intents, commands, or detached producers even when all pinned
    # originals remain intact. Runtime inventory is independently frozen below.
    actual = set()
    for f in run.rglob('*'):
        name = f.relative_to(run).as_posix()
        need(not f.is_symlink(), 'RUN_SYMLINK')
        if f.is_file() and not name.startswith('runtime/'):
            actual.add(name)
    need(actual == {x for x in entries if not x.startswith('native-task-lease/')}, 'RUN_INVENTORY')
    frozen = load(run / 'run-definition.json')
    need(frozen.get('deployment', {}).get('source_commit') == COMMIT and len(frozen.get('files', {})) == 421, 'FROZEN_SCOPE')
    for name, digest in frozen['files'].items():
        need(sha(read_bytes(run / relative(name))) == digest, 'FROZEN_HASH')
    original = load(run / 'activity-preflight.json')
    need(original.get('execution_stopped') is False and original.get('status') == 'needs_review'
         and original.get('error') == 'AGENT_TOOL_COMMIT_UNKNOWN_READBACK_REQUIRED', 'ORIGINAL_UNKNOWN_CHANGED')
    check_identity(load(run / 'skill-primary/preflight/launch-intent.json')['scope'],
                   ['task_id', 'run_id', 'binding_id', 'source_commit', 'profile', 'serial'])
    finals = list(run.rglob('official-caller-final-*.json'))
    need(len(finals) == 3, 'CALLER_INVENTORY')
    missing = []
    for final in finals:
        v = load(final)
        check_identity(v, ['task_id', 'run_id', 'binding_id', 'source_commit'])
        need(v.get('protocol') == 'official-caller-final/v1' and v.get('evidence_only') is True
             and v.get('not_recovery_authority') is True and v.get('activity_key') == 'preflight'
             and v.get('journal_closed') is True and v.get('evidence_complete') is True and v.get('raw_turns') == [], 'CALLER_STOP')
        s = v['snapshot']
        need(all(s.get(k) is True for k in ['sealed', 'execution_stopped', 'caller_execution_stopped'])
             and s.get('pending') == 0 and all(s.get(k) is False for k in
             ['execution_unknown', 'external_effect_unknown', 'previous_caller_stop_unproven', 'final_record_failed']), 'CALLER_STOP')
        for a in [v['ledger'], *v['artifacts']]:
            b = read_bytes(final.parent / relative(a['file']))
            need(sha(b) == a['sha256'] and len(b) == a['bytes'], 'CALLER_JOURNAL')
        pending = []
        for event in lines(final.parent / v['ledger']['file']):
            if event['event'] == 'read_intent':
                pending.append((event['path'], event['epoch']))
            if event['event'] == 'read_returned':
                key = (event['path'], event['epoch'])
                need(key in pending, 'READ_PAIR')
                pending.remove(key)
        missing.extend(pending)
    need(missing == [('/api/brain/runs/' + RUN + '/definition', 0)], 'MISSING_READ_CHANGED')
    source = run / 'native-phone/preflight/source'
    expected_names = {'lifecycle.intent.json'}
    # The original lifecycle is pinned; fixtures may use the exact same reader
    # inventory. Only finite transport/sync reads occurred before the failure.
    for i, path in enumerate(['/system/bin/am', '/system/bin/app_process', '/system/bin/app_process32', '/system/bin/app_process64']):
        name = f'read-{i}.intent.json'
        v = load(source / name)
        need(v.get('id') == i and v.get('path') == path, 'SOURCE_READ_SCOPE')
        expected_names.add(name)
        services = [('host:transport:' + SERIAL).encode(), b'sync:']
        writes = [f'{len(b):04x}'.encode() + b for b in services]
        b = path.encode()
        writes.append(b'RECV' + len(b).to_bytes(4, 'little') + b)
        if i < 3:
            writes.append(b'QUIT' + bytes(4))
            name = f'read-{i}.returned.json'; expected_names.add(name)
            v = load(source / name)
            need(v.get('path') == path and v.get('id') == i and v.get('peer_eof') is True and v.get('socket_closed') is True, 'SOURCE_READ_RETURN')
        else:
            expected_names.add('read-3.unknown.json')
            need(load(source / 'read-3.unknown.json') == dict(id=3, code='NATIVE_PHONE_READ_AUTHORITY'), 'SOURCE_UNKNOWN_CHANGED')
        for n, b in enumerate(writes):
            name = f'read-{i}-write-{n}.intent.json'; expected_names.add(name)
            need(load(source / name) == dict(bytes=len(b), sha256=sha(b)), 'SOURCE_WRITE')
    need({f.name for f in source.iterdir()} == expected_names, 'SOURCE_INVENTORY')
    domain_rows = lines(run / 'preflight-native-domain-close.jsonl')
    need(len(domain_rows) == 1, 'PHYSICAL_INVENTORY')
    d = domain_rows[0]
    check_identity(d, list(IDENTITY))
    need(d.get('agent_not_launched') is True and d.get('official_stopped') is False
         and d.get('resource_unknown') is False and d.get('physical_sequence') == 1, 'PHYSICAL_SCOPE')
    physical = d['physical']; control = d['control']
    need(physical.get('execution_stopped') is True and physical.get('pending') == 0
         and physical.get('command_failures') == 0 and control.get('sealed') is True
         and control.get('execution_stopped') is True and control.get('pending') == 0, 'PHYSICAL_STOP')
    need(physical['adb'].get('complete') is True and physical['adb'].get('requests_returned') is True
         and physical['local'].get('sealed') is True and physical['local'].get('execution_stopped') is True, 'LEAF_STOP')
    pids = set()
    for section in ['adb', 'local']:
        for leaf in physical[section]['leaves']:
            need(leaf.get('code') == 0 and leaf.get('tainted') is False, 'LEAF_STOP')
            pids.add(leaf['pid'])
    for leaf_file in (run / 'preflight-native-scopes').rglob('*.jsonl'):
        pending = set()
        for leaf in lines(leaf_file):
            phase = leaf.get('event', leaf.get('phase'))
            key = leaf.get('id', leaf.get('sequence'))
            if phase == 'intent':
                need(key not in pending, 'LEAF_DUPLICATE'); pending.add(key)
            if phase in ('returned', 'exit'):
                need(key in pending and leaf.get('code') == 0 and leaf.get('tainted') is False, 'LEAF_STOP')
                pending.remove(key)
            if 'pid' in leaf:
                pids.add(leaf['pid'])
        need(not pending, 'LEAF_PENDING')
    tools = list((run / 'agent-tools').rglob('*.intent.json'))
    need(len(tools) == 1 and load(tools[0]).get('operation') == 'resource_prepare', 'BUSINESS_INTENT')
    terminals = list((run / 'commander-preflight/sdk').glob('*.terminal.json'))
    need(len(terminals) == 2, 'COMMANDER_INVENTORY')
    for terminal in terminals:
        v = load(terminal); rid = v['run_id']
        intent = load(terminal.parent / (rid + '.intent.json'))
        model = load(terminal.parent / (rid + '.model-turn.intent.json'))
        facts = v['success_evidence']
        need(intent['run_id'] == model['run_id'] == facts['official_run_id'] == facts['turn_id'] == rid
             and intent['execution_session_id'] == model['execution_session_id'] == facts['session_id']
             and v['terminal']['status'] == 'ok' and v['terminal']['run_id_matches'] is True, 'COMMANDER_IDENTITY')
        need(len(v['transport_proofs']) == 2 and all(all(r.get(k) is True for k in
             ['request_closed', 'websocket_closed', 'socket_closed']) for r in v['transport_proofs']), 'COMMANDER_STOP')
    launch, exited = json.loads(blobs['launch']), json.loads(blobs['exit'])
    need(launch.get('argv') == ['/bin/bash', str(home / '.local/share/zenithjoy/phone-candidates' / COMMIT / 'run.sh'),
         'douyin_video_discovery', 'cloud-phone-test', SERIAL, 'yuesheng', TAG]
         and launch.get('task_id') == TASK and launch.get('source_commit') == COMMIT
         and launch.get('host') == launch.get('broker_host') == 'mmv'
         and launch.get('adb_endpoint') == 'tcp:127.0.0.1:5041' and exited.get('exit_code') == 1, 'LAUNCH_EXIT')
    pids.update([launch['pid'], launch['supervisor_pid'], 34248])
    need(all(not process_exists(pid) for pid in pids), 'PROCESS_LIVE')
    return dict(protocol=PROTOCOL, identity=IDENTITY, pins=PINS,
                frozen_sha256=entries['run-definition.json']['sha256'], original_execution_stopped=False,
                missing_read_returned=missing[0][0], source_read3='NATIVE_PHONE_READ_AUTHORITY',
                source_writes='fixed-sync-read-only', process_pids=sorted(pids))


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
    path = root / (SERIAL + '.guard')
    read_bytes(path, True)
    fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            need(False, 'GUARD_BUSY')
        a, b = os.fstat(fd), path.lstat()
        need(a.st_dev == b.st_dev and a.st_ino == b.st_ino, 'GUARD_CHANGED')
        yield root
    finally:
        os.close(fd)


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
    path = root / ('.source-review-cloud6-' + EPOCH)
    if not path.exists():
        path.mkdir(mode=0o700); sync_dir(root)
    directory(path, True)
    need({p.name for p in path.iterdir()} <= {'plan.json', 'apply.intent.json', 'apply.returned.json'}, 'JOURNAL_INVENTORY')
    return path


def archive_path(root):
    return root / ('.source-review-cloud6-' + EPOCH + '.retired')


def validate_plan(root, journal, evidence):
    p = json.loads(read_bytes(journal / 'plan.json', True))
    need(set(p) == {'protocol', 'state', 'identity', 'evidence', 'lock', 'retired_path', 'machine_authority'}
         and p['protocol'] == PROTOCOL and p['state'] == 'planned' and p['identity'] == IDENTITY
         and p['evidence'] == evidence and p['retired_path'] == str(archive_path(root)), 'PLAN_DRIFT')
    authority = p['machine_authority']
    need(authority.get('original_task') == TASK and authority.get('original_status') == 'blocked'
         and authority.get('fix_task') == FIX_TASK and authority.get('claim') == CLAIM
         and authority.get('central_owner') in (None, TASK), 'PLAN_AUTHORITY')
    return p


def plan():
    with device_guard() as root:
        facts = verify_evidence(); machine_authority = brain_authority()
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
            return value
        need(not archive_path(root).exists() and not archive_path(root).is_symlink(), 'ARCHIVE_EXISTS')
        value = dict(protocol=PROTOCOL, state='planned', identity=IDENTITY, evidence=facts,
                     lock=lock_snapshot(root / (SERIAL + '.lock')), retired_path=str(archive_path(root)),
                     machine_authority=machine_authority)
        durable(journal / 'plan.json', value)
        return value


def free_readback(root, run, facts):
    # Execute only the original frozen/pinned local verifier, never a phone CLI.
    path = run / 'runtime/phone-lock-root.py'
    frozen_bytes = read_bytes(run / 'run-definition.json')
    need(sha(frozen_bytes) == facts['frozen_sha256'], 'FROZEN_HASH')
    code = read_bytes(path)
    need(sha(code) == json.loads(frozen_bytes)['files']['runtime/phone-lock-root.py'], 'FROZEN_HASH')
    module = types.ModuleType('cloud6_original_lock_root')
    module.__file__ = str(path)
    exec(compile(code, str(path), 'exec'), module.__dict__)
    value = module.check_serial(root, SERIAL)
    need(value == dict(serial=SERIAL, state='free', migration='verified'), 'FREE_READBACK')
    return value


def apply():
    with device_guard() as root:
        facts = verify_evidence(); brain_authority()
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
            durable(i, intent)
        active, retired = root / (SERIAL + '.lock'), archive_path(root)
        need(active.exists() != retired.exists() and not active.is_symlink() and not retired.is_symlink(), 'LOCK_LOCATION')
        if active.exists():
            need(not (journal / 'apply.returned.json').exists() and lock_snapshot(active) == p['lock'], 'LOCK_DRIFT')
            # All immutable evidence and current machine authority are checked
            # again immediately before the single filesystem mutation.
            need(verify_evidence() == facts, 'EVIDENCE_CHANGED'); brain_authority()
            need(lock_snapshot(active) == p['lock'], 'LOCK_DRIFT')
            os.rename(active, retired); sync_dir(root)
        need(lock_snapshot(retired) == p['lock'], 'RETIRED_DRIFT')
        _, _, run, _ = layout()
        local = free_readback(root, run, facts)
        central = brain_authority()  # No central release: preserve the actual readback.
        result = dict(protocol=PROTOCOL, state='retired', identity=IDENTITY, plan_sha256=intent['plan_sha256'],
                      retired_path=str(retired), local_readback=local, central_readback=central, original_execution_stopped=False)
        returned = journal / 'apply.returned.json'
        if returned.exists():
            need(json.loads(read_bytes(returned, True)) == result, 'RETURN_DRIFT')
        else:
            durable(returned, result)
        return result


def main():
    need(len(sys.argv) == 2 and sys.argv[1] in ('plan', 'apply'), 'USAGE: cloud6-source-review-recovery.py plan|apply')
    print(json.dumps(plan() if sys.argv[1] == 'plan' else apply(), ensure_ascii=False, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else 'CLOUD6_SOURCE_REVIEW_IO_UNKNOWN', file=sys.stderr)
        sys.exit(2)

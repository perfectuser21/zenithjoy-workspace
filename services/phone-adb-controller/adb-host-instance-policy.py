#!/usr/bin/env python3
"""ADB声明式实例规矩；只读源码registry、固定policy与维护启动授权，不创建服务。"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import types
import uuid
from datetime import datetime, timezone

HERE = Path(__file__).resolve().parent
REGISTRY = 'config/adb-host-instances.json'
SOURCE_FILES = ('adb-host-instance-policy.py', 'adb-host-service.py', 'adb-existing-route.py', 'adb-managed-client.py', REGISTRY)
POLICY_KEYS = {'schema_version', 'instance_id', 'host_id', 'transport', 'endpoint',
               'forbidden_ports', 'adb_bin', 'adb_realpath', 'adb_sha256'}


def need(value, code):
    if not value:
        raise ValueError('ADB_INSTANCE_' + code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read_file(path, private=False):
    path = Path(path)
    need(path.is_absolute() and not any(p.is_symlink() for p in (path, *path.parents)), 'PATH')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as handle:
        info = os.fstat(handle.fileno())
        need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.geteuid()
             and not info.st_mode & 0o022 and info.st_size <= 4 * 1024 * 1024
             and (not private or stat.S_IMODE(info.st_mode) == 0o600), 'FILE')
        raw = handle.read()
        after = path.lstat()
        need((info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
             == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'FILE_CHANGED')
        return raw


def source_manifest(root=HERE, extra=()):
    root = Path(root).resolve()
    manifest = json.loads(read_file(root / 'deployment-manifest.json'))
    need(manifest.get('source_repo') == 'perfectuser21/zenithjoy-workspace'
         and re.fullmatch('[a-f0-9]{40}', manifest.get('source_commit', ''))
         and manifest.get('target') == 'mmv', 'SOURCE')
    for name in (*SOURCE_FILES, *extra):
        rows = [r for r in manifest.get('files', []) if r.get('path') == 'services/phone-adb-controller/' + name]
        need(len(rows) == 1 and rows[0].get('deployed_path') == name
             and rows[0].get('content_sha256') == sha(read_file(root / name)), 'SOURCE_BYTES')
    return manifest


def validate_registry(doc):
    need(isinstance(doc, dict) and set(doc) == {'schema_version', 'startup_verifier', 'instances'}
         and type(doc['schema_version']) is int and doc['schema_version'] == 1, 'REGISTRY_SCHEMA')
    verifier = doc['startup_verifier']
    need(isinstance(verifier, dict) and set(verifier) == {'module', 'node'}
         and verifier['module'] == 'device-epoch-fence-review.mjs'
         and isinstance(verifier['node'], dict) and set(verifier['node']) == {'path', 'sha256'}
         and Path(verifier['node']['path']).is_absolute()
         and re.fullmatch('[a-f0-9]{64}', verifier['node']['sha256']), 'REGISTRY_VERIFIER')
    rows = doc['instances']
    need(isinstance(rows, list) and 1 <= len(rows) <= 8, 'REGISTRY_INSTANCES')
    ids, endpoints = set(), set()
    for row in rows:
        need(isinstance(row, dict) and set(row) == {'instance_id', 'kind', 'policy_path', 'policy', 'coexists_with'}, 'REGISTRY_ROW')
        key, p = row['instance_id'], row['policy']
        need(isinstance(key, str) and re.fullmatch('[a-z][a-z0-9-]{2,63}', key) and key not in ids
             and row['kind'] in ('managed', 'external_existing') and Path(row['policy_path']).is_absolute(), 'REGISTRY_IDENTITY')
        ids.add(key)
        managed = row['kind'] == 'managed'
        need(isinstance(p, dict) and set(p) == (POLICY_KEYS if managed else POLICY_KEYS - {'instance_id'})
             and p['schema_version'] == (2 if managed else 1) and type(p['schema_version']) is int
             and (not managed or p['instance_id'] == key)
             and p['host_id'] == 'mmv' and p['transport'] == 'tcp' and p['forbidden_ports'] == [], 'REGISTRY_POLICY')
        match = re.fullmatch(r'tcp:127\.0\.0\.1:([1-9][0-9]{0,4})', p['endpoint'])
        need(match and int(match[1]) <= 65535 and p['endpoint'] not in endpoints, 'REGISTRY_ENDPOINT')
        endpoints.add(p['endpoint'])
        need(all(isinstance(p[k], str) and Path(p[k]).is_absolute() for k in ('adb_bin', 'adb_realpath'))
             and re.fullmatch('[a-f0-9]{64}', p['adb_sha256']), 'REGISTRY_BINARY')
        need(isinstance(row['coexists_with'], list) and len(set(row['coexists_with'])) == len(row['coexists_with'])
             and key not in row['coexists_with'], 'REGISTRY_PARTNERS')
    for row in rows:
        for partner in row['coexists_with']:
            other = [r for r in rows if r['instance_id'] == partner]
            need(len(other) == 1 and row['instance_id'] in other[0]['coexists_with'], 'REGISTRY_PARTNERS')
    return doc


def registry(root=HERE):
    source_manifest(root)
    raw = read_file(Path(root) / REGISTRY)
    return validate_registry(json.loads(raw)), sha(raw)


def read_instance_policy(path, policy, root=HERE):
    policy = {k: v for k, v in policy.items() if k != 'port'}
    doc, _ = registry(root)
    rows = [r for r in doc['instances'] if r['instance_id'] == policy.get('instance_id') and r['kind'] == 'managed']
    need(len(rows) == 1 and str(Path(path).resolve()) == rows[0]['policy_path']
         and policy == rows[0]['policy'] and json.loads(read_file(Path(path), private=True)) == policy, 'POLICY')
    return rows[0]


def verify_binary(policy):
    path = Path(policy['adb_bin'])
    info = path.resolve(strict=True).stat()
    need(str(path.resolve(strict=True)) == policy['adb_realpath'] and stat.S_ISREG(info.st_mode)
         and not info.st_mode & 0o022 and os.access(path, os.X_OK)
         and sha(path.read_bytes()) == policy['adb_sha256'], 'BINARY')


def adb_environment(environment):
    return {k: v for k, v in environment.items()
            if k in ('HOME', 'PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TZ')}


def verifier_context(policy, config):
    row = read_instance_policy(config, policy)
    doc, registry_sha = registry()
    verifier = doc['startup_verifier']
    manifest = source_manifest(extra=(verifier['module'],))
    node = verifier['node']
    node_info = Path(node['path']).stat()
    need(str(Path(node['path']).resolve(strict=True)) == node['path']
         and stat.S_ISREG(node_info.st_mode) and not node_info.st_mode & 0o022 and os.access(node['path'], os.X_OK)
         and sha(Path(node['path']).read_bytes()) == node['sha256'], 'VERIFIER_BINARY')
    token = os.environ.get('BRAIN_INTERNAL_TOKEN')
    need(isinstance(token, str) and token and token.strip() == token
         and not any(c in token for c in ('\r', '\n', '\x00')), 'CREDENTIAL_REQUIRED')
    env = {k: v for k, v in os.environ.items() if k in ('HOME', 'PATH', 'LANG', 'TMPDIR')}
    env['BRAIN_INTERNAL_TOKEN'] = token
    return {'row': row, 'registry_sha256': registry_sha, 'manifest': manifest,
            'node': node, 'module': str(HERE / verifier['module']), 'env': env,
            'policy_sha256': sha(read_file(Path(config), private=True))}


VERIFIER_ERROR_CODES = frozenset({
    'EPOCH_ADMISSION_DRIFT',
    'EPOCH_ADMISSION_SCOPE',
    'EPOCH_AGENT_INPUT',
    'EPOCH_ARCHIVE',
    'EPOCH_BUSINESS_BINDING',
    'EPOCH_BUSINESS_CENTRAL',
    'EPOCH_BUSINESS_COMPANY',
    'EPOCH_BUSINESS_DRIFT',
    'EPOCH_BUSINESS_TASK',
    'EPOCH_BUSINESS_TASK_RUN',
    'EPOCH_CENTRAL_INVENTORY',
    'EPOCH_CLI_NOT_APPLICABLE',
    'EPOCH_CLI_USAGE',
    'EPOCH_DAEMON_IDENTITY',
    'EPOCH_DAEMON_LISTENER',
    'EPOCH_DAEMON_SCOPE',
    'EPOCH_DAEMON_SOURCE',
    'EPOCH_ENV_BINDING',
    'EPOCH_EVIDENCE_ROOT',
    'EPOCH_FROZEN_DRIFT',
    'EPOCH_FROZEN_REFERENCE',
    'EPOCH_HOST_INVENTORY',
    'EPOCH_LIVE_ROUTES',
    'EPOCH_LOCAL_HANDOFF',
    'EPOCH_POLICY_PATH',
    'EPOCH_RECORD_DIGEST',
    'EPOCH_REFERENCE_ID',
    'EPOCH_RUNTIME_SNAPSHOT',
    'EPOCH_SOURCE_POLICY',
})


def preserve_verifier_diagnostic(context, arguments, branch, returncode, stdout=b'', stderr=b''):
    descriptors = []
    try:
        if len(arguments) != 3 or arguments[:2] != ['verify-epoch', '--run-dir']:
            return
        run = Path(arguments[2])
        need(run.is_absolute() and str(run.resolve()) == str(run)
             and not any(p.is_symlink() for p in (run, *run.parents)), 'DIAGNOSTIC_PATH')

        def private_directory(path, parent=None):
            fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            descriptors.append(fd)
            info = os.fstat(fd)
            need(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
                 and stat.S_IMODE(info.st_mode) == 0o700, 'DIAGNOSTIC_DIRECTORY')
            return fd

        directory = private_directory(run)
        frozen = json.loads(read_file(run / 'run-definition.json', private=True))
        snapshot = frozen.pop('snapshot_sha256')
        canonical = json.dumps(frozen, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()
        public = frozen['public_domain']
        source = frozen['deployment']['source_commit']
        scope = frozen.get('discovery_phone_scope') or frozen.get('collection_phone_scope')
        identity = r'[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}'
        need(isinstance(snapshot, str) and re.fullmatch('[a-f0-9]{64}', snapshot) and sha(canonical) == snapshot
             and public['protocol'] == 'workflow-domain/v1'
             and re.fullmatch(identity, public['run_id']) and re.fullmatch(identity, public['task_id'])
             and source == context['manifest']['source_commit'] and re.fullmatch('[a-f0-9]{40}', source)
             and scope['source_commit'] == source, 'DIAGNOSTIC_BINDING')
        stdout = stdout.encode() if isinstance(stdout, str) else stdout or b''
        stderr = stderr.encode() if isinstance(stderr, str) else stderr or b''
        code = stderr.decode('ascii', errors='replace')
        code = code[:-1] if code.endswith('\n') else code
        diagnostic_code = code if code in VERIFIER_ERROR_CODES or code == 'DEVICE_EPOCH_FENCE_UNKNOWN' else None
        proof = {'protocol': 'epoch-verifier-diagnostic/v1', 'producer': 'python',
                 'attempt_id': str(uuid.uuid4()), 'observed_at': datetime.now(timezone.utc).isoformat(),
                 'pid': os.getpid(), 'run_id': public['run_id'], 'task_id': public['task_id'],
                 'source_commit': source, 'snapshot_sha256': snapshot, 'fold_branch': branch,
                 'returncode': returncode, 'stdout_bytes': len(stdout), 'stderr_bytes': len(stderr),
                 'stdout_sha256': sha(stdout), 'stderr_sha256': sha(stderr), 'node_error_code': diagnostic_code}
        raw = (json.dumps(proof, separators=(',', ':')) + '\n').encode()
        need(len(raw) <= 4096, 'DIAGNOSTIC_LIMIT')
        for name in ('epoch-fence-admission', 'diagnostics'):
            try:
                os.mkdir(name, mode=0o700, dir_fd=directory)
                os.fsync(directory)
            except FileExistsError:
                pass
            directory = private_directory(name, directory)
        need(all(re.fullmatch(r'(?:[0-2][0-9]|3[01])\.json', name) for name in os.listdir(directory)), 'DIAGNOSTIC_QUOTA')
        for slot in range(32):
            try:
                fd = os.open(f'{slot:02d}.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             0o600, dir_fd=directory)
            except FileExistsError:
                continue
            descriptors.append(fd)
            info = os.fstat(fd)
            need(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and info.st_nlink == 1
                 and stat.S_IMODE(info.st_mode) == 0o600, 'DIAGNOSTIC_FILE')
            offset = 0
            while offset < len(raw):
                count = os.write(fd, raw[offset:])
                need(count > 0, 'DIAGNOSTIC_WRITE')
                offset += count
            os.fsync(fd)
            os.fsync(directory)
            break
    except Exception:
        pass
    finally:
        for fd in reversed(descriptors):
            try:
                os.close(fd)
            except OSError:
                pass


def verifier_answer(context, arguments, runner):
    try:
        result = runner([context['node']['path'], context['module'], *arguments], env=context['env'],
                        capture_output=True, text=False, timeout=15)
    except subprocess.TimeoutExpired as error:
        preserve_verifier_diagnostic(context, arguments, 'timeout', None, error.stdout, error.stderr)
        raise ValueError('ADB_INSTANCE_VERIFIER_TIMEOUT') from None
    if result.returncode != 0:
        # The fixed Node boundary emits a single code line. Never disclose raw
        # subprocess diagnostics, commands, JSON, or caller-provided strings.
        stderr = result.stderr.decode('ascii', errors='replace') if isinstance(result.stderr, bytes) else result.stderr
        code = stderr[:-1] if stderr.endswith('\n') else stderr
        preserve_verifier_diagnostic(context, arguments, 'nonzero_allowlisted' if code in VERIFIER_ERROR_CODES else 'nonzero_unrecognized',
                                     result.returncode, result.stdout, result.stderr)
        need(code in VERIFIER_ERROR_CODES, 'VERIFIER_AUTHORITY')
        raise ValueError('ADB_INSTANCE_VERIFIER_' + code)
    if len(result.stdout.encode() if isinstance(result.stdout, str) else result.stdout) > 8192:
        preserve_verifier_diagnostic(context, arguments, 'stdout_limit', result.returncode, result.stdout, result.stderr)
    need(len(result.stdout.encode() if isinstance(result.stdout, str) else result.stdout) <= 8192, 'VERIFIER_AUTHORITY')
    try:
        answer = json.loads(result.stdout)
    except (ValueError, UnicodeError):
        preserve_verifier_diagnostic(context, arguments, 'json_invalid', result.returncode, result.stdout, result.stderr)
        raise
    if not isinstance(answer, dict) or answer.get('authorized') is not True:
        preserve_verifier_diagnostic(context, arguments, 'not_object' if not isinstance(answer, dict) else 'not_authorized',
                                     result.returncode, result.stdout, result.stderr)
    need(isinstance(answer, dict) and answer.get('authorized') is True, 'VERIFIER_AUTHORITY')
    return answer


def authorize_start(policy, config, receipt, runner=subprocess.run):
    # 每次启动均fresh核Task/lease；epoch租约迁移后旧receipt不能用于守护重启，须维护controller重新授权。
    need(isinstance(receipt, str) and Path(receipt).is_absolute(), 'STARTUP_RECEIPT_REQUIRED')
    c = verifier_context(policy, config)
    answer = verifier_answer(c, ['verify-startup', '--receipt', receipt, '--instance-id', c['row']['instance_id'],
                                '--registry-sha256', c['registry_sha256'], '--source', c['manifest']['source_commit'],
                                '--policy-sha256', c['policy_sha256']], runner)
    expected = {'protocol': 'device-epoch-fence-startup-verification/v1', 'authorized': True,
                'action': 'start_private_server', 'instance_id': c['row']['instance_id'], 'endpoint': policy['endpoint'],
                'source_commit': c['manifest']['source_commit'], 'registry_sha256': c['registry_sha256'],
                'policy_sha256': c['policy_sha256']}
    original = json.loads(read_file(Path(receipt), private=True))
    if answer.get('protocol') == 'device-epoch-fence-startup-verification/v1':
        need(answer == expected and original.get('protocol') != 'device-epoch-fence-resume-startup/v1', 'STARTUP_AUTHORITY')
        return expected
    extra = {'resume_plan_sha256', 'prior_pending_sha256', 'auth_ref_sha256', 'auth'}
    need(set(answer) == set(expected) | extra
         and answer['protocol'] == 'device-epoch-fence-startup-verification/v2'
         and all(answer[k] == v for k, v in expected.items() if k != 'protocol')
         and all(re.fullmatch('[a-f0-9]{64}', answer.get(k, '')) for k in extra - {'auth'}), 'STARTUP_AUTHORITY')
    need(original.get('protocol') == 'device-epoch-fence-resume-startup/v1'
         and all(original.get(k) == answer[k] for k in extra - {'auth'})
         and isinstance(answer['auth'], dict) and answer['auth'].get('ref_path') == original.get('auth_ref_path')
         and answer['auth'].get('ref_sha256') == answer['auth_ref_sha256'], 'STARTUP_AUTHORITY')
    authenticated_environment(policy, config, answer, {})
    return answer


def authenticated_environment(policy, config, answer, environment):
    # No external key/root argument. The fixed registry policy path derives the
    # private auth root; Node remains the sole Task/provenance/math authority.
    need(answer.get('protocol') == 'device-epoch-fence-startup-verification/v2'
         and answer.get('authorized') is True and answer.get('action') == 'start_private_server'
         and answer.get('instance_id') == policy.get('instance_id')
         and answer.get('endpoint') == policy.get('endpoint'), 'PRIVATE_AUTH_AUTHORITY')
    read_instance_policy(config, policy)
    manifest = source_manifest(extra=('adb-private-auth.py',))
    _, registry_sha = registry()
    need(answer.get('source_commit') == manifest['source_commit']
         and answer.get('registry_sha256') == registry_sha
         and answer.get('policy_sha256') == sha(read_file(Path(config), private=True)), 'PRIVATE_AUTH_AUTHORITY')
    path = HERE / 'adb-private-auth.py'
    module = types.ModuleType('adb_private_auth')
    module.__file__ = str(path)
    exec(compile(read_file(path), str(path), 'exec'), module.__dict__)
    verified = module.validate_auth(config, policy['instance_id'], answer.get('auth'))
    need(verified['ref_sha256'] == answer.get('auth_ref_sha256'), 'PRIVATE_AUTH_AUTHORITY')
    result = adb_environment(environment)
    result['ADB_VENDOR_KEYS'] = verified['key_path']
    return result


def authorize_epoch(policy, serial, run_dir, runner=subprocess.run):
    # Task、immutable record及epoch只由受保护run-definition派生；Python不另接任意引用或复制动态判断。
    need(isinstance(run_dir, str) and Path(run_dir).is_absolute()
         and str(Path(run_dir).resolve()) == run_dir, 'EPOCH_RUN_DIR')
    doc, _ = registry()
    rows = [r for r in doc['instances'] if r['kind'] == 'managed' and r['instance_id'] == policy.get('instance_id')]
    need(len(rows) == 1, 'EPOCH_INSTANCE')
    c = verifier_context(policy, rows[0]['policy_path'])
    answer = verifier_answer(c, ['verify-epoch', '--run-dir', run_dir], runner)
    keys = {'protocol', 'authorized', 'epoch_id', 'task_id', 'run_id', 'source_commit', 'instance_id',
            'endpoint', 'serial', 'old_route_absent', 'original_execution_stopped', 'android_internal'}
    need(set(answer) == keys and answer['protocol'] == 'device-epoch-fence-admission/v1'
         and answer['instance_id'] == policy['instance_id'] and answer['endpoint'] == policy['endpoint']
         and answer['serial'] == serial and answer['source_commit'] == c['manifest']['source_commit']
         and answer['old_route_absent'] is True and answer['original_execution_stopped'] is False
         and answer['android_internal'] == 'not_attested'
         and isinstance(answer['epoch_id'], str) and re.fullmatch('[-A-Za-z0-9_]{1,120}', answer['epoch_id'])
         and isinstance(answer['run_id'], str) and re.fullmatch('[-A-Za-z0-9_]{1,200}', answer['run_id'])
         and isinstance(answer['task_id'], str) and re.fullmatch(
             '[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', answer['task_id']), 'EPOCH_AUTHORITY')
    return answer

#!/usr/bin/env python3
"""ADB声明式实例规矩；只读源码registry、固定policy与维护启动授权，不创建服务。"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess

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


def authorize_start(policy, config, receipt, runner=subprocess.run):
    # 每次启动均fresh核Task/lease；epoch租约迁移后旧receipt不能用于守护重启，须维护controller重新授权。
    need(isinstance(receipt, str) and Path(receipt).is_absolute(), 'STARTUP_RECEIPT_REQUIRED')
    row = read_instance_policy(config, policy)
    doc, registry_sha = registry()
    verifier = doc['startup_verifier']
    manifest = source_manifest(extra=(verifier['module'],))
    node = verifier['node']
    node_info = Path(node['path']).stat()
    need(str(Path(node['path']).resolve(strict=True)) == node['path']
         and stat.S_ISREG(node_info.st_mode) and not node_info.st_mode & 0o022 and os.access(node['path'], os.X_OK)
         and sha(Path(node['path']).read_bytes()) == node['sha256'], 'VERIFIER_BINARY')
    policy_sha = sha(read_file(Path(config), private=True))
    token = os.environ.get('BRAIN_INTERNAL_TOKEN')
    need(isinstance(token, str) and token and token.strip() == token
         and not any(c in token for c in ('\r', '\n', '\x00')), 'CREDENTIAL_REQUIRED')
    verifier_env = {k: v for k, v in os.environ.items() if k in ('HOME', 'PATH', 'LANG', 'TMPDIR')}
    verifier_env['BRAIN_INTERNAL_TOKEN'] = token
    result = runner([node['path'], str(HERE / verifier['module']), 'verify-startup', '--receipt', receipt,
                     '--instance-id', row['instance_id'], '--registry-sha256', registry_sha,
                     '--source', manifest['source_commit'], '--policy-sha256', policy_sha],
                    env=verifier_env,
                    capture_output=True, text=True, timeout=15)
    expected = {'protocol': 'device-epoch-fence-startup-verification/v1', 'authorized': True,
                'action': 'start_private_server', 'instance_id': row['instance_id'], 'endpoint': policy['endpoint'],
                'source_commit': manifest['source_commit'], 'registry_sha256': registry_sha, 'policy_sha256': policy_sha}
    need(result.returncode == 0 and len(result.stdout.encode()) <= 8192, 'STARTUP_AUTHORITY')
    answer = json.loads(result.stdout)
    need(isinstance(answer, dict) and answer.get('authorized') is True and answer == expected, 'STARTUP_AUTHORITY')
    return expected

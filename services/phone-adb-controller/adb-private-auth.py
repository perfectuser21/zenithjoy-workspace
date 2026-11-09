#!/usr/bin/env python3
"""复核Node已批准authref的静态私有字节；不取凭据、不连接、不授动态权限。"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat


def need(ok):
    if not ok:
        raise ValueError('ADB_INSTANCE_PRIVATE_AUTH_INVALID')


def sha(value):
    return hashlib.sha256(value).hexdigest()


def digest(value):
    return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value)


def directory(path):
    info = path.lstat()
    need(stat.S_ISDIR(info.st_mode) and info.st_uid in (0, os.geteuid())
         and stat.S_IMODE(info.st_mode) == 0o700)


def private(path, root):
    need(isinstance(path, str) and Path(path).is_absolute() and ':' not in path)
    path = Path(path)
    need(path.resolve(strict=True) == path and path != root and root in path.parents
         and not any(p.is_symlink() for p in (path, *path.parents)))
    for parent in path.parents:
        if parent == root.parent:
            directory(parent)
            break
        directory(parent)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_uid in (0, os.geteuid()) and info.st_nlink == 1
             and stat.S_IMODE(info.st_mode) == 0o600 and info.st_size <= 4*1024*1024)
        with os.fdopen(os.dup(fd), 'rb') as source:
            raw = source.read(4*1024*1024+1)
        after = path.lstat()
        need(len(raw) <= 4*1024*1024 and
             (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns) ==
             (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns))
        return raw
    finally:
        os.close(fd)


def validate_auth(policy_path, instance_id, auth):
    need(re.fullmatch('[a-z][a-z0-9-]{2,63}', instance_id or '')
         and isinstance(policy_path, str) and Path(policy_path).is_absolute())
    root = Path(policy_path).parent / 'adb-auth' / instance_id
    need(root.resolve(strict=True) == root and '.android' not in root.parts)
    need(isinstance(auth, dict) and set(auth) == {'ref_path', 'ref_sha256', 'key_path', 'key_sha256', 'public_key_sha256'}
         and all(digest(auth[k]) for k in ('ref_sha256', 'key_sha256', 'public_key_sha256')))
    raw = private(auth['ref_path'], root)
    need(sha(raw) == auth['ref_sha256'])
    ref = json.loads(raw)
    need(isinstance(ref, dict) and set(ref) == {'protocol', 'instance_id', 'resource', 'key', 'credential', 'provenance'}
         and ref['protocol'] == 'device-epoch-fence-auth-ref/v1' and ref['instance_id'] == instance_id)
    resource = ref['resource']
    need(isinstance(resource, dict) and set(resource) == {'serial', 'cloud_instance_id', 'region_id'}
         and all(isinstance(v, str) and v and '\x00' not in v for v in resource.values()))
    key = ref['key']
    need(isinstance(key, dict) and set(key) == {'path', 'sha256', 'public_path', 'public_key_sha256', 'key_pair_id'}
         and key['path'] == auth['key_path'] and key['sha256'] == auth['key_sha256']
         and key['public_key_sha256'] == auth['public_key_sha256']
         and isinstance(key['key_pair_id'], str) and key['key_pair_id'])
    need(sha(private(key['path'], root)) == key['sha256']
         and sha(private(key['public_path'], root)) == key['public_key_sha256'])
    credential = ref['credential']
    need(isinstance(credential, dict) and set(credential) == {'provider', 'item_id', 'version', 'compromised', 'valid_from', 'expires_at'}
         and credential['provider'] == '1password' and credential['compromised'] is False
         and isinstance(credential['item_id'], str) and credential['item_id']
         and type(credential['version']) is int and credential['version'] > 0)
    # 0 is unset, never evidence of expiration. Node alone judges official dates.
    for key_name in ('valid_from', 'expires_at'):
        value = credential[key_name]
        need(type(value) is int and value == 0 or isinstance(value, str) and value)
    provenance = ref['provenance']
    need(isinstance(provenance, dict) and set(provenance) == {'attach', 'keypair'})
    for original in provenance.values():
        need(isinstance(original, dict) and set(original) == {'path', 'sha256'} and digest(original['sha256'])
             and sha(private(original['path'], root)) == original['sha256'])
    return {'key_path': auth['key_path'], 'ref_sha256': auth['ref_sha256']}

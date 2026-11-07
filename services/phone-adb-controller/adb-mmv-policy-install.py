#!/usr/bin/env python3
"""Install only the frozen MMV cloud policy; never manage an ADB server or launchd job."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import socket
import stat
import sys

HERE = Path(__file__).resolve().parent
FILES = ('adb-mmv-policy-install.py', 'adb-existing-route.py',
         'config/collection-phone-hosts.json', 'install-adb-host-service.sh')


def need(value, code):
    if not value:
        raise ValueError('ADB_MMV_INSTALL_' + code)


def regular(path, *, private=False):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError as error:
        raise ValueError('ADB_MMV_INSTALL_FILE_UNREADABLE') from error
    with os.fdopen(fd, 'rb') as source:
        info = os.fstat(source.fileno())
        need(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid()
             and info.st_nlink == 1, 'FILE_IDENTITY')
        if private:
            need(stat.S_IMODE(info.st_mode) == 0o600, 'FILE_PERMISSIONS')
        raw = source.read()
        after = os.lstat(path)
        need((info.st_dev, info.st_ino) == (after.st_dev, after.st_ino), 'FILE_CHANGED')
        return raw


def no_links(path):
    for parent in [path, *path.parents]:
        need(not parent.is_symlink(), 'SYMLINK_PATH')


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def inspect_route(policy):
    # Execute the checked source bytes, never a timestamp-valid but unfrozen pyc.
    path = HERE / 'adb-existing-route.py'
    namespace = {'__name__': 'mmv_install_route', '__file__': str(path)}
    exec(compile(regular(path), str(path), 'exec'), namespace)
    return namespace['inspect_managed_host']({**policy, 'port': 5041})


def install(manifest_path, source_commit):
    user = pwd.getpwuid(os.geteuid())
    need(os.geteuid() != 0 and user.pw_name == 'administrator'
         and os.environ.get('HOME') == user.pw_dir, 'USER_HOME')
    need(socket.gethostname().lower().split('.')[0] in ('r10-7', 'aad17-2'), 'HOST_IDENTITY')
    home = Path(user.pw_dir)
    no_links(home)
    manifest_path = Path(manifest_path)
    need(manifest_path.is_absolute() and manifest_path.parent == HERE
         and manifest_path.name == 'deployment-manifest.json', 'INSTALLED_ROOT')
    no_links(manifest_path)
    manifest = json.loads(regular(manifest_path))
    need(re.fullmatch('[a-f0-9]{40}', source_commit or '')
         and manifest.get('source_commit') == source_commit
         and manifest.get('source_repo') == 'perfectuser21/zenithjoy-workspace'
         and manifest.get('target') == 'mmv', 'MANIFEST_SOURCE')
    for name in FILES:
        path = HERE / name
        no_links(path)
        rows = [row for row in manifest.get('files', [])
                if row.get('path') == 'services/phone-adb-controller/' + name]
        need(len(rows) == 1 and rows[0].get('deployed_path') == name
             and rows[0].get('content_sha256') == hashlib.sha256(regular(path)).hexdigest(), 'MANIFEST_BYTES')
    hosts = json.loads(regular(HERE / 'config/collection-phone-hosts.json'))
    rows = [row for row in hosts['hosts']
            if row['target'] == 'mmv' and row['profile'] == 'cloud-phone-test']
    need(len(rows) == 1, 'COLLECTION_HOST')
    row = rows[0]
    policy = row['policy']
    need(row['serial'] == '47.100.213.173:10001' and row['expected_account'] == '77980009922'
         and policy['schema_version'] == 1 and policy['host_id'] == 'mmv'
         and policy['transport'] == 'tcp' and policy['endpoint'] == 'tcp:127.0.0.1:5041'
         and policy['forbidden_ports'] == [], 'COLLECTION_POLICY')
    binary = Path(policy['adb_bin'])
    need(binary.is_absolute() and str(binary.resolve(strict=True)) == policy['adb_realpath']
         and hashlib.sha256(binary.read_bytes()).hexdigest() == policy['adb_sha256'], 'ADB_BINARY')
    measured = inspect_route(policy)
    need(measured['host_id'] == 'mmv' and measured['endpoint'] == policy['endpoint']
         and measured['port'] == 5041
         and [x for x in measured['devices'] if x['serial'] == row['serial']]
         == [{'serial': row['serial'], 'state': 'device'}], 'ROUTE_READBACK')
    base = home / '.config/zenithjoy'
    no_links(base)
    base.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = base.lstat()
    need(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
         and stat.S_IMODE(info.st_mode) == 0o700, 'PRIVATE_DIRECTORY')
    active = base / 'adb-service.json'
    raw = (json.dumps(policy, sort_keys=True) + '\n').encode()
    created = False
    try:
        fd = os.open(active, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        need(json.loads(regular(active, private=True)) == policy, 'ACTIVE_POLICY_CONFLICT')
    else:
        with os.fdopen(fd, 'wb') as out:
            out.write(raw)
            out.flush()
            os.fsync(out.fileno())
        sync_directory(base)
        created = True
    need(json.loads(regular(active, private=True)) == policy, 'ACTIVE_READBACK')
    return {'created': created, 'config': str(active), 'source_commit': source_commit,
            'policy': policy, 'policy_sha256': hashlib.sha256(regular(active, private=True)).hexdigest(),
            'route': inspect_route(policy), 'server_lifecycle_changed': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--source', required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(install(args.manifest, args.source), sort_keys=True))
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)

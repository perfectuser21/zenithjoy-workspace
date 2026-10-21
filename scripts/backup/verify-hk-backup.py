#!/usr/bin/env python3
"""从HK取真实每日备份到私有异地目录，并在无网络容器内恢复验证。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import uuid

RESTORE_DATABASE = 'cecelia_scratch'
IMAGE = 'mirror.gcr.io/library/postgres:17.10'
REMOTE_ROOT = '/opt/zenithjoy-backups/hk-local'
SOURCE_SCRIPT = r'''
import hashlib,json,pathlib,re
root=pathlib.Path('/opt/zenithjoy-backups/hk-local')
out=[]
for db in ['zenithjoy','zenithjoy_staging']:
 files=sorted(p for p in root.glob(db+'-*.dump') if re.fullmatch(re.escape(db)+r'-\d{8}-\d{6}\.dump',p.name))
 if not files:raise RuntimeError('missing backup: '+db)
 p=files[-1];st=p.stat();h=hashlib.sha256()
 with p.open('rb') as f:
  for chunk in iter(lambda:f.read(1048576),b''):h.update(chunk)
 out.append(dict(database=db,name=p.name,size=st.st_size,mtime=st.st_mtime,sha256=h.hexdigest()))
print(json.dumps(out))
'''


def command(args, **kwargs):
    kwargs.setdefault('timeout', 600)
    return subprocess.run(args, check=True, **kwargs)


def file_digest(path):
    digest = hashlib.sha256()
    with path.open('rb') as data:
        for chunk in iter(lambda: data.read(1048576), b''):
            digest.update(chunk)
    return digest.hexdigest()


def validate_source(item):
    db = item.get('database')
    if db not in ('zenithjoy', 'zenithjoy_staging'):
        raise ValueError('unexpected source database')
    if not re.fullmatch(re.escape(db) + r'-\d{8}-\d{6}\.dump', item.get('name', '')):
        raise ValueError('invalid backup filename')
    if not re.fullmatch(r'[a-f0-9]{64}', item.get('sha256', '')):
        raise ValueError('invalid source checksum')
    if not isinstance(item.get('size'), int) or item['size'] <= 0:
        raise ValueError('empty backup')
    age = time.time() - item.get('mtime', 0)
    if age < -300 or age > 36 * 3600:
        raise ValueError('backup is stale or timestamp is in the future')


def validate_run_id(run_id):
    if not re.fullmatch(r'[a-f0-9]{32}', run_id):
        raise ValueError('invalid backup run identity')
    return run_id


def cleanup_run(run_id):
    """只回收本次run且用途/原生容器ID/名称均核实的隔离容器。"""
    validate_run_id(run_id)
    result = command(['docker', 'ps', '-aq', '--no-trunc', '--filter',
                      'label=zenithjoy.backup-run=' + run_id], capture_output=True, text=True, timeout=30)
    for identity in result.stdout.split():
        if not re.fullmatch(r'[a-f0-9]{64}', identity):
            raise ValueError('invalid container identity')
        item = json.loads(command(['docker', 'inspect', identity], capture_output=True, text=True, timeout=30).stdout)[0]
        labels = item.get('Config', {}).get('Labels', {}) or {}
        if (item.get('Id') != identity or labels.get('zenithjoy.backup-run') != run_id
                or labels.get('zenithjoy.purpose') != 'isolated-backup-restore'
                or not item.get('Name', '').startswith('/zj-backup-proof-' + run_id + '-')):
            raise ValueError('container ownership mismatch; refusing cleanup')
        command(['docker', 'stop', '--time', '10', identity], capture_output=True, timeout=30)
        command(['docker', 'rm', '-v', identity], capture_output=True, timeout=30)


def container_args(name, run_id=None):
    run_id = validate_run_id(run_id or uuid.uuid4().hex)
    return ['docker', 'run', '-d', '--name', name, '--network', 'none',
            '--label', 'zenithjoy.purpose=isolated-backup-restore',
            '--label', 'zenithjoy.backup-run=' + run_id,
            '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', IMAGE]


def validate_restored(counts, expected_data_objects):
    if len(counts) < expected_data_objects or not counts or not any(x['rows'] > 0 for x in counts):
        raise ValueError('restore contains missing tables or no actual rows')


def verify_restore(dump, run_id=None):
    run_id = validate_run_id(run_id or uuid.uuid4().hex)
    name = 'zj-backup-proof-' + run_id + '-' + uuid.uuid4().hex[:8]
    started = False
    try:
        command(container_args(name, run_id), capture_output=True)
        started = True
        for _ in range(60):
            ready = subprocess.run(['docker', 'exec', name, 'pg_isready', '-U', 'postgres'], capture_output=True)
            if ready.returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError('isolated restore server not ready')
        command(['docker', 'exec', name, 'createdb', '-U', 'postgres', RESTORE_DATABASE], capture_output=True)
        with dump.open('rb') as source:
            toc = command(['docker', 'exec', '-i', name, 'pg_restore', '--list'], stdin=source, capture_output=True).stdout.decode()
        expected = sum(' TABLE DATA ' in line for line in toc.splitlines())
        if expected < 1:
            raise ValueError('dump has no table data objects')
        with dump.open('rb') as source:
            command(['docker', 'exec', '-i', name, 'pg_restore', '--exit-on-error', '--no-owner', '--no-acl',
                     '-U', 'postgres', '-d', RESTORE_DATABASE], stdin=source, capture_output=True)
        psql = ['docker', 'exec', name, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', RESTORE_DATABASE, '-Atc']
        sql = "SELECT json_agg(json_build_object('schema',schemaname,'table',tablename)) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')"
        tables = json.loads(command(psql + [sql], capture_output=True, text=True).stdout) or []
        counts = []
        for table in tables:
            quoted = '.'.join('"' + table[key].replace('"', '""') + '"' for key in ('schema', 'table'))
            count = int(command(psql + ['SELECT count(*) FROM ' + quoted], capture_output=True, text=True).stdout)
            counts.append({**table, 'rows': count})
        validate_restored(counts, expected)
        return {'image': IMAGE, 'container': name, 'network': 'none', 'database': RESTORE_DATABASE,
                'dump_data_objects': expected, 'tables': counts, 'total_rows': sum(x['rows'] for x in counts)}
    finally:
        # 只清理本次创建的唯一容器；从不连接或删除生产容器/数据库。
        if started:
            command(['docker', 'stop', '--time', '10', name], capture_output=True)
            command(['docker', 'rm', '-v', name], capture_output=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-id', default=uuid.uuid4().hex)
    parser.add_argument('--host', default='hk-vps')
    parser.add_argument('--store', type=Path, required=True)
    args = parser.parse_args()
    run_id = validate_run_id(args.run_id)
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.@-]*', args.host):
        parser.error('invalid SSH host')
    os.umask(0o077)
    store = args.store.expanduser().resolve()
    store.mkdir(parents=True, exist_ok=True, mode=0o700)
    store.chmod(0o700)
    source = command(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', args.host, 'python3', '-'],
                     input=SOURCE_SCRIPT, text=True, capture_output=True)
    items = json.loads(source.stdout)
    if len(items) != 2 or {i.get('database') for i in items} != {'zenithjoy', 'zenithjoy_staging'}:
        raise ValueError('missing or duplicate database backups')
    for item in items:
        validate_source(item)
    try:
        command(['docker', 'pull', IMAGE], capture_output=True)
        proofs = []
        for item in items:
            target = store / (item['sha256'] + '.dump')
            part = store / (uuid.uuid4().hex + '.partial')
            try:
                command(['scp', '-q', '-o', 'BatchMode=yes', args.host + ':' + REMOTE_ROOT + '/' + item['name'], str(part)])
                digest = file_digest(part)
                if part.stat().st_size != item['size'] or digest != item['sha256']:
                    raise ValueError('offsite bytes differ from source backup')
                if target.exists():
                    if file_digest(target) != digest:
                        raise ValueError('existing immutable offsite backup is corrupt')
                else:
                    part.chmod(0o600)
                    os.replace(part, target)
                proof = {'source': item, 'offsite_path': str(target), 'verified_at': time.time(),
                         'restore': verify_restore(target, run_id), 'status': 'verified'}
                proof_path = store / (item['sha256'] + '.proof.json')
                proof_path.write_text(json.dumps(proof, ensure_ascii=False, indent=2) + '\n')
                proofs.append({'database': item['database'], 'sha256': digest, 'proof': str(proof_path)})
            finally:
                part.unlink(missing_ok=True)
    finally:
        cleanup_run(run_id)
    print(json.dumps({'status': 'verified', 'backups': proofs}, ensure_ascii=False))


if __name__ == '__main__':
    main()

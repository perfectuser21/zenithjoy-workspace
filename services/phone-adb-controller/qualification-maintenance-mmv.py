#!/usr/bin/env python3
"""只读固定353 staging RPC执行域；Gateway模型owner另行核验。"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
SUPPORTED = '353b910f11ce3852b2ef69c8ead5c37e97850b4a'


def need(value):
    if not value:
        raise ValueError('MAINTENANCE_MMV_RPC_UNKNOWN')


def parse_cwds(raw):
    result, pid, descriptor = {}, None, False
    for line in raw.splitlines():
        if line.startswith('p') and line[1:].isdigit():
            need(pid is None or pid in result)
            pid = int(line[1:])
            need(pid not in result)
            descriptor = False
        elif line == 'fcwd':
            need(pid is not None and pid not in result and not descriptor)
            descriptor = True
        elif line.startswith('n'):
            need(pid is not None and pid not in result and line[1:].startswith('/'))
            result[pid] = line[1:]
        else:
            need(False)
    need(pid is None or pid in result)
    return result


def classify_rpc(executable, argv, cwd, scope):
    # 353 createRpc在固定staging根cd后启动；其固定程序不创建改cwd的后台RPC。
    potential = bool(re.fullmatch(r'node(?:[0-9]+)?|python(?:[0-9]+(?:\.[0-9]+)*)?|(?:ba|z)?sh|ssh|scp|sftp|ffmpeg', Path(executable).name, re.I))
    if potential and (argv is None or cwd is None):
        return 'unknown'
    values = [scope['runtime_root'], scope['run_tag'], scope['run_id'], scope['consumer_source']]
    if cwd and (cwd == scope['runtime_root'] or cwd.startswith(scope['runtime_root'] + '/')):
        return 'related'
    if argv and any(value in arg for arg in argv for value in values):
        return 'related'
    return 'outside_fixed_rpc_domain'


def bind_cwd_identity(before, after):
    need(before is not None and after is not None and before['pid'] == after['pid']
         and before['start_identity'] == after['start_identity'])


def cwd_command(platform, uid):
    need(platform in ('darwin', 'linux'))
    binary = '/usr/sbin/lsof' if platform == 'darwin' else '/usr/bin/lsof'
    return [binary, '-a', '-u', str(uid), '-d', 'cwd', '-Fpn']


def collect_mmv(scope):
    need(scope.get('consumer_source') == SUPPORTED and re.fullmatch(r'[A-Za-z0-9_-]{1,120}', scope.get('run_tag', '')))
    root = str(Path.home() / '.local/share/zenithjoy/phone-candidates' / SUPPORTED / 'runtime')
    bound = {**scope, 'runtime_root': root, 'run_id': 'douyin_video_processing-' + scope['run_tag'] + '__a1'}
    spec = importlib.util.spec_from_file_location('processes', HERE / 'qualification-maintenance-processes.py')
    processes = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(processes)
    started = int(time.time() * 1000)
    first = [row for row in processes.listed() if row['uid'] == os.getuid() and row['pid'] > 1]
    before_cwd = {}
    for row in first:
        try:
            before_cwd[row['pid']] = processes.kernel(row['pid'])
        except Exception:
            before_cwd[row['pid']] = None
    p = subprocess.run(cwd_command(sys.platform, os.getuid()),
                       capture_output=True, text=True, timeout=5)
    need(p.returncode == 0 and 0 < len(p.stdout.encode()) < 4 * 1024 * 1024)
    cwds = parse_cwds(p.stdout)
    covered, matches, unknown = {}, [], []

    def observe(row):
        pid = row['pid']
        if pid == os.getpid():
            identity = processes.kernel(pid)
            need(identity is not None)
            covered[pid] = identity['start_identity']
            return
        try:
            before = processes.kernel(pid)
            if before is None:
                covered[pid] = 'ESRCH'
                return
            if before['terminal']:
                covered[pid] = before['start_identity']
                return
            bind_cwd_identity(before_cwd.get(pid), before)
            executable, argv = processes.args(pid)
            after = processes.kernel(pid)
            if after is None:
                covered[pid] = 'ESRCH'
                return
            need(before['start_identity'] == after['start_identity'])
            classification = classify_rpc(executable, argv, cwds.get(pid), bound)
            covered[pid] = after['start_identity']
            item = {'pid': pid, 'start_identity': after['start_identity'],
                    'argv_sha256': hashlib.sha256(json.dumps(argv).encode()).hexdigest(),
                    'cwd_sha256': hashlib.sha256(cwds.get(pid, '').encode()).hexdigest()}
            if classification == 'related':
                matches.append(item)
            elif classification == 'unknown':
                unknown.append(item)
        except Exception:
            try:
                if processes.kernel(pid) is None:
                    covered[pid] = 'ESRCH'
                    return
            except Exception:
                pass
            unknown.append({'pid': pid, 'reason': 'identity_or_cwd_unknown'})

    for row in first:
        observe(row)
    final = [row for row in processes.listed() if row['uid'] == os.getuid() and row['pid'] > 1]
    for row in final:
        try:
            actual = processes.kernel(row['pid'])
            if actual is None:
                covered[row['pid']] = 'ESRCH'
            elif covered.get(row['pid']) != actual['start_identity']:
                unknown.append({'pid': row['pid'], 'reason': 'final_identity_not_covered'})
        except Exception:
            unknown.append({'pid': row['pid'], 'reason': 'final_identity_unknown'})
    digest = lambda value: hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return {'status': 'verified_inactive' if not matches and not unknown else 'blocked',
            'domain': 'fixed353_mmv_rpc', 'source_commit': SUPPORTED, 'run_tag': bound['run_tag'], 'run_id': bound['run_id'],
            'observer_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'process_observer_sha256': hashlib.sha256((HERE / 'qualification-maintenance-processes.py').read_bytes()).hexdigest(),
            'observed_at_ms': started, 'completed_at_ms': int(time.time() * 1000),
            'enumerated_sha256': digest(first), 'final_enumerated_sha256': digest(final),
            'coverage_sha256': digest(covered), 'enumerated_count': len(first), 'final_count': len(final),
            'matches': matches, 'unknown': unknown, 'os_full_stop': False}


if __name__ == '__main__':
    try:
        value = json.loads(sys.stdin.read(65537))
        print(json.dumps(collect_mmv(value)))
    except Exception:
        print(json.dumps({'status': 'blocked', 'code': 'MAINTENANCE_MMV_RPC_UNKNOWN'}))
        sys.exit(1)

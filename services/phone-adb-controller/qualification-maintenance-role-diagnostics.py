#!/usr/bin/env python3
"""开发诊断：代码摘要/cwd/launchd归属；不判effects、不发信号、不操作手机或锁。"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import re
import stat
import subprocess
import sys

HERE = Path(__file__).resolve()
spec = importlib.util.spec_from_file_location('maintenance_processes', HERE.with_name('qualification-maintenance-processes.py'))
processes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(processes)


def diagnostic_input(scope):
    keys = {'host', 'uid', 'run_tag', 'serial', 'run_dir', 'runtime_root', 'run_started_at_ms', 'tracked'}
    if not isinstance(scope, dict) or set(scope) != keys:
        return {'status': 'blocked'}
    return {'status': 'diagnostic_only'}


def parse_cwds(raw, pids):
    selected = set(pids)
    result = {}
    pid = None
    for line in raw.splitlines():
        if re.fullmatch(r'p[0-9]+', line):
            pid = int(line[1:])
        elif line.startswith('n/') and pid in selected:
            if str(pid) in result:
                raise ValueError('DUPLICATE_CWD')
            result[str(pid)] = line[1:]
    return result


def parse_launchd_list(raw, pids):
    result = []
    for line in raw.splitlines():
        parts = line.split()
        if len(parts) == 3 and parts[0].isdigit() and int(parts[0]) in pids and re.fullmatch(r'[A-Za-z0-9_.-]+', parts[2]):
            result.append({'pid': int(parts[0]), 'label': parts[2]})
    return result


def file_identity(path):
    path = Path(path).resolve(strict=True)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size > 256 * 1024 * 1024:
            raise ValueError('FILE_BOUND')
        digest = hashlib.sha256()
        total = 0
        while True:
            chunk = os.read(fd, 1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > 256 * 1024 * 1024:
                raise ValueError('FILE_BOUND')
            digest.update(chunk)
        after = os.fstat(fd)
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
            raise ValueError('FILE_CHANGED')
        return {'realpath': str(path), 'sha256': digest.hexdigest(), 'uid': after.st_uid, 'bytes': total}
    finally:
        os.close(fd)


def main(scope):
    if diagnostic_input(scope)['status'] != 'diagnostic_only' or sys.platform != 'darwin':
        raise ValueError('DIAGNOSTIC_INPUT')
    census = processes.collect(scope)
    potential = re.compile(r'^(?:python(?:[0-9]+(?:\.[0-9]+)*)?|node(?:[0-9]+)?|bash|zsh|sh|sleep|ssh|scp|sftp|adb|scrcpy|ffmpeg|ffprobe|curl)$', re.I)
    rows = [r for r in census['observations'] if r.get('executable') and potential.fullmatch(Path(r['executable']).name)]
    if len(rows) > 64:
        raise ValueError('ROLE_BOUND')
    pids = [r['pid'] for r in rows]
    details = {}
    cache = {}
    for row in rows:
        try:
            path = row['executable']
            if path not in cache:
                cache[path] = file_identity(path)
            current = processes.kernel(row['pid'])
            if current is None:
                details[str(row['pid'])] = {'state': 'absent', 'reason': 'ESRCH'}
            elif current['start_identity'] != row['start_identity']:
                details[str(row['pid'])] = {'state': 'identity_changed'}
            else:
                details[str(row['pid'])] = {'state': 'observed', 'executable': cache[path], 'kernel': current}
        except (OSError, ValueError):
            details[str(row['pid'])] = {'state': 'unknown'}
    cwds = subprocess.run(['/usr/sbin/lsof', '-a', '-p', ','.join(map(str, pids)), '-d', 'cwd', '-Fpn'], capture_output=True, text=True, timeout=5)
    launch = subprocess.run(['/bin/launchctl', 'list'], capture_output=True, text=True, timeout=5)
    if len(cwds.stdout) > 1024 * 1024 or len(launch.stdout) > 1024 * 1024:
        raise ValueError('ROLE_OUTPUT_BOUND')
    roles = parse_launchd_list(launch.stdout, pids) if launch.returncode == 0 else []
    for role in roles:
        path = Path.home() / 'Library' / 'LaunchAgents' / (role['label'] + '.plist')
        try:
            role['plist'] = file_identity(path)
            definition = plistlib.loads(path.read_bytes())
            argv = definition.get('ProgramArguments')
            if isinstance(argv, list) and argv and all(isinstance(a, str) for a in argv):
                role['program'] = processes.describe_program(argv[0], argv)
                role['arguments_sha256'] = hashlib.sha256(json.dumps(argv, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
        except (OSError, ValueError, plistlib.InvalidFileException):
            role['metadata_status'] = 'unknown'
    return {'classification': 'DIAGNOSTIC_ONLY_NO_EFFECTS_ADMISSION', 'reader_sha256': hashlib.sha256(HERE.read_bytes()).hexdigest(),
            'census': census, 'role_details': details, 'cwd_command_exit': cwds.returncode,
            'cwds': parse_cwds(cwds.stdout, pids), 'launchd_command_exit': launch.returncode, 'launchd_roles': roles}


if __name__ == '__main__':
    try:
        raw = sys.stdin.buffer.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise ValueError('INPUT_BOUND')
        print(json.dumps(main(json.loads(raw))))
    except Exception:
        print(json.dumps({'classification': 'DIAGNOSTIC_UNKNOWN'}))
        sys.exit(1)

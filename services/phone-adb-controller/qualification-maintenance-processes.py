#!/usr/bin/env python3
"""固定资格程序域的只读kernel观察；不输出argv正文，不发任何停止信号。"""
import ctypes
import errno
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

EFFECTORS = ('python', 'node', 'adb', 'scrcpy', 'zsh', 'bash', 'sh', 'sleep', 'ssh', 'scp', 'sftp', 'ffmpeg', 'ffprobe', 'curl')
READONLY_PYTHON = {
    'a6a8fab5ecc72f1f15e21cafeb27744488cf5495a52db735932d17d6d2aeebd2',
    'cecd8eb83bd1696e1f877bcaf43a4fb1659b839531b800f4ea528ca1abfebdcb',
}
HERE = Path(__file__).resolve()


def need(value, code):
    if not value:
        raise ValueError(code)


def listed():
    p = subprocess.run(['/bin/ps', '-axo', 'pid=,uid=,ppid=,pgid='],
                       capture_output=True, text=True, timeout=3, check=True)
    need(len(p.stdout.encode()) < 4 * 1024 * 1024, 'PROCESS_ENUMERATION_LIMIT')
    rows = []
    for line in p.stdout.splitlines():
        f = line.split()
        # Darwin的nobody在ps中显示为-2，实际uid_t为无符号4294967294。
        need(len(f) == 4 and all(f[i].isdigit() for i in (0, 2, 3))
             and re.fullmatch(r'-?\d+', f[1]), 'PROCESS_ENUMERATION_INVALID')
        row = dict(zip(('pid', 'uid', 'ppid', 'pgid'), map(int, f)))
        need(-(2 ** 31) <= row['uid'] < 2 ** 32, 'PROCESS_ENUMERATION_INVALID')
        row['uid'] %= 2 ** 32
        need(row['pid'] > 0, 'PROCESS_ENUMERATION_INVALID')
        rows.append(row)
    need(rows and len(rows) <= 20000 and len({r['pid'] for r in rows}) == len(rows), 'PROCESS_ENUMERATION_INVALID')
    return rows


def linux_kernel(pid):
    try:
        text = Path('/proc/%d/stat' % pid).read_text()
        f = text[text.rfind(')') + 2:].split()
        uid = Path('/proc/%d' % pid).stat().st_uid
        boot = next(int(x.split()[1]) for x in Path('/proc/stat').read_text().splitlines() if x.startswith('btime '))
        return {'pid': pid, 'uid': uid, 'ppid': int(f[1]), 'pgid': int(f[2]),
                'start_identity': f[19], 'start_ms': (boot + int(f[19]) / os.sysconf('SC_CLK_TCK')) * 1000,
                'terminal': f[0] == 'Z'}
    except (FileNotFoundError, ProcessLookupError):
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return None
        raise ValueError('PROCESS_KERNEL_UNKNOWN')


def darwin_kernel(pid):
    spec = importlib.util.spec_from_file_location('maintenance_kernel', HERE.with_name('adb-process-observation.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    need(ctypes.sizeof(module.BSDInfo) == 136, 'PROCESS_KERNEL_LAYOUT')
    lib = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
    info = module.BSDInfo()
    ctypes.set_errno(0)
    size = lib.proc_pidinfo(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info))
    if size == 0 and ctypes.get_errno() == errno.ESRCH:
        return None
    need(size == 136 and info.pbi_pid == pid and info.pbi_start_tvsec > 0, 'PROCESS_KERNEL_UNKNOWN')
    return {'pid': pid, 'uid': int(info.pbi_uid), 'ppid': int(info.pbi_ppid), 'pgid': int(info.pbi_pgid),
            'start_identity': '%d:%d' % (info.pbi_start_tvsec, info.pbi_start_tvusec),
            'start_ms': info.pbi_start_tvsec * 1000 + info.pbi_start_tvusec / 1000,
            'terminal': info.pbi_status == 5}


def kernel(pid):
    return darwin_kernel(pid) if sys.platform == 'darwin' else linux_kernel(pid)


def darwin_args(pid):
    lib = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
    mib = (ctypes.c_int * 3)(1, 49, pid)  # CTL_KERN / KERN_PROCARGS2
    size = ctypes.c_size_t()
    need(lib.sysctl(mib, 3, None, ctypes.byref(size), None, 0) == 0 and 4 < size.value <= 1024 * 1024, 'PROCESS_ARGUMENTS_UNKNOWN')
    data = ctypes.create_string_buffer(size.value)
    need(lib.sysctl(mib, 3, data, ctypes.byref(size), None, 0) == 0, 'PROCESS_ARGUMENTS_UNKNOWN')
    raw = data.raw[:size.value]
    argc = ctypes.c_int.from_buffer_copy(raw[:4]).value
    end = raw.find(b'\0', 4)
    need(end > 4 and 0 < argc <= 8192, 'PROCESS_ARGUMENTS_UNKNOWN')
    executable = raw[4:end].decode('utf-8')
    pos = end
    while pos < len(raw) and raw[pos] == 0:
        pos += 1
    args = raw[pos:].split(b'\0')[:argc]
    need(len(args) == argc, 'PROCESS_ARGUMENTS_UNKNOWN')
    return executable, [x.decode('utf-8') for x in args]


def args(pid):
    if sys.platform == 'darwin':
        return darwin_args(pid)
    executable = os.readlink('/proc/%d/exe' % pid)
    argv = Path('/proc/%d/cmdline' % pid).read_bytes().split(b'\0')
    if argv and argv[-1] == b'':
        argv.pop()
    return executable, [x.decode('utf-8') for x in argv]


def classify(row, argv, scope):
    if row['pid'] == os.getpid():
        return 'observer'
    if row['terminal']:
        return 'terminal'
    executable = Path(row['executable']).name.lower()
    full = '\0'.join(argv)
    # 原只读watcher/inspector代码摘要从353真实静态literal独立审定；不执行候选字符串。
    if executable.startswith('python') and len(argv) >= 3 and argv[1] == '-c':
        if hashlib.sha256(argv[2].encode()).hexdigest() in READONLY_PYTHON:
            return 'read_only_native_observer'
    # 只承认本维护包明确的三个观察/控制程序，不将整个目录当免检范围。
    own = [str(HERE), str(HERE.with_name('qualification-maintenance-host.py')),
           str(HERE.with_name('qualification-maintenance.mjs'))]
    if any(path in argv for path in own):
        return 'maintenance_epoch_actor'
    related = any(value and value in full for value in (scope['run_tag'], scope['serial'], scope['run_dir'], scope['runtime_root']))
    if related:
        # Phone-wall固定无副作用截图不能被误当旧UI producer；其余shell命令不泛放。
        if executable == 'adb' and argv[1:] == ['-s', scope['serial'], 'exec-out', 'screencap', '-p']:
            return 'read_only_screenshot'
        return 'active_related'
    if row['start_ms'] < scope['run_started_at_ms']:
        return 'preexisting_outside_original_run'
    if not executable.startswith(EFFECTORS):
        return 'outside_supported_program'
    # 孤儿/脱组不因argv未出现tag而消失。标准shell/stdin解释器没有可证明归属就拒绝。
    if row['ppid'] == 1:
        return 'unknown_detached'
    explicit = [x for x in argv[1:] if x.startswith('/') and Path(x).suffix in ('.js', '.mjs', '.cjs', '.py', '.sh')]
    if explicit and all(not x.startswith(scope['runtime_root'] + '/') for x in explicit):
        return 'independent_explicit_program'
    return 'unknown_producer'


def observe(pid, scope):
    before = kernel(pid)
    if before is None:
        return None
    if before['terminal']:
        return {**before, 'executable': None, 'argv_sha256': None, 'classification': 'terminal'}
    try:
        executable, argv = args(pid)
    except (OSError, ValueError, UnicodeError):
        if kernel(pid) is None:
            return None
        raise ValueError('PROCESS_ARGUMENTS_UNKNOWN')
    after = kernel(pid)
    if after is None:
        return None
    need(all(before[k] == after[k] for k in ('pid', 'uid', 'start_identity')), 'PROCESS_IDENTITY_CHANGED')
    row = {**after, 'executable': executable}
    row['classification'] = classify(row, argv, scope)
    # argv可能含凭据；只在本进程内分类，绝不打印或持久化正文。
    row['argv_sha256'] = hashlib.sha256(json.dumps(argv, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
    return row


def collect(scope):
    need(sys.platform in ('darwin', 'linux') and scope['uid'] == os.getuid(), 'PROCESS_SCOPE_UID')
    need(isinstance(scope['run_started_at_ms'], (int, float)) and scope['run_started_at_ms'] > 0, 'PROCESS_SCOPE_TIME')
    need(all(isinstance(scope[k], str) and scope[k] for k in ('run_tag', 'serial', 'run_dir', 'runtime_root', 'host')), 'PROCESS_SCOPE')
    out = {'protocol': 'qualification-process-census-v1', 'host': scope['host'], 'uid': os.getuid(),
           'platform': sys.platform, 'observer_pid': os.getpid(), 'observer_sha256': hashlib.sha256(HERE.read_bytes()).hexdigest(),
           'started_at_ms': time.time() * 1000, 'enumerated': listed(), 'observations': [], 'absent': [], 'tracked': [], 'unknown': []}
    visited = set()
    def inspect(rows):
        for listed_row in rows:
            pid = listed_row['pid']
            if listed_row['uid'] != scope['uid'] or pid in visited or pid <= 1:
                continue
            visited.add(pid)
            try:
                row = observe(pid, scope)
                if row is None:
                    out['absent'].append({'pid': pid, 'reason': 'ESRCH'})
                else:
                    need(row['uid'] == scope['uid'], 'PROCESS_IDENTITY_CHANGED')
                    out['observations'].append(row)
            except (OSError, ValueError, UnicodeError):
                out['unknown'].append({'pid': pid, 'code': 'PROCESS_INSPECTION_UNKNOWN'})
    inspect(out['enumerated'])
    second = listed()
    inspect(second)
    out['final_enumerated'] = listed()
    for expected in scope.get('tracked', []):
        pid = expected['pid']
        need(type(pid) is int and pid > 1 and isinstance(expected['start_identity'], str), 'TRACKED_IDENTITY_INVALID')
        try:
            current = kernel(pid)
            state = 'absent' if current is None else 'reused' if current['start_identity'] != expected['start_identity'] else 'terminal' if current['terminal'] else 'alive'
            out['tracked'].append({'pid': pid, 'expected_start_identity': expected['start_identity'], 'state': state,
                                   'reason': 'ESRCH' if current is None else 'KERNEL',
                                   'actual_start_identity': current['start_identity'] if current else None})
        except (OSError, ValueError):
            out['tracked'].append({'pid': pid, 'expected_start_identity': expected['start_identity'], 'state': 'unknown'})
    out['finished_at_ms'] = time.time() * 1000
    return out


if __name__ == '__main__':
    try:
        raw = sys.stdin.buffer.read(1024 * 1024 + 1)
        need(len(raw) <= 1024 * 1024, 'PROCESS_INPUT_LIMIT')
        print(json.dumps(collect(json.loads(raw))))
    except Exception:
        print(json.dumps({'protocol': 'qualification-process-census-v1', 'unknown': [{'code': 'PROCESS_OBSERVER_UNKNOWN'}]}))
        sys.exit(1)

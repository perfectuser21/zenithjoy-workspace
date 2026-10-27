#!/usr/bin/env python3
"""维护专用Darwin进程身份；终态只采信内核无PID或绑定原出生时刻的zombie。"""
import ctypes
import errno
import hashlib
import sys


class BSDInfo(ctypes.Structure):
    # Apple SDK sys/proc_info.h proc_bsdinfo；MAXCOMLEN=16。
    _fields_ = [(name, ctypes.c_uint32) for name in (
        'pbi_flags', 'pbi_status', 'pbi_xstatus', 'pbi_pid', 'pbi_ppid', 'pbi_uid',
        'pbi_gid', 'pbi_ruid', 'pbi_rgid', 'pbi_svuid', 'pbi_svgid', 'rfu_1')]
    _fields_ += [('pbi_comm', ctypes.c_char * 16), ('pbi_name', ctypes.c_char * 32)]
    _fields_ += [(name, ctypes.c_uint32) for name in (
        'pbi_nfiles', 'pbi_pgid', 'pbi_pjobc', 'e_tdev', 'e_tpgid')]
    _fields_ += [('pbi_nice', ctypes.c_int32), ('pbi_start_tvsec', ctypes.c_uint64),
                 ('pbi_start_tvusec', ctypes.c_uint64)]


def need(value, code):
    if not value:
        raise ValueError('ADB_MAINTENANCE_' + code)


def kernel_snapshot(pid, loader=ctypes.CDLL):
    need(sys.platform == 'darwin' and type(pid) is int and pid > 1, 'PROCESS_KERNEL_PLATFORM_OR_PID')
    need(ctypes.sizeof(BSDInfo) == 136 and BSDInfo.pbi_start_tvsec.offset == 120
         and BSDInfo.pbi_start_tvusec.offset == 128, 'PROCESS_KERNEL_LAYOUT')
    library = loader('/usr/lib/libproc.dylib', use_errno=True)
    function = library.proc_pidinfo
    function.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
    function.restype = ctypes.c_int
    info = BSDInfo()
    ctypes.set_errno(0)
    size = function(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info))
    error = ctypes.get_errno()
    if size == 0 and error == errno.ESRCH:
        return None
    need(size == ctypes.sizeof(info) and info.pbi_pid == pid
         and info.pbi_status in (1, 2, 3, 4, 5) and info.pbi_start_tvsec > 0
         and info.pbi_start_tvusec < 1000000, 'PROCESS_KERNEL_UNKNOWN')
    return {'pid': pid, 'uid': int(info.pbi_uid), 'status': int(info.pbi_status),
            'start': [int(info.pbi_start_tvsec), int(info.pbi_start_tvusec)]}


def same_process(before, after):
    need(all(before[key] == after[key] for key in ('pid', 'uid', 'start')), 'PROCESS_CHANGED')


def bind_expected(value, expected):
    birth = expected.get('kernel_start') if isinstance(expected, dict) else None
    need(isinstance(birth, list) and len(birth) == 2 and all(type(x) is int for x in birth)
         and type(expected.get('pid')) is int and type(expected.get('uid')) is int
         and value['pid'] == expected['pid'] and value['uid'] == expected['uid']
         and value['start'] == birth, 'PROCESS_CHANGED_OR_TERMINAL_UNBOUND')


def terminal(before, after, expected):
    if after is None:  # 仅kernel_snapshot本次明确ESRCH，绝不把读取失败当缺席。
        return True
    same_process(before, after)
    if after['status'] == 5:  # sys/proc.h SZOMB；已不能执行，出生身份仍必须绑定。
        bind_expected(after, expected)
        return True
    return False


def observe(pid, command, executable_reader, expected=None, kernel_reader=None):
    kernel_reader = kernel_snapshot if kernel_reader is None else kernel_reader
    before = kernel_reader(pid)
    if before is None:
        return None
    if expected is not None:
        bind_expected(before, expected)
    if before['status'] == 5:
        bind_expected(before, expected)
        return None
    fields = {}
    for key in ('uid', 'lstart', 'args'):
        result = command(['/bin/ps', '-ww', '-p', str(pid), '-o', key + '='], check=False)
        if result.returncode == 1 and not result.stdout.strip():
            if terminal(before, kernel_reader(pid), expected):
                return None
        need(result.returncode == 0 and result.stdout.strip(), 'PROCESS_INSPECTION')
        fields[key] = result.stdout.strip()
    try:
        executable = executable_reader(pid)
    except ValueError as error:
        if str(error) != 'ADB_MAINTENANCE_PROCESS_EXECUTABLE_UNAVAILABLE':
            raise
        if terminal(before, kernel_reader(pid), expected):
            return None
        raise
    after = kernel_reader(pid)
    if terminal(before, after, expected):
        return None
    need(int(fields['uid']) == before['uid'], 'PROCESS_CHANGED')
    check = command(['/bin/ps', '-ww', '-p', str(pid), '-o', 'lstart='], check=False)
    if check.returncode != 0 or check.stdout.strip() != fields['lstart']:
        if terminal(before, kernel_reader(pid), expected):
            return None
        need(False, 'PROCESS_CHANGED')
    # 最后一次内核回读也覆盖ps检查期间退出/同秒PID复用；新plan绑定微秒出生值。
    if terminal(before, kernel_reader(pid), expected):
        return None
    return {'pid': pid, 'uid': before['uid'], 'lstart': fields['lstart'],
            'kernel_start': before['start'], 'executable': executable,
            'argv_sha256': hashlib.sha256(fields['args'].encode()).hexdigest(), '_argv': fields['args']}

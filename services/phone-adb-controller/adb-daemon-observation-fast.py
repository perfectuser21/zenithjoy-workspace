#!/usr/bin/env python3
"""Per-admission read-only Darwin listener and process proof for the fixed successor."""
import ctypes
import errno
import importlib.util
import json
import os
import platform
import struct
import subprocess
import sys


def need(condition):
    if not condition:
        raise ValueError('daemon proof mismatch')


def listener(lib, pid, port):
    # Darwin arm64 SDK sys/proc_info.h. Reject truncated FD and socket records.
    length = lib.proc_pidinfo(pid, 1, 0, None, 0)  # PROC_PIDLISTFDS
    need(0 < length <= 1048576 and length % 8 == 0)
    buffer = ctypes.create_string_buffer(length + 192)
    length = lib.proc_pidinfo(pid, 1, 0, buffer, len(buffer))
    need(0 < length < len(buffer) and length % 8 == 0)
    for fd, fd_type in struct.iter_unpack('=iI', buffer.raw[:length]):
        if fd_type != 2:  # PROX_FDTYPE_SOCKET
            continue
        info = ctypes.create_string_buffer(792)  # sizeof(struct socket_fdinfo)
        ctypes.set_errno(0)
        size = lib.proc_pidfdinfo(pid, fd, 3, info, len(info))
        # Unrelated connected sockets may expire while walking the table. A missing
        # row never supplies the positive listener proof.
        if size == 0 and ctypes.get_errno() in (errno.EBADF, errno.ENOENT):
            continue
        need(size == len(info))
        raw = info.raw
        if (struct.unpack_from('=ii', raw, 180) == (6, 2)  # TCP, AF_INET
                and struct.unpack_from('=i', raw, 256)[0] == 2  # SOCKINFO_TCP
                and struct.unpack_from('=i', raw, 344)[0] == 1  # TSI_S_LISTEN
                and raw[324:328] == b'\x7f\x00\x00\x01'
                and struct.unpack_from('!H', raw, 268)[0] == port):
            return True
    return False


def observe(lib, kernel_snapshot, scope):
    pid, port, uid = scope['pid'], scope['port'], scope['uid']
    need(type(pid) is int and pid > 1 and type(port) is int and 0 < port <= 65535 and uid == os.getuid())
    before = kernel_snapshot(pid)
    need(before is not None and before['uid'] == uid and before['status'] != 5 and listener(lib, pid, port))
    path = ctypes.create_string_buffer(4096)
    need(lib.proc_pidpath(pid, path, len(path)) > 0 and os.fsdecode(path.value) == scope['executable'])
    row = subprocess.check_output(['/bin/ps', '-p', str(pid), '-o', 'lstart=', '-o', 'command='],
                                  text=True, timeout=2, stderr=subprocess.DEVNULL).rstrip('\n')
    need(row[:24].strip() == scope['start_identity'] and row[24:].strip() == scope['command'])
    need(lib.proc_pidpath(pid, path, len(path)) > 0 and os.fsdecode(path.value) == scope['executable']
         and listener(lib, pid, port))
    after = kernel_snapshot(pid)
    need(after is not None and after['uid'] == uid and after['status'] != 5 and after['start'] == before['start'])
    return before['start']


def main(path):
    need(sys.platform == 'darwin' and platform.machine() == 'arm64')
    spec = importlib.util.spec_from_file_location('pinned_adb_process_observation', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    lib = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
    lib.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
    lib.proc_pidfdinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_void_p, ctypes.c_int]
    lib.proc_pidpath.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
    while line := sys.stdin.buffer.readline(65537):
        try:
            need(len(line) <= 65536 and line.endswith(b'\n'))
            birth = observe(lib, module.kernel_snapshot, json.loads(line))
            print(json.dumps({'birth': birth}), flush=True)
        except (ValueError, KeyError, OSError, subprocess.SubprocessError):
            print('{"rejected":true}', flush=True)
            return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))

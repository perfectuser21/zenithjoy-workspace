#!/usr/bin/env python3
"""固定客户端/JAR校验及有界、无覆盖的Android JAR传输；不领取或释放锁。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import signal
import socket
import stat
import subprocess
import sys
import time
import uuid

POLICY = json.loads(Path(__file__).with_name('runtime-policy.json').read_text())


class RuntimeFailure(Exception):
    def __init__(self, message, unknown=False):
        super().__init__(message)
        self.unknown = unknown


def regular_bytes(path):
    path = Path(path)
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, 'rb') as handle:
            if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode):
                raise RuntimeFailure('runtime artifact is not a regular file')
            return handle.read()
    except OSError as error:
        raise RuntimeFailure('runtime artifact is unavailable: ' + str(error)) from error


def verify_runtime(runtime_root, client_sha256=None):
    root = Path(runtime_root)
    if not root.is_absolute() or root.is_symlink() or not root.is_dir():
        raise RuntimeFailure('runtime root must be an existing absolute non-symlink directory')
    expected = client_sha256 or POLICY['client_sha256']
    if expected != POLICY['client_sha256']:
        raise RuntimeFailure('client pin is not approved by repository runtime policy')
    paths = {'client': root / 'scrcpy', 'server': root / 'scrcpy-server'}
    result = {'verified': True, 'schema': POLICY['schema'], 'version': POLICY['version']}
    for kind, path in paths.items():
        digest = hashlib.sha256(regular_bytes(path)).hexdigest()
        if digest != POLICY[kind + '_sha256']:
            raise RuntimeFailure(kind + ' SHA256 does not match pinned runtime')
        if kind == 'client' and not os.access(path, os.X_OK):
            raise RuntimeFailure('runtime client is not executable')
        result[kind + '_path'] = str(path)
        result[kind + '_sha256'] = digest
    return result


def require_owner(lock_dir, owner):
    lock = Path(lock_dir)
    if not lock.is_absolute() or lock.is_symlink() or not lock.is_dir():
        raise RuntimeFailure('exact device lock directory is unavailable')
    if regular_bytes(lock / 'owner') not in (owner.encode(), (owner + '\n').encode()):
        raise RuntimeFailure('exact lock owner does not match')


def terminate_owned(child):
    # 此PID尚未reap，不能误杀复用PID；仅处理自己新建的进程组。
    for sig, seconds in ((signal.SIGTERM, 0.5), (signal.SIGKILL, 1)):
        try:
            os.killpg(child.pid, sig)
        except ProcessLookupError:
            pass
        try:
            child.communicate(timeout=seconds)
            for pipe in (child.stdin, child.stdout, child.stderr):
                if pipe and not pipe.closed:
                    pipe.close()
            return
        except subprocess.TimeoutExpired:
            continue
    raise RuntimeFailure('owned adb process group termination unproven', unknown=True)


def require_existing_server(port, timeout=1):
    """直接只读smart-socket查询；不调用可能自动创建server的start-server。"""
    def exact(connection, count):
        data = b''
        while len(data) < count:
            chunk = connection.recv(count - len(data))
            if not chunk:
                raise RuntimeFailure('existing ADB server probe ended early')
            data += chunk
        return data
    try:
        with socket.create_connection(('127.0.0.1', int(port)), timeout=timeout) as connection:
            connection.settimeout(timeout)
            connection.sendall(b'000chost:version')
            if exact(connection, 4) != b'OKAY':
                raise RuntimeFailure('existing ADB server did not accept version probe')
            size = int(exact(connection, 4), 16)
            if not 1 <= size <= 16 or not re.fullmatch(rb'[0-9a-fA-F]+', exact(connection, size)):
                raise RuntimeFailure('existing ADB server version is unknown')
    except (OSError, ValueError) as error:
        raise RuntimeFailure('required existing ADB server is unavailable') from error


def stage_server(*, runtime_root, adb_bin, adb_port, serial, owner, lock_dir,
                 evidence_root, evidence_id, timeout=45, client_sha256=None):
    receipt = {'verified': False, 'execution_stop_unknown': False, 'phase': 'planned',
               'serial': serial, 'owner': owner, 'adb_port': adb_port}
    receipt_path = None
    temporary = '/data/local/tmp/zj-scrcpy.stage-' + uuid.uuid4().hex
    receipt['temporary_path'] = temporary
    touched = False
    own_temporary = False
    deadline = time.monotonic() + float(timeout)

    def save():
        if receipt_path:
            temp = receipt_path.with_suffix('.json.tmp')
            with open(temp, 'x', encoding='utf-8') as handle:
                os.chmod(temp, 0o600)
                json.dump(receipt, handle, ensure_ascii=False, indent=2)
                handle.write('\n')
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp, receipt_path)

    def adb(script, data=None):
        try:
            require_owner(lock_dir, owner)
        except RuntimeFailure as error:
            raise RuntimeFailure(str(error), unknown=touched) from error
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeFailure('server stage deadline reached', unknown=touched)
        try:
            require_existing_server(adb_port, min(1, remaining))
        except RuntimeFailure as error:
            raise RuntimeFailure(str(error), unknown=touched) from error
        env = dict(os.environ, ADB_SERVER_SOCKET='tcp:localhost:' + str(adb_port))
        child = subprocess.Popen([str(adb_bin), '-P', str(adb_port), '-s', serial,
                                  'shell', '-T', script], stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 env=env, start_new_session=True)
        try:
            stdout, stderr = child.communicate(data, timeout=remaining)
        except (subprocess.TimeoutExpired, RuntimeFailure) as error:
            terminate_owned(child)
            raise RuntimeFailure('bounded adb command did not complete', unknown=True) from error
        try:
            require_owner(lock_dir, owner)
        except RuntimeFailure as error:
            raise RuntimeFailure(str(error), unknown=touched) from error
        return child.returncode, stdout, stderr

    def probe(path):
        q = shlex.quote(path)
        script = (f'if [ -L {q} ]; then printf "SYMLINK\\n"; '
                  f'elif [ ! -e {q} ]; then printf "ABSENT\\n"; '
                  f'elif [ ! -f {q} ]; then printf "OTHER\\n"; '
                  f'else toybox sha256sum {q} && toybox wc -c < {q}; fi')
        code, out, _ = adb(script)
        if code:
            raise RuntimeFailure('remote checksum probe failed')
        lines = out.decode('utf-8', errors='strict').splitlines()
        if lines == ['ABSENT']:
            return 'absent'
        if lines in (['SYMLINK'], ['OTHER']):
            return 'conflict'
        if len(lines) != 2 or not re.fullmatch(r'[0-9a-f]{64}  ' + re.escape(path), lines[0]) or not lines[1].strip().isdigit():
            raise RuntimeFailure('remote checksum reply is unknown', unknown=touched)
        if lines[0].split('  ', 1)[0] == POLICY['server_sha256'] and int(lines[1]) == len(server):
            return 'matching'
        return 'conflict'

    try:
        if not re.fullmatch(r'[A-Za-z0-9_.:@-]{1,160}', serial) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,120}', owner):
            raise RuntimeFailure('invalid serial or owner')
        if not re.fullmatch(r'[A-Za-z0-9_.-]{1,120}', evidence_id):
            raise RuntimeFailure('invalid evidence id')
        if not 1 <= int(adb_port) <= 65535 or not 0.1 <= float(timeout) <= 120:
            raise RuntimeFailure('invalid port or stage budget')
        if not Path(adb_bin).is_absolute() or not os.access(adb_bin, os.X_OK):
            raise RuntimeFailure('ADB executable must be explicit and executable')
        evidence = Path(evidence_root)
        if not evidence.is_absolute() or evidence.is_symlink() or not evidence.is_dir():
            raise RuntimeFailure('evidence root must already exist as an absolute directory')
        receipt_path = evidence / (evidence_id + '.server-stage.' + uuid.uuid4().hex + '.json')
        fd = os.open(receipt_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(fd)
        receipt['stage_receipt'] = str(receipt_path)
        save()
        receipt.update(verify_runtime(runtime_root, client_sha256))
        receipt['verified'] = False
        server = regular_bytes(receipt['server_path'])
        destination = POLICY['remote_server']
        receipt['remote_path'] = destination
        require_owner(lock_dir, owner)
        initial = probe(destination)
        if initial == 'conflict':
            raise RuntimeFailure('existing remote server is unverified; refuse replacement')
        if initial == 'matching':
            receipt['mode'] = 'reused'
        else:
            receipt['phase'] = 'upload_attempted'
            touched = True
            save()  # 在任何远端写入前持久化可恢复标记。
            token = uuid.uuid4().hex
            script = (f'umask 077; set -C; toybox head -c {len(server)} > '
                      f'{shlex.quote(temporary)} && printf "STAGED {token}\\n"')
            code, stdout, _ = adb(script, server)
            if code or stdout != ('STAGED ' + token + '\n').encode():
                raise RuntimeFailure('fixed-byte upload completion is unproven', unknown=True)
            own_temporary = True
            receipt['phase'] = 'received'
            save()
            if probe(temporary) != 'matching':
                raise RuntimeFailure('temporary server hash or byte count does not match')
            receipt['phase'] = 'publish_attempted'
            save()
            code, _, _ = adb('ln ' + shlex.quote(temporary) + ' ' + shlex.quote(destination))
            if code:
                raise RuntimeFailure('no-clobber publication refused')
            if probe(destination) != 'matching':
                raise RuntimeFailure('published server verification is unproven', unknown=True)
            code, _, _ = adb('rm ' + shlex.quote(temporary))
            if code or probe(temporary) != 'absent':
                raise RuntimeFailure('own temporary cleanup is unproven', unknown=True)
            own_temporary = False
            receipt['mode'] = 'fixed_byte_shell_staged'
        if probe(destination) != 'matching':
            raise RuntimeFailure('final remote server verification is unproven', unknown=True)
        receipt.update(phase='verified', verified=True, received_bytes=len(server))
    except (RuntimeFailure, OSError, ValueError, UnicodeError) as error:
        receipt.update(verified=False, error=str(error),
                       execution_stop_unknown=getattr(error, 'unknown', touched and not own_temporary))
        if own_temporary and not receipt['execution_stop_unknown']:
            try:
                code, _, _ = adb('rm ' + shlex.quote(temporary))
                if code or probe(temporary) != 'absent':
                    raise RuntimeFailure('temporary cleanup not verified', unknown=True)
            except Exception:
                receipt['execution_stop_unknown'] = True
        receipt['phase'] = 'unknown' if receipt['execution_stop_unknown'] else 'failed'
    try:
        save()
    except OSError as error:
        receipt.update(verified=False, error='stage receipt persistence failed: ' + str(error),
                       execution_stop_unknown=touched)
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['verify', 'stage-server'])
    parser.add_argument('--runtime-root', required=True)
    parser.add_argument('--client-sha256')
    parser.add_argument('--adb-bin')
    parser.add_argument('--adb-port', type=int)
    parser.add_argument('--serial')
    parser.add_argument('--owner')
    parser.add_argument('--lock-dir')
    parser.add_argument('--evidence-root')
    parser.add_argument('--evidence-id')
    parser.add_argument('--timeout', type=float, default=45)
    args = parser.parse_args(argv)
    try:
        if args.command == 'verify':
            result = verify_runtime(args.runtime_root, args.client_sha256)
        else:
            for field in ('adb_bin', 'adb_port', 'serial', 'owner', 'lock_dir', 'evidence_root', 'evidence_id'):
                if getattr(args, field) is None:
                    parser.error('--' + field.replace('_', '-') + ' is required for staging')
            values = vars(args).copy()
            del values['command']
            result = stage_server(**values)
    except RuntimeFailure as error:
        result = {'verified': False, 'error': str(error), 'execution_stop_unknown': error.unknown}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result['verified'] else (75 if result.get('execution_stop_unknown') else 64)


if __name__ == '__main__':
    def interrupted(signum, frame):
        raise RuntimeFailure('runtime stage interrupted by signal', unknown=True)
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, interrupted)
    sys.exit(main())

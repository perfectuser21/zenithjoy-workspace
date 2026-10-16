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


def runtime_policy(runtime_kind='sdk31'):
    """只允许仓库内两个固定策略；环境不能指定任意policy文件。"""
    if runtime_kind == 'sdk31':
        policy, expected = POLICY, ('scrcpy-sdk31-pinned-v1', '5.0.1')
    elif runtime_kind == 'sdk33':
        try:
            policy = json.loads(Path(__file__).with_name('runtime-policy-sdk33.json').read_text())
        except (OSError, ValueError) as error:
            raise RuntimeFailure('fixed sdk33 runtime policy is unavailable') from error
        expected = ('scrcpy-sdk33-pinned-v1', '3.3.4')
    else:
        raise RuntimeFailure('unknown pinned runtime kind')
    if not isinstance(policy, dict) or (policy.get('schema'), policy.get('version')) != expected:
        raise RuntimeFailure('fixed runtime policy identity does not match selected kind')
    return policy


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


def verify_runtime(runtime_root, client_sha256=None, runtime_kind='sdk31'):
    policy = runtime_policy(runtime_kind)
    root = Path(runtime_root)
    if not root.is_absolute() or root.is_symlink() or not root.is_dir():
        raise RuntimeFailure('runtime root must be an existing absolute non-symlink directory')
    expected = client_sha256 or policy['client_sha256']
    if expected != policy['client_sha256']:
        raise RuntimeFailure('client pin is not approved by repository runtime policy')
    paths = {'client': root / 'scrcpy', 'server': root / 'scrcpy-server'}
    result = {'verified': True, 'schema': policy['schema'], 'version': policy['version']}
    for kind, path in paths.items():
        digest = hashlib.sha256(regular_bytes(path)).hexdigest()
        if digest != policy[kind + '_sha256']:
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
            if not 1 <= size <= 16:
                raise RuntimeFailure('existing ADB server version is unknown')
            version = exact(connection, size)
            if not re.fullmatch(rb'[0-9a-fA-F]+', version) or int(version, 16) != POLICY['adb_server_protocol']:
                raise RuntimeFailure('existing ADB server protocol does not match approved client protocol')
    except (OSError, ValueError) as error:
        raise RuntimeFailure('required existing ADB server is unavailable') from error


def require_adb_client(adb_bin, timeout=2):
    # "adb version"只读本地程序，不连接server。拒绝协议不匹配的客户端，
    # 否则ADB自身可能在普通shell调用前kill/restart共享server。
    child = subprocess.Popen([str(adb_bin), 'version'], stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             start_new_session=True)
    try:
        stdout, _ = child.communicate(timeout=timeout)
    except (subprocess.TimeoutExpired, RuntimeFailure) as error:
        terminate_owned(child)
        raise RuntimeFailure('local ADB version check did not complete') from error
    match = re.search(rb'(?m)^Android Debug Bridge version 1\.0\.([0-9]+)\r?$', stdout)
    if child.returncode or not match or int(match[1]) != POLICY['adb_server_protocol']:
        raise RuntimeFailure('local ADB protocol does not match approved server protocol')


def stage_server(*, runtime_root, adb_bin, adb_port, serial, owner, lock_dir,
                 evidence_root, evidence_id, timeout=45, client_sha256=None, runtime_kind='sdk31'):
    receipt = {'verified': False, 'execution_stop_unknown': False, 'phase': 'planned',
               'serial': serial, 'owner': owner, 'adb_port': adb_port,
               'evidence_id': evidence_id}
    receipt_path = None
    temporary = None
    if runtime_kind == 'sdk31':
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
        # AOSP treats numeric127.0.0.1 as a remote socket: connection failure
        # returns an error rather than auto-launching a local shared server.
        env = dict(os.environ, ADB_SERVER_SOCKET='tcp:127.0.0.1:' + str(adb_port))
        child = subprocess.Popen([str(adb_bin), '-H', '127.0.0.1', '-P', str(adb_port), '-s', serial,
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
        if lines[0].split('  ', 1)[0] == policy['server_sha256'] and int(lines[1]) == len(server):
            return 'matching'
        return 'conflict'

    try:
        policy = runtime_policy(runtime_kind)
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
        receipt.update(verify_runtime(runtime_root, client_sha256, runtime_kind))
        receipt['verified'] = False
        server = regular_bytes(receipt['server_path'])
        destination = policy['remote_server']
        receipt['remote_path'] = destination
        require_owner(lock_dir, owner)
        require_adb_client(adb_bin, min(2, max(0.1, deadline - time.monotonic())))
        initial = probe(destination)
        if initial == 'conflict':
            raise RuntimeFailure('existing remote server is unverified; refuse replacement')
        if initial == 'matching':
            receipt['mode'] = 'reused'
        elif runtime_kind == 'sdk33':
            # Android16 shell禁止hardlink；仅此已批准种类使用独占canonical创建。
            # journal在任何写入前记录真实目标；不删除失败/未知的canonical。
            receipt.update(phase='canonical_upload_attempted', write_target=destination,
                           staging_mode='canonical_noclobber')
            touched = True
            save()
            token = uuid.uuid4().hex
            opened = ('CANONICAL_OPENED ' + token + '\n').encode()
            script = (f'umask 077; set -C; if {{ printf "CANONICAL_OPENED {token}\\n" >&2; '
                      f'toybox head -c {len(server)}; }} > {shlex.quote(destination)}; '
                      f'then printf "STAGED {token}\\n"; else printf "REFUSED {token}\\n"; fi')
            code, stdout, stderr = adb(script, server)
            if code == 0 and stdout == ('REFUSED ' + token + '\n').encode() and opened not in stderr:
                # 受控分支仅在重定向拒绝后返回REFUSED；group未进入，没有本次写入。
                touched = False
                receipt['phase'] = 'canonical_create_refused'
                raise RuntimeFailure('exclusive canonical creation refused without upload')
            if code or stdout != ('STAGED ' + token + '\n').encode() or stderr != opened:
                raise RuntimeFailure('canonical fixed-byte upload completion is unproven', unknown=True)
            receipt['phase'] = 'canonical_received'
            save()
            if probe(destination) != 'matching':
                raise RuntimeFailure('canonical server hash or byte count does not match', unknown=True)
            receipt['mode'] = 'fixed_byte_canonical_noclobber'
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
                       execution_stop_unknown=(runtime_kind == 'sdk33' and touched)
                       or getattr(error, 'unknown', touched and not own_temporary))
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
    if receipt.get('verified') and receipt_path:
        try:
            # 只加到返回值，不写回原件，避免自引用哈希。
            receipt['stage_receipt_sha256'] = hashlib.sha256(regular_bytes(receipt_path)).hexdigest()
        except RuntimeFailure as error:
            receipt.update(verified=False, execution_stop_unknown=touched, error=str(error))
    return receipt


def verify_prestaged_server(config, verified):
    """内部push只读复用C同步阶段原件；此处没有上传/发布/删除路径。"""
    policy = runtime_policy(config.get('runtime_kind', 'sdk31'))
    raw_path = os.environ.get('ZJ_SCRCPY_STAGE_RECEIPT', '')
    expected_sha = os.environ.get('ZJ_SCRCPY_STAGE_RECEIPT_SHA256', '')
    path = Path(raw_path)
    evidence = Path(config['evidence_root'])
    if not raw_path or not re.fullmatch(r'[0-9a-f]{64}', expected_sha):
        raise RuntimeFailure('canonical prestage receipt and SHA256 are required')
    if (not path.is_absolute() or path.is_symlink() or evidence.is_symlink()
            or path.parent != evidence
            or not re.fullmatch(re.escape(config['evidence_id']) + r'\.server-stage\.[0-9a-f]{32}\.json', path.name)):
        raise RuntimeFailure('canonical prestage receipt is outside the exact evidence binding')
    raw = regular_bytes(path)
    if hashlib.sha256(raw).hexdigest() != expected_sha:
        raise RuntimeFailure('canonical prestage receipt SHA256 changed')
    try:
        receipt = json.loads(raw)
    except (ValueError, UnicodeError) as error:
        raise RuntimeFailure('canonical prestage receipt is invalid') from error
    expected = {'phase': 'verified', 'serial': config['serial'], 'owner': config['owner'],
                'adb_port': config['adb_port'], 'evidence_id': config['evidence_id'],
                'remote_path': policy['remote_server'], 'stage_receipt': str(path),
                'client_sha256': verified['client_sha256'], 'server_sha256': verified['server_sha256'],
                'client_path': verified['client_path'], 'server_path': verified['server_path'],
                'received_bytes': len(regular_bytes(verified['server_path'])),
                'schema': policy['schema'], 'version': policy['version']}
    if (not isinstance(receipt, dict) or receipt.get('verified') is not True
            or receipt.get('execution_stop_unknown') is not False
            or any(receipt.get(key) != value for key, value in expected.items())):
        raise RuntimeFailure('canonical prestage receipt is not successful for this exact capture')
    deadline = time.monotonic() + min(float(config['timeout']), 15)
    require_owner(config['lock_dir'], config['owner'])
    require_adb_client(config['adb_bin'], min(2, max(0.1, deadline - time.monotonic())))
    require_existing_server(config['adb_port'], min(1, max(0.1, deadline - time.monotonic())))
    target = shlex.quote(policy['remote_server'])
    script = (f'[ ! -L {target} ] && [ -f {target} ] && '
              f'toybox sha256sum {target} && toybox wc -c < {target}')
    env = dict(os.environ, ADB_SERVER_SOCKET='tcp:127.0.0.1:' + str(config['adb_port']))
    child = subprocess.Popen([str(config['adb_bin']), '-H', '127.0.0.1', '-P',
                              str(config['adb_port']), '-s', config['serial'],
                              'shell', '-T', script], stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             env=env, start_new_session=True)
    try:
        stdout, _ = child.communicate(timeout=max(0.1, deadline - time.monotonic()))
    except (subprocess.TimeoutExpired, RuntimeFailure) as error:
        terminate_owned(child)
        raise RuntimeFailure('read-only prestaged server probe did not complete') from error
    require_owner(config['lock_dir'], config['owner'])
    lines = stdout.decode('utf-8', errors='strict').splitlines()
    if (child.returncode or len(lines) != 2
            or lines[0] != policy['server_sha256'] + '  ' + policy['remote_server']
            or not lines[1].strip().isdigit()
            or int(lines[1]) != expected['received_bytes']):
        raise RuntimeFailure('prestaged remote server is missing or changed; push shim is read-only')
    return {'verified': True, 'mode': 'prestaged_readonly_reuse',
            'stage_receipt': str(path), 'stage_receipt_sha256': expected_sha,
            'server_sha256': policy['server_sha256']}


def shim_config():
    runtime_kind = os.environ.get('ZJ_SCRCPY_RUNTIME_KIND', 'sdk31')
    policy = runtime_policy(runtime_kind)
    keys = {'runtime_root': 'RUNTIME_ROOT', 'client_sha256': 'CLIENT_SHA256',
            'adb_bin': 'ADB_BIN', 'adb_port': 'ADB_PORT', 'serial': 'SERIAL',
            'owner': 'OWNER', 'lock_dir': 'LOCK_DIR', 'evidence_root': 'EVIDENCE_ROOT',
            'evidence_id': 'EVIDENCE_ID', 'timeout': 'STAGE_TIMEOUT'}
    config = {'runtime_kind': runtime_kind}
    for key, suffix in keys.items():
        value = os.environ.get('ZJ_SCRCPY_' + suffix)
        if value is None:
            if key == 'client_sha256':
                value = policy['client_sha256']
            elif key == 'timeout':
                value = '45'
            else:
                raise RuntimeFailure('missing pinned ADB shim configuration: ' + suffix)
        config[key] = value
    config['adb_port'] = int(config['adb_port'])
    config['timeout'] = float(config['timeout'])
    return config


def adb_shim(argv):
    """只替代ADB进程；从不包裹或启动scrcpy，保留真实录制PID。"""
    try:
        config = shim_config()
        policy = runtime_policy(config['runtime_kind'])
        verified = verify_runtime(config['runtime_root'], config['client_sha256'], config['runtime_kind'])
        require_owner(config['lock_dir'], config['owner'])
        serial = config['serial']
        if argv == ['start-server']:
            require_existing_server(config['adb_port'])
            return 0  # 既有桥只读检查，绝不调用start-server。
        if len(argv) >= 3 and argv[:2] == ['-s', serial] and argv[2] == 'push':
            if len(argv) != 5 or os.path.abspath(argv[3]) != verified['server_path'] or argv[4] != policy['remote_server']:
                raise RuntimeFailure('ADB shim refuses a non-pinned server push')
            result = verify_prestaged_server(config, verified)
            print('runtime server reused verified prestage: ' + json.dumps(result, ensure_ascii=False), file=sys.stderr)
            return 0
        allowed = argv == ['devices', '-l']
        if argv[:2] == ['-s', serial]:
            rest = argv[2:]
            prefix = ['shell', 'CLASSPATH=' + policy['remote_server'], 'app_process',
                      '/', 'com.genymobile.scrcpy.Server', policy['version']]
            if rest[:6] == prefix and all(re.fullmatch(r'[A-Za-z0-9_./:@=,+-]+', token) for token in rest[6:]):
                allowed = True
            elif rest and rest[0] in ('forward', 'reverse'):
                if len(rest) == 3 and rest[1] == '--remove':
                    pattern = r'tcp:[0-9]{1,5}' if rest[0] == 'forward' else r'localabstract:scrcpy_[0-9a-f]{8}'
                    allowed = bool(re.fullmatch(pattern, rest[2]))
                elif len(rest) == 3:
                    local, remote = (rest[1], rest[2]) if rest[0] == 'forward' else (rest[2], rest[1])
                    allowed = bool(re.fullmatch(r'tcp:[0-9]{1,5}', local) and
                                   re.fullmatch(r'localabstract:scrcpy_[0-9a-f]{8}', remote))
        if not allowed:
            raise RuntimeFailure('ADB shim refuses unrelated command or target')
        require_adb_client(config['adb_bin'])
        require_existing_server(config['adb_port'])
        env = dict(os.environ, ADB_SERVER_SOCKET='tcp:127.0.0.1:' + str(config['adb_port']))
        os.execve(str(config['adb_bin']), [str(config['adb_bin']), '-H', '127.0.0.1', '-P',
                  str(config['adb_port']), *argv], env)
    except (RuntimeFailure, OSError, ValueError) as error:
        print('pinned ADB shim refused: ' + str(error), file=sys.stderr)
        return 75 if getattr(error, 'unknown', False) else 64


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['verify', 'stage-server'])
    parser.add_argument('--runtime-root', required=True)
    parser.add_argument('--runtime-kind', choices=['sdk31', 'sdk33'], default='sdk31')
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
            result = verify_runtime(args.runtime_root, args.client_sha256, args.runtime_kind)
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

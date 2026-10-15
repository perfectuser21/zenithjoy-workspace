"""把本事件真实手机PNG送到已授权模型节点，读回SHA256后才提供查看路径。"""
import hashlib
import os
import signal
from pathlib import Path, PurePosixPath
import re
import shlex
import subprocess


def run_transport_command(args, *, capture_output=True, text=True, timeout):
    """一次有界传输；独立进程组确保超时不会留下scp/ssh子进程。"""
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=text, start_new_session=True)
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except BaseException:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.communicate(timeout=2)
        raise
    return subprocess.CompletedProcess(args, process.returncode, stdout, stderr)


def transfer(source, event_id, state, config, runner=None):
    runner = runner or run_transport_command
    source = Path(source).resolve()
    if not re.fullmatch(r'[0-9a-f]{64}', event_id):
        raise ValueError('invalid_transport_event')
    if (not source.is_file() or source.suffix != '.png'
            or not source.is_relative_to((state.path.parent / event_id).resolve())
            or source.stat().st_mode & 0o077
            or not re.fullmatch(r'[A-Za-z0-9_-][A-Za-z0-9_.-]*\.png', source.name)):
        raise ValueError('transport_requires_private_registered_event_png')
    state.verify_phone_evidence(event_id, str(source))
    host = config.get('host', '')
    remote_root = config.get('remote_root', '')
    ssh_config = config.get('ssh_config', '')
    if (not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]*', host)
            or not re.fullmatch(r'/[A-Za-z0-9_/.-]+', remote_root)
            or '..' in PurePosixPath(remote_root).parts
            or not Path(ssh_config).is_absolute()):
        raise ValueError('invalid_authorized_image_transport')
    remote_dir = str(PurePosixPath(remote_root) / event_id)
    remote_path = str(PurePosixPath(remote_dir) / source.name)
    options = ['-F', ssh_config, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10']

    def run(args, timeout=30):
        result = runner(args, capture_output=True, text=True, timeout=timeout)
        if result.returncode != 0:
            raise ValueError('image_transport_command_failed')
        return result.stdout

    run(['ssh', *options, host, shlex.join(['mkdir', '-p', remote_dir])])
    run(['ssh', *options, host, shlex.join(['chmod', '700', remote_dir])])
    run(['scp', '-p', *options, '--', str(source), host + ':' + remote_path], timeout=120)
    output = run(['ssh', *options, host, shlex.join(['shasum', '-a', '256', remote_path])])
    match = re.fullmatch(r'([0-9a-fA-F]{64})\s+[^\r\n]+\s*', output)
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    # Revalidate local evidence too; a changed source must never become a model proof.
    state.verify_phone_evidence(event_id, str(source))
    if not match or match.group(1).lower() != source_hash:
        raise ValueError('image_transport_remote_hash_mismatch')
    return {'path': remote_path, 'node': host, 'sha256': source_hash}

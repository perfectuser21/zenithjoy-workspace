"""Protect one previously captured local owner under its original guard; never ADB."""
import fcntl
import hashlib
import json
import os
import stat
import sys


def identity(fd, expected, directory=False):
    s = os.fstat(fd)
    if (s.st_dev, s.st_ino, s.st_uid) != (expected['dev'], expected['ino'], os.getuid()):
        raise ValueError('identity')
    if s.st_mode & 0o022 or (not stat.S_ISDIR(s.st_mode) if directory else not stat.S_ISREG(s.st_mode)):
        raise ValueError('type')


def read_at(fd, name):
    f = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    try:
        s = os.fstat(f)
        if not stat.S_ISREG(s.st_mode) or s.st_uid != os.getuid() or s.st_mode & 0o022 or s.st_size > 4096:
            raise ValueError('file')
        return f, os.read(f, 4097)
    except BaseException:
        os.close(f)
        raise


def protect(p):
    root = os.open(p['root'], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    guard = lock = None
    stage = None
    try:
        identity(root, p['root_identity'], True)
        guard = os.open(p['serial'] + '.guard', os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=root)
        identity(guard, p['guard_identity'])
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        name = p['serial'] + '.lock'
        lock = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root)
        identity(lock, p['lock_identity'], True)
        def same_owner():
            s = os.stat(name, dir_fd=root, follow_symlinks=False)
            if (s.st_dev, s.st_ino) != (p['lock_identity']['dev'], p['lock_identity']['ino']):
                raise ValueError('replaced')
            fd, raw = read_at(lock, 'owner')
            try:
                identity(fd, p['owner_identity'])
                if hashlib.sha256(raw).hexdigest() != p['owner_sha256'] or raw.decode().strip() != p['owner']:
                    raise ValueError('owner')
            finally:
                os.close(fd)
        same_owner()
        try:
            fd, raw = read_at(lock, 'standalone_review_required')
        except FileNotFoundError:
            raw = None
        else:
            os.close(fd)
            if raw.decode().strip() != p['owner']:
                raise ValueError('foreign_marker')
        if raw is None:
            stage = '.official-quarantine-' + os.urandom(12).hex()
            fd = os.open(stage, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600, dir_fd=lock)
            try:
                body = (p['owner'] + '\n').encode()
                done = 0
                while done < len(body):
                    n = os.write(fd, body[done:])
                    if n <= 0:
                        raise ValueError('write')
                    done += n
                os.fsync(fd)
            finally:
                os.close(fd)
            same_owner()
            os.rename(stage, 'standalone_review_required', src_dir_fd=lock, dst_dir_fd=lock)
            stage = None
            os.fsync(lock)
        same_owner()
        fd, raw = read_at(lock, 'standalone_review_required')
        os.close(fd)
        if raw.decode().strip() != p['owner']:
            raise ValueError('readback')
        return {'verified': True, 'local_protection_only': True, 'physical_actions': 0,
                'owner': p['owner'], 'task_id': p['task_id'], 'run_id': p['run_id'],
                'source_commit': p['source_commit'], 'snapshot_sha256': p['snapshot_sha256'],
                'lock_dev': p['lock_identity']['dev'], 'lock_ino': p['lock_identity']['ino']}
    finally:
        if stage is not None and lock is not None:
            os.unlink(stage, dir_fd=lock)
        for fd in (lock, guard, root):
            if fd is not None:
                os.close(fd)


if __name__ == '__main__':
    try:
        print(json.dumps(protect(json.load(sys.stdin)), separators=(',', ':')))
    except Exception:
        print('OFFICIAL_CLI_QUARANTINE_SCOPE', file=sys.stderr)
        sys.exit(2)

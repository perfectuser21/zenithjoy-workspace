"""候选目录只读确认及一次安装；运输错误不等于远端未提交。"""
import base64
import ctypes
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import zlib

mode, encoded = sys.argv[1:3]
spec = json.loads(zlib.decompress(base64.b64decode(encoded)))
sha = spec['sha']
if len(sha) != 40 or any(c not in '0123456789abcdef' for c in sha):
    raise ValueError('invalid candidate SHA')
home = Path(os.environ['HOME'])
base = home / '.local/share/zenithjoy/phone-candidates'
final = base / sha


def directory(path, create=False):
    """逐层 lstat；只有真实 ENOENT 才是 absence。"""
    for parent in [*reversed(path.parents), path]:
        try:
            info = parent.lstat()
        except FileNotFoundError:
            if create:
                parent.mkdir(mode=0o700)
                info = parent.lstat()
            else:
                return False
        if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
            raise ValueError('candidate directory is not a real directory')
        if (parent == home or home in parent.parents) and (info.st_uid != os.getuid() or info.st_mode & 0o022):
            raise ValueError('candidate directory owner/write permissions unsafe')
    return True


def pending(exclude=None):
    if not directory(base):
        return []
    return [p for p in base.iterdir() if p.name.startswith('.' + sha + '.') and p != exclude]


def regular(path, private=False):
    if not directory(path.parent):
        raise ValueError('candidate parent missing')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
            raise ValueError('candidate file type/owner mismatch')
        if info.st_mode & 0o022:
            raise ValueError('candidate file is writable by other users')
        if private and info.st_mode & 0o077:
            raise ValueError('candidate identity is not private')
        if info.st_size > (65536 if private else 128 * 1024 * 1024):
            raise ValueError('candidate file too large')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            return stream.read()
    finally:
        os.close(fd)


def presence():
    if pending():
        raise ValueError('same SHA candidate installation pending')
    if not directory(final):
        return {'protocol': 'candidate_presence_v1', 'state': 'absent'}
    if not directory(final / 'runtime'):
        raise ValueError('candidate runtime missing')
    identity = json.loads(regular(final / 'candidate-identity.json', private=True))
    if set(identity) != {'source_commit', 'release_id', 'manifest_sha256'} or identity != spec['identity']:
        raise ValueError('candidate identity mismatch')
    if hashlib.sha256(regular(final / 'run.sh')).hexdigest() != spec['wrapper_sha256']:
        raise ValueError('candidate wrapper digest mismatch')
    # 未执行远端JS前，核验整份固定文件闭包；不信未知collector自报绿。
    for entry in spec['files']:
        parts = entry['deployed_path'].split('/')
        if any(p in ('', '.', '..') for p in parts):
            raise ValueError('invalid candidate file path')
        data = regular(final / 'runtime' / entry['deployed_path'])
        if hashlib.sha256(data).hexdigest() != entry['content_sha256']:
            raise ValueError('candidate content digest mismatch: ' + entry['deployed_path'])
    return {'protocol': 'candidate_presence_v1', 'state': 'present', 'identity': identity}


def rename_exclusive(source, target):
    # 不用 mv 的目录嵌套语义，也不允许覆盖迟到的最终目录。
    libc = ctypes.CDLL(None, use_errno=True)
    if sys.platform == 'darwin':
        result = libc.renamex_np(os.fsencode(source), os.fsencode(target), 4)  # RENAME_EXCL
    elif sys.platform.startswith('linux'):
        result = libc.renameat2(-100, os.fsencode(source), -100, os.fsencode(target), 1)
    else:
        raise ValueError('exclusive candidate rename unsupported')
    if result != 0:
        value = ctypes.get_errno()
        raise OSError(value, os.strerror(value))


if mode == 'presence':
    print(json.dumps(presence()))
elif mode == 'install':
    directory(base, create=True)
    if presence()['state'] != 'absent':
        raise ValueError('candidate appeared before install; retry readback')
    stage = Path(tempfile.mkdtemp(prefix='.' + sha + '.', dir=base))
    try:
        if pending(stage) or final.exists() or final.is_symlink():
            raise ValueError('candidate writer appeared before extraction')
        subprocess.run(['tar', '-xf', '-', '-C', str(stage)], stdin=sys.stdin.buffer, check=True)
        if pending(stage) or final.exists() or final.is_symlink():
            raise ValueError('candidate writer appeared before commit')
        rename_exclusive(stage, final)
    finally:
        # 只清理本人已终止操作的暂存，不碰任何其他未知安装。
        if stage.exists():
            shutil.rmtree(stage)
else:
    raise ValueError('invalid candidate operation')

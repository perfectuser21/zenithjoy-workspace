"""Host side of the coordinated production Dashboard release."""

from contextlib import contextmanager
import ctypes
from dataclasses import dataclass
import fcntl
import hashlib
from html.parser import HTMLParser
from http.client import HTTPException
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
from urllib.request import Request, urlopen
import uuid


LIMIT = 128 * 1024**2
MAX_FILES = 4096
DOCUMENT_ROOT = '/usr/share/nginx/html'
SHA = re.compile(r'[0-9a-f]{40}')
DIGEST = re.compile(r'[0-9a-f]{64}')
RELATIVE = re.compile(r'[a-zA-Z0-9_./-]{1,240}')


class ReleaseError(RuntimeError):
    pass


def require(condition, reason):
    if not condition:
        raise ReleaseError(reason)


@dataclass(frozen=True)
class Target:
    live: Path
    container: str
    origin: str


TARGETS = {
    'hz': Target(Path('/opt/zenithjoy-cn/releases/hk-20260929'),
                 'zenithjoy-cn-production-web', 'https://zenithjoy.tech'),
    'hk': Target(Path('/opt/zenithjoy/autopilot-dashboard/dist'),
                 'autopilot-dashboard', 'https://autopilot.zenjoymedia.media'),
}


@dataclass(frozen=True)
class Tree:
    root: Path
    sha: str
    digest: str
    files: dict

    def receipt(self):
        return {'sha': self.sha, 'digest': self.digest}


def file_digest(path):
    digest = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024**2), b''):
            digest.update(chunk)
    return digest.hexdigest()


def safe_path(name):
    return RELATIVE.fullmatch(name) and all(x not in ('', '.', '..') for x in name.split('/'))


def read_tree(root):
    require(root.is_dir() and not root.is_symlink(), 'release path is not a directory')
    files = {}
    total = 0
    for path in sorted(root.rglob('*')):
        name = path.relative_to(root).as_posix()
        info = path.lstat()
        require(safe_path(name), 'invalid release path')
        if not stat.S_ISDIR(info.st_mode):
            require(stat.S_ISREG(info.st_mode), 'release has a nonregular file')
            total += info.st_size
            require(total <= LIMIT and len(files) < MAX_FILES, 'release tree exceeds limits')
            files[name] = file_digest(path)
    require('index.html' in files and 'release-sha.json' in files, 'release is missing its entrypoint or stamp')
    stamp = root / 'release-sha.json'
    require(stamp.stat().st_size <= 1024, 'oversized release stamp')
    sha = json.loads(stamp.read_text()).get('sha')
    require(isinstance(sha, str) and SHA.fullmatch(sha), 'invalid release SHA')
    canonical = json.dumps(files, sort_keys=True, separators=(',', ':')).encode()
    return Tree(root, sha, hashlib.sha256(canonical).hexdigest(), files)


def unpack(stream, archive, output, expected, size):
    remaining = size
    digest = hashlib.sha256()
    with archive.open('xb') as f:
        while remaining:
            chunk = stream.read(min(remaining, 1024**2))
            require(chunk, 'archive ended early')
            f.write(chunk)
            digest.update(chunk)
            remaining -= len(chunk)
    require(not stream.read(1), 'archive has trailing bytes')
    require(digest.hexdigest() == expected, 'archive digest differs')
    total = 0
    seen = set()
    with tarfile.open(archive, 'r|gz') as tar:
        for member in tar:
            if member.name == '.' and member.isdir():
                continue
            name = member.name.removeprefix('./')
            require(safe_path(name) and name not in seen, 'invalid or duplicate archive path')
            require(len(seen) < 2 * MAX_FILES, 'archive contains too many paths')
            seen.add(name)
            target = output / PurePosixPath(name)
            if member.isdir():
                target.mkdir(mode=0o755, parents=True, exist_ok=True)
                continue
            require(member.isfile(), 'archive contains a nonregular file')
            total += member.size
            require(total <= LIMIT, 'expanded archive exceeds limits')
            target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            with tar.extractfile(member) as inp, target.open('xb') as out:
                shutil.copyfileobj(inp, out)
            target.chmod(0o644)


def checked_output(args):
    result = subprocess.run(args, capture_output=True, check=False, timeout=20, text=True)
    require(result.returncode == 0, f'{args[0]} readback failed')
    return result.stdout


def is_mounted(target):
    template = '{{json .State}}|{{json .Mounts}}'
    state, mounts = checked_output(['docker', 'inspect', '--type', 'container', '--format',
                                    template, target.container]).split('|', 1)
    state = json.loads(state)
    require(state.get('Running') and not state.get('Restarting'), 'Dashboard container is not ready')
    binds = [m for m in json.loads(mounts) if m['Destination'] == DOCUMENT_ROOT]
    require(len(binds) == 1 and binds[0]['Type'] == 'bind' and not binds[0]['RW']
            and binds[0]['Source'] == str(target.live), 'Dashboard container has unexpected mounts')


class EntryAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = set()

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        path = attrs.get('src') if tag == 'script' else attrs.get('href') if tag == 'link' else None
        if isinstance(path, str) and path.startswith('/assets/') and safe_path(path[1:]):
            self.paths.add(path[1:])


def entry_assets(html):
    parser = EntryAssets()
    parser.feed(html.decode('utf-8'))
    return parser.paths


def read_public(target, path, nonce):
    request = Request(f'{target.origin}/{path}?release_verify={nonce}',
                      headers={'Cache-Control':'no-cache', 'Accept-Encoding':'identity'})
    with urlopen(request, timeout=8) as response:
        expected = f'{target.origin}/{path}?release_verify={nonce}'
        require(response.status == 200 and response.geturl() == expected, 'public asset redirected')
        content = response.read(LIMIT + 1)
        require(len(content) <= LIMIT, 'public asset exceeds limit')
        return content


def verify_live(target, tree):
    is_mounted(target)
    command = ['docker', 'exec', target.container, 'sha256sum']
    for index in range(0, len(tree.files), 128):
        names = list(tree.files)[index:index + 128]
        mounted = checked_output(command + [f'{DOCUMENT_ROOT}/{path}' for path in names]).splitlines()
        expected = [f'{tree.files[path]}  {DOCUMENT_ROOT}/{path}' for path in names]
        require(mounted == expected, 'container is serving a different filesystem')
    expected_assets = entry_assets((tree.root / 'index.html').read_bytes())
    require(expected_assets and expected_assets <= set(tree.files), 'entrypoint assets are not in the release')
    for attempt in range(4):
        try:
            nonce = uuid.uuid4().hex
            require(json.loads(read_public(target, 'release-sha.json', nonce)).get('sha') == tree.sha,
                    'public version differs')
            require(entry_assets(read_public(target, 'index.html', nonce)) == expected_assets,
                    'public entrypoint assets differ')
            for path in expected_assets | ({'sw.js', 'manifest.webmanifest'} & tree.files.keys()):
                require(hashlib.sha256(read_public(target, path, nonce)).hexdigest() == tree.files[path],
                        'public asset digest differs')
            return
        except (OSError, ValueError, AttributeError, HTTPException, ReleaseError):
            if attempt == 3:
                raise ReleaseError('public Dashboard content verification failed') from None
            time.sleep(2)


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_json(path, data):
    with tempfile.NamedTemporaryFile(mode='w', prefix='.json-', dir=path.parent, delete=False) as f:
        tempfile_path = Path(f.name)
        json.dump(data, f, separators=(',', ':'))
        f.flush()
        os.fsync(f.fileno())
    try:
        tempfile_path.replace(path)
        sync_dir(path.parent)
    finally:
        tempfile_path.unlink(missing_ok=True)


def exchange(left, right):
    # Docker reopens the fixed source on restart. Keep that name present
    # throughout the swap, including when the incumbent is a directory.
    renameat2 = ctypes.CDLL(None, use_errno=True).renameat2
    renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    if renameat2(-100, os.fsencode(left), -100, os.fsencode(right), 2):
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))
    sync_dir(left.parent)
    sync_dir(right.parent)


def restart(target, lock_fd):
    # The Docker client holds the host lock after an SSH disconnect or timeout.
    command = ['docker', 'restart', '--time', '15', target.container]
    proc = subprocess.Popen(command, start_new_session=True, pass_fds=(lock_fd,),
                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        status = proc.wait(timeout=45)
    except subprocess.TimeoutExpired:
        raise ReleaseError('Dashboard restart is still running; pending release retained') from None
    require(status == 0, 'Dashboard restart outcome is unknown; pending release retained')


class ReleaseHost:
    def __init__(self, target):
        self.target = target
        self.state = target.live.parent / '.dashboard-production-v1'
        self.pending = self.state / 'pending.json'

    @contextmanager
    def locked(self, write=False):
        if write:
            self.state.mkdir(mode=0o700, exist_ok=True)
        if not self.state.exists() and not self.state.is_symlink():
            yield None
            return
        info = self.state.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
                and stat.S_IMODE(info.st_mode) == 0o700, 'release state directory is not private')
        lock = self.state / 'release.lock'
        flags = os.O_RDWR | os.O_CREAT if write else os.O_RDONLY
        try:
            fd = os.open(lock, flags | os.O_NOFOLLOW, 0o600)
        except FileNotFoundError:
            raise ReleaseError('release lock not ready') from None
        try:
            fcntl.flock(fd, (fcntl.LOCK_EX if write else fcntl.LOCK_SH) | fcntl.LOCK_NB)
            yield fd
        except BlockingIOError:
            raise ReleaseError('Dashboard release is locked') from None
        finally:
            os.close(fd)

    def current(self):
        path = self.target.live.resolve(strict=True)
        require(path.is_relative_to(self.target.live.parent.resolve()), 'current Dashboard root is outside its release directory')
        return read_tree(path)

    def transaction(self):
        if not self.pending.exists():
            return None
        tx = json.loads(self.pending.read_text())
        require(set(tx) == {'before', 'target'} and all(isinstance(v, str) and SHA.fullmatch(v)
                for v in tx.values()) and tx['before'] != tx['target'], 'invalid pending release')
        return tx

    def inspect(self):
        with self.locked():
            tree = self.current()
            tx = self.transaction()
            if tx:
                return {**tree.receipt(), 'pending': tx}
            verify_live(self.target, tree)
            return tree.receipt()

    def read_record(self, sha):
        return json.loads((self.state / sha / 'receipt.json').read_text())

    def stored(self, sha, verified=False):
        require((self.state / sha / 'receipt.json').is_file(), 'release is not retained')
        record = self.read_record(sha)
        tree = read_tree(self.state / sha / 'files')
        require(tree.sha == sha and record == {**tree.receipt(), 'verified': record.get('verified')}
                and isinstance(record.get('verified'), bool), 'retained release changed')
        require(not verified or record['verified'], 'release has no verified rollback receipt')
        return tree

    def remember(self, tree, verified):
        destination = self.state / tree.sha
        if destination.exists():
            saved = self.stored(tree.sha)
            require(saved.digest == tree.digest, 'refusing to replace retained bytes for the same SHA')
        else:
            with tempfile.TemporaryDirectory(prefix='retain-', dir=self.state) as temp:
                staged = Path(temp) / 'release'
                staged.mkdir()
                shutil.copytree(tree.root, staged / 'files')
                require(read_tree(staged / 'files').receipt() == tree.receipt(), 'source changed while retaining release')
                write_json(staged / 'receipt.json', {**tree.receipt(), 'verified': verified})
                staged.rename(destination)
                sync_dir(self.state)
        if verified:
            write_json(destination / 'receipt.json', {**tree.receipt(), 'verified': True})

    def prepare(self, sha, expected, size, stream):
        require(SHA.fullmatch(sha) and DIGEST.fullmatch(expected) and 0 < size <= LIMIT,
                'invalid prepare parameters')
        with self.locked(write=True):
            require(not self.transaction(), 'restore the pending Dashboard release first')
            require(shutil.disk_usage(self.state).free >= size + 3 * LIMIT + 512 * 1024**2,
                    'insufficient Dashboard release space')
            current = self.current()
            verify_live(self.target, current)
            self.remember(current, verified=True)
            with tempfile.TemporaryDirectory(prefix='prepare-', dir=self.state) as temp:
                work = Path(temp)
                output = work / 'dist'
                output.mkdir(mode=0o755)
                unpack(stream, work / 'bundle.tgz', output, expected, size)
                tree = read_tree(output)
                require(tree.sha == sha, 'candidate stamp differs from requested SHA')
                self.remember(tree, verified=False)
                return tree.receipt()

    def activate(self, sha, expected):
        return self.switch(sha, expected, recovering=False)

    def restore(self, sha, expected):
        return self.switch(sha, expected, recovering=True)

    def switch(self, sha, expected, recovering):
        require(SHA.fullmatch(sha) and SHA.fullmatch(expected), 'invalid release SHA')
        with self.locked(write=True) as lock:
            chosen = self.stored(sha, verified=recovering)
            current = self.current()
            tx = self.transaction()
            requested = {'before': expected, 'target': sha}
            if tx:
                reverse = {'before': sha, 'target': expected}
                require((tx == requested or (recovering and tx == reverse)) and
                        current.sha in tx.values(), 'another Dashboard release is pending')
                require(self.stored(current.sha).digest == current.digest, 'pending release bytes changed')
            else:
                require(current.sha in (expected, sha), 'unexpected current Dashboard SHA')
                verify_live(self.target, current)
                require(self.stored(current.sha, verified=True).digest == current.digest,
                        'current release differs from retained proof')
                if current.sha == sha:
                    return chosen.receipt()
                write_json(self.pending, requested)
            if current.sha != sha:
                self.install_pointer(chosen)
            restart(self.target, lock)
            verify_live(self.target, chosen)
            self.remember(chosen, verified=True)
            self.pending.unlink()
            sync_dir(self.state)
            return chosen.receipt()

    def install_pointer(self, tree):
        previous = self.state / 'original-bind'
        require(self.target.live.is_symlink() or not previous.exists(),
                'unexpected second original Dashboard directory')
        node = self.state / f'swap-{uuid.uuid4().hex}'
        node.symlink_to(tree.root, target_is_directory=True)
        try:
            exchange(self.target.live, node)
        finally:
            if node.is_symlink():
                node.unlink()
                sync_dir(self.state)
            elif node.is_dir():
                node.rename(previous)
                sync_dir(self.state)


def main():
    target, action, *args = sys.argv[1:]
    require(target in TARGETS, 'unknown Dashboard host')
    host = ReleaseHost(TARGETS[target])
    if action == 'inspect' and not args:
        output = host.inspect()
    elif action == 'prepare' and len(args) == 3:
        require(re.fullmatch(r'[1-9][0-9]{0,8}', args[2]), 'invalid archive size')
        output = host.prepare(args[0], args[1], int(args[2]), sys.stdin.buffer)
    elif action in ('activate', 'restore') and len(args) == 2:
        output = (host.activate if action == 'activate' else host.restore)(*args)
    else:
        raise ReleaseError('invalid Dashboard release command')
    print(json.dumps(output, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main()
    except ReleaseError as error:
        sys.exit(f'Dashboard release refused: {error}')
    except (OSError, ValueError, AttributeError, KeyError, subprocess.SubprocessError, tarfile.TarError):
        sys.exit('Dashboard release refused: host or artifact verification failed')

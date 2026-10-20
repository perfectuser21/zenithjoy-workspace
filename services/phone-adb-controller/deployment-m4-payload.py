#!/usr/bin/env python3
"""Fixed M4 ordinary-file transport, not a device/controller installer."""
import argparse
import hashlib
import io
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import tarfile
import time


def require(value, message):
    if not value:
        raise ValueError(message)


def safe(path):
    require(isinstance(path, str) and re.fullmatch(r'[A-Za-z0-9_./-]+', path)
            and not path.startswith('/') and all(p not in ('', '.', '..') for p in path.split('/')),
            'unsafe payload path')
    return path


def sha(data):
    return hashlib.sha256(data).hexdigest()


def pack(args):
    root = pathlib.Path(args.root)
    entries, payload, seen = [], {}, set()
    after_stream = 'log-stream-push.sh' not in args.sh
    for group in ('sh', 'node', 'probe', 'plan'):
        for path in getattr(args, group):
            safe(path)
            require((group, path) not in seen, 'duplicate group target')
            seen.add((group, path))
            if group == 'sh' and path == 'log-stream-push.sh':
                after_stream = True
                continue
            entry = dict(path=path, group=group, phase='after' if after_stream else 'before')
            source = root / path
            if not source.exists() or source.stat().st_size == 0:
                entry['missing'] = True
            else:
                info = source.lstat()
                require(stat.S_ISREG(info.st_mode), 'nonregular payload source')
                data = source.read_bytes()
                require(len(data) <= 32 * 1024 * 1024, 'oversized payload')
                entry.update(missing=False, size=len(data), sha256=sha(data),
                             mode=stat.S_IMODE(info.st_mode), mtime_ns=info.st_mtime_ns)
                require(path not in payload or payload[path] == data, 'source changed during packing')
                payload[path] = data
            entries.append(entry)
    require(sum(map(len, payload.values())) <= 128 * 1024 * 1024, 'oversized bundle')
    with tarfile.open(args.archive, 'w') as archive:
        members = {'plan.json': json.dumps(entries, separators=(',', ':')).encode(),
                   **{'payload/' + k: v for k, v in payload.items()}}
        for name, data in members.items():
            info = tarfile.TarInfo(name)
            info.size, info.mode = len(data), 0o600
            archive.addfile(info, io.BytesIO(data))
    print(sha(pathlib.Path(args.archive).read_bytes()))


def verified_bundle(path, expected):
    data = pathlib.Path(path).read_bytes()
    require(re.fullmatch('[a-f0-9]{64}', expected) and sha(data) == expected, 'bundle hash mismatch')
    require(len(data) <= 132 * 1024 * 1024, 'oversized archive')
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        members = archive.getmembers()
        require(all(x.isfile() for x in members) and len({x.name for x in members}) == len(members),
                'nonregular or duplicate archive member')
        require(len(members) <= 1000, 'too many archive members')
        content = {x.name: archive.extractfile(x).read() for x in members}
    require('plan.json' in content, 'missing plan')
    plan = json.loads(content.pop('plan.json'))
    require(isinstance(plan, list) and 0 < len(plan) <= 1000, 'invalid plan')
    required, seen = set(), set()
    for item in plan:
        require(isinstance(item, dict), 'invalid plan item')
        path = safe(item.get('path'))
        require(item.get('group') in ('sh', 'node', 'probe', 'plan')
                and item.get('phase') in ('before', 'after') and type(item.get('missing')) is bool,
                'invalid operation')
        require((item['group'], path) not in seen, 'duplicate group target')
        seen.add((item['group'], path))
        require(path != 'log-stream-push.sh' and path not in ('douyin-phone-adb', 'text-input-focus.py'),
                'special installer target refused')
        if item['missing']:
            continue
        name = 'payload/' + path
        require(name in content and len(content[name]) == item.get('size')
                and sha(content[name]) == item.get('sha256'), 'missing or damaged payload')
        require(type(item.get('mode')) is int and 0 <= item['mode'] <= 0o777
                and type(item.get('mtime_ns')) is int and item['mtime_ns'] >= 0, 'invalid file metadata')
        required.add(name)
    require(set(content) == required, 'unexpected archive member')
    return plan, content


def parent_identity(path):
    identities = []
    for parent in reversed([path, *path.parents]):
        info = parent.lstat()
        require(stat.S_ISDIR(info.st_mode), 'destination ancestor is not a real directory')
        identities.append((parent, info.st_dev, info.st_ino))
    return identities


def check_parents(identities):
    for path, dev, ino in identities:
        info = path.lstat()
        require(stat.S_ISDIR(info.st_mode) and (info.st_dev, info.st_ino) == (dev, ino),
                'destination ancestor changed')


def checker(group, path, target, has_zsh):
    suffix = pathlib.Path(path).suffix
    if group == 'sh':
        return ['zsh', '-n', str(target)] if has_zsh else None
    if suffix == '.py' and group == 'node':
        return ['python3', '-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', str(target)]
    if suffix == '.json':
        node = '/opt/homebrew/bin/node' if group in ('node', 'probe') else 'node'
        return [node, '-e', 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))', str(target)]
    if group == 'node' or group == 'probe' and suffix in ('.js', '.mjs'):
        return ['/opt/homebrew/bin/node', '--check', str(target)]
    return ['zsh', '-n', str(target)] if group == 'plan' else None


def install(args):
    started = time.monotonic()
    plan, content = verified_bundle(args.archive, args.sha256)
    root = pathlib.Path.home() / 'bin-harvest'
    root.mkdir(exist_ok=True)
    base = parent_identity(root)
    failed, checked = False, 0
    for item in plan:
        if item['phase'] != args.phase:
            continue
        path, group = item['path'], item['group']
        if item['missing']:
            print('缺源文件: ' + path, flush=True)
            failed |= group != 'sh'
            continue
        check_parents(base)
        target = root / path
        # Create only real directories below the pinned destination root.
        current = root
        for part in pathlib.PurePosixPath(path).parts[:-1]:
            current /= part
            if not current.exists():
                current.mkdir()
            require(stat.S_ISDIR(current.lstat().st_mode), 'symlink destination parent refused')
        identities = parent_identity(target.parent)
        mode = item['mode'] | (0o111 if group == 'sh' else 0)
        temp = target.with_name('.' + target.name + '.deploy-new')
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(content['payload/' + path])
                stream.flush()
                os.fchmod(stream.fileno(), mode)
            os.utime(temp, ns=(item['mtime_ns'], item['mtime_ns']), follow_symlinks=False)
            check_parents(base)
            check_parents(identities)
            os.replace(temp, target)
        finally:
            if temp.exists():
                temp.unlink()
        command = checker(group, path, target, args.has_zsh == '1')
        result = subprocess.run(command, capture_output=True, text=True) if command else None
        if result and result.returncode != 0:
            print('语法检查失败: ' + path + '\n' + '\n'.join(result.stderr.splitlines()[:3]), file=sys.stderr)
            failed = True
        print('M4_FILE ' + json.dumps(dict(path=path, group=group, checked=command is not None,
                                         valid=result is None or result.returncode == 0)), flush=True)
        checked += 1
    print('M4_PHASE ' + json.dumps(dict(phase=args.phase, files=checked, failed=failed,
                                      elapsed_ms=round((time.monotonic() - started) * 1000))), flush=True)
    return 3 if failed else 0


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest='command', required=True)
    p = commands.add_parser('pack')
    p.add_argument('root')
    p.add_argument('archive')
    for group in ('sh', 'node', 'probe', 'plan'):
        p.add_argument('--' + group, nargs='*', default=[])
    p = commands.add_parser('install')
    p.add_argument('archive')
    p.add_argument('sha256')
    p.add_argument('phase', choices=['before', 'after'])
    p.add_argument('has_zsh', choices=['0', '1'])
    args = parser.parse_args()
    return pack(args) or 0 if args.command == 'pack' else install(args)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, tarfile.TarError) as error:
        print('M4_PAYLOAD_INVALID: ' + str(error), file=sys.stderr)
        sys.exit(2)

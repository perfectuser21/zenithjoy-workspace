#!/usr/bin/env python3
"""重用内容相同的旧版本包；新版本产物去除构建时间差异。不同内容必须新版本。"""
import gzip
import io
from pathlib import Path
import re
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request


def normalized(file):
    entries = {}
    total = 0
    with tarfile.open(file, 'r:gz') as source:
        for member in source.getmembers():
            name = member.name.removeprefix('./').rstrip('/')
            if name in ('', '.'):
                continue
            if name.startswith('/') or any(x in ('', '.', '..') for x in name.split('/')) or name in entries:
                raise ValueError('invalid module path')
            if not member.isfile() and not member.isdir():
                raise ValueError('unsupported module entry')
            total += member.size
            if total > 512 * 1024 * 1024:
                raise ValueError('module exceeds size limit')
            content = source.extractfile(member).read() if member.isfile() else None
            entries[name] = (member.mode & 0o777, content)
    out = io.BytesIO()
    with gzip.GzipFile(fileobj=out, mode='wb', mtime=0, filename='') as compressed:
        with tarfile.open(fileobj=compressed, mode='w', format=tarfile.PAX_FORMAT) as archive:
            for name, (mode, content) in sorted(entries.items()):
                entry = tarfile.TarInfo(name)
                entry.mode = mode
                entry.type = tarfile.DIRTYPE if content is None else tarfile.REGTYPE
                entry.size = len(content) if content is not None else 0
                archive.addfile(entry, io.BytesIO(content) if content is not None else None)
    return out.getvalue()


def prepare(candidate, existing):
    actual = normalized(candidate)
    if existing is not None:
        if normalized(existing) != actual:
            raise ValueError('existing module version has different contents; bump version before candidate build')
        candidate.write_bytes(existing.read_bytes())
    else:
        candidate.write_bytes(actual)


def main(file):
    candidate = Path(file)
    if not re.fullmatch(r'line\d{2}-[a-z-]+-v\d+\.\d+\.\d+\.tar\.gz', candidate.name):
        raise ValueError('invalid module filename')
    url = 'https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com/install-pack/modules/' + candidate.name
    with tempfile.TemporaryDirectory() as directory:
        existing = Path(directory) / 'existing.tar.gz'
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                if response.geturl() != url:
                    raise ValueError('artifact redirect rejected')
                with existing.open('wb') as target:
                    total = 0
                    while chunk := response.read(65536):
                        total += len(chunk)
                        if total > 512 * 1024 * 1024:
                            raise ValueError('artifact too large')
                        target.write(chunk)
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            existing = None
        prepare(candidate, existing)


if __name__ == '__main__':
    main(sys.argv[1])

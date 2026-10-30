#!/usr/bin/env python3
"""Extract the approved official Comfy frontend into a versioned public bundle.

This release contains only upstream frontend static files. User files, custom
nodes, configuration, HTML and source maps are deliberately excluded.
"""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tempfile
import zipfile

WHEEL_SHA256 = '593af1d79767cefc3587c862dd3b3d90ff00530c5f83071522f8f9807c175346'
WHEEL_URL = ('https://files.pythonhosted.org/packages/79/f2/'
             '2f99e418fa31d7d73d23723d7fce0a4bba2d363ad0fb59ab973d78191ea3/'
             'comfyui_frontend_package-1.57.6-py3-none-any.whl')
ASSET_PREFIX = 'comfyui_frontend_package/static/assets/'
FONT_PREFIX = 'comfyui_frontend_package/static/fonts/'
REQUIRED_ASSETS = ('index-CqDKM-zt.js', 'rolldown-runtime-CM1DJQSe.js', 'vendor-datadog-CS-2l-KQ.js')
REQUIRED_FONTS = ('inter-latin-normal.woff2', 'inter-latin-italic.woff2', 'materialdesignicons-webfont.woff2')
ALLOWED_EXTENSIONS = {'.js', '.css', '.json', '.png', '.webp', '.webm', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot'}
MAX_EXTRACTED_BYTES = 64 * 1024 * 1024

def extract_assets(wheel, dist, expected_sha256):
    wheel, dist = Path(wheel), Path(dist)
    if not re.fullmatch(r'[a-f0-9]{64}', expected_sha256):
        raise ValueError('invalid expected wheel digest')
    data=wheel.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected_sha256:
        raise ValueError('official wheel digest mismatch')
    with zipfile.ZipFile(wheel) as archive:
        entries, seen, total = [], set(), 0
        for info in archive.infolist():
            if info.filename.startswith(ASSET_PREFIX):
                relative='assets/'+info.filename[len(ASSET_PREFIX):]
            elif info.filename.startswith(FONT_PREFIX):
                relative='fonts/'+info.filename[len(FONT_PREFIX):]
            else:
                continue
            if relative in ('assets/','fonts/'):
                continue
            if (relative.startswith('/') or not re.fullmatch(r'[A-Za-z0-9._@/-]+',relative)
                or any(part in ('','.','..') for part in relative.rstrip('/').split('/'))
                or relative in seen):
                raise ValueError('invalid or duplicate asset path')
            seen.add(relative)
            file_type=stat.S_IFMT(info.external_attr >> 16)
            if file_type not in (0, stat.S_IFREG, stat.S_IFDIR):
                raise ValueError('archive links and special files are forbidden')
            if info.is_dir():
                continue
            if file_type == stat.S_IFDIR:
                raise ValueError('invalid directory entry')
            if Path(relative).suffix.lower() not in ALLOWED_EXTENSIONS:
                continue
            total += info.file_size
            if total > MAX_EXTRACTED_BYTES:
                raise ValueError('official assets exceed size limit')
            entries.append((relative, info))
        required={f'assets/{name}' for name in REQUIRED_ASSETS}|{f'fonts/{name}' for name in REQUIRED_FONTS}
        if not required.issubset({name for name,_ in entries}):
            raise ValueError('official frontend entry files missing')
        parent=dist/'assets'/'comfy'
        parent.mkdir(parents=True,exist_ok=True)
        release=parent/expected_sha256
        temporary=Path(tempfile.mkdtemp(prefix='.official-',dir=parent))
        try:
            manifest={}
            for relative, info in entries:
                payload=archive.read(info)
                target=temporary.joinpath(*PurePosixPath(relative).parts)
                target.parent.mkdir(parents=True,exist_ok=True)
                target.write_bytes(payload)
                manifest[relative]=hashlib.sha256(payload).hexdigest()
            (temporary/'manifest.json').write_text(json.dumps({'wheel_sha256':expected_sha256,'files':manifest},sort_keys=True,separators=(',',':'))+'\n')
            if release.exists() or release.is_symlink():
                if release.is_symlink() or not release.is_dir():
                    raise ValueError('invalid existing release')
                expected={str(p.relative_to(temporary)):hashlib.sha256(p.read_bytes()).digest() for p in temporary.rglob('*') if p.is_file()}
                actual={str(p.relative_to(release)):hashlib.sha256(p.read_bytes()).digest() for p in release.rglob('*') if p.is_file() and not p.is_symlink()}
                if any(p.is_symlink() for p in release.rglob('*')) or expected != actual:
                    raise ValueError('existing release differs')
                return release
            os.replace(temporary,release)
            return release
        finally:
            if temporary.exists(): shutil.rmtree(temporary)

if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('usage: comfy_official_assets.py OFFICIAL_WHEEL OUTPUT_DIST')
    print(extract_assets(sys.argv[1],sys.argv[2],WHEEL_SHA256))

#!/usr/bin/env python3
"""受信方法包安装/采集：只读固定Git对象，独立不可变根，不改当前指针或ACK。"""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent

def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / 'commander' / (name + '.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module

method = load('wf-method')
io = load('wf-v2-io')


def install(release_id, source_root, home, request):
    method.need(socket.gethostname().lower().split('.')[0] == 'aad17-2', 'installation physical host is not MMV')
    release = request('/api/brain/releases/' + release_id)['release']
    method.need(release['id'] == release_id and release['environment'] == 'production' and release['payload']['verification']['status'] == 'verified', 'install requires verified formal release')
    manifest = method.manifest_for(release)
    info = method.instance(manifest, home)
    method.need(release['target'] == info['target'], 'formal release target is not derived from package')
    root = Path(info['method_root'])
    root.parent.mkdir(parents=True, exist_ok=True)
    method.need(root.parent.resolve(strict=True) == root.parent, 'installation parent is not canonical')
    with io.lock(root.parent / (info['manifest_sha256'] + '.install.lock')):
        if root.exists():
            return method.collect(manifest, home)
        staging = Path(tempfile.mkdtemp(prefix='.install-', dir=root.parent))
        try:
            for binding in manifest['bindings']:
                path, revision = binding['path'], binding['revision']
                entry = subprocess.check_output(['git', '-C', str(source_root), 'ls-tree', revision, '--', path], text=True).split()
                method.need(len(entry) == 4 and entry[0] in ('100644', '100755') and entry[1] == 'blob' and entry[3] == path, 'source must be a fixed regular Git blob')
                raw = subprocess.check_output(['git', '-C', str(source_root), 'show', revision + ':' + path])
                method.need('sha256:' + method.digest(raw) == binding['digest'], 'official source digest mismatch')
                target = staging / path; target.parent.mkdir(parents=True, exist_ok=True)
                with open(target, 'wb') as output:
                    output.write(raw); output.flush(); os.fsync(output.fileno())
            method.dependencies(manifest, staging)
            io.write(staging / 'method-manifest.json', manifest)
            # 完整写完后一次发布；从不替换已有包，失败只清未发布staging。
            os.rename(staging, root)
            fd = os.open(str(root.parent), os.O_RDONLY)
            try: os.fsync(fd)
            finally: os.close(fd)
            for path in root.rglob('*'):
                path.chmod(0o555 if path.is_dir() else 0o444)
            root.chmod(0o555)
        finally:
            if staging.exists(): shutil.rmtree(staging)
        return method.collect(manifest, home)


def main():
    method.need(len(sys.argv) >= 3 and sys.argv[1] in ('install', 'collect'), 'use install release_id git_root | collect release_id')
    if sys.argv[1] == 'install':
        method.need(len(sys.argv) == 4, 'fixed source checkout required')
        result = install(sys.argv[2], Path(sys.argv[3]), Path.home(), io.brain_read)
    else:
        release = io.brain_read('/api/brain/releases/' + sys.argv[2])['release']
        result = method.collect(method.manifest_for(release), Path.home())
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    try: main()
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr); sys.exit(1)

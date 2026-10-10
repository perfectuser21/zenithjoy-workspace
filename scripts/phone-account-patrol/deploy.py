#!/usr/bin/env python3
"""从已提交代码部署固定版本；不创建或启动定时服务。"""
import argparse
import hashlib
import io
import json
import pathlib
import shlex
import shutil
import subprocess
import tarfile

FILES = ['runner.py', 'collector.py', 'dispatch.py', 'preflight.py', 'publish.mjs', 'ocr.swift', 'SKILL.md']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True, help='已登记流程/调度ID，不含凭据')
    args = parser.parse_args()
    source = pathlib.Path(__file__).resolve().parent
    repo = pathlib.Path(subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip())
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    # 未提交修改不能被包装成该commit的部署。
    dirty = subprocess.check_output(['git', 'status', '--porcelain', '--', str(source)], text=True).strip()
    if dirty:
        raise SystemExit('巡查源码有未提交改动，拒绝部署')
    config = json.loads(pathlib.Path(args.config).read_text())
    remote_home = '/Users/jinnuoshengyuan'
    remote_release = remote_home + '/.local/share/phone-account-patrol/releases/' + revision
    state = pathlib.Path.home() / '.local/share/phone-account-patrol'
    release = state / 'releases' / revision
    release.mkdir(parents=True, exist_ok=True)
    manifest = {**config, 'source_revision': revision, 'source_repository': 'perfectuser21/zenithjoy-workspace',
                'remote_release': remote_release, 'maintenance_owner': '主理人', 'sha256': {}}
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w:gz') as archive:
        for name in FILES:
            committed = subprocess.check_output(['git', 'show', revision + ':' + str((source / name).relative_to(repo))])
            target = release / name
            target.write_bytes(committed)
            manifest['sha256'][name] = hashlib.sha256(committed).hexdigest()
            info = tarfile.TarInfo(name)
            info.size = len(committed)
            info.mode = 0o600
            archive.addfile(info, io.BytesIO(committed))
        encoded = json.dumps(manifest, ensure_ascii=False, indent=2).encode()
        (release / 'deployment.json').write_bytes(encoded)
        info = tarfile.TarInfo('deployment.json')
        info.size = len(encoded)
        info.mode = 0o600
        archive.addfile(info, io.BytesIO(encoded))
    command = 'mkdir -p ' + shlex.quote(remote_release) + ' && tar -xzf - -C ' + shlex.quote(remote_release)
    result = subprocess.run(['/usr/bin/ssh', '-o', 'ProxyJump=none', '-o', 'ProxyCommand=none', '-o', 'BatchMode=yes', '-o', 'ControlMaster=no', '-o', 'ControlPath=none', 'xian-m4', command], input=buffer.getvalue(), capture_output=True)
    if result.returncode:
        raise SystemExit('M4版本部署失败，未改变调度')
    (state / 'deployment-current.json').write_text(json.dumps({'release': str(release), **manifest}, ensure_ascii=False, indent=2))
    print(json.dumps({'local_release': str(release), 'remote_release': remote_release, 'source_revision': revision}, ensure_ascii=False))


if __name__ == '__main__':
    main()

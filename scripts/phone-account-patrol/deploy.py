#!/usr/bin/env python3
"""从已提交代码部署固定版本；不创建或启动定时服务。"""
import argparse
import hashlib
import io
import json
import pathlib
import re
import shlex
import shutil
import subprocess
import tarfile

FILES = ['runner.py', 'collector.py', 'dispatch.py', 'preflight.py', 'publish.mjs', 'ocr.swift', 'SKILL.md', 'mirror.mjs']


def validate_config(config):
    keys = {'single_workflow_id', 'batch_workflow_id', 'schedule_id', 'project_id'}
    if set(config) != keys or any(not isinstance(v, str) or not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', v) for v in config.values()):
        raise ValueError('部署配置只能包含四个已登记的UUID，不能携带凭据或任意字段')


def verify_remote_proof(expected, proof):
    if proof.get('ok') is not True or proof.get('source_revision') != expected['source_revision'] or proof.get('sha256') != expected['sha256']:
        raise ValueError('远端部署文件指纹读回不一致，不更新当前部署指针')


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
    validate_config(config)
    ssh = ['/usr/bin/ssh', '-o', 'ProxyJump=none', '-o', 'ProxyCommand=none', '-o', 'BatchMode=yes', '-o', 'ControlMaster=no', '-o', 'ControlPath=none', 'xian-m4']
    remote_home = subprocess.check_output(ssh + ["/opt/homebrew/bin/python3 -c 'import pathlib; print(pathlib.Path.home())'"], text=True).strip()
    if not pathlib.PurePosixPath(remote_home).is_absolute() or '\n' in remote_home:
        raise ValueError('远端用户目录未能可靠读回')
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
    verification = 'import pathlib,json,hashlib; p=pathlib.Path(' + repr(remote_release) + '); m=json.loads((p/"deployment.json").read_text()); h={n:hashlib.sha256((p/n).read_bytes()).hexdigest() for n in m["sha256"]}; print(json.dumps({"ok":h==m["sha256"],"source_revision":m["source_revision"],"sha256":h}))'
    proof = json.loads(subprocess.check_output(ssh + ['/opt/homebrew/bin/python3 -c ' + shlex.quote(verification)], text=True))
    verify_remote_proof(manifest, proof)
    # 沿用既有设备镜子的执行器与定时，不新增服务；镜子源码也落Git固定release。
    mirror_target = state.parent / 'phone-task-view/mirror.mjs'
    if not mirror_target.parent.is_dir():
        raise ValueError('既有设备镜子执行器缺失，不能冒称页面已接通')
    mirror_target.write_bytes((release / 'mirror.mjs').read_bytes())
    (state / 'deployment-current.json').write_text(json.dumps({'release': str(release), **manifest}, ensure_ascii=False, indent=2))
    print(json.dumps({'local_release': str(release), 'remote_release': remote_release, 'source_revision': revision}, ensure_ascii=False))


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""从已提交代码部署固定版本；不创建或启动定时服务。"""
import argparse
import errno
import hashlib
import io
import json
import pathlib
import re
import shlex
import subprocess
import tarfile
import tempfile

FILES = ['runner.py', 'collector.py', 'dispatch.py', 'preflight.py', 'publish.mjs', 'ocr.swift', 'SKILL.md', 'mirror.mjs']
IDENTITY_KEYS = ('single_workflow_id', 'batch_workflow_id', 'schedule_id', 'project_id')


def validate_config(config):
    if set(config) != set(IDENTITY_KEYS) or any(not isinstance(v, str) or not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', v) for v in config.values()):
        raise ValueError('部署配置只能包含四个已登记的UUID，不能携带凭据或任意字段')


def verify_remote_proof(expected, proof):
    if proof.get('ok') is not True or proof.get('source_revision') != expected['source_revision'] or proof.get('sha256') != expected['sha256']:
        raise ValueError('远端部署文件指纹读回不一致，不更新当前部署指针')
    if any(proof.get(key) != expected.get(key) for key in IDENTITY_KEYS):
        raise ValueError('远端部署流程身份读回不一致，不更新当前部署指针')


def read_release_file(repo, revision, name):
    reader = (
        "import {readArchivedDeploymentSource} from './services/phone-adb-controller/deployment-fixed-source.mjs';"
        "process.stdout.write(readArchivedDeploymentSource(process.cwd(), ...process.argv.slice(1)));"
    )
    return subprocess.check_output(
        ['node', '--input-type=module', '-e', reader, revision, 'scripts/phone-account-patrol/' + name],
        cwd=repo, timeout=135)


def install_local_release(release, files):
    release.parent.mkdir(parents=True, exist_ok=True)
    if not release.exists() and not release.is_symlink():
        with tempfile.TemporaryDirectory(prefix='.patrol-stage-', dir=release.parent) as temporary:
            stage = pathlib.Path(temporary)
            for name, content in files.items():
                (stage / name).write_bytes(content)
            try:
                stage.rename(release)
            except OSError as error:
                if error.errno not in (errno.EEXIST, errno.ENOTEMPTY):
                    raise
    if release.is_symlink():
        raise ValueError('本机冻结候选不可使用符号链接')
    for name, content in files.items():
        path = release / name
        if path.is_symlink():
            raise ValueError('本机冻结候选不可使用符号链接')
        installed = path.read_bytes()
        matches = json.loads(installed) == json.loads(content) if name == 'deployment.json' else installed == content
        if not matches:
            raise ValueError('本机冻结候选已有不同字节，不覆盖：' + name)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True, help='已登记流程/调度ID，不含凭据')
    parser.add_argument('--prepare-only', action='store_true', help='准备并核对两机固定目录，保留当前指针')
    parser.add_argument('--source-revision', help='prepare-only 的候选完整 Git SHA')
    args = parser.parse_args()
    source = pathlib.Path(__file__).resolve().parent
    repo = pathlib.Path(subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip())
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    revision = args.source_revision or head
    if args.source_revision and not args.prepare_only:
        parser.error('--source-revision requires --prepare-only')
    if not re.fullmatch(r'[0-9a-f]{40}', revision) or subprocess.run(
            ['git', 'merge-base', '--is-ancestor', revision, head], cwd=repo, check=False).returncode:
        parser.error('候选固定源必须是当前 checkout 的完整祖先 SHA')
    # 未提交修改不能被包装成该commit的部署。
    reader_path = 'services/phone-adb-controller/deployment-fixed-source.mjs'
    dirty = subprocess.check_output(['git', 'status', '--porcelain', '--', str(source), reader_path], text=True).strip()
    if dirty:
        raise SystemExit('巡查源码有未提交改动，拒绝部署')
    config = json.loads(pathlib.Path(args.config).read_text())
    validate_config(config)
    files = {name: read_release_file(repo, revision, name) for name in FILES}
    ssh = ['/usr/bin/ssh', '-o', 'ProxyJump=none', '-o', 'ProxyCommand=none', '-o', 'BatchMode=yes', '-o', 'ControlMaster=no', '-o', 'ControlPath=none', 'xian-m4']
    remote_home = subprocess.check_output(ssh + ["/opt/homebrew/bin/python3 -c 'import pathlib; print(pathlib.Path.home())'"], text=True).strip()
    if not pathlib.PurePosixPath(remote_home).is_absolute() or '\n' in remote_home:
        raise ValueError('远端用户目录未能可靠读回')
    remote_release = remote_home + '/.local/share/phone-account-patrol/releases/' + revision
    state = pathlib.Path.home() / '.local/share/phone-account-patrol'
    release = state / 'releases' / revision
    manifest = {**config, 'source_revision': revision, 'source_repository': 'perfectuser21/zenithjoy-workspace',
                'remote_release': remote_release, 'maintenance_owner': '主理人',
                'sha256': {name: hashlib.sha256(content).hexdigest() for name, content in files.items()}}
    files['deployment.json'] = json.dumps(manifest, ensure_ascii=False, indent=2).encode()
    install_local_release(release, files)
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w:gz') as archive:
        for name, committed in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(committed)
            info.mode = 0o600
            archive.addfile(info, io.BytesIO(committed))
    remote_parent = shlex.quote(str(pathlib.PurePosixPath(remote_release).parent))
    candidate_path = shlex.quote(remote_release)
    rename = shlex.quote('from os import rename; from sys import argv; rename(argv[1], argv[2])')
    command = (
        f'if [ -e {candidate_path} ] || [ -L {candidate_path} ]; then cat >/dev/null; else '
        f'mkdir -p {remote_parent} && stage=$(mktemp -d {remote_parent}/.patrol-stage-XXXXXXXX) || exit 1; '
        'trap \'rmdir "$stage" 2>/dev/null || rm -rf -- "$stage"\' EXIT; '
        f'tar -xzf - -C "$stage" && /opt/homebrew/bin/python3 -c {rename} "$stage" {candidate_path}; fi')
    result = subprocess.run(ssh + [command], input=buffer.getvalue(), capture_output=True)
    if result.returncode:
        raise SystemExit('M4版本部署失败，未改变调度')
    verification = (
        'import pathlib,json,hashlib; p=pathlib.Path(' + repr(remote_release) + '); '
        'assert not p.is_symlink() and not (p/"deployment.json").is_symlink(); '
        'm=json.loads((p/"deployment.json").read_text()); '
        'names=' + repr(FILES) + '; assert all(not (p/n).is_symlink() for n in names); '
        'h={n:hashlib.sha256((p/n).read_bytes()).hexdigest() for n in names}; '
        'print(json.dumps({**m,"ok":h==m["sha256"],"sha256":h}))')
    proof = json.loads(subprocess.check_output(ssh + ['/opt/homebrew/bin/python3 -c ' + shlex.quote(verification)], text=True))
    verify_remote_proof(manifest, proof)
    if args.prepare_only:
        print(json.dumps({'local_release': str(release), 'remote_release': remote_release,
                          'source_revision': revision, 'sha256': manifest['sha256'], 'activated': False}, ensure_ascii=False))
        return
    # 沿用既有设备镜子的执行器与定时，不新增服务；镜子源码也落Git固定release。
    mirror_target = state.parent / 'phone-task-view/mirror.mjs'
    if not mirror_target.parent.is_dir():
        raise ValueError('既有设备镜子执行器缺失，不能冒称页面已接通')
    mirror_target.write_bytes((release / 'mirror.mjs').read_bytes())
    (state / 'deployment-current.json').write_text(json.dumps({'release': str(release), **manifest}, ensure_ascii=False, indent=2))
    print(json.dumps({'local_release': str(release), 'remote_release': remote_release, 'source_revision': revision}, ensure_ascii=False))


if __name__ == '__main__':
    main()

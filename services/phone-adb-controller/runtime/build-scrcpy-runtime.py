#!/usr/bin/env python3
"""采用已验固定产物，或从固定源码重建候选客户端；从不执行安装或ADB。"""
import argparse
import ctypes
import errno
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

POLICY = json.loads(Path(__file__).with_name('runtime-policy.json').read_text())


def runtime_policy(runtime_kind='sdk31'):
    """只允许仓库内两个固定策略；环境不能指定任意policy文件。"""
    if runtime_kind == 'sdk31':
        policy, expected = POLICY, ('scrcpy-sdk31-pinned-v1', '5.0.1')
    elif runtime_kind == 'sdk33':
        try:
            policy = json.loads(Path(__file__).with_name('runtime-policy-sdk33.json').read_text())
        except (OSError, ValueError) as error:
            raise ValueError('fixed sdk33 runtime policy is unavailable') from error
        expected = ('scrcpy-sdk33-pinned-v1', '3.3.4')
    else:
        raise ValueError('unknown pinned runtime kind')
    if not isinstance(policy, dict) or (policy.get('schema'), policy.get('version')) != expected:
        raise ValueError('fixed runtime policy identity does not match selected kind')
    return policy


def digest(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError('artifact must be a regular non-symlink file')
    return hashlib.sha256(path.read_bytes()).hexdigest()


def publish_exclusive(source, destination):
    """原子rename且禁止替换已存在目录，不使用exists+rename竞态窗口。"""
    libc = ctypes.CDLL(None, use_errno=True)
    if sys.platform == 'darwin':
        function = libc.renamex_np
        function.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
        code = function(os.fsencode(source), os.fsencode(destination), 4)  # RENAME_EXCL
    elif sys.platform.startswith('linux') and hasattr(libc, 'renameat2'):
        function = libc.renameat2
        function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int,
                             ctypes.c_char_p, ctypes.c_uint]
        code = function(-100, os.fsencode(source), -100, os.fsencode(destination), 1)
    else:
        raise RuntimeError('atomic no-clobber directory publication is unsupported')
    if code:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), str(destination))


def adopt_runtime(client, server, runtime_root, runtime_kind='sdk31'):
    policy = runtime_policy(runtime_kind)
    client, server, root = map(Path, (client, server, runtime_root))
    if not root.is_absolute() or not root.parent.is_dir():
        raise ValueError('runtime root must be absolute with an existing parent')
    for name, path in [('client', client), ('server', server)]:
        if digest(path) != policy[name + '_sha256']:
            raise ValueError(name + ' does not match approved SHA256')
    temporary = Path(tempfile.mkdtemp(prefix='.' + root.name + '.build-', dir=root.parent))
    try:
        shutil.copyfile(client, temporary / 'scrcpy')
        shutil.copyfile(server, temporary / 'scrcpy-server')
        # 复制后再校验，不能凭源检查把竞态损坏的副本发布。
        for name, path in [('client', temporary / 'scrcpy'), ('server', temporary / 'scrcpy-server')]:
            if digest(path) != policy[name + '_sha256']:
                raise ValueError('copied artifact hash mismatch')
        result = dict(policy, verified=True, client_path=str(root / 'scrcpy'),
                      server_path=str(root / 'scrcpy-server'), runtime_root=str(root),
                      installation='isolated immutable package; no global installation')
        (temporary / 'runtime-manifest.json').write_text(json.dumps(result, indent=2) + '\n')
        os.chmod(temporary / 'scrcpy', 0o555)
        os.chmod(temporary / 'scrcpy-server', 0o444)
        os.chmod(temporary / 'runtime-manifest.json', 0o444)
        os.chmod(temporary, 0o555)
        publish_exclusive(temporary, root)
        return result
    finally:
        if temporary.exists():
            temporary.chmod(0o755)
            shutil.rmtree(temporary)


def rebuild_candidate(source, build_dir, server, meson, ninja, pkg_config, runtime_kind='sdk31'):
    """只产生待审新SHA候选；重编译绝不自动变更已批准client pin。"""
    policy = runtime_policy(runtime_kind)
    source, build_dir, server = map(Path, (source, build_dir, server))
    if not source.is_absolute() or not build_dir.is_absolute() or build_dir.exists():
        raise ValueError('source/build paths must be absolute and build path must be new')
    head = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    if head != policy['source_commit']:
        raise ValueError('source commit is not the selected pinned official commit')
    if subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain'], text=True).strip():
        raise ValueError('rebuild requires a clean dedicated official source checkout')
    archive = subprocess.check_output(['git', '-C', str(source), 'archive', 'HEAD'])
    if hashlib.sha256(archive).hexdigest() != policy['source_archive_sha256']:
        raise ValueError('official source archive digest mismatch')
    patch_file = Path(__file__).with_name({'sdk31': 'scrcpy-v5.0.1-recorder-init.patch',
                                        'sdk33': 'scrcpy-v3.3.4-log-flush.patch'}[runtime_kind])
    if digest(patch_file) != policy['patch_sha256'] or digest(server) != policy['server_sha256']:
        raise ValueError('patch/server digest mismatch')
    subprocess.run(['git', '-C', str(source), 'apply', '--check', str(patch_file)], check=True)
    subprocess.run(['git', '-C', str(source), 'apply', str(patch_file)], check=True)
    if runtime_kind == 'sdk31' and digest(source / 'app/src/recorder.c') != policy['patched_recorder_sha256']:
        raise ValueError('patched recorder digest mismatch')
    if digest(source / 'app/src/util/log.c') != policy['patched_log_sha256']:
        raise ValueError('patched logger digest mismatch')
    tools = [str(Path(tool).resolve().parent) for tool in (meson, ninja, pkg_config)]
    env = dict(os.environ, PKG_CONFIG=str(pkg_config),
               PATH=os.pathsep.join(tools + [os.environ.get('PATH', '')]))
    if not env.get('PKG_CONFIG_PATH') and sys.platform == 'darwin':
        env['PKG_CONFIG_PATH'] = ':'.join('/opt/homebrew/opt/' + name + '/lib/pkgconfig'
                                         for name in ('ffmpeg', 'sdl3' if runtime_kind == 'sdk31' else 'sdl2', 'libusb'))
    subprocess.run([str(meson), 'setup', str(build_dir), str(source), '--buildtype=debug',
                    '--prefix=' + str(build_dir / 'prefix'), '-Dcompile_server=false'],
                   env=env, check=True)
    subprocess.run([str(ninja), '-C', str(build_dir)], env=env, check=True)
    subprocess.run([sys.executable, str(Path(__file__).parent / 'tests/test_log_flush.py'),
                    '--source', str(source), '--build-dir', str(build_dir),
                    '--pkg-config', str(pkg_config), '--sdl-package',
                    'sdl3' if runtime_kind == 'sdk31' else 'sdl2'], env=env, check=True)
    subprocess.run([str(meson), 'test', '-C', str(build_dir), '--print-errorlogs'],
                   env=env, check=True)
    executable = build_dir / 'app/scrcpy'
    result = {'candidate_only': True, 'client_path': str(executable),
              'client_sha256': digest(executable), 'source_commit': head,
              'approved_pin_matches': digest(executable) == policy['client_sha256'],
              'note': 'debug路径/工具链可能改变字节；新SHA须独立审核，不自动作为生产runtime'}
    (build_dir / 'candidate-manifest.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    adopt = sub.add_parser('adopt')
    for key in ('client', 'server', 'runtime-root'):
        adopt.add_argument('--' + key, required=True)
    rebuild = sub.add_parser('rebuild')
    for key in ('source', 'build-dir', 'server', 'meson', 'ninja', 'pkg-config'):
        rebuild.add_argument('--' + key, required=True)
    for command_parser in (adopt, rebuild):
        command_parser.add_argument('--runtime-kind', choices=['sdk31', 'sdk33'], default='sdk31')
    args = vars(parser.parse_args(argv))
    command = args.pop('command')
    try:
        result = adopt_runtime(**args) if command == 'adopt' else rebuild_candidate(**args)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(json.dumps({'verified': False, 'error': str(error)}))
        return 64
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())

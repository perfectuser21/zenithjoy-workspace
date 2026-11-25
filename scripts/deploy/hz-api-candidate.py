"""Publish the exact HK-staged image and deliver it to the Hangzhou API release host."""

import argparse
import hashlib
import importlib.util
import ipaddress
import json
import logging
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile


HERE = Path(__file__).resolve().parent
ARCHIVE = 'image.tar.gz'
MIGRATIONS = 'migration-filenames.txt'
MANIFEST = 'candidate.json'
SHA_PATTERN = r'[a-f0-9]{40}'
DIGEST_PATTERN = r'[a-f0-9]{64}'
NUMBER_PATTERN = r'[1-9][0-9]{0,15}'
MIGRATION_PATTERN = r'[A-Za-z0-9_.-]+\.sql'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def validate_coordinates(sha, run_id, attempt):
    require(re.fullmatch(SHA_PATTERN, sha), 'candidate SHA is invalid')
    require(re.fullmatch(NUMBER_PATTERN, run_id), 'staging run ID is invalid')
    require(re.fullmatch(NUMBER_PATTERN, attempt), 'staging run attempt is invalid')


def publish(source, target, sha, run_id, attempt):
    validate_coordinates(sha, run_id, attempt)
    tracked = subprocess.check_output(
        ['git', 'ls-tree', '--name-only', f'{sha}:apps/api/db/migrations'], text=True
    )
    paths = [Path(line).name for line in tracked.splitlines() if line.endswith('.sql')]
    require(len(paths) > 0 and len(paths) == len(set(paths))
            and all(re.fullmatch(MIGRATION_PATTERN, name) for name in paths),
            'candidate migrations list is invalid')
    sizes = json.loads((source / 'staging-image-sizes.json').read_text())
    identity = json.loads((source / 'staging-image-identity.json').read_text())
    target.mkdir(mode=0o700, exist_ok=False)
    shutil.copyfile(source / 'staging-image.tar.gz', target / ARCHIVE)
    (target / MIGRATIONS).write_text('\n'.join(sorted(paths)) + '\n')
    info = {
        'schema': 1, 'sha': sha, 'run_id': run_id, 'run_attempt': attempt,
        'archive_bytes': sizes['archive'], 'unpacked_bytes': sizes['unpacked'],
        'archive_sha256': (source / 'staging-image.sha256').read_text().strip(),
        'compressed_sha256': file_sha256(target / ARCHIVE),
        'migrations_sha256': file_sha256(target / MIGRATIONS),
        'config': identity['config'], 'layers_hash': identity['layers_hash'],
    }
    (target / MANIFEST).write_text(json.dumps(info, sort_keys=True) + '\n')
    read_bundle(target, sha, run_id, attempt)


def read_bundle(target, sha, run_id, attempt):
    validate_coordinates(sha, run_id, attempt)
    for name in (ARCHIVE, MIGRATIONS, MANIFEST):
        item = target / name
        require(item.is_file() and not item.is_symlink(), 'candidate bundle file is missing or unsafe')
    info = json.loads((target / MANIFEST).read_text())
    require(info.get('schema') == 1 and (info.get('sha'), info.get('run_id'), info.get('run_attempt'))
            == (sha, run_id, attempt), 'candidate bundle is from a different staging attempt')
    for key in ('archive_bytes', 'unpacked_bytes'):
        require(type(info.get(key)) is int and 0 < info[key] < 5 * 1024**3, 'candidate image sizes are invalid')
    for key in ('archive_sha256', 'compressed_sha256', 'migrations_sha256', 'layers_hash'):
        require(isinstance(info.get(key), str) and re.fullmatch(DIGEST_PATTERN, info[key]),
                'candidate digests are invalid')
    require(isinstance(info.get('config'), str) and re.fullmatch('sha256:' + DIGEST_PATTERN, info['config']),
            'candidate image config is invalid')
    require(0 < (target / ARCHIVE).stat().st_size < 5 * 1024**3
            and file_sha256(target / ARCHIVE) == info['compressed_sha256'],
            'candidate archive differs from staging bundle')
    require((target / MIGRATIONS).stat().st_size < 65536
            and file_sha256(target / MIGRATIONS) == info['migrations_sha256'],
            'candidate migration list differs from staging bundle')
    migrations = (target / MIGRATIONS).read_text()
    rows = migrations.splitlines()
    require(bool(rows) and rows == sorted(set(rows)) and all(re.fullmatch(MIGRATION_PATTERN, row) for row in rows),
            'candidate migration list is invalid')
    return info, migrations


def run_via_hangzhou(ssh, **kwargs):
    inner = shlex.join(['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
                        '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15',
                        'aliyun-cn', ssh[-1]])
    return subprocess.run([*ssh[:-1], inner], **kwargs)


def outer_ssh(directory, env):
    host = str(ipaddress.IPv4Address(env['MMV_SSH_HOST']))
    user = env['MMV_SSH_USER']
    require(re.fullmatch(r'[a-zA-Z0-9_][a-zA-Z0-9_-]{0,31}', user), 'MMV SSH user is invalid')
    host_key = env['MMV_HOST_KEY'].strip()
    require(re.fullmatch(r'ssh-ed25519 [a-zA-Z0-9+/=]+', host_key), 'MMV host key must be pinned')
    key = directory / 'ssh-key'
    key.write_text(env['MMV_SSH_KEY'].rstrip() + '\n')
    key.chmod(0o600)
    known = directory / 'known_hosts'
    known.write_text(f'{host} {host_key}\n')
    return ['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o',
            'StrictHostKeyChecking=yes', '-o', f'UserKnownHostsFile={known}', '-o',
            'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-i', str(key), f'{user}@{host}']


def host_script(ssh, path, args, stdin='', capture_output=False):
    command = shlex.join(['sudo', '-n', 'bash', '-c', path.read_text(), 'hz-api', *args])
    return run_via_hangzhou([*ssh, command], input=stdin, text=True, check=True,
                            stdout=subprocess.PIPE if capture_output else None)


def read_receipt(lines, prefix, pattern):
    values = [line.removeprefix(prefix) for line in lines.splitlines() if line.startswith(prefix)]
    require(len(values) == 1 and re.fullmatch(pattern, values[0]), 'Hangzhou host receipt incomplete')
    return values[0]


def import_transfer():
    path = HERE / 'staging-cos-delivery.py'
    spec = importlib.util.spec_from_file_location('existing_cos_delivery', path)
    transfer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(transfer)
    return transfer


def deliver_image(ssh, source, info, env):
    logging.disable(logging.CRITICAL)
    from qcloud_cos import CosConfig, CosS3Client

    transfer = import_transfer()
    original = shlex.join(['sudo', '-n', 'bash', '-c', (HERE / 'hz-api-load-image.sh').read_text(),
                           'hz-api-image', info['sha'], info['archive_sha256'], str(info['archive_bytes']),
                           str(info['unpacked_bytes']), info['config'], info['layers_hash'],
                           (HERE / 'staging-image-identity.py').read_text()])

    def remote(outer, **kwargs):
        nonlocal receipt
        result = run_via_hangzhou(outer, **kwargs, stdout=subprocess.PIPE)
        receipt = result.stdout
        return result

    receipt = ''
    try:
        client = CosS3Client(CosConfig(Region=env['COS_REGION'], SecretId=env['COS_SECRET_ID'],
                                      SecretKey=env['COS_SECRET_KEY'], Scheme='https', Timeout=600))
        transfer.deliver(client, source / ARCHIVE, env, original, ssh, run=remote)
    except transfer.DeliveryError as error:
        raise ValueError(str(error)) from None
    except Exception:
        raise ValueError('private image transfer failed') from None
    config = read_receipt(receipt, 'HZ_CANDIDATE_CONFIG=', 'sha256:' + DIGEST_PATTERN)
    require(config == info['config'], 'Hangzhou loaded image differs from the admitted configuration')
    return read_receipt(receipt, 'HZ_CANDIDATE_IMAGE=', 'sha256:' + DIGEST_PATTERN)


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest='mode', required=True)
    artifact = commands.add_parser('artifact')
    artifact.add_argument('source', type=Path)
    artifact.add_argument('target', type=Path)
    artifact.add_argument('sha')
    artifact.add_argument('run_id')
    artifact.add_argument('run_attempt')
    commands.add_parser('inspect')
    rollback = commands.add_parser('rollback')
    rollback.add_argument('sha')
    promote = commands.add_parser('promote')
    promote.add_argument('source', type=Path)
    promote.add_argument('sha')
    promote.add_argument('run_id')
    promote.add_argument('run_attempt')
    args = parser.parse_args()
    if args.mode == 'artifact':
        publish(args.source, args.target, args.sha, args.run_id, args.run_attempt)
        return
    host = HERE / 'hz-api-release.sh'
    with tempfile.TemporaryDirectory(prefix='hz-api-ssh-') as folder:
        ssh = outer_ssh(Path(folder), os.environ)
        if args.mode == 'inspect':
            host_script(ssh, host, ['check'])
        elif args.mode == 'rollback':
            require(re.fullmatch(SHA_PATTERN, args.sha), 'rollback requires a retained full SHA')
            host_script(ssh, host, ['rollback', args.sha])
        else:
            info, migrations = read_bundle(args.source, args.sha, args.run_id, args.run_attempt)
            checked = host_script(ssh, host, ['check', args.sha], migrations, capture_output=True)
            current = read_receipt(checked.stdout, 'HZ_RELEASE_CURRENT=', SHA_PATTERN)
            print(checked.stdout, end='', flush=True)
            image = deliver_image(ssh, args.source, info, {**os.environ, 'DEPLOY_SHA': args.sha})
            host_script(ssh, host, ['promote', args.sha, image, info['layers_hash'], current], migrations)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        message = str(error) if type(error) is ValueError else 'Hangzhou release command failed'
        print(message, file=sys.stderr)
        sys.exit(1)

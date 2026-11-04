#!/usr/bin/env python3
"""固定本次维护claim的plan/apply。只读手机桌面；仅归档原单durable owner。

原native UNKNOWN与失败101保持原样；不恢复业务，不释放中央租约。
工具由协调者从固定已审查commit部署后执行，不接受原件预期hash或owner参数。
"""
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import socket
import subprocess
import sys
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


proof = load('discovery-review-maintenance-proof.py')
lock = load('discovery-review-maintenance-lock.py')
prior = load('maintenance-reopen-host.py')
gate, window, tx = prior.gate, prior.window, prior.tx
need = proof.need


def brain(path):
    need(re.fullmatch(r'/api/brain/(?:tasks/[a-f0-9-]{36}|releases/[a-f0-9-]{36}(?:/gate|/observations/[a-f0-9-]{36})?)', path), 'BRAIN_PATH')
    request = Request('http://100.79.41.61:5221' + path,
                      headers={'Authorization': 'Bearer ' + prior._token()})
    with urlopen(request, timeout=10) as response:
        need(response.status == 200, 'BRAIN_HTTP')
        return json.loads(response.read(8 * 1024 * 1024))


def task():
    value = brain('/api/brain/tasks/' + proof.TASK['id'])
    value = value.get('task', value)
    return proof.verify_task(value)


def quiet():
    observed = prior.current_observation()
    # This is exclusion of new automatic admissions, never proof of OS stop.
    window.verify_automatic_quiescence(observed['cron_raw'], {proof.SCOPE['serial'],
        'ANGYVB4227006983', 'ANGYVB4402004137'}, recovery_disabled=observed['recovery_disabled'],
        recovery_loaded=observed['recovery_loaded'], process_table=observed['process_table'])
    # Commented schedules are safe; every active harvest entry is forbidden.
    need(not any('harvest-cron.sh' in line and line.strip() and not line.lstrip().startswith('#')
                 for line in observed['cron_raw'].splitlines()), 'ACTIVE_SCHEDULE')
    return {k: observed[k] for k in ('cron_raw', 'recovery_disabled', 'recovery_loaded')}


def candidate(home, sha, release_id):
    """验证现有候选；保留原run namespace，不使用旧空namespace reopen合同。"""
    need(re.fullmatch(r'[a-f0-9]{40}', sha or '') and sha != proof.SCOPE['source_commit']
         and re.fullmatch(r'[a-f0-9-]{36}', release_id or ''), 'CANDIDATE_ID')
    base = home / '.local/share/zenithjoy/phone-candidates' / sha
    runtime = base / 'runtime'
    release = brain('/api/brain/releases/' + release_id)['release']
    current = brain('/api/brain/releases/' + release_id + '/gate')
    observation = brain('/api/brain/releases/' + release_id + '/observations/' + str(current.get('current_observation_id')))['observation']
    environment = 'staging:' + sha
    payload = release.get('payload', {})
    need(release.get('id') == release_id and release.get('target') == 'xian-m4'
         and release.get('environment') == environment
         and release.get('manifest_sha256') == gate.digest({'environment': environment, 'target': 'xian-m4', 'payload': payload}), 'RELEASE')
    need(current.get('release_id') == release_id and current.get('manifest_sha256') == release['manifest_sha256']
         and current.get('deployed') is True and current.get('actual_matches') is True
         and current.get('current_status') == 'deployed' and current.get('gaps') == []
         and all(current.get('verification', {}).get(k) == 'verified' for k in
                 ('status', 'ci_status', 'definition_status', 'step_coverage_status')), 'GATE')
    need(observation.get('id') == current.get('current_observation_id')
         and observation.get('release_id') == release_id
         and observation.get('payload', {}).get('target') == 'xian-m4'
         and observation['payload'].get('environment') == environment
         and observation['payload'].get('components') == payload.get('components'), 'OBSERVATION')
    manifest = json.loads(proof.read(runtime / 'deployment-manifest.json'))
    need(manifest.get('source_repo') == gate.REPO and manifest.get('source_commit') == sha
         and manifest.get('release_id') == release_id
         and manifest.get('observation_id') == observation['id']
         and manifest.get('environment') == environment and manifest.get('target') == 'xian-m4', 'MANIFEST')
    identity = json.loads(proof.read(base / 'candidate-identity.json'))
    need(identity == {'source_commit': sha, 'release_id': release_id,
                      'manifest_sha256': release['manifest_sha256']}, 'CANDIDATE_IDENTITY')
    # observeDeployment persists the declaration plus release metadata; host
    # identity exists only in the measured observation, never in that file.
    measured_hostname = socket.gethostname()
    # Same xian-m4 mapping as runtime-host.mjs deploymentTarget().
    need(isinstance(measured_hostname, str) and 'm4-xian' in measured_hostname.lower().split('.')[0], 'MEASURED_HOST')
    seen, by_source, measured_files = set(), {}, []
    for row in manifest.get('files', []):
        name = row.get('deployed_path')
        need(isinstance(name, str) and not name.startswith('/') and name not in seen
             and all(part not in ('', '.', '..') for part in name.split('/')), 'MANIFEST_PATH')
        seen.add(name)
        actual_sha = proof.sha(proof.read(runtime / name))
        need(actual_sha == row.get('content_sha256'), 'CANDIDATE_BYTES')
        measured_files.append({**row, 'content_sha256': actual_sha})
        by_source[row['path']] = actual_sha
    observed = {'source_repo': manifest['source_repo'], 'source_commit': manifest['source_commit'],
                'files': measured_files, 'observed_hostname': measured_hostname}
    # Canonicalization sorts object keys only: the original file array order
    # is covered exactly as in collectDeployment/observeDeployment.
    need(observation['payload'].get('evidence_ref') == 'deployment-sha256:' + gate.digest(observed), 'OBSERVATION_DIGEST')
    need({'leadgen-run.sh', 'adb-managed-client.py', 'adb-existing-route.py'} <= seen, 'CANDIDATE_FILES')
    components = payload.get('components')
    need(isinstance(components, list) and components, 'COMPONENTS')
    for component in components:
        need(component.get('repo') == gate.REPO and component.get('revision') == sha
             and (component.get('kind') == 'repo' or component.get('kind') in ('code', 'skill')
                  and component.get('digest') == 'sha256:' + by_source.get(component.get('path'), '')), 'COMPONENT')
    return {'source_commit': sha, 'release_id': release_id,
            'observation_id': observation['id'], 'manifest_sha256': release['manifest_sha256']}


def desktop(home, sha):
    runtime = home / '.local/share/zenithjoy/phone-candidates' / sha / 'runtime'
    original = home / '.local/share/zenithjoy/phone-candidate-runs' / proof.SCOPE['source_commit'] / 'ledger' / proof.SCOPE['run_id'].removesuffix('__a1')
    policy = json.loads(proof.read(original / 'run-definition.json'))['discovery_phone_scope']['policy']
    endpoint = re.fullmatch(r'tcp:127[.]0[.]0[.]1:([0-9]{1,5})', policy.get('endpoint', ''))
    need(endpoint and 1 <= int(endpoint[1]) <= 65535, 'ADB_ENDPOINT')
    binary = Path(policy['adb_bin']).resolve()
    need(str(binary) == policy.get('adb_realpath', str(binary))
         and proof.sha(proof.read(binary, 128 * 1024 * 1024)) == policy['adb_sha256'], 'ADB_PIN')
    spec = importlib.util.spec_from_file_location('discovery_existing_route', runtime / 'adb-existing-route.py')
    route = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(route)
    # Smart-socket route/protocol reads use existing servers only. Numeric -H
    # forbids adb client autostart when the selected server disappears.
    route.select_existing_unique_route(proof.SCOPE['serial'], policy['endpoint'])
    installed_policy = route.read_host_policy()
    if installed_policy is not None:
        need(installed_policy['endpoint'] == policy['endpoint'], 'ADB_POLICY_ROUTE')
        route.select_route(proof.SCOPE['serial'], policy['endpoint'])
    env = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'HOME': str(home),
           'ADB_SERVER_SOCKET': policy['endpoint']}
    version = subprocess.run([str(binary), 'version'], env=env, capture_output=True,
                             text=True, timeout=3, check=True).stdout
    need(re.search(r'^Android Debug Bridge version 1[.]0[.]41\r?$', version, re.M), 'ADB_VERSION')
    def read(args):
        need(proof.sha(proof.read(binary, 128 * 1024 * 1024)) == policy['adb_sha256'], 'ADB_PIN_DRIFT')
        route.select_existing_unique_route(proof.SCOPE['serial'], policy['endpoint'])
        result = subprocess.run([str(binary), '-H', '127.0.0.1', '-P', endpoint[1],
                                 '-s', proof.SCOPE['serial'], 'shell', *args],
                                env=env, capture_output=True, text=True, timeout=20, check=True)
        return result.stdout
    home_read = read(['cmd', 'package', 'resolve-activity', '-a', 'android.intent.action.MAIN',
                      '-c', 'android.intent.category.HOME'])
    focus = read(['dumpsys', 'window', 'displays'])
    return prior.proof.verify_safe_desktop(proof.SCOPE['serial'], home_read, focus)


def legacy_record(home):
    pin = proof.CONTRACT['legacy_record']
    raw = proof.read(home / pin['relative_path'])
    need(proof.sha(raw) == pin['sha256'], 'LEGACY_RECORD_HASH')
    record = json.loads(raw)
    need(record.get('mode') == 'review-preserve', 'LEGACY_RECORD_MODE')
    lock.maintenance.verify_legacy_binding(record)
    return record


def admission(home, sha, release_id):
    need(home.is_absolute() and home.resolve() == home and home.is_dir() and not home.is_symlink(), 'HOME')
    claim = task()
    legacy_record(home)
    barrier = quiet()
    installed = candidate(home, sha, release_id)
    root = home / '.local/share/zenithjoy/phone-candidate-runs' / proof.SCOPE['source_commit'] / 'ledger' / proof.SCOPE['run_id'].removesuffix('__a1')
    original = proof.verify_original(root)
    current_desktop = desktop(home, sha)
    need(task() == claim and quiet() == barrier and candidate(home, sha, release_id) == installed, 'ADMISSION_DRIFT')
    return {'version': 1, 'purpose': 'retire_exact_discovery_review_owner',
            'maintenance_claim': claim, 'original': original, 'candidate': installed,
            'legacy_record_sha256': proof.CONTRACT['legacy_record']['sha256'],
            'desktop': current_desktop, 'automatic_barrier': barrier,
            'central_lease_released': False}


def execute(action, home, sha, release_id):
    need(action in ('plan', 'apply'), 'ACTION')
    authorization = admission(home, sha, release_id)
    if action == 'plan':
        return authorization
    directory = home / '.config/zenithjoy/discovery-review-maintenance'
    need(directory.parent.is_dir() and not directory.parent.is_symlink(), 'JOURNAL_PARENT')
    directory.mkdir(mode=0o700, exist_ok=True)
    need(not directory.is_symlink() and directory.stat().st_uid == os.geteuid()
         and directory.stat().st_mode & 0o777 == 0o700, 'JOURNAL_DIR')
    saved = directory / 'admission.json'
    raw = tx.canonical(authorization)
    if saved.exists():
        need(tx.regular(saved)[0] == raw, 'AUTHORITY_DRIFT')
    else:
        tx.atomic_bytes(saved, raw)
    durable = home / '.local/share/zenithjoy/phone-locks'
    marker = lock.locks.verify(durable)
    original_legacy_record = legacy_record(home)
    # The lock module independently checks both inventories under all guards.
    # No central release: current Brain API has no run/fence CAS.
    def revalidate():
        need(admission(home, sha, release_id) == authorization, 'LOCKED_ADMISSION_DRIFT')
    result = lock.retire(marker['legacy_root'], durable, directory / 'lock-journal.json', proof.sha(raw),
                         before_commit=revalidate, legacy_record=original_legacy_record)
    return {**result, 'old_phone_domain_returned': True, 'execution_stopped': False,
            'production_promoted': False, 'old_run_modified': False}


if __name__ == '__main__':
    try:
        need(len(sys.argv) == 4 and os.geteuid() != 0, 'ARGUMENTS')
        home = Path(pwd.getpwuid(os.geteuid()).pw_dir).resolve()
        print(json.dumps(execute(sys.argv[1], home, sys.argv[2], sys.argv[3]), sort_keys=True))
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)

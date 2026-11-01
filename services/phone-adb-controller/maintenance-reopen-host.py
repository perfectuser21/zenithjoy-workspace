#!/usr/bin/env python3
"""Separate, controlled reopening of one phone after safety-only installation.

Never promotes a production release, restores a sealed candidate, starts a
workflow, or sends a phone input. The final unlock still requires a separate
production approval and a newly staged same-SHA candidate.
"""

import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import stat
import subprocess
import sys
from urllib.request import Request, urlopen


HERE = Path(__file__).resolve().parent
OLD_SERIAL = 'ANGYVB4227006983'
OLD_SOURCE = '2fbb306f1d9929e9b8a572ecf99e344c07596ad0'
OLD_RUN = 'douyin_video_discovery-accept2fbb_jinuo101f_20261101t1018__a1'
OLD_OWNER = 'accept2fbb_jinuo101f_20261101t1018'
OLD_TASK = 'ff33a797-e027-45b8-baf9-45f3c9e8dbf1'


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


tx = load('deployment-transaction.py')
roots = load('maintenance-reopen-roots.py')
gate = load('maintenance-reopen-gate.py')
proof = load('maintenance-reopen-proof.py')
lock = load('maintenance-reopen-lock.py')
locks = load('phone-lock-root.py')
window = load('maintenance-install-window.py')
recovery = load('deployment-service.py')


def require(ok, code):
    if not ok:
        raise ValueError('REOPEN_HOST_' + code)


def run(argv, *, timeout=15):
    result = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, check=True)
    return result.stdout


def current_observation():
    state = recovery.service_state()
    return {'cron_raw': run(['/usr/bin/crontab', '-l']),
            'recovery_disabled': state['disabled'], 'recovery_loaded': state['loaded'],
            'process_table': run(['/bin/ps', '-axo', 'pid=,command='])}


def phone_read(kind):
    base = ['/opt/homebrew/bin/adb', '-s', OLD_SERIAL, 'shell']
    if kind == 'home':
        return run([*base, 'cmd', 'package', 'resolve-activity', '-a',
                    'android.intent.action.MAIN', '-c', 'android.intent.category.HOME'])
    if kind == 'focus':
        return run([*base, 'dumpsys', 'window', 'displays'])
    raise ValueError('REOPEN_HOST_PHONE_READ_KIND')


def boot_epoch():
    raw = run(['/usr/sbin/sysctl', '-n', 'kern.boottime'])
    found = re.search(r'\bsec\s*=\s*(\d+)\b', raw)
    require(found, 'BOOT_EPOCH')
    return int(found.group(1))


def _token():
    token = os.environ.get('BRAIN_INTERNAL_TOKEN')
    if token:
        require('\n' not in token and len(token) < 4096, 'BRAIN_TOKEN')
        return token
    home = Path(pwd.getpwuid(os.geteuid()).pw_dir)
    path = home / '.credentials/cecelia-internal.env'
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and
            stat.S_IMODE(info.st_mode) == 0o600, 'BRAIN_TOKEN_FILE')
    raw = tx.regular(path)[0].decode().strip()
    found = re.fullmatch(r'CECELIA_INTERNAL_TOKEN=([^\n]{1,4096})', raw)
    require(found, 'BRAIN_TOKEN_FILE')
    return found.group(1)


def brain_request(path):
    require(re.fullmatch(r'/api/brain/releases/[a-f0-9-]{36}(?:/gate|/observations/[a-f0-9-]{36})?',
                         path) is not None, 'BRAIN_PATH')
    # M4 has no local Brain proxy; the existing Tailnet Brain endpoint is
    # reachable from this host and uses the service account's private token.
    request = Request('http://100.79.41.61:5221' + path,
                      headers={'Authorization': 'Bearer ' + _token()})
    with urlopen(request, timeout=10) as response:
        require(response.status == 200, 'BRAIN_HTTP')
        return json.loads(response.read(2 * 1024 * 1024))


def verify_safety_barrier(home, safety_tx, observed, *, allow_partial=False):
    home = Path(home)
    tx.owned(home, safety_tx)
    safety = roots._safety_journal(home, safety_tx)
    require(OLD_SERIAL in safety['review_serials'] and
            observed.get('cron_raw') == safety['cron_after'], 'SAFETY_SCOPE')
    window.verify_automatic_quiescence(observed['cron_raw'], set(safety['review_serials']),
                                        recovery_disabled=observed['recovery_disabled'],
                                        recovery_loaded=observed['recovery_loaded'],
                                        process_table=observed['process_table'])
    durable = home / '.local/share/zenithjoy/phone-locks'
    marker = locks.verify(durable)
    require(marker['legacy_root'] == '/private/tmp/openclaw-phone/locks' or
            marker['legacy_root'].startswith(str(home) + '/'), 'LEGACY_ROOT')
    if not allow_partial:
        require(locks.verify_review(marker['legacy_root'], durable)['review_owners'] == 3,
                'REVIEW_SCOPE')
    return safety


def _admission_path(home, safety_tx, sha):
    return tx.transaction_directory(home, safety_tx) / ('reopen-admission-' + sha + '.json')


def finalize_reopen(home, safety_tx, candidate_sha, release_id, observed, *,
                    brain_request=brain_request, phone_read=phone_read, boot_seconds=None):
    home = Path(home)
    require(re.fullmatch(r'[a-f0-9]{40}', candidate_sha or '') and
            re.fullmatch(r'[a-f0-9-]{36}', release_id or '') and
            candidate_sha != OLD_SOURCE, 'NEW_CANDIDATE')
    admission_path = _admission_path(home, safety_tx, candidate_sha)
    safety = verify_safety_barrier(home, safety_tx, observed,
                                   allow_partial=admission_path.exists())
    roots.verify_prepared_roots(home, safety_tx, candidate_sha)
    endpoint = '/api/brain/releases/' + release_id
    release = brain_request(endpoint)['release']
    current_gate = brain_request(endpoint + '/gate')
    observation = brain_request(endpoint + '/observations/' +
                                str(current_gate.get('current_observation_id')))['observation']
    candidate = gate.verify_candidate_gate(home, candidate_sha, release,
                                           current_gate, observation)
    # Path concatenation is explicit to keep the sealed old ledger immutable.
    sealed = home / '.local/share/zenithjoy' / ('phone-candidate-runs.sealed.' + safety_tx)
    receipts = sealed / OLD_SOURCE / 'ledger' / OLD_RUN.removesuffix('__a1') / 'native-operations'
    old = {'run_id': OLD_RUN, 'owner': OLD_OWNER, 'source_commit': OLD_SOURCE,
           'serial': OLD_SERIAL, 'task_id': OLD_TASK}
    native = proof.verify_native_termination(receipts, old,
        boot_seconds=boot_epoch() if boot_seconds is None else boot_seconds,
        process_table=observed['process_table'])
    desktop = proof.verify_safe_desktop(OLD_SERIAL, phone_read('home'), phone_read('focus'))
    require(brain_request(endpoint + '/gate') == current_gate, 'BRAIN_GATE_DRIFT')
    require(gate.verify_candidate_gate(home, candidate_sha, release,
                                       current_gate, observation) == candidate,
            'CANDIDATE_DRIFT')
    admission = {'schema_version': 1, 'safety_transaction': safety_tx,
                 'candidate': candidate, 'old_native': native, 'desktop': desktop,
                 'old_run_id': OLD_RUN, 'old_owner': OLD_OWNER,
                 'old_serial': OLD_SERIAL, 'manifest_sha256': safety['manifest_sha256']}
    if admission_path.exists():
        prior = json.loads(tx.regular(admission_path)[0])
        require(prior == admission, 'ADMISSION_DRIFT')
    else:
        tx.atomic_bytes(admission_path, tx.canonical(admission))
    marker = locks.verify(home / '.local/share/zenithjoy/phone-locks')
    retired = lock.retire_exact_review(marker['legacy_root'],
        home / '.local/share/zenithjoy/phone-locks', OLD_SERIAL, OLD_OWNER,
        'phone-reopen-' + candidate_sha[:24],
        tx.transaction_directory(home, safety_tx) / ('reopen-lock-' + candidate_sha + '.json'))
    return {**retired, 'candidate_sha': candidate_sha, 'release_id': release_id,
            'old_frozen_unsealed': False, 'production_promoted': False}


if __name__ == '__main__':
    try:
        require(len(sys.argv) in (4, 5), 'ARGUMENTS')
        action, safety_tx, candidate_sha = sys.argv[1:4]
        home = Path(pwd.getpwuid(os.geteuid()).pw_dir).resolve()
        require(os.geteuid() != 0 and home.is_dir(), 'SERVICE_ACCOUNT')
        observed = current_observation()
        if action == 'prepare' and len(sys.argv) == 4:
            result = roots.prepare_fresh_roots(home, safety_tx, candidate_sha, observed)
        elif action == 'finalize' and len(sys.argv) == 5:
            result = finalize_reopen(home, safety_tx, candidate_sha, sys.argv[4], observed)
        else:
            raise ValueError('REOPEN_HOST_ACTION')
        print(json.dumps(result, sort_keys=True))
    except (OSError, ValueError, KeyError, subprocess.SubprocessError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)

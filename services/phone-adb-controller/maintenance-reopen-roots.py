#!/usr/bin/env python3
"""Create fresh candidate namespaces without ever reopening sealed old bytes."""

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat


HERE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


tx = load('deployment-transaction.py')
fence = load('deployment-candidate-fence.py')
locks = load('phone-lock-root.py')
window = load('maintenance-install-window.py')
steps = load('maintenance-install-transaction.py')


def require(ok, code):
    if not ok:
        raise ValueError('REOPEN_ROOTS_' + code)


def _safety_journal(home, safety_tx):
    path = home / '.config/zenithjoy/maintenance-only' / safety_tx / 'journal.json'
    value = json.loads(tx.regular(path)[0])
    checksum = value.pop('sha256', None)
    require(checksum == tx.digest(tx.canonical(value)) and
            value.get('transaction') == safety_tx and value.get('home') == str(home) and
            value.get('completed') == list(steps.STEPS) and
            safety_tx == 'phone-safety-' + value.get('source_commit', '')[:24] and
            re.fullmatch(r'[a-f0-9]{40}', value.get('source_commit', '')),
            'SAFETY_JOURNAL')
    require(isinstance(value.get('review_serials'), list) and len(value['review_serials']) == 3,
            'REVIEW_SCOPE')
    require(tx.digest(tx.regular(home / 'bin-harvest/deployment-manifest.json')[0]) ==
            value.get('manifest_sha256'), 'MANIFEST_DRIFT')
    return value


def _check_safety(home, safety_tx, observed):
    safety = _safety_journal(home, safety_tx)
    require(isinstance(observed, dict) and
            observed.get('cron_raw') == safety.get('cron_after') and
            type(observed.get('recovery_disabled')) is bool and
            type(observed.get('recovery_loaded')) is bool and
            isinstance(observed.get('process_table'), str), 'OBSERVATION')
    window.verify_automatic_quiescence(observed['cron_raw'], set(safety['review_serials']),
                                        recovery_disabled=observed['recovery_disabled'],
                                        recovery_loaded=observed['recovery_loaded'],
                                        process_table=observed['process_table'])
    durable = home / '.local/share/zenithjoy/phone-locks'
    marker = locks.verify(durable)
    require(locks.verify_review(marker['legacy_root'], durable)['review_owners'] == 3,
            'REVIEW_DRIFT')
    return safety


def _dir_identity(path):
    require(path.is_dir() and not path.is_symlink(), 'FRESH_DIR')
    info = path.stat()
    require(info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o700 and
            not list(path.iterdir()), 'FRESH_DIR')
    return {'device': info.st_dev, 'inode': info.st_ino}


def _sealed_old(roots, sealed, rows):
    for root, destination, record in zip(roots, sealed, rows):
        require(record['root_path'] == str(root) and record['sealed_path'] == str(destination) and
                destination.is_dir() and not destination.is_symlink(), 'OLD_SEALED')
        info = destination.stat()
        require((info.st_dev, info.st_ino) == (record['root_device'], record['root_inode']) and
                info.st_uid == os.geteuid() and not info.st_mode & 0o022, 'OLD_SEALED')


def prepare_fresh_roots(home, safety_tx, candidate_sha, observed, *, after_root=lambda _: None):
    home = Path(home)
    require(home.is_absolute() and home.resolve() == home and not home.is_symlink(), 'HOME')
    require(re.fullmatch(r'[a-f0-9]{40}', candidate_sha or ''), 'SHA')
    tx.owned(home, safety_tx)
    safety = _check_safety(home, safety_tx, observed)
    roots, sealed, fence_journal = fence.paths(home, safety_tx)
    old_fence = fence.read(fence_journal)
    _sealed_old(roots, sealed, old_fence['roots'])
    journal = tx.transaction_directory(home, safety_tx) / ('reopen-roots-' + candidate_sha + '.json')
    fresh = [root.parent / ('.' + root.name + '.fresh.' + candidate_sha) for root in roots]
    if journal.exists():
        value = json.loads(tx.regular(journal)[0])
        proof = value.pop('sha256', None)
        require(proof == tx.digest(tx.canonical(value)) and
                value.get('schema_version') == 1 and value.get('safety_transaction') == safety_tx and
                value.get('candidate_sha') == candidate_sha and
                value.get('source_commit') == safety['source_commit'] and
                isinstance(value.get('roots'), list) and len(value['roots']) == 2,
                'JOURNAL_DRIFT')
    else:
        require(all(root.is_file() and not root.is_symlink() for root in roots), 'OLD_BLOCKER')
        for root in roots:
            fence.blocker(root, safety_tx)
        for path in fresh:
            if not path.exists() and not path.is_symlink():
                path.mkdir(mode=0o700)
                tx.sync_directory(path.parent)
            _dir_identity(path)
        value = {'schema_version': 1, 'safety_transaction': safety_tx,
                 'source_commit': safety['source_commit'], 'candidate_sha': candidate_sha,
                 'roots': [{'root': str(root), 'fresh': str(path), **_dir_identity(path)}
                           for root, path in zip(roots, fresh)]}
        tx.atomic_bytes(journal, tx.canonical({**value, 'sha256': tx.digest(tx.canonical(value))}))
    for root, path, record in zip(roots, fresh, value['roots']):
        require(record['root'] == str(root) and record['fresh'] == str(path), 'ROOT_IDENTITY')
        if root.is_file() and not root.is_symlink():
            fence.blocker(root, safety_tx)
            require(_dir_identity(path) == {'device': record['device'], 'inode': record['inode']},
                    'FRESH_DRIFT')
            fence.exchange(root, path)
            tx.sync_directory(root.parent)
            after_root(root.name)
        require(root.is_dir() and not root.is_symlink(), 'ROOT_NOT_FRESH')
        info = root.stat()
        require((info.st_dev, info.st_ino) == (record['device'], record['inode']) and
                info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o700,
                'ROOT_DRIFT')
        fence.blocker(path, safety_tx)
        # Candidate installation is a subsequent, separately verified stage.
        require(not list(root.iterdir()), 'ROOT_ALREADY_USED')
    _sealed_old(roots, sealed, old_fence['roots'])
    return {'candidate_sha': candidate_sha, 'source_commit': safety['source_commit'],
            'old_fence_transaction': safety_tx, 'fresh_roots': True}


def verify_prepared_roots(home, safety_tx, candidate_sha):
    """Read back namespace identity after the candidate has been staged."""
    home = Path(home)
    tx.owned(home, safety_tx)
    roots, sealed, fence_journal = fence.paths(home, safety_tx)
    old_fence = fence.read(fence_journal)
    _sealed_old(roots, sealed, old_fence['roots'])
    journal = tx.transaction_directory(home, safety_tx) / ('reopen-roots-' + candidate_sha + '.json')
    value = json.loads(tx.regular(journal)[0])
    proof = value.pop('sha256', None)
    require(proof == tx.digest(tx.canonical(value)) and value.get('candidate_sha') == candidate_sha and
            value.get('safety_transaction') == safety_tx and len(value.get('roots', [])) == 2,
            'JOURNAL_DRIFT')
    for root, record in zip(roots, value['roots']):
        path = Path(record['fresh'])
        require(record['root'] == str(root) and root.is_dir() and not root.is_symlink(), 'ROOT_DRIFT')
        info = root.stat()
        require((info.st_dev, info.st_ino) == (record['device'], record['inode']) and
                info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o700,
                'ROOT_DRIFT')
        fence.blocker(path, safety_tx)
    return value

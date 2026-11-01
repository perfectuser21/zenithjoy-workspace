#!/usr/bin/env python3
"""Cross-check a new M4 candidate against Brain's current release observation."""

import hashlib
import json
import os
from pathlib import Path
import re
import stat


REPO = 'perfectuser21/zenithjoy-workspace'
MAX_FILE = 128 * 1024 * 1024


def require(ok, reason):
    if not ok:
        raise ValueError('REOPEN_GATE_' + reason)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False,
                      allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def bounded_file(path, limit=MAX_FILE):
    path = Path(path)
    require(path.is_file() and not path.is_symlink(), 'BYTE_FILE')
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == os.geteuid() and
                not before.st_mode & 0o022 and 0 <= before.st_size <= limit, 'BYTE_FILE')
        raw = os.read(fd, limit + 1)
        after = os.fstat(fd)
        require(len(raw) == before.st_size and
                (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), 'BYTE_DRIFT')
        return raw
    finally:
        os.close(fd)


def _json_file(path):
    try:
        return json.loads(bounded_file(path, 8 * 1024 * 1024))
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise ValueError('REOPEN_GATE_BYTE_JSON') from None


def verify_candidate_gate(home, source_commit, release, gate, observation):
    require(re.fullmatch(r'[a-f0-9]{40}', source_commit or ''), 'SHA')
    home = Path(home)
    require(home.is_absolute() and home.resolve() == home and not home.is_symlink(), 'HOME')
    base = home / '.local/share/zenithjoy/phone-candidates'
    state = home / '.local/share/zenithjoy/phone-candidate-runs'
    require(base.is_dir() and not base.is_symlink() and state.is_dir() and
            not state.is_symlink() and not list(state.iterdir()), 'NAMESPACE')
    require({p.name for p in base.iterdir()} == {source_commit}, 'ONLY_NEW_SHA')
    candidate = base / source_commit
    runtime = candidate / 'runtime'
    require(candidate.is_dir() and not candidate.is_symlink() and
            runtime.is_dir() and not runtime.is_symlink(), 'CANDIDATE')
    environment = 'staging:' + source_commit
    require(release.get('id') and release.get('environment') == environment and
            release.get('target') == 'xian-m4' and
            release.get('manifest_sha256') == digest({
                'environment': environment, 'target': 'xian-m4', 'payload': release.get('payload')}) and
            isinstance(release.get('payload', {}).get('components'), list), 'RELEASE')
    release_id = release['id']
    identity = _json_file(candidate / 'candidate-identity.json')
    require(identity == {'source_commit': source_commit, 'release_id': release_id,
                         'manifest_sha256': release['manifest_sha256']}, 'IDENTITY')
    require(gate.get('release_id') == release_id and
            gate.get('manifest_sha256') == release['manifest_sha256'] and
            gate.get('deployed') is True and gate.get('actual_matches') is True and
            gate.get('current_status') == 'deployed' and gate.get('gaps') == [] and
            all(gate.get('verification', {}).get(key) == 'verified' for key in
                ('status', 'ci_status', 'definition_status', 'step_coverage_status')),
            'BRAIN_GATE')
    obs_id = gate.get('current_observation_id')
    require(obs_id and obs_id == observation.get('id') == gate.get('last_verified_observation_id', obs_id) and
            observation.get('release_id') == release_id, 'OBSERVATION')
    payload = observation.get('payload')
    require(isinstance(payload, dict) and payload.get('target') == 'xian-m4' and
            payload.get('environment') == environment and
            payload.get('components') == release['payload']['components'], 'OBSERVATION')
    manifest = _json_file(runtime / 'deployment-manifest.json')
    require(manifest.get('source_repo') == REPO and manifest.get('source_commit') == source_commit and
            manifest.get('release_id') == release_id and manifest.get('observation_id') == obs_id and
            manifest.get('environment') == environment and manifest.get('target') == 'xian-m4' and
            isinstance(manifest.get('observed_hostname'), str) and manifest['observed_hostname'] and
            isinstance(manifest.get('files'), list) and manifest['files'], 'MANIFEST')
    observed = {key: manifest[key] for key in ('source_repo', 'source_commit', 'files',
                                               'observed_hostname')}
    require(payload.get('evidence_ref') == 'deployment-sha256:' + digest(observed), 'OBSERVATION')
    expected = ('#!/bin/bash\nset -euo pipefail\nunset WF_RELEASE_ID WF_DEPLOYMENT_MANIFEST\n'
                'export WFR_HOME="$HOME/.local/share/zenithjoy/phone-candidate-runs/' +
                source_commit + '"\n'
                'exec zsh "$(cd "$(dirname "$0")" && pwd)/runtime/leadgen-run.sh" "$@"\n')
    require(bounded_file(candidate / 'run.sh') == expected.encode(), 'WRAPPER')
    seen = set()
    files_by_source = {}
    for entry in manifest['files']:
        require(isinstance(entry, dict) and isinstance(entry.get('deployed_path'), str) and
                isinstance(entry.get('path'), str) and
                re.fullmatch(r'[a-f0-9]{64}', entry.get('content_sha256', '')), 'MANIFEST')
        relative = entry['deployed_path']
        require(relative and not relative.startswith('/') and
                all(part not in ('', '.', '..') for part in relative.split('/')) and
                relative not in seen, 'MANIFEST')
        seen.add(relative)
        target = runtime
        for part in relative.split('/')[:-1]:
            target /= part
            require(target.is_dir() and not target.is_symlink(), 'BYTE_DIR')
        data = bounded_file(target / relative.split('/')[-1])
        require(hashlib.sha256(data).hexdigest() == entry['content_sha256'], 'BYTE_HASH')
        files_by_source[entry['path']] = entry['content_sha256']
    require('leadgen-run.sh' in seen, 'MANIFEST')
    for component in payload['components']:
        require(component.get('repo') == REPO and component.get('revision') == source_commit,
                'COMPONENT')
        if component.get('kind') == 'repo':
            continue
        require(component.get('kind') in ('code', 'skill') and
                component.get('digest') == 'sha256:' + files_by_source.get(component.get('path'), ''),
                'COMPONENT')
    return {'source_commit': source_commit, 'release_id': release_id,
            'observation_id': obs_id, 'file_count': len(seen), 'manifest_sha256': release['manifest_sha256']}

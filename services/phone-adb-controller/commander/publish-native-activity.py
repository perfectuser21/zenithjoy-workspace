#!/usr/bin/env python3
"""公共Runner的单个发布外壳Activity；不启动业务agent、不选择下一步。"""
import importlib.util
import json
from pathlib import Path
import re
import sys
import subprocess
from datetime import datetime, timezone, timedelta


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def execute(phase, manifest, value):
    if phase not in ('preflight', 'cleanup'):
        raise ValueError('fixed native phase required')
    run_id, task_id = value['run_tag'], value['task_id']
    for token in (run_id, task_id):
        if not re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', token):
            raise ValueError('invalid common runner identity')
    io, phone_module = load('wf-v2-io'), load('wf-v2-phone')
    root = Path(manifest['state_root'])
    if not root.is_absolute():
        raise ValueError('fixed absolute state root required')
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    directory = root / run_id
    directory.mkdir(mode=0o700, exist_ok=True)
    (directory / 'evidence').mkdir(mode=0o700, exist_ok=True)
    with io.lock(directory / '.common-identity.lock'):
        stored = directory / 'envelope.json'
        if stored.exists():
            envelope = io.read(stored)
            if envelope['task_id'] != task_id or envelope['input_sha256'] != io.digest(value.get('publication_input', {})) or envelope['contract'] != manifest['contract'] or envelope['definition'] != manifest['definition']:
                raise ValueError('immutable publish identity conflict')
        else:
            if phase != 'preflight':
                raise ValueError('cleanup cannot synthesize a prior execution')
            now = datetime.now(timezone.utc)
            seconds = manifest['contract'].get('recovery', {}).get('total_timeout_sec', 2400)
            cleanup = manifest['contract'].get('recovery', {}).get('cleanup_timeout_sec', 300)
            envelope = dict(protocol='common-workflow-runner/v1', run_id=run_id, task_id=task_id, attempt=1, owner_epoch=1,
                            contract=manifest['contract'], definition=manifest['definition'], activity_bindings=manifest['activity_bindings'],
                            input=value.get('publication_input', {}), input_sha256=io.digest(value.get('publication_input', {})),
                            deadline_at=(now + timedelta(seconds=seconds)).isoformat(),
                            cleanup_deadline_at=(now + timedelta(seconds=seconds + cleanup)).isoformat())
            io.write(stored, envelope)
            io.write(directory / 'events.json', [])
        if not envelope['definition'].get('expected_path') or not envelope['activity_bindings']:
            raise ValueError('frozen activity and step identities required')
        phone = phone_module.Phone(directory, envelope)
        receipt = phone.prepare() if phase == 'preflight' else phone.cleanup()
        completed = phase == 'preflight' or receipt.get('completed') is True
        return dict(schema_version=1, run_tag=run_id, status='completed' if completed else 'needs_review',
                    outputs={'publish_context': {'directory': str(directory), 'receipt': receipt}}, metrics={},
                    evidence=[str(directory / (phase + '.json'))], **({} if completed else {'failure_class': 'needs_human'}))


if __name__ == '__main__':
    value = json.load(sys.stdin)
    try:
        result = execute(sys.argv[1], json.loads(Path(sys.argv[2]).read_text()), value)
    except Exception as error:
        result = dict(schema_version=1, run_tag=value.get('run_tag', ''), status='needs_review', failure_class='needs_human',
                      outputs={}, metrics={}, evidence=[], reason_code='publish_native_unconfirmed', diagnostic=type(error).__name__)
        if isinstance(error, subprocess.TimeoutExpired):
            result.update(execution_stopped=False, external_effect='unknown')
    print(json.dumps(result, ensure_ascii=False))

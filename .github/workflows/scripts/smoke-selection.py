#!/usr/bin/env python3
"""Select standalone smoke scripts; context-only helpers require explicit callers."""
import argparse
import json
import hashlib
import re
from pathlib import Path, PurePosixPath


REQUIRED_DUPLICATES = {
    'dashboard-license-smoke.sh': 'Smoke — Dashboard License (Sprint A)',
    'line04-crm-view-prefs-smoke.sh': 'Line04 CRM view-prefs smoke（列偏好服务端持久化 GET/PUT）',
}


def required_consumer_contract(source, step_name):
    """Fingerprint reviewed YAML blocks; never infer execution from a filename.

    Only event subscription, the API job's configuration, the exact invocation
    step and the required aggregate are protected. Unrelated steps may change.
    Real YAML/shell behavior is independently tested by smoke-glob-sharding.
    Unknown YAML layouts fail instead of being partially interpreted.
    """
    def block(name):
        matches = list(re.finditer(r'^  ' + re.escape(name) + r':\n', source, re.M))
        if len(matches) != 1:
            raise ValueError('required consumer job missing/duplicate: ' + name)
        start = matches[0].start()
        end = re.search(r'^  [a-zA-Z0-9_-]+:\n', source[matches[0].end():], re.M)
        return source[start:matches[0].end() + end.start() if end else len(source)]
    api = block('smoke-api-contract')
    if api.count('    steps:\n') != 1:
        raise ValueError('unknown required consumer step layout')
    header = api.split('    steps:\n', 1)[0]
    starts = list(re.finditer(r'^      - name: ' + re.escape(step_name) + r'\n', api, re.M))
    if len(starts) != 1:
        raise ValueError('required consumer invocation missing/duplicate')
    start = starts[0].start()
    end = re.search(r'^      - ', api[starts[0].end():], re.M)
    step = api[start:starts[0].end() + end.start() if end else len(api)]
    events = re.findall(r'^on:\n[\s\S]*?(?=^concurrency:)', source, re.M)
    if len(events) != 1:
        raise ValueError('unknown required consumer event layout')
    return hashlib.sha256('\0'.join([events[0], header, step, block('l4-e2e-passed')]).encode()).hexdigest()


def required_duplicates(root, inventory, baseline):
    data = json.loads((root / '.github/workflows/scripts/smoke-required-duplicates.json').read_text())
    if set(data) != {'schema_version', 'duplicates'} or data['schema_version'] != 1 or not isinstance(data['duplicates'], list):
        raise ValueError('invalid required duplicate manifest')
    records = data['duplicates']
    if len(records) != len(REQUIRED_DUPLICATES) or {r.get('name') for r in records} != set(REQUIRED_DUPLICATES):
        raise ValueError('only the two reviewed required duplicate exclusions are permitted')
    source = (root / '.github/workflows/ci-l4-e2e-smoke.yml').read_text()
    for record in records:
        name = record['name']
        if (set(record) != {'name', 'reason', 'workflow', 'job', 'step', 'required_context', 'consumer_contract_sha256'} or
                record['workflow'] != '.github/workflows/ci-l4-e2e-smoke.yml' or
                record['job'] != 'smoke-api-contract' or record['required_context'] != 'L4 E2E Gate Passed' or
                record['step'] != REQUIRED_DUPLICATES[name] or not isinstance(record['reason'], str) or not record['reason'].strip()):
            raise ValueError('invalid required duplicate consumer: ' + name)
        path = root / '.github/workflows/scripts/smoke' / name
        if name not in inventory or not path.is_file() or path.is_symlink():
            raise ValueError('missing required duplicate script: ' + name)
        if required_consumer_contract(source, record['step']) != record['consumer_contract_sha256']:
            raise ValueError('required duplicate consumer contract changed; re-review execution and gate: ' + name)
    excluded = set(REQUIRED_DUPLICATES)
    if baseline & excluded:
        raise ValueError('baseline script cannot be excluded as required duplicate: ' + ', '.join(sorted(baseline & excluded)))
    return excluded


def select(root=Path('.')):
    root = Path(root).resolve()
    directory = root / '.github/workflows/scripts/smoke'
    inventory = sorted(path.name for path in directory.glob('*.sh'))
    if not inventory:
        raise ValueError('empty smoke inventory')
    baseline = set((root / '.github/workflows/scripts/smoke-baseline.txt').read_text().splitlines()) - {''}
    manifest = json.loads((root / '.github/workflows/scripts/smoke-helpers.json').read_text())
    if set(manifest) != {'schema_version', 'helpers'} or manifest['schema_version'] != 1 or not isinstance(manifest['helpers'], list):
        raise ValueError('invalid smoke helper manifest')
    helpers = set()
    for record in manifest['helpers']:
        if not isinstance(record, dict) or set(record) != {'name', 'reason', 'consumers'}:
            raise ValueError('helper needs exact name, reason and explicit consumers')
        name = record['name']
        if (not isinstance(name, str) or PurePosixPath(name).name != name or
                any(c in name for c in '*?[]\\\n\r\t') or not name.endswith('.sh') or name.endswith('-smoke.sh')):
            raise ValueError('helper must be an exact context-only filename, never a smoke/pattern')
        if name in helpers:
            raise ValueError('duplicate smoke helper: ' + name)
        path = directory / name
        if name not in inventory or not path.is_file() or path.is_symlink():
            raise ValueError('missing or nonregular smoke helper: ' + name)
        if not isinstance(record['reason'], str) or not record['reason'].strip():
            raise ValueError('helper reason required: ' + name)
        consumers = record['consumers']
        if not isinstance(consumers, list) or not consumers or len(set(consumers)) != len(consumers):
            raise ValueError('explicit helper consumers required: ' + name)
        for consumer in consumers:
            if (not isinstance(consumer, str) or not consumer or
                    str(PurePosixPath(consumer)) != consumer or PurePosixPath(consumer).is_absolute() or
                    '..' in PurePosixPath(consumer).parts):
                raise ValueError('invalid helper consumer path: ' + name)
            caller = root / consumer
            if not caller.is_file() or not caller.resolve().is_relative_to(root) or name not in caller.read_text():
                raise ValueError('missing or unreferenced helper consumer: ' + name)
        helpers.add(name)
    overlap = baseline & helpers
    if overlap:
        raise ValueError('baseline script cannot be excluded as helper: ' + ', '.join(sorted(overlap)))
    if not baseline <= set(inventory):
        raise ValueError('missing baseline script: ' + ', '.join(sorted(baseline - set(inventory))))
    duplicates = required_duplicates(root, inventory, baseline)
    return {'inventory': [name for name in inventory if name not in helpers | duplicates],
            'excluded_helpers': sorted(helpers), 'excluded_required': sorted(duplicates)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    try:
        result = select()
        data = json.dumps(result, ensure_ascii=False) + '\n'
        if args.output:
            args.output.write_text(data)
        else:
            print(data, end='')
    except (ValueError, OSError, TypeError) as error:
        parser.exit(1, 'Smoke selection FAILED: ' + str(error) + '\n')

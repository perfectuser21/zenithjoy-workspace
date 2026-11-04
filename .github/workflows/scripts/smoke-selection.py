#!/usr/bin/env python3
"""Select standalone smoke scripts; context-only helpers require explicit callers."""
import argparse
import json
from pathlib import Path, PurePosixPath


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
    return {'inventory': [name for name in inventory if name not in helpers], 'excluded_helpers': sorted(helpers)}


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

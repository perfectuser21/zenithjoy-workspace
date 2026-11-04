#!/usr/bin/env python3
"""Compare release sources; authoring tests have a single, unpackaged home."""
import pathlib
import sys

IGNORED = {'tests', '__pycache__', '.pytest_cache'}


def files(root):
    return {p.relative_to(root).as_posix(): p.read_bytes()
            for p in root.rglob('*') if p.is_file()
            and not IGNORED.intersection(p.relative_to(root).parts)
            and p.suffix != '.pyc'}


def check(source, target):
    if not source.is_dir() or not target.is_dir():
        return ['source or package directory missing']
    expected, actual = files(source), files(target)
    errors = ['packaged tests directory: ' + p.relative_to(target).as_posix()
              for p in target.rglob('tests') if p.is_dir()]
    errors += ['missing: ' + name for name in sorted(expected.keys() - actual.keys())]
    errors += ['extra: ' + name for name in sorted(actual.keys() - expected.keys())]
    errors += ['different: ' + name for name in sorted(expected.keys() & actual.keys())
               if expected[name] != actual[name]]
    return errors


if __name__ == '__main__':
    root = pathlib.Path(__file__).resolve().parents[3]
    source = root / 'services/agent/wechat-rpa'
    target = root / 'services/agent/build-modules/line04/wechat-rpa'
    errors = check(source, target)
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        print('Rebuild with: cd services/agent && bash scripts/build-line-module.sh line04', file=sys.stderr)
        sys.exit(1)
    print('Line04 package matches runtime source; tests remain in authoring source.')

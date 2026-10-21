#!/usr/bin/env python3
"""只保存本部署会改的OpenClaw授权列；不复制包含密钥的整份配置。"""
import importlib.util
import json
import os
import pwd
from pathlib import Path
import re
import subprocess
import sys

spec = importlib.util.spec_from_file_location('phone_transaction', Path(__file__).with_name('deployment-transaction.py'))
tx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tx)
require = tx.require
CONFIG = {'skills': 'agents.entries.work-commander.skills',
          'allowAgents': 'agents.entries.work-commander.subagents.allowAgents'}


def names(values):
    require(isinstance(values, list) and len(values) <= 100 and
            all(isinstance(v, str) and re.fullmatch('[A-Za-z0-9_-]{1,80}', v) for v in values) and
            len(set(values)) == len(values), 'invalid authored config names')
    return values


def save(path, record):
    value = {k: v for k, v in record.items() if k != 'sha256'}
    value['sha256'] = tx.digest(tx.canonical(value))
    tx.atomic_bytes(path, tx.canonical(value))
    return value


def read(path):
    value = json.loads(tx.regular(path)[0])
    require(value.get('sha256') == tx.digest(tx.canonical({k: v for k, v in value.items() if k != 'sha256'})), 'config snapshot digest mismatch')
    require(value.get('schema_version') == 1 and set(value.get('before', {})) == set(CONFIG) and
            set(value.get('after', {})) == set(CONFIG), 'invalid config snapshot identity')
    for group in ('before', 'after'):
        for values in value[group].values():
            names(values)
    return value


def prepare_config(path, skills, get):
    names(skills)
    if path.exists():
        old = read(path)
        require(old.get('requested_skills') == skills, 'config transaction identity mismatch')
        return old
    before = {name: names(get(name)) for name in CONFIG}
    additions = {'skills': skills, 'allowAgents': ['skill-factory']}
    after = {name: values + [v for v in additions[name] if v not in values] for name, values in before.items()}
    return save(path, {'schema_version': 1, 'requested_skills': skills, 'before': before, 'after': after})


def change_config(path, get, set_value, direction):
    record = read(path)
    current = {name: names(get(name)) for name in CONFIG}
    for name in CONFIG:
        require(current[name] in (record['before'][name], record['after'][name]), 'config writer conflict: ' + name)
    for name in CONFIG:
        wanted = record[direction][name]
        if current[name] == wanted:
            continue
        set_value(name, current[name], wanted)
        require(get(name) == wanted, 'config readback mismatch: ' + name)
    return record


def apply_config(path, get, set_value):
    return change_config(path, get, set_value, 'after')


def restore_config(path, get, set_value):
    return change_config(path, get, set_value, 'before')


def cli_get(name):
    return json.loads(subprocess.check_output(['/opt/homebrew/bin/openclaw', 'config', 'get', CONFIG[name]],
                                             text=True, timeout=30, stderr=subprocess.PIPE))


def cli_set(name, expected, value):
    subprocess.run(['/opt/homebrew/bin/openclaw', 'config', 'set', CONFIG[name], json.dumps(value), '--strict-json',
                    '--expect-current-json', json.dumps(expected)], check=True, timeout=30,
                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)


if __name__ == '__main__':
    try:
        action, transaction = sys.argv[1:3]
        home = Path(pwd.getpwuid(os.getuid()).pw_dir).resolve()
        tx.owned(home, transaction)
        path = tx.transaction_directory(home, transaction) / 'effects.json'
        if action == 'prepare':
            result = prepare_config(path, json.load(sys.stdin)['skills'], cli_get)
        elif action == 'apply':
            result = apply_config(path, cli_get, cli_set)
        elif action == 'restore':
            result = restore_config(path, cli_get, cli_set)
        elif action in ('verify-installed', 'verify-restored'):
            result = read(path)
            direction = 'after' if action == 'verify-installed' else 'before'
            require(all(cli_get(name) == result[direction][name] for name in CONFIG), 'config final readback mismatch')
        else:
            raise ValueError('invalid config operation')
        print(json.dumps({'verified': True, 'operation': action}))
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        # OpenClaw异常不把整条配置命令或环境凭据输出到部署日志。
        print('phone deployment configuration operation failed', file=sys.stderr)
        sys.exit(1)

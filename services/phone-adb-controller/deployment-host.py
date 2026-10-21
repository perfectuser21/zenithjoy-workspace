#!/usr/bin/env python3
"""固定安装根的宿主适配器：不读凭据、不操作ADB、不替代Brain权威。"""
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import shlex
import socket
import subprocess
import sys


def module(name):
    spec = importlib.util.spec_from_file_location('phone_'+name,Path(__file__).with_name('deployment-'+name+'.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


tx = module('transaction')
require = tx.require
UNSET = object()


def record(home, transaction, name, value=UNSET, expected=UNSET):
    require(name in ('coordinator','decision','started'), 'unknown coordinator record')
    path = tx.transaction_directory(home,transaction)/(name+'.json')
    previous = None
    if path.exists():
        saved = json.loads(tx.regular(path)[0])
        require(saved['sha256'] == tx.digest(tx.canonical(saved['value'])), 'coordinator record digest mismatch')
        previous = saved['value']
    if value is UNSET:
        return previous
    require(name not in ('coordinator','started') or previous is None or value == previous, 'coordinator record immutable')
    require(previous == expected, 'coordinator record CAS mismatch')
    if name == 'decision':
        require(value in ('install','commit','restore') and
                (previous,value) in ((None,'install'),(None,'restore'),('install','commit'),('install','restore'),
                                    ('commit','restore'),('commit','commit'),('restore','restore')), 'invalid deployment decision transition')
    tx.atomic_bytes(path,tx.canonical({'value':value,'sha256':tx.digest(tx.canonical(value))}))
    return value


def live_writers(home, output):
    prefixes = [str(home/p)+'/' for p in ('bin-harvest','.openclaw/leadgen-scripts','.local/bin')]
    found = []
    for line in output.splitlines():
        match = re.fullmatch(r'\s*([0-9]+)\s+(.+)',line)
        if not match:
            continue
        try:
            args = shlex.split(match[2])
        except ValueError:
            require(not any(prefix in match[2] for prefix in prefixes), 'ambiguous live runtime process')
            continue
        # 长驻日志桥只转运日志，恢复代码后由部署器精确重载；冻结run目录不在live根。
        paths = [arg for arg in args if any(arg.startswith(prefix) for prefix in prefixes)]
        if paths and any(Path(path).name not in ('log-stream-push.sh','log-bridge-liveness.sh') for path in paths):
            found.append(int(match[1]))
    return sorted(set(found))


GUI_LABELS = {'mmv':'com.zenithjoy.escortclaude','xian-m4':'com.zenithjoy.logstreampush'}


def gui_state(target):
    label = GUI_LABELS[target]
    domain = 'gui/'+str(os.getuid())
    state = subprocess.run(['/bin/launchctl','print',domain+'/'+label],capture_output=True,text=True,timeout=15)
    require(state.returncode == 0 or 'Could not find service' in state.stderr, 'GUI launchd state unavailable')
    output = subprocess.check_output(['/bin/launchctl','print-disabled',domain],text=True,timeout=15)
    entries = re.findall(r'"'+re.escape(label)+r'"\s*=>\s*(disabled|enabled)',output)
    require(len(entries) <= 1,'ambiguous GUI disabled state')
    return {'label':label,'loaded':state.returncode == 0,'disabled':entries == ['disabled']}


def reload_gui(target, expected):
    require(gui_state(target) == expected,'GUI service state changed during deployment')
    if expected['loaded'] and not expected['disabled']:
        subprocess.run(['/bin/launchctl','kickstart','-k','gui/'+str(os.getuid())+'/'+GUI_LABELS[target]],
                       check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
    require(gui_state(target) == expected,'GUI service reload readback failed')
    return {'verified':True}


def current(home, target):
    require(target in ('mmv','xian-m4'),'invalid host target')
    roots = ['bin-harvest'] + (['.openclaw/leadgen-scripts'] if target == 'mmv' else [])
    manifests = {}
    for root in roots:
        path = tx.safe_path(home,root+'/deployment-manifest.json')
        raw = tx.regular(path)[0]
        value = json.loads(raw)
        require(value.get('environment') == 'production' and value.get('target') == target,'previous manifest is not production')
        for entry in value['files']:
            actual = tx.regular(tx.safe_path(home,root+'/'+entry['deployed_path']))[0]
            require(tx.digest(actual) == entry['content_sha256'],'previous runtime bytes differ from manifest')
        require(tx.regular(path)[0] == raw,'previous manifest changed during read')
        manifests[root] = value
    require(all(value == manifests['bin-harvest'] for value in manifests.values()),'previous aliases disagree')
    result = {'home':str(home),'hostname':socket.gethostname(),'manifest':manifests['bin-harvest'],'gui':gui_state(target)}
    if target == 'mmv':
        runtime = json.loads(tx.regular(tx.safe_path(home,'.openclaw/commander/runtime-manifest.json'))[0])
        for name, expected in runtime['files'].items():
            require(tx.digest(tx.regular(tx.safe_path(home,'.openclaw/commander/'+name))[0]) == expected,'previous Commander bytes differ')
        result['commander_manifest'] = runtime
    return result


def dispatch(home, action, data):
    transaction = data.get('transaction')
    if action == 'reload-gui':
        tx.owned(home,transaction)
        return reload_gui(data['target'],data['expected'])
    if action == 'current':
        return current(home,data['target'])
    if action == 'census':
        ps = subprocess.check_output(['/bin/ps','-axo','pid=,command='],text=True,timeout=15)
        pids = live_writers(home,ps)
        require(not pids,'live runtime processes must finish before deployment: '+','.join(map(str,pids)))
        return {'quiescent':True}
    if action == 'record':
        args = [home,transaction,data['name']]
        if 'value' in data:
            args.extend([data['value'],data['expected']])
        return record(*args)
    if action == 'effect-exists':
        require(data['effect'] in ('effects','service'),'invalid effect')
        path = tx.transaction_directory(home,transaction)/(data['effect']+'.json')
        require(not path.is_symlink(),'effect journal symlink')
        return path.exists()
    if action == 'inspect':
        directory = tx.transaction_directory(home,transaction)
        return tx.read_transaction(home,transaction) if (directory/'journal.json').exists() else None
    if action == 'prepare':
        return tx.prepare(home,transaction,data['entries'],data['identity'])
    if action == 'reopen':
        return tx.reopen(home,transaction,data['source_commit'])
    if action == 'restore':
        return tx.rollback(home,transaction,explicit=data.get('explicit') is True)
    if action == 'commit':
        return tx.commit(home,transaction)
    if action == 'release':
        return tx.release(home,transaction,data['release_id'])
    if action == 'verify':
        record_value = tx.read_transaction(home,transaction)
        tx.owned(home,transaction)
        direction = data['direction']
        require(direction in ('before','after'),'invalid verification direction')
        for entry in record_value['entries']:
            wanted = tx.restored_value(entry) if direction == 'before' else entry['after']
            require(tx.describe(tx.record_path(home,entry['path'])) == wanted,'package final bytes mismatch: '+entry['path'])
        return {'verified':True}
    raise ValueError('unknown host operation')


if __name__ == '__main__':
    try:
        home = Path(pwd.getpwuid(os.getuid()).pw_dir).resolve()
        result = dispatch(home,sys.argv[1],json.load(sys.stdin))
        print(json.dumps(result,ensure_ascii=False))
    except (OSError,ValueError,KeyError,subprocess.SubprocessError) as error:
        print(str(error),file=sys.stderr)
        sys.exit(1)

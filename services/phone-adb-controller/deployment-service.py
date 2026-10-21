#!/usr/bin/env python3
"""只管理固定phone recovery LaunchDaemon；快照不包含环境凭据。"""
import base64
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import stat
import subprocess
import sys
import tempfile

spec = importlib.util.spec_from_file_location('phone_transaction', Path(__file__).with_name('deployment-transaction.py'))
tx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tx)
require = tx.require
LABEL = 'com.zenithjoy.phonerecovery'
PLIST = Path('/Library/LaunchDaemons/' + LABEL + '.plist')


def valid_file(value):
    require(isinstance(value, dict), 'invalid root plist')
    if value == {'kind': 'missing'}:
        return
    require(set(value) == {'kind', 'bytes', 'mode', 'uid', 'gid'} and value['kind'] == 'file' and
            value['mode'] == 0o644 and value['uid'] == 0 and value['gid'] == 0, 'root plist ownership/mode required')
    data = base64.b64decode(value['bytes'], validate=True)
    require(0 < len(data) < 65536, 'bounded root plist required')


def read(path):
    value = json.loads(tx.regular(path)[0])
    require(value.get('sha256') == tx.digest(tx.canonical({k:v for k,v in value.items() if k != 'sha256'})), 'service snapshot digest mismatch')
    require(value.get('schema_version') == 1 and value.get('label') == LABEL, 'service identity mismatch')
    for side in ('before', 'after'):
        row = value[side]
        valid_file(row['file'])
        require(type(row['loaded']) is bool and type(row['disabled']) is bool, 'invalid launchd state')
    return value


def prepare(path, after_file, get):
    valid_file(after_file)
    require(after_file['kind'] == 'file', 'new root plist required')
    if path.exists():
        value = read(path)
        require(value['after']['file'] == after_file, 'service candidate changed')
        return value
    before = get()
    valid_file(before['file'])
    require(not before['loaded'] or before['file']['kind'] == 'file', 'loaded service lacks its plist')
    value = {'schema_version':1, 'label':LABEL, 'before':before,
             'after':{'file':after_file,'loaded':not before['disabled'],'disabled':before['disabled']}}
    value['sha256'] = tx.digest(tx.canonical(value))
    tx.atomic_bytes(path, tx.canonical(value))
    return read(path)


def change(path, direction, get, set_file, set_loaded):
    require(direction in ('before','after'), 'invalid service direction')
    record = read(path)
    current = get()
    require(current['disabled'] == record['before']['disabled'], 'service disabled state changed')
    require(current['file'] in (record['before']['file'],record['after']['file']), 'root plist writer conflict')
    wanted = record[direction]
    if current['file'] != wanted['file']:
        if current['loaded']:
            set_loaded(False)
            require(not get()['loaded'], 'service bootout readback failed')
        set_file(current['file'], wanted['file'])
        require(get()['file'] == wanted['file'], 'root plist readback failed')
    if get()['loaded'] != wanted['loaded']:
        set_loaded(wanted['loaded'])
    require(get() == wanted, 'service final readback failed')
    return record


def file_state():
    for parent in (PLIST, *PLIST.parents):
        require(not parent.is_symlink(), 'root plist symlink rejected')
    if not PLIST.exists():
        return {'kind':'missing'}
    data, mode = tx.regular(PLIST)
    info = PLIST.stat()
    value = {'kind':'file','bytes':base64.b64encode(data).decode(),'mode':mode,'uid':info.st_uid,'gid':info.st_gid}
    valid_file(value)
    return value


def launch(*args, check=True):
    return subprocess.run(['sudo','-n','/bin/launchctl',*args],capture_output=True,text=True,timeout=30,check=check)


def service_state():
    state = launch('print','system/'+LABEL,check=False)
    # Distinguish absence from privilege/transport failures; unknown errors never look unloaded.
    require(state.returncode == 0 or 'Could not find service' in state.stderr, 'launchd state unavailable')
    disabled = launch('print-disabled','system').stdout
    entries = re.findall(r'"'+re.escape(LABEL)+r'"\s*=>\s*(disabled|enabled)',disabled)
    require(len(entries) <= 1, 'ambiguous launchd disabled state')
    return {'file':file_state(),'loaded':state.returncode == 0,'disabled':entries == ['disabled']}


def root_write(expected, wanted):
    require(os.geteuid() == 0, 'root writer required')
    valid_file(expected)
    valid_file(wanted)
    require(file_state() == expected, 'root plist CAS conflict')
    if wanted['kind'] == 'missing':
        if PLIST.exists():
            PLIST.unlink()
            tx.sync_directory(PLIST.parent)
        return
    data = base64.b64decode(wanted['bytes'],validate=True)
    fd, name = tempfile.mkstemp(prefix='.phone-recovery-',dir=PLIST.parent)
    try:
        with os.fdopen(fd,'wb') as output:
            output.write(data)
            output.flush()
            os.fchown(output.fileno(),0,0)
            os.fchmod(output.fileno(),0o644)
            os.fsync(output.fileno())
        require(file_state() == expected, 'root plist CAS conflict')
        os.replace(name,PLIST)
        tx.sync_directory(PLIST.parent)
    finally:
        if os.path.exists(name):
            os.unlink(name)
    require(file_state() == wanted, 'root plist readback mismatch')


def cli_file(expected,wanted):
    subprocess.run(['sudo','-n','/usr/bin/python3',str(Path(__file__).resolve()),'root-write'],
                   input=json.dumps({'expected':expected,'wanted':wanted}),text=True,check=True,timeout=30,
                   stdout=subprocess.PIPE,stderr=subprocess.PIPE)


def cli_loaded(wanted):
    if wanted:
        launch('bootstrap','system',str(PLIST))
    else:
        launch('bootout','system/'+LABEL)


if __name__ == '__main__':
    try:
        action = sys.argv[1]
        if action == 'root-write':
            data = json.load(sys.stdin)
            root_write(data['expected'],data['wanted'])
        else:
            home = Path(pwd.getpwuid(os.getuid()).pw_dir).resolve()
            transaction = sys.argv[2]
            tx.owned(home,transaction)
            require(tx.read_transaction(home,transaction)['identity']['target'] == 'xian-m4', 'M4 service only')
            path = tx.transaction_directory(home,transaction)/'service.json'
            if action == 'prepare':
                prepare(path,json.load(sys.stdin)['file'],service_state)
            elif action in ('apply','restore'):
                change(path,'after' if action == 'apply' else 'before',service_state,cli_file,cli_loaded)
            elif action in ('verify-installed','verify-restored'):
                require(service_state() == read(path)['after' if action == 'verify-installed' else 'before'], 'service final readback mismatch')
            else:
                raise ValueError('invalid service action')
        print(json.dumps({'operation':action,'verified':True}))
    except (OSError,ValueError,KeyError,subprocess.SubprocessError):
        print('phone deployment service operation failed',file=sys.stderr)
        sys.exit(1)

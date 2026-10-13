#!/usr/bin/env python3
"""手机共享外壳：沿用控制器精确owner锁、账号核验、桌面原证据与锁读回。"""
import importlib.util
from pathlib import Path
import re
import shlex
import subprocess
import time


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


io = load('wf-v2-io')
lib = load('wf-agent-lib')


class Phone:
    def __init__(self, directory, envelope):
        self.directory = directory
        self.run = envelope['run_id']
        self.resource = envelope['contract']['resources']
        self.host = self.resource['machine']
        self.profile = self.resource['profile']
        self.serial = self.resource['device_serial']
        self.account = self.resource['account_ref']
        parse = __import__('datetime').datetime.fromisoformat
        self.execution_deadline = parse(envelope['deadline_at'].replace('Z', '+00:00')).timestamp()
        self.cleanup_deadline = parse(envelope['cleanup_deadline_at'].replace('Z', '+00:00')).timestamp()
        self.deadline = self.execution_deadline
        if self.host not in ('xian-m1', 'xian-m4') or not re.fullmatch(r'[A-Za-z0-9_.-]+', self.profile) or not re.fullmatch(r'[A-Za-z0-9]+', self.serial):
            raise ValueError('invalid registered phone resource')
        self.root = '/private/tmp/openclaw-phone/evidence/' + self.profile

    def ssh(self, command):
        budget = self.deadline - time.time()
        if budget <= 0:
            raise ValueError('phone operation budget exhausted')
        result = subprocess.run(['ssh', '-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', self.host, command],
                                capture_output=True, timeout=min(25, budget))
        if result.returncode:
            raise ValueError('phone controller operation failed')
        return result.stdout

    def ctl(self, *args):
        command = 'export PATH="$HOME/.local/bin:$PATH"; ' + shlex.join(['douyin-phone-adb', '--profile', self.profile, *args])
        return self.ssh(command).decode()

    def owner(self):
        value = self.ctl('lock-status')
        if value.startswith('lock=free'):
            return 'free'
        found = re.search(r'owner=([^\s]+)', value)
        return found.group(1) if found else 'unknown'

    def prepare(self):
        self.deadline = self.execution_deadline
        value = self.ctl('preflight')
        if 'serial=' + self.serial not in value or 'state=device' not in value:
            raise ValueError('phone unavailable')
        owner = self.owner()
        if owner == 'free':
            self.ctl('lock-acquire', self.run)
        elif owner != self.run:
            raise ValueError('phone busy')
        if self.owner() != self.run:
            raise ValueError('phone lock readback mismatch')
        self.ctl('--lock-owner', self.run, 'open-app')
        account = self.ctl('--lock-owner', self.run, 'account-current', self.run + '-preflight-account')
        nick = re.search(r'^nickname=(.*)$', account, re.M)
        if not nick or nick.group(1) != self.account:
            raise ValueError('account mismatch or unavailable')
        io.write(self.directory / 'preflight.json', dict(serial=self.serial, owner=self.run, account=nick.group(1)))

    def refresh(self):
        self.deadline = self.execution_deadline
        self.ctl('lock-refresh', self.run)

    def cleanup(self):
        self.deadline = self.cleanup_deadline
        ok, owner, paths, failures = False, 'unknown', {}, []
        try:
            owner = self.owner()
            # 已释放的失败清理可在剩余预算内精确重领，仅做清理，不跑prepare/业务。
            if owner == 'free' and (self.directory / 'cleanup-owner.json').exists():
                self.ctl('lock-acquire', self.run)
                owner = self.owner()
            if owner != self.run:
                raise ValueError('phone cleanup ownership unconfirmed')
            io.write(self.directory / 'cleanup-owner.json', {'owner': self.run})
            paths = self.capture_cleanup()
            ok, reason, paths = lib.cleanup_evidence(str(self.directory), self.run, {'DESKTOP_CAPTURED': '1', 'APP_CLOSED': '1'})
            if reason:
                failures.append(reason)
        except Exception as error:
            failures.append(str(error))
        finally:
            # controller自行校验精确owner；取证或owner查询失联不能阻止释放尝试。
            if owner in (self.run, 'unknown'):
                try:
                    released = self.ctl('lock-release', self.run)
                    (self.directory / 'cleanup-release.log').write_text(released)
                except Exception as error:
                    failures.append('release: ' + str(error))
            try:
                owner = self.owner()
                io.write(self.directory / 'cleanup-lock-readback.json', {'owner': owner, 'run_id': self.run})
            except Exception as error:
                owner = 'unknown'
                failures.append('release readback: ' + str(error))
        evidence = list(paths.values())
        evidence += [str(self.directory / name) for name in ('cleanup-release.log', 'cleanup-lock-readback.json') if (self.directory / name).exists()]
        receipt = dict(completed=ok and owner == 'free', evidence=evidence, lock_status=owner,
                       failure='; '.join(failures) or None)
        io.write(self.directory / 'cleanup.json', receipt)
        return receipt

    def capture_cleanup(self):
        for op, name in [('close-app', 'cleanup-close-app.log'), ('return-safe-desktop', 'cleanup-desktop.log')]:
            (self.directory / name).write_text(self.ctl('--lock-owner', self.run, op))
        eid = self.run + '-cleanup-desktop-original'
        for op, name in [('snapshot-evidence', 'cleanup-screenshot.log'), ('ui-evidence', 'cleanup-ui.log')]:
            (self.directory / name).write_text(self.ctl('--lock-owner', self.run, op, eid))
        paths = {}
        for ext in ('png', 'xml'):
            path = self.directory / 'evidence' / (eid + '.' + ext)
            path.write_bytes(self.ssh(shlex.join(['cat', self.root + '/' + eid + '.' + ext])))
            paths[ext] = str(path)
        return paths

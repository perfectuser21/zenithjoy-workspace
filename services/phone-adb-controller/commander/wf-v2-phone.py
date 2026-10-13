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
shell = load('wf-v2-shell')


class Phone:
    def __init__(self, directory, envelope):
        self.directory = directory
        self.envelope = envelope
        self.stage = 'preflight'
        self.control_receipts = []
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

    def check_roots(self, label, establish=False):
        roots = {}
        for name, path in [('commander', Path(__file__).parent), ('run', self.directory), ('evidence', self.directory / 'evidence')]:
            real = path.resolve(strict=True)
            stat = real.stat()
            if not real.is_dir():
                raise ValueError('root identity is not a directory: ' + name)
            roots[name] = {'realpath': str(real), 'st_dev': stat.st_dev, 'st_ino': stat.st_ino}
        baseline = self.directory / 'root-identity.json'
        if establish and not baseline.exists():
            io.write(baseline, roots)
        matches = baseline.exists() and io.read(baseline) == roots
        io.write(self.directory / (label.split('-')[0] + '-root-' + label.split('-')[-1] + '.json'),
                 {'observed_at': shell.now(), 'roots': roots, 'matches': matches})
        if not matches:
            raise ValueError('root identity changed or missing')

    def ssh(self, command):
        budget = self.deadline - time.time()
        if budget <= 0:
            raise ValueError('phone operation budget exhausted')
        receipt = self.directory / 'controller-receipts' / self.stage / str(time.time_ns())
        receipt.parent.mkdir(parents=True, exist_ok=True)
        meta = {'host': self.host, 'command': command, 'started_at': shell.now()}
        try:
            result = subprocess.run(['ssh', '-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', self.host, command],
                                    capture_output=True, timeout=min(25, budget))
            stdout, stderr = result.stdout, getattr(result, 'stderr', b'')
            meta.update(returncode=result.returncode)
        except subprocess.TimeoutExpired as error:
            stdout, stderr = error.stdout or b'', error.stderr or b''
            meta.update(timed_out=True)
            raise
        finally:
            for suffix, content in [('stdout', locals().get('stdout', b'')), ('stderr', locals().get('stderr', b''))]:
                path = receipt.with_suffix('.' + suffix)
                path.write_bytes(content)
                self.control_receipts.append(path)
            meta['ended_at'] = shell.now()
            io.write(receipt.with_suffix('.json'), meta)
            self.control_receipts.append(receipt.with_suffix('.json'))
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
        self.stage = 'preflight'
        return shell.execute(self, 'preflight', self._prepare)

    def _prepare(self):
        self.deadline = self.execution_deadline
        self.check_roots('preflight-start', establish=True)
        value = self.ctl('preflight')
        (self.directory / 'preflight-controller.log').write_text(value)
        if 'serial=' + self.serial not in value or 'state=device' not in value:
            raise ValueError('phone unavailable')
        owner = self.owner()
        (self.directory / 'preflight-owner.log').write_text(owner)
        if owner == 'free':
            self.ctl('lock-acquire', self.run)
        elif owner != self.run:
            raise ValueError('phone busy')
        if self.owner() != self.run:
            raise ValueError('phone lock readback mismatch')
        self.ctl('--lock-owner', self.run, 'open-app')
        account = self.ctl('--lock-owner', self.run, 'account-current', self.run + '-preflight-account')
        (self.directory / 'preflight-account.log').write_text(account)
        nick = re.search(r'^nickname=(.*)$', account, re.M)
        if not nick or nick.group(1) != self.account:
            raise ValueError('account mismatch or unavailable')
        self.check_roots('preflight-end')
        io.write(self.directory / 'preflight.json', dict(serial=self.serial, owner=self.run, account=nick.group(1)))

    def refresh(self):
        self.deadline = self.execution_deadline
        self.ctl('lock-refresh', self.run)

    def cleanup(self):
        self.stage = 'cleanup'
        return shell.execute(self, 'cleanup', self._cleanup)

    def _cleanup(self):
        self.deadline = self.cleanup_deadline
        ok, owner, paths, failures = False, 'unknown', {}, []
        try:
            self.check_roots('cleanup-start')
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
        try:
            self.check_roots('cleanup-end')
        except Exception as error:
            ok = False
            failures.append(str(error))
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

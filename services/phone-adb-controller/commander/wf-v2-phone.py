#!/usr/bin/env python3
"""手机共享外壳：沿用控制器精确owner锁、账号核验、桌面原证据与锁读回。"""
import hashlib
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
                                    capture_output=True, timeout=min(280, budget))
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

    def identity(self):
        return {key: self.envelope[key] for key in ('run_id', 'task_id', 'attempt', 'owner_epoch')}

    def ctl(self, *args):
        if args not in (('preflight',), ('lock-status',)):
            # 必须先fsync，再发送：进程死于RPC响应前也不能把未知副作用当成无动作。
            intent = self.directory / 'phone-action-intent.json'
            if not intent.exists():
                io.write(intent, dict(self.identity(), args=list(args), at=shell.now()))
        if self.envelope['contract'].get('action_bindings'):
            command_env = 'WF_COMMANDER_OWNER_EPOCH=' + str(self.envelope['owner_epoch']) + ' '
        else:
            command_env = ''
        command = 'export PATH="$HOME/.local/bin:$PATH"; ' + command_env + shlex.join(['douyin-phone-adb', '--profile', self.profile, *args])
        return self.ssh(command).decode()

    def policy(self, mode, stopped=False, key=None):
        payload = self.envelope if mode == 'bind' else dict(self.identity(), execution_stopped=stopped, key=key)
        command = 'export PATH="$HOME/.local/bin:$PATH"; printf %s ' + shlex.quote(json.dumps(payload, ensure_ascii=False)) + ' | ' + shlex.join(
            ['douyin-phone-adb', '--profile', self.profile, '--lock-owner', self.run, 'commander-' + mode])
        return json.loads(self.ssh(command).decode())

    def owner(self):
        value = self.ctl('lock-status')
        if value.strip() == 'lock=free':
            return 'free'
        found = re.search(r'owner=([^\s]+)', value)
        return found.group(1) if found else 'unknown'

    def prepare(self):
        self.stage = 'preflight'
        return shell.execute(self, 'preflight', self._prepare)

    def _prepare(self):
        self.deadline = self.execution_deadline
        self.check_roots('preflight-start', establish=True)
        # 正证只来自这一代协议、这一run的首次preflight；旧状态缺文件不构成证明。
        boundary = self.directory / 'preflight-no-resource.json'
        state = io.read(self.directory / 'shell-preflight.json')
        eligible = state['attempt'] == 1 and not boundary.exists() and not (self.directory / 'phone-action-intent.json').exists()
        try:
            value = self.ctl('preflight')
        except ValueError:
            if eligible and self.control_receipts:
                meta = io.read(self.control_receipts[-1])
                if meta.get('returncode', 0) != 0 and not meta.get('timed_out'):
                    files = [{'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
                             for path in self.control_receipts]
                    io.write(boundary, dict(self.identity(), shell_attempt=state['attempt'],
                             started_at=state['started_at'], roots=io.read(self.directory / 'root-identity.json'),
                             resource=self.resource, files=files, boundary='controller-preflight-failed-before-acquire'))
            raise
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
        if self.envelope['contract'].get('action_bindings'):
            policy = self.policy('bind')
            if any(policy.get(k) != self.envelope[k] for k in ('task_id', 'run_id', 'owner_epoch')):
                raise ValueError('phone Commander policy readback mismatch')
        self.ctl('--lock-owner', self.run, 'open-app')
        account = self.ctl('--lock-owner', self.run, 'account-current', self.run + '-preflight-account')
        (self.directory / 'preflight-account.log').write_text(account)
        nick = re.search(r'^nickname=(.*)$', account, re.M)
        if not nick or nick.group(1) != self.account:
            raise ValueError('account mismatch or unavailable')
        self.check_roots('preflight-end')
        return shell.commit_receipt(self, 'preflight', dict(serial=self.serial, owner=self.run, account=nick.group(1)))

    def refresh(self):
        self.deadline = self.execution_deadline
        self.ctl('lock-refresh', self.run)

    def cleanup(self):
        self.stage = 'cleanup'
        return shell.execute(self, 'cleanup', self._cleanup)

    def no_resource_cleanup(self):
        directory = self.directory
        proof_path = directory / 'preflight-no-resource.json'
        if not proof_path.exists() or (directory / 'phone-action-intent.json').exists():
            return None
        proof = io.read(proof_path)
        if any(proof.get(k) != v for k, v in self.identity().items()) or proof.get('resource') != self.resource:
            return None
        state = io.read(directory / 'shell-preflight.json')
        if not state.get('terminal') or not state.get('error') or state['attempt'] != proof.get('shell_attempt') or state['started_at'] != proof.get('started_at'):
            return None
        if proof.get('boundary') != 'controller-preflight-failed-before-acquire' or proof.get('roots') != io.read(directory / 'root-identity.json'):
            return None
        archive = directory / 'shell-evidence' / 'preflight' / str(state['attempt'])
        archived = {hashlib.sha256(p.read_bytes()).hexdigest() for p in archive.iterdir() if p.is_file()}
        originals = proof.get('files', []) + [{'path': str(proof_path), 'sha256': hashlib.sha256(proof_path.read_bytes()).hexdigest()}]
        if len(proof.get('files', [])) != 3:
            return None
        for original in originals:
            if hashlib.sha256(Path(original['path']).read_bytes()).hexdigest() != original['sha256'] or original['sha256'] not in archived:
                return None
        with io.lock(directory / '.launch.lock'):
            # 与claim同锁重查并封闭，free查询和最终回执都在同一入场临界区。
            if any((directory / name).exists() for name in ('spawn-claimed.json', 'agent-binding.json', 'phone-action-intent.json')):
                return None
            self.check_roots('cleanup-start')
            owner = self.owner()
            if owner != 'free':
                return None
            self.check_roots('cleanup-end')
            if not (directory / 'handoff-closed.json').exists():
                io.write(directory / 'handoff-closed.json', dict(self.identity(), reason='preflight failed before resource acquisition'))
            readback = directory / 'cleanup-lock-readback.json'
            io.write(readback, dict(self.identity(), owner=owner, observed_at=shell.now()))
            evidence = [str(proof_path), str(archive / 'attempt.json'), str(readback)]
            evidence += [str(p) for p in self.control_receipts]
            return shell.commit_receipt(self, 'cleanup', dict(completed=True, mode='no-resource',
                device_actions='none', diagnostic_actions='controller preflight may refresh adb',
                lock_status=owner, evidence=evidence, failure=None))

    def _cleanup(self):
        self.deadline = self.cleanup_deadline
        try:
            receipt = self.no_resource_cleanup()
            if receipt is not None:
                return receipt
        except Exception:
            pass  # 缺失/篡改/未知证据不能证明无资源；继续原精确owner清理路径。
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
        return shell.commit_receipt(self, 'cleanup', receipt)

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

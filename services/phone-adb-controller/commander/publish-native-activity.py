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
        class SupervisedPhone(phone_module.Phone):
            def __init__(self, *args):
                super().__init__(*args)
                self.quarantine = self.directory / 'native-transport-unknown.json'
                # Existence is a sticky deny, including a damaged latch: only an
                # independent stop/readback protocol may ever clear isolation.
                self.transport_unknown = self.quarantine.exists()
                self.lock_readback = False

            def evidence(self):
                return ([str(self.quarantine)] if self.quarantine.exists() else []) + [
                    str(p) for p in self.control_receipts if p.is_file()]

            def ctl(self, *args):
                if self.transport_unknown and args != ('lock-status',):
                    raise ValueError('native transport unknown: readback only')
                self.lock_readback = args == ('lock-status',)
                try:
                    return super().ctl(*args)
                finally:
                    self.lock_readback = False

            def ssh(self, command):
                # Block direct ssh paths too; only ctl's exact lock-status call
                # can cross this gate after an uncertain remote execution.
                if self.transport_unknown and not self.lock_readback:
                    raise ValueError('native transport unknown: readback only')
                try:
                    return super().ssh(command)
                except Exception as error:
                    # SSH255 is a transport failure, not proof the accepted remote
                    # operation stopped. Native controller stdout/stderr stay intact.
                    meta = {}
                    if self.control_receipts:
                        try:
                            meta = io.read(self.control_receipts[-1])
                        except (OSError, ValueError):
                            pass
                    code = meta.get('returncode')
                    if isinstance(error, subprocess.TimeoutExpired) or code == 255 or isinstance(code, int) and code < 0:
                        self.transport_unknown = True
                        if not self.quarantine.exists():
                            io.write(self.quarantine, dict(self.identity(), boundary='remote-execution-unknown',
                                     evidence=[str(p) for p in self.control_receipts if p.is_file()]))
                    raise

        phone = SupervisedPhone(directory, envelope)
        try:
            receipt = phone.prepare() if phase == 'preflight' else phone.cleanup()
        except Exception as error:
            error.native_transport_unknown = phone.transport_unknown
            error.native_evidence = phone.evidence()
            raise
        # cleanup catches controller exceptions internally; keep the same transport
        # boundary even if a later native readback returns another receipt.
        if phone.transport_unknown:
            return dict(schema_version=1, run_tag=run_id, status='needs_review', failure_class='needs_human',
                        outputs={}, metrics={}, evidence=phone.evidence(),
                        reason_code='publish_native_unconfirmed', execution_stopped=False, external_effect='unknown')
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
                      outputs={}, metrics={}, evidence=getattr(error, 'native_evidence', []), reason_code='publish_native_unconfirmed', diagnostic=type(error).__name__)
        if getattr(error, 'native_transport_unknown', False):
            result.update(execution_stopped=False, external_effect='unknown')
    print(json.dumps(result, ensure_ascii=False))

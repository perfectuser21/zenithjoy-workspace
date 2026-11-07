"""Private-home integration fixtures. Production CLI accepts no evidence override."""
import unittest, tempfile, importlib.util, json, hashlib, os, tarfile, io, fcntl, sys
from pathlib import Path
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'cloud7-quarantine-supersession.py'
TASK = 'c4bab9ac-d487-4689-a26d-cf169066ec07'
FIX = '85d0e7ee-e7e3-49d0-a0e7-9fd68827aca7'
BIND = '5d2a142a-04b7-4583-96eb-4e3c9a99e422'
COMMIT = '69c40526d2ba0ecffae10b566bb5e10b707e1268'
TAG = 'potato20261107_101_cloud7'
RUN = 'douyin_video_discovery-' + TAG + '__a1'
EPOCH = '37802167-65cf-47ca-a7ce-d6bf086d9907'
SERIAL = '47.100.213.173:10001'
sha = lambda b: hashlib.sha256(b).hexdigest()
def encoded(v): return (json.dumps(v, separators=(',', ':')) + '\n').encode()
def put(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.write_bytes(value if isinstance(value, bytes) else encoded(value)); path.chmod(0o600)
def identity():
    return dict(task_id=TASK, run_id=RUN, binding_id=BIND, source_commit=COMMIT,
                profile='cloud-phone-test', serial=SERIAL, owner=TAG, epoch=EPOCH)

class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SOURCE.is_file(), 'missing formal non-replay quarantine supersession authority')
        spec = importlib.util.spec_from_file_location('cloud7_supersession', SOURCE)
        self.m = importlib.util.module_from_spec(spec); spec.loader.exec_module(self.m)
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve()
        self.root = self.home / '.local/share/zenithjoy/phone-locks'
        self.root.mkdir(parents=True, mode=0o700); self.root.chmod(0o700)
        self.run = self.home / '.local/share/zenithjoy/phone-candidate-runs' / COMMIT / 'ledger' / ('douyin_video_discovery-' + TAG)
        self.run.mkdir(parents=True, mode=0o700)
        self.e = self.home / 'perfect21/runner-deploy-evidence/potato-runner-commander-20261107/cloud-drive7'
        self.e.mkdir(parents=True, mode=0o700)
        self.legacy = self.home / 'legacy'; self.legacy.mkdir(mode=0o755); self.legacy.chmod(0o755)
        put(self.root / '.migration-complete.json', dict(schema_version=1, state='complete', source_sha256='a'*64, legacy_root=str(self.legacy)))
        put(self.root / (SERIAL+'.guard'), b''); os.link(self.root / (SERIAL+'.guard'), self.legacy / (SERIAL+'.guard'))
        self.lock = self.root / (SERIAL+'.lock'); self.lock.mkdir(mode=0o700)
        for name, value in self.m.LOCK_FIELDS.items(): put(self.lock/name, (value+'\n').encode())
        self.foreign = self.root/'4227.lock'; self.foreign.mkdir(mode=0o700); put(self.foreign/'owner', b'untouched\n')
        self.files = {}; self.build_evidence(); self.m.system_home = lambda: self.home
        self.calls = []; self.task = dict(id=TASK, status='blocked')
        self.fix = dict(id=FIX, status='in_progress', claimed_by='codex-cloud7-nonreplay-authority', claimed_at='2026-11-07T19:33:17.015Z')
        self.central = dict(device_name=SERIAL, locked_by=None, expires_at=None)
        def brain(path):
            self.calls.append(path)
            if path == '/tasks/'+TASK: return self.task
            if path == '/tasks/'+FIX: return self.fix
            if path == '/device-locks': return dict(success=True, locks=[self.central])
            self.fail('unexpected Brain read '+path)
        self.m.brain_get = brain
        self.real_source_authority = self.m.source_authority
        self.m.source_authority = lambda: dict(commit='f'*40, files={'cloud7-quarantine-supersession.py':'e'*64})
        self.repin()
    def add(self, path, value):
        f = self.run/path; put(f, value); self.files[path] = f
    def build_evidence(self):
        runtime = {}
        for name in ['phone-lock-root.py', 'native-phone-runtime.mjs', 'native-phone-command-source.mjs', 'config/native-phone-command-sources.json']:
            b = (SOURCE.parent/name).read_bytes(); self.add('runtime/'+name, b); runtime['runtime/'+name] = sha(b)
        self.add('run-definition.json', dict(schema_version=1, files=runtime,
            agent_input=dict(task_id=TASK, run_id=RUN, run_tag=TAG, profile='cloud-phone-test', serial=SERIAL, workflow_key='douyin_video_discovery', line='yuesheng'),
            run_identity=dict(task_id=TASK, run_id=RUN, binding_id=BIND), deployment=dict(source_commit=COMMIT, target='mmv'), snapshot_sha256='a'*64))
        self.add('activity-preflight.json', dict(status='needs_review', execution_stopped=False, error='AGENT_TOOL_COMMIT_UNKNOWN_READBACK_REQUIRED'))
        self.add('activity-collect_videos.json', dict(activity='collect_videos', status='blocked', reason='原执行终止未知，保留资源'))
        self.add('activity-cleanup.json', dict(activity='cleanup', status='blocked', reason='原执行终止未知，保留资源'))
        self.add('split-result.json', dict(**{k:v for k,v in identity().items() if k not in ['owner','epoch','serial']}, workflow_key='douyin_video_discovery', status='needs_review',
            results=[dict(activity='preflight', status='needs_review', execution_stopped=False), dict(activity='collect_videos', status='blocked'), dict(activity='cleanup', status='blocked')]))
        self.add('resource-quarantine.json', dict(verified=True, device=dict(applicable=True, verified=True, physical_actions=0), videos=[], claim_receipt_unknown=False))
        scope = dict(task_id=TASK, run_id=RUN, binding_id=BIND, source_commit=COMMIT, profile='cloud-phone-test', serial=SERIAL, run=TAG, activity='preflight', workflow='douyin_video_discovery', line='yuesheng', execution_transport='raw-model-v1')
        self.add('skill-primary/preflight/launch-intent.json', dict(scope=scope))
        self.add('agent-tools/preflight/'+'0'*64+'.intent.json', dict(operation='resource_prepare'))
        for domain in ['commander-preflight/caller', 'skill-primary/preflight', 'skill-primary/preflight/native-authority']:
            d = domain+'/official-control/'
            rows = [dict(event='read_intent', path='/api/brain/tasks/'+TASK, epoch=0), dict(event='read_returned', path='/api/brain/tasks/'+TASK, epoch=0, bytes=12)]
            self.add(d+'official-authority-fixture.jsonl', b''.join(encoded(x) for x in rows))
            self.add(d+'caller-lifecycle-fixture.intent.json', dict(protocol='official-caller-lifecycle/v1', source_commit=COMMIT))
            b = self.files[d+'official-authority-fixture.jsonl'].read_bytes(); a = self.files[d+'caller-lifecycle-fixture.intent.json'].read_bytes()
            self.add(d+'official-caller-final-fixture.json', dict(protocol='official-caller-final/v1', evidence_only=True, not_recovery_authority=True, task_id=TASK, run_id=RUN, binding_id=BIND, source_commit=COMMIT,
                activity_key='preflight', raw_turns=[], journal_closed=True, evidence_complete=True,
                snapshot=dict(sealed=True, pending=0, execution_stopped=True, caller_execution_stopped=True, execution_unknown=False, external_effect_unknown=False, previous_caller_stop_unproven=False, final_record_failed=False),
                ledger=dict(file='official-authority-fixture.jsonl', sha256=sha(b), bytes=len(b)), artifacts=[dict(file='caller-lifecycle-fixture.intent.json', sha256=sha(a), bytes=len(a))]))
        self.add('native-phone/preflight/source/lifecycle.intent.json', dict(protocol='native-phone-adb-read/v1', source_sha256='b'*64))
        policy = json.loads((SOURCE.parent/'config/native-phone-command-sources.json').read_text())['device_sources'][0]
        for n, program in enumerate(policy['program_files']):
            path = program['path']; d='native-phone/preflight/source/'
            self.add(d+f'read-{n}.intent.json', dict(id=n, path=path, scope_sha256='b'*64))
            writes = []
            for service in ['host:transport:'+SERIAL, 'sync:']:
                b=service.encode(); writes.append(f'{len(b):04x}'.encode()+b)
            b=path.encode(); writes.extend([b'RECV'+len(b).to_bytes(4,'little')+b, b'QUIT'+bytes(4)])
            for k,b in enumerate(writes): self.add(d+f'read-{n}-write-{k}.intent.json', dict(bytes=len(b), sha256=sha(b)))
            self.add(d+f'read-{n}.returned.json', dict(id=n, path=path, sha256=program['sha256'], bytes=207, peer_eof=True, socket_closed=True))
        d='native-phone/preflight/command-0/'
        self.add(d+'lifecycle.intent.json', dict(schema_version=1, instance_id='e49722c9-c689-4c97-a144-5428e1dca675', scope_sha256='b'*64, source_sha256='b'*64))
        for n in range(2): self.add(d+f'socket-{n}.intent.json', dict(schema_version=1, index=n, endpoint_sha256=sha(b'tcp:127.0.0.1:5041'), serial_sha256=sha(SERIAL.encode())))
        writes=[]
        for service in ['host-serial:'+SERIAL+':features', 'host:transport:'+SERIAL, "shell,v2,raw:exec /system/bin/getprop 'ro.build.version.sdk'"]:
            b=service.encode(); writes.append(f'{len(b):04x}'.encode()+b)
        writes.append(b'\x04\x00\x00\x00\x00')
        for n,b in enumerate(writes): self.add(d+f'write-{n}.intent.json', dict(schema_version=1, bytes=len(b), sha256=sha(b)))
        close={**identity(), 'physical_sequence':1, 'activity':'preflight', 'physical':dict(domain='parent-preflight-local-nofork-v1', execution_stopped=True, pending=0, command_failures=0,
            adb=dict(complete=True, requests_returned=True, leaves=[dict(sequence=1,pid=700003,code=0,tainted=False,request_returned=True)]),
            local=dict(sealed=True, execution_stopped=True, leaves=[dict(id='leaf',pid=700004,code=0,tainted=False)])),
            'control':dict(sealed=True,pending=0,execution_stopped=True), 'official_stopped':False, 'agent_not_launched':True, 'resource_unknown':False}
        self.add('preflight-native-domain-close.jsonl', encoded(close))
        self.add('preflight-native-scopes/local.jsonl', b''.join(encoded(x) for x in [dict(event='intent',id='leaf',operation='lock'), dict(event='started',id='leaf',pid=700004), dict(event='returned',id='leaf',pid=700004,code=0,tainted=False)]))
        self.add('preflight-native-scopes/adb.jsonl', b''.join(encoded(x) for x in [dict(phase='intent',sequence=1), dict(phase='started',sequence=1,pid=700003), dict(phase='exit',sequence=1,pid=700003,code=0,tainted=False,request_returned=True)]))
        self.add('native-phone/preflight/local/local-fixture.jsonl', b''.join(encoded(x) for x in [dict(event='create'),dict(event='intent',id='positive',role='calibration-positive'),dict(event='returned',id='positive',role='calibration-positive',code=0,stdio_closed=True),dict(event='intent',id='negative',role='calibration-negative'),dict(event='returned',id='negative',role='calibration-negative',code=128,stdio_closed=True),dict(event='final',unknown=False,leaves=2)]))
        self.add('preflight-lock-events.jsonl', b''.join(encoded({**identity(),'operation':op,'result':dict(lock=state,owner=TAG,epoch=EPOCH,readback_owner=TAG,readback_epoch=EPOCH)}) for op,state in [('acquire','acquired'),('quarantine','quarantined')]))
        self.launch = dict(pid=700001, supervisor_pid=700002, task_id=TASK, source_commit=COMMIT, host='mmv', broker_host='mmv', adb_endpoint='tcp:127.0.0.1:5041',
            argv=['/bin/bash',str(self.home/'.local/share/zenithjoy/phone-candidates'/COMMIT/'run.sh'),'douyin_video_discovery','cloud-phone-test',SERIAL,'yuesheng',TAG])
        put(self.e/'launch.json', self.launch); put(self.e/'exit.json', dict(exit_code=1))
        self.diag=self.e.parent/'sdk-outcome-fix8'
        put(self.diag/'failure-chain-and-recovery-contract.json', dict(original_run_id=RUN, original_root_cause='CLOUD7_NATIVE_SDK_PREPARE_READBACK_UNKNOWN', last_durable_event='native-phone/preflight/command-0/write-3.intent.json',
            exact_command="exec /system/bin/getprop 'ro.build.version.sdk'", original_inner_error='unknown_not_persisted', old_ledger_information_loss_proven=True,
            historical_recovery=dict(code='CLOUD7_SDK_HISTORICAL_STOP_EVIDENCE_UNRECOVERABLE',original_execution_stopped=False)))
        put(self.diag/'adb-historical-trace-readback.json',dict(verdict='NO_MATCHING_HISTORICAL_SDK_STREAM_EVIDENCE',cloud7_window_records=[],command_trace_records=[]))
    def repin(self):
        with tarfile.open(self.e/'runtime-evidence.tar.gz','w:gz') as t:
            for p,f in self.files.items():
                b=f.read_bytes();i=tarfile.TarInfo(self.run.name+'/'+p);i.size=len(b);t.addfile(i,io.BytesIO(b))
        archive=sha((self.e/'runtime-evidence.tar.gz').read_bytes())
        manifest=dict(run_id=RUN,root=str(self.run),archive_sha256=archive,files={p:dict(bytes=f.stat().st_size,sha256=sha(f.read_bytes())) for p,f in self.files.items()})
        put(self.e/'runtime-manifest.json',manifest)
        preservation=dict(cloud7_archive=dict(path=str(self.e/'runtime-evidence.tar.gz'),sha256=archive),cloud7_quarantine=dict(root=str(self.lock),files={name:dict(sha256=sha((value+'\n').encode()),text=value+'\n') for name,value in self.m.LOCK_FIELDS.items()}))
        put(self.e/'preservation-readback.json',preservation)
        paths=dict(manifest=self.e/'runtime-manifest.json',archive=self.e/'runtime-evidence.tar.gz',launch=self.e/'launch.json',exit=self.e/'exit.json',marker=self.root/'.migration-complete.json',preservation=self.e/'preservation-readback.json',loss=self.diag/'failure-chain-and-recovery-contract.json',trace=self.diag/'adb-historical-trace-readback.json')
        self.m.PINS={k:sha(p.read_bytes()) for k,p in paths.items()}
    def alter(self,path,fn):
        f=self.files[path];v=json.loads(f.read_text());fn(v);put(f,v);self.repin()
    def plan(self):return self.m.plan()
    def apply(self):return self.m.apply()
    def archived(self):return self.m.archive_path(self.root)
    def test_plan_apply_preserves_originals_and_supersedes_only_exact_lock(self):
        original={p:sha(f.read_bytes()) for p,f in self.files.items()};before={f.name:f.read_bytes() for f in self.lock.iterdir()};ino=self.lock.stat().st_ino
        p=self.plan();self.assertEqual(p['state'],'planned');self.assertTrue(self.lock.is_dir())
        r=self.apply();self.assertEqual(r['state'],'superseded');self.assertEqual(r['local_readback']['state'],'free');self.assertIs(r['original_execution_stopped'],False)
        self.assertFalse(self.lock.exists());archived=self.archived();self.assertEqual(archived.stat().st_ino,ino);self.assertEqual({f.name:f.read_bytes() for f in archived.iterdir()},before)
        self.assertEqual((self.foreign/'owner').read_bytes(),b'untouched\n');self.assertEqual(original,{p:sha(f.read_bytes()) for p,f in self.files.items()})
        self.assertFalse(json.loads(self.files['activity-preflight.json'].read_text())['execution_stopped']);self.assertGreaterEqual(self.calls.count('/device-locks'),3)
    def test_apply_requires_plan_and_cli_rejects_override(self):
        with self.assertRaises(ValueError):self.apply()
        import subprocess
        r=subprocess.run([sys.executable,str(SOURCE),'plan','--owner','foreign'],capture_output=True,text=True)
        self.assertEqual(r.returncode,2);self.assertIn('USAGE',r.stderr);self.assertTrue(self.lock.exists())
    def test_unmerged_or_dirty_authority_source_is_not_a_release_capability(self):
        import subprocess
        def unmerged(argv, **kwargs):
            if argv[-2:] == ['rev-parse','HEAD']: return ('f'*40+'\n').encode()
            if 'merge-base' in argv: raise subprocess.CalledProcessError(1, argv)
            self.fail('unmerged authority must not inspect deployable source')
        with patch.object(self.m.subprocess,'check_output',side_effect=unmerged):
            with self.assertRaises(subprocess.CalledProcessError): self.real_source_authority()
        def dirty(argv, **kwargs):
            if argv[-2:] == ['rev-parse','HEAD']: return ('f'*40+'\n').encode()
            if 'merge-base' in argv: return b''
            if 'show' in argv: return b'wrong committed bytes'
            self.fail('unexpected authority git command')
        with patch.object(self.m.subprocess,'check_output',side_effect=dirty):
            with self.assertRaises(ValueError): self.real_source_authority()
        self.assertTrue(self.lock.exists())
    def test_original_hash_and_frozen_runtime_drift_refuse(self):
        for f in [self.files['activity-preflight.json'],self.run/'runtime/native-phone-runtime.mjs']:
            b=f.read_bytes();put(f,b+b' ')
            with self.assertRaises(ValueError):self.plan()
            put(f,b)
    def test_worker_unknown_stop_identity_or_business_side_effect_refuse_with_matching_pins(self):
        cases=[('activity-preflight.json',lambda v:v.update(execution_stopped=True)),('skill-primary/preflight/official-control/official-caller-final-fixture.json',lambda v:v.update(raw_turns=[dict(dispatched=True)])),
            ('skill-primary/preflight/official-control/official-caller-final-fixture.json',lambda v:v['snapshot'].update(execution_stopped=False)),('skill-primary/preflight/official-control/official-caller-final-fixture.json',lambda v:v.update(task_id='foreign')),
            ('preflight-native-domain-close.jsonl',lambda v:v.update(agent_not_launched=False)),('resource-quarantine.json',lambda v:v['device'].update(physical_actions=1)),('resource-quarantine.json',lambda v:v.update(videos=[dict(video_id='123')])),
            ('skill-primary/preflight/launch-intent.json',lambda v:v['scope'].update(activity='collect_videos'))]
        for path,fn in cases:
            with self.subTest(path=path):
                b=self.files[path].read_bytes();self.alter(path,fn)
                with self.assertRaises(ValueError):self.plan()
                put(self.files[path],b);self.repin()
    def test_unknown_command_not_fixed_read_only_sdk_refuses_even_with_matching_pins(self):
        path='native-phone/preflight/command-0/write-2.intent.json';b=self.files[path].read_bytes();self.alter(path,lambda v:v.update(sha256=sha(b'shell,v2,raw:input tap 1 1')))
        with self.assertRaises(ValueError):self.plan()
        put(self.files[path],b);self.repin()
        put(self.run/'native-phone/preflight/command-1/lifecycle.intent.json',dict(command='tap'))
        with self.assertRaises(ValueError):self.plan()
    def test_new_sdk_exit_diagnostic_cannot_be_backfilled_into_old_run(self):
        put(self.run/'native-phone/preflight/command-0/terminal.json',dict(exit_code=0,peer_eof=True,socket_closed=True))
        with self.assertRaises(ValueError):self.plan()
    def test_original_source_read_must_have_eof_and_socket_close(self):
        path='native-phone/preflight/source/read-6.returned.json';self.alter(path,lambda v:v.update(peer_eof=False))
        with self.assertRaises(ValueError):self.plan()
    def test_information_loss_and_historical_stop_verdict_required(self):
        for name,key,value in [('failure-chain-and-recovery-contract.json','old_ledger_information_loss_proven',False),('adb-historical-trace-readback.json','verdict','RECOVERED')]:
            f=self.diag/name;b=f.read_bytes();v=json.loads(b);v[key]=value;put(f,v);self.repin()
            with self.assertRaises(ValueError):self.plan()
            put(f,b);self.repin()
    def test_owner_epoch_and_extra_field_refuse(self):
        self.plan()
        for name in ['owner','preflight_epoch','preflight_quarantined']:
            f=self.lock/name;b=f.read_bytes();put(f,b'foreign\n')
            with self.assertRaises(ValueError):self.apply()
            put(f,b)
        put(self.lock/'unexpected',b'unknown')
        with self.assertRaises(ValueError):self.apply()
    def test_foreign_claim_task_or_central_owner_refuses(self):
        for target,key,value in [(self.fix,'claimed_by','foreign'),(self.fix,'claimed_at','changed'),(self.fix,'status','blocked'),(self.task,'status','in_progress'),(self.central,'locked_by','foreign')]:
            old=target.get(key);target[key]=value
            with self.assertRaises(ValueError):self.plan()
            target[key]=old
    def test_same_original_central_owner_still_held_refuses(self):
        self.central.update(locked_by=TASK,expires_at='2999-01-01T00:00:00Z')
        with self.assertRaises(ValueError):self.plan()
    def test_guard_busy_missing_peer_or_third_link_refuses(self):
        guard=self.root/(SERIAL+'.guard');peer=self.legacy/(SERIAL+'.guard')
        with guard.open('r+') as g:
            fcntl.flock(g,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with self.assertRaises(ValueError):self.plan()
        peer.unlink()
        with self.assertRaises(ValueError):self.plan()
        put(peer,b'')
        with self.assertRaises(ValueError):self.plan()
        peer.unlink();os.link(guard,peer);third=self.home/'third.guard';os.link(guard,third)
        with self.assertRaises(ValueError):self.plan()
    def test_interruption_before_after_rename_and_double_apply(self):
        self.plan();rename=self.m.os.rename
        with patch.object(self.m.os,'rename',side_effect=OSError('before rename')):
            with self.assertRaises(OSError):self.apply()
        self.assertTrue(self.lock.exists())
        def after(a,b):rename(a,b);raise OSError('after rename')
        with patch.object(self.m.os,'rename',side_effect=after):
            with self.assertRaises(OSError):self.apply()
        self.assertFalse(self.lock.exists());self.assertEqual(self.apply(),self.apply())
    def test_archive_without_durable_intent_cannot_be_adopted(self):
        self.plan();os.rename(self.lock,self.archived())
        with self.assertRaises(ValueError):self.apply()
        with self.assertRaises(ValueError):self.plan()
    def test_new_owner_after_supersession_is_not_released_by_replay(self):
        self.plan();self.apply();self.lock.mkdir(mode=0o700);put(self.lock/'owner',b'potato20261107_101_cloud8\n')
        with self.assertRaises(ValueError):self.apply()
        self.assertEqual((self.lock/'owner').read_bytes(),b'potato20261107_101_cloud8\n')
    def test_durable_plan_identity_drift_refuses_before_move(self):
        self.plan();journal=self.m.journal_dir(self.root)/'plan.json';v=json.loads(journal.read_text());v['identity']['epoch']='foreign';put(journal,v)
        with self.assertRaises(ValueError):self.apply()
        self.assertTrue(self.lock.exists())
    def test_final_readback_cannot_write_return_after_evidence_drift(self):
        self.plan();old=self.m.brain_get;count=0
        def read(path):
            nonlocal count
            if path=='/device-locks':
                count+=1
                if count==3:
                    f=self.files['activity-preflight.json'];v=json.loads(f.read_text());v['execution_stopped']=True;put(f,v)
            return old(path)
        self.m.brain_get=read
        with self.assertRaises(ValueError):self.apply()
        self.assertFalse(self.lock.exists());self.assertTrue(self.archived().is_dir());self.assertFalse(list(self.root.glob('*/apply.returned.json')))
    def test_archive_owner_and_plan_identity_drift_fail_closed(self):
        self.plan();self.apply();put(self.archived()/'owner',b'foreign\n')
        with self.assertRaises(ValueError):self.apply()
    def test_final_authority_read_cannot_hide_evidence_change(self):
        self.plan();old=self.m.brain_get;count=0
        def read(path):
            nonlocal count
            if path=='/device-locks':
                count+=1
                if count==2:
                    f=self.files['activity-preflight.json'];v=json.loads(f.read_text());v['execution_stopped']=True;put(f,v)
            return old(path)
        self.m.brain_get=read
        with self.assertRaises(ValueError):self.apply()
        self.assertTrue(self.lock.exists());self.assertFalse(list(self.root.glob('*/apply.returned.json')))
    def test_final_guard_replacement_cannot_hide_foreign_authority(self):
        self.plan();old=self.m.brain_get;count=0
        def read(path):
            nonlocal count
            if path=='/device-locks':
                count+=1
                if count==2:
                    guard=self.root/(SERIAL+'.guard');os.rename(guard,self.root/'.guard.replaced');put(guard,b'')
            return old(path)
        self.m.brain_get=read
        with self.assertRaises(ValueError):self.apply()
        self.assertTrue(self.lock.exists());self.assertFalse(list(self.root.glob('*/apply.returned.json')))
    def test_evidence_and_owner_symlink_or_hardlink_fail_closed(self):
        f=self.files['activity-preflight.json'];os.link(f,self.home/'linked-evidence')
        with self.assertRaises(ValueError):self.plan()
        (self.home/'linked-evidence').unlink();f=self.lock/'owner';f.unlink();f.symlink_to(self.foreign/'owner')
        with self.assertRaises(ValueError):self.plan()
    def test_central_readback_unknown_after_rename_preserves_intent_and_archive(self):
        self.plan();old=self.m.brain_get
        def read(path):
            if path=='/device-locks' and not self.lock.exists():raise ValueError('central after rename unknown')
            return old(path)
        self.m.brain_get=read
        with self.assertRaises(ValueError):self.apply()
        self.assertFalse(self.lock.exists());self.assertTrue(self.archived().is_dir());self.m.brain_get=old;self.assertEqual(self.apply()['state'],'superseded')

if __name__=='__main__':unittest.main()

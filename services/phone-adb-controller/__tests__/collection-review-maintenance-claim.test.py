"""原blocked维护任务必须经正式新claim+恢复+活性回执，不能伪装原claim。"""
import copy,importlib.util,json,unittest
from pathlib import Path
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location('old_gap_fixture',HERE/'collection-review-gap.test.py')
b=importlib.util.module_from_spec(sp);sp.loader.exec_module(b)
h=b.h;m=h.m
NEW='headed-102-maintenance-resume'
STALE='headed session stale: no initiative_runs row past grace — 降级 blocked（可恢复），非 failed'

class MaintenanceClaimTest(unittest.TestCase):
    def setUp(self):
        self.fixture=b.GapEvidenceTest('test_accepts_new_owner_and_binds_every_raw_record_without_claiming_continuity')
        self.fixture.setUp();self.addCleanup(self.fixture.doCleanups)
        self.f=self.fixture;self.records=self.f.records
        patch.object(h,'now_ms',return_value=m.ms('2026-11-04T09:05:00Z')).start()
        payload={'headed_manual':'true','failed_run_id':m.SCOPE['run_id'],'source_commit':m.SCOPE['source_commit'],
                 'scope':{'line':'yuesheng','send':0,'profile':m.SCOPE['profile'],'device_serial':m.SCOPE['serial'],
                          'no_raw_sql_write':True,'no_shared_adb_restart':True,'keep_original_failed_result':True,'do_not_reuse_original101_maintenance':True}}
        self.blocked={**m.TASK,'status':'blocked','claimed_by':None,'claimed_at':None,'blocked_at':'2026-11-04T06:35:29.529Z',
                      'updated_at':'2026-11-04T06:35:29.529Z','error_message':STALE,'payload':payload,'executor_kind':'headed-session'}
        self.current={**self.blocked,'status':'in_progress','claimed_by':NEW,'claimed_at':'2026-11-04T09:00:00.000Z'}
        ack={'id':m.TASK['id'],'claimed_by':NEW,'claimed_at':self.current['claimed_at'],'executor_kind':'headed-session',
             'lease_until':'2026-11-04T13:00:00.005Z','lease_seconds':14400,'on_lease_expire':'auto'}
        self.records.update({
          'maintenance-blocked.json':{'observed_at':'2026-11-04T08:46:34.921465+00:00','raw':{'maintenance_task':self.blocked}},
          'maintenance-claim-request.json':{'claimer':NEW,'executor_kind':'headed-session','lease_seconds':14400},
          'maintenance-claim-ack.json':ack,
          'maintenance-resume-request.json':{'status':'in_progress'},'maintenance-resume-ack.json':self.current,
          'maintenance-task.json':self.current,'maintenance-task-confirm.json':self.current,
          'maintenance-heartbeat-request.json':{'claimer':NEW,'lease_seconds':14400},
          'maintenance-heartbeat-ack.json':{'ok':True,'lease_until':'2026-11-04T13:00:01.000Z','lease_seconds':14400,'heartbeat_count':1}})
        for name in ['acquire-ack.json','locks-after.json','locks-confirm.json']:
            target=self.records[name]['lock'] if name=='acquire-ack.json' else next(r for r in self.records[name]['locks'] if r['device_name']==m.SCOPE['serial'])
            target.update(locked_at='2026-11-04T09:01:00Z',expires_at='2026-11-04T09:51:00Z')
        self.f.records=json.loads(json.dumps(self.records));self.records=self.f.records
        self.f.manifest.update(version=2,kind='collection-review-new-isolation-after-gap-v2');self.f.save()
        patch.object(h,'BLOCKED_SHA256',self.f.manifest['files']['maintenance-blocked.json'],create=True).start()
    def verify(self):return h.gap_evidence(self.f.path)
    def tamper(self,name,key,value):
        self.records[name][key]=value;self.f.save()
    def test_v2_records_new_claim_and_lease_but_preserves_historical_task(self):
        proof=self.verify();current=proof['current_maintenance_claim']
        self.assertEqual(proof['maintenance'],m.TASK)
        self.assertEqual(current['claimed_by'],NEW);self.assertNotEqual(current['claimed_at'],m.TASK['claimed_at'])
        self.assertEqual(proof['task_lease_epoch']['lease_seconds'],14400)
        self.assertEqual(proof['task_lease_epoch']['claimed_at'],current['claimed_at'])
        self.assertEqual(m.TASK['claimed_by'],'headed-102-collection-fix')
    def test_missing_lease_or_wrong_actor_request_rejected(self):
        for field,value in [('lease_seconds',None),('lease_seconds',0),('lease_seconds',True),('claimer',m.TASK['claimed_by']),('executor_kind','kernel-v1')]:
            with self.subTest(field=field,value=value):
                old=copy.deepcopy(self.records['maintenance-claim-request.json']);self.tamper('maintenance-claim-request.json',field,value)
                with self.assertRaises(ValueError):self.verify()
                self.records['maintenance-claim-request.json']=old;self.f.save()
    def test_new_claim_cannot_reuse_old_timestamp_or_foreign_epoch(self):
        self.tamper('maintenance-claim-ack.json','claimed_at',m.TASK['claimed_at'])
        with self.assertRaises(ValueError):self.verify()
    def test_original_blocked_reason_and_clear_claim_must_be_exact(self):
        for key,value in [('status','failed'),('error_message','different'),('claimed_by','still-alive'),('claimed_at',m.TASK['claimed_at'])]:
            original=copy.deepcopy(self.records['maintenance-blocked.json']);self.records['maintenance-blocked.json']['raw']['maintenance_task'][key]=value;self.f.save()
            with patch.object(h,'BLOCKED_SHA256',self.f.manifest['files']['maintenance-blocked.json']),self.subTest(key=key),self.assertRaises(ValueError):self.verify()
            self.records['maintenance-blocked.json']=original;self.f.save()
    def test_resume_request_or_ack_cannot_skip_active_status(self):
        self.tamper('maintenance-resume-request.json','status','queued')
        with self.assertRaises(ValueError):self.verify()
    def test_second_task_readback_must_match_first_claim_and_entire_payload(self):
        self.records['maintenance-task-confirm.json']['payload']['scope']['send']=1;self.f.save()
        with self.assertRaises(ValueError):self.verify()
    def test_successful_claim_ack_without_active_heartbeat_does_not_admit(self):
        self.tamper('maintenance-heartbeat-ack.json','ok',False)
        with self.assertRaises(ValueError):self.verify()
    def test_expired_recorded_lease_blocks_even_if_task_still_claimed(self):
        patch.object(h,'now_ms',return_value=m.ms('2026-11-04T13:01:00Z')).start()
        with self.assertRaises(ValueError):self.verify()
    def test_changed_new_claim_live_is_rejected_without_phone_or_writes(self):
        proof=self.verify()
        for changed in [{'status':'blocked'},{'claimed_by':'foreign'},{'claimed_at':'2026-11-04T09:02:00Z'}]:
            with patch.object(h,'brain',return_value={**self.current,**changed}),self.subTest(changed=changed),self.assertRaises(ValueError):h.task(self.f.root,proof)
        with patch.object(h,'brain',return_value=self.current):
            self.assertEqual(h.task(self.f.root,proof),proof['current_maintenance_claim'])
    def test_v1_remains_strict_and_does_not_accept_v2_claim(self):
        self.f.manifest.update(version=1,kind='collection-review-new-isolation-after-gap-v1')
        self.f.records={k:v for k,v in self.records.items() if k in h.GAP_FILES};self.f.manifest['files']={};self.f.save()
        with self.assertRaises(ValueError):self.verify()
    def test_snapshot_claim_binding_prevents_old_journal_adoption(self):
        from types import SimpleNamespace
        proof=self.verify();auth={'acquisition_gap':proof,'current_maintenance_claim':proof['current_maintenance_claim'],'task_lease_epoch':proof['task_lease_epoch']}
        identity={'files':{'collection-review-maintenance-contract.json':'c'*64}}
        guards=SimpleNamespace(target_identity=[1,2,3,4],legacy_snapshot=m.CONTRACT['lock_state']['legacy'])
        value=h.snapshot_value(guards,auth,identity)
        self.assertEqual(value['current_maintenance_claim'],proof['current_maintenance_claim'])
        directory=self.f.root/'journal';directory.mkdir(mode=0o700);h.phone_module.atomic_new(directory/h.SNAPSHOT,value)
        changed=copy.deepcopy(auth);changed['current_maintenance_claim']['claimed_at']='2026-11-04T09:02:00Z'
        with self.assertRaises(ValueError):h.saved_snapshot(directory,changed,identity)

if __name__=='__main__':unittest.main()

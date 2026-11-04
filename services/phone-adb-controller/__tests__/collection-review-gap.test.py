"""新维护隔离不能复活旧run，也不能接纳旧journal或别的设备变化。"""
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('collection_gap_host',HERE/'collection-review-maintenance-host.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
m=h.m

class GapEvidenceTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name).resolve();self.root.chmod(0o700)
        self.old={'id':m.SCOPE['task_id'],'status':'failed','completed_at':'2026-11-04T05:25:41.289Z','claimed_by':None,
          'result':{'lease_expired':{'at':'2026-11-04T05:25:41.286Z','source':'claim','claimer':'interactive-leadgen-validation-75f3','lease_until':'2026-11-04T05:25:21.939Z','heartbeat_count':0}}}
        self.maintenance={**m.TASK,'payload':{'headed_manual':'true'}}
        self.free={'device_name':m.SCOPE['serial'],'locked_by':None,'locked_at':None,'expires_at':None,'expired':False}
        self.other={'device_name':'ANGYVB4227006983','locked_by':'foreign','locked_at':'2026-11-04T06:00:00Z','expires_at':'2026-11-04T10:00:00Z','expired':False}
        self.lease={**self.free,'locked_by':m.TASK['id'],'locked_at':'2026-11-04T08:00:00Z','expires_at':'2026-11-04T08:50:00Z'}
        self.records={
          'history-last.json':{'independent_readback':{'lock':{**self.free,'locked_by':m.SCOPE['task_id'],'expires_at':'2026-11-04T05:17:26.274Z'}}},
          'history-first-null.json':{'health':{'timestamp':'2026-11-04T06:32:47.413Z'},'locks':{'locks':[self.free]},'old102':self.old},
          'old-task.json':self.old,'maintenance-task.json':self.maintenance,
          'locks-before.json':{'locks':[self.free,self.other]},
          'acquire-request.json':{'device_name':m.SCOPE['serial'],'locked_by':m.TASK['id'],'ttl_minutes':50},
          'acquire-ack.json':{'acquired':True,'lock':self.lease},
          'locks-after.json':{'locks':[self.other,self.lease]},'locks-confirm.json':{'locks':[self.lease,self.other]}}
        self.records=json.loads(json.dumps(self.records))
        self.manifest={'version':1,'kind':'collection-review-new-isolation-after-gap-v1','scope':m.SCOPE,'maintenance':m.TASK,'continuous_central_isolation_proven':False,'files':{}}
        self.path=self.root/'authorization.json';self.save()
        history={n:self.manifest['files'][n] for n in ['history-last.json','history-first-null.json']}
        self.addCleanup(patch.stopall)
        patch.object(h,'HISTORY_SHA256',history,create=True).start()
        patch.object(h,'now_ms',return_value=m.ms('2026-11-04T08:05:00Z'),create=True).start()
    def save(self):
        for name,value in self.records.items():
            p=self.root/name;p.write_bytes(m.canonical(value));p.chmod(0o600)
            self.manifest['files'][name]=m.sha(p.read_bytes())
        self.path.write_bytes(m.canonical(self.manifest));self.path.chmod(0o600)
    def verify(self):return h.gap_evidence(self.path)
    def test_accepts_new_owner_and_binds_every_raw_record_without_claiming_continuity(self):
        proof=self.verify()
        self.assertEqual(proof['maintenance_lease']['locked_by'],m.TASK['id'])
        self.assertEqual(proof['original_scope'],m.SCOPE)
        self.assertFalse(proof['continuous_central_isolation_proven'])
        self.assertEqual(proof['manifest_sha256'],m.sha(self.path.read_bytes()))
        self.assertEqual(proof['files'],self.manifest['files'])
    def test_old_owner_new_owner_conflict_or_acquire_denial_rejected(self):
        baseline=copy.deepcopy(self.records)
        for record,key,value in [('acquire-request.json','locked_by',m.SCOPE['task_id']),('acquire-ack.json','acquired',False)]:
            self.records=copy.deepcopy(baseline);self.records[record][key]=value;self.save()
            with self.subTest(record=record),self.assertRaises(ValueError):self.verify()
        self.records=copy.deepcopy(baseline);self.records['locks-before.json']['locks'][0]['locked_by']='unexpected';self.save()
        with self.assertRaises(ValueError):self.verify()
    def test_old_failure_or_original_claim_changes_rejected(self):
        baseline=copy.deepcopy(self.records)
        for name,key,value in [('old-task.json','status','in_progress'),('old-task.json','completed_at','2026-11-04T09:00:00Z'),('maintenance-task.json','claimed_at','new')]:
            self.records=copy.deepcopy(baseline);self.records[name][key]=value;self.save()
            with self.subTest(name=name,key=key),self.assertRaises(ValueError):self.verify()
    def test_other_device_drift_or_duplicate_serial_or_unconfirmed_epoch_rejected(self):
        baseline=copy.deepcopy(self.records)
        for change in ['foreign','duplicate','epoch']:
            self.records=copy.deepcopy(baseline)
            if change=='foreign':self.records['locks-confirm.json']['locks'][1]['locked_by']='changed'
            if change=='duplicate':self.records['locks-confirm.json']['locks'].append(self.lease)
            if change=='epoch':self.records['locks-confirm.json']['locks'][0]['locked_at']='2026-11-04T08:01:00Z'
            self.save()
            with self.subTest(change=change),self.assertRaises(ValueError):self.verify()
    def test_rewritten_raw_manifest_and_gap_continuity_claim_rejected(self):
        (self.root/'acquire-ack.json').write_bytes(b'{}')
        with self.assertRaises(ValueError):self.verify()
        self.save();self.manifest['continuous_central_isolation_proven']=True;self.save()
        with self.assertRaises(ValueError):self.verify()
    def test_symlink_or_writable_evidence_rejected(self):
        p=self.root/'locks-before.json';p.chmod(0o666)
        with self.assertRaises(ValueError):self.verify()
        self.save();p.unlink();p.symlink_to(self.root/'locks-after.json')
        with self.assertRaises((ValueError,OSError)):self.verify()
    def test_central_rechecks_live_maintenance_owner_epoch_and_expiry(self):
        proof=self.verify()
        for live in [self.lease,{**self.lease,'expires_at':'2026-11-04T09:00:00Z'}]:
            with patch.object(h,'brain',return_value={'locks':[live]}):
                self.assertEqual(h.central(self.root,proof),proof['maintenance_lease'])
        for live in [{**self.lease,'locked_by':m.SCOPE['task_id']},{**self.lease,'locked_at':'2026-11-04T08:01:00Z'},{**self.lease,'expires_at':'2026-11-04T08:04:00Z'},{**self.lease,'expired':True}]:
            with self.subTest(live=live),patch.object(h,'brain',return_value={'locks':[live]}),self.assertRaises(ValueError):h.central(self.root,proof)
    def test_real_admission_binds_gap_and_live_old_failure_before_any_phone(self):
        def api(home,path):
            if path.endswith('/tasks/'+m.TASK['id']):return self.maintenance
            if path.endswith('/tasks/'+m.SCOPE['task_id']):return self.old
            if path.endswith('/device-locks'):return {'locks':[self.lease,self.other]}
            raise AssertionError(path)
        with patch.object(h,'brain',side_effect=api),patch.object(h,'quiet',return_value={'cron':'frozen'}),patch.object(h,'candidate',return_value={'source_commit':'a'*40}),patch.object(h.m,'verify_original',return_value={'execution_stopped':False,'leaves':1486}),patch.object(h,'quiet_recorders'),patch.object(h.m,'legacy_record'):
            proof,_=h.admission(self.root,'a'*40,'release',self.path)
            self.assertEqual(proof['central_lease']['locked_by'],m.TASK['id'])
            self.assertEqual(proof['scope']['task_id'],m.SCOPE['task_id'])
            self.assertEqual(proof['acquisition_gap'],self.verify())
            self.old['status']='in_progress'
            with self.assertRaisesRegex(ValueError,'OLD_TASK_TERMINAL'):h.admission(self.root,'a'*40,'release',self.path)
    def test_gap_manifest_change_cannot_adopt_old_snapshot_or_journal(self):
        from types import SimpleNamespace
        proof=self.verify();directory=self.root/'journal';directory.mkdir(mode=0o700)
        identity={'source_commit':'b'*40,'files':{'collection-review-maintenance-contract.json':'c'*64}}
        auth={'acquisition_gap':proof}
        inventory=h.snapshot_value(SimpleNamespace(target_identity=[1,2,3,4],legacy_snapshot=m.CONTRACT['lock_state']['legacy']),auth,identity)
        h.phone_module.atomic_new(directory/h.SNAPSHOT,inventory)
        self.assertEqual(h.saved_snapshot(directory,auth,identity)[0],inventory)
        changed=copy.deepcopy(auth);changed['acquisition_gap']['manifest_sha256']='0'*64
        with self.assertRaisesRegex(ValueError,'SAVED_SNAPSHOT_BINDING'):h.saved_snapshot(directory,changed,identity)
        (directory/h.SNAPSHOT).unlink();(directory/'cleanup-intent.json').write_text('{}')
        with self.assertRaisesRegex(ValueError,'SNAPSHOT_MISSING_WITH_JOURNAL'):h.saved_snapshot(directory,auth,identity)
    def test_no_gap_proof_cannot_enter_phone_or_guards(self):
        with patch.object(h,'quiet') as q,patch.object(h.phone_module,'Phone') as p,patch.object(h.m,'OwnedGuards') as g:
            with self.assertRaises(ValueError):h.admission(self.root,'a'*40,'00000000-0000-0000-0000-000000000000')
            q.assert_not_called();p.assert_not_called();g.assert_not_called()

if __name__=='__main__':unittest.main()

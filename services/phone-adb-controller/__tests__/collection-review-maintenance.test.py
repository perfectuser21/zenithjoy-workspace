"""102专用历史请求域及单owner维护：不得把业务code1或旧false洗绿。"""
import importlib.util
import json
import os
import sys
from pathlib import Path
import unittest

HERE=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('collection_review',HERE/'collection-review-maintenance.py')
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def leaf(code=0):
    i={'sequence':1,'argv_sha256':'a'*64,'intent_at':10,'boundary':'darwin-sandbox-deny-process-fork-v1'}
    s={**i,'pid':123,'started_at':11}
    return [{**i,'phase':'intent'},{**s,'phase':'started'},{**s,'phase':'exit','ended_at':12,'code':code,'signal':None,'tainted':False,'request_returned':True}]

class RequestDomainTest(unittest.TestCase):
    def verify(self,rows):
        return m.verify_leaf_log(''.join(json.dumps(x)+'\n' for x in rows))
    def test_business_failure_returned_never_means_complete(self):
        for code in [0,1]:
            r=self.verify(leaf(code));self.assertEqual(r['leaves'],1);self.assertTrue(r['requests_returned'])
            self.assertFalse(r['execution_stopped']);self.assertEqual(r['code_failures'],code)
    def test_missing_duplicate_signal_taint_unknown_and_scope_changes_fail(self):
        r=leaf()
        for rows in [r[:-1],r+r,[*r,{'phase':'unknown'}],[r[0],{**r[1],'pid':999},r[2]],
                     [*r[:-1],{**r[-1],'signal':'SIGKILL'}],[*r[:-1],{**r[-1],'tainted':True}],
                     [*r[:-1],{**r[-1],'request_returned':False}],[*r[:-1],{**r[-1],'code':137}],
                     [*r[:-1],{**r[-1],'ended_at':9}]]:
            with self.subTest(rows=rows),self.assertRaises(ValueError):self.verify(rows)
    def test_exact_new102_scope_and_new_maintenance_claim(self):
        self.assertEqual(m.SCOPE['owner'],'ys20261103235714_102')
        self.assertEqual(m.SCOPE['task_id'],'6ca6e356-d63b-4a1f-92b7-9f5a7798b916')
        task={**m.TASK,'payload':{'headed_manual':'true'}};m.verify_task(task)
        for k in m.TASK:
            with self.subTest(key=k),self.assertRaises(ValueError):m.verify_task({**task,k:'foreign'})
    def test_phone_cleanup_is_fixed_and_never_business_or_shared_restart(self):
        commands=m.cleanup_commands()
        self.assertEqual(commands[:2],[['shell','am','force-stop','com.ss.android.ugc.aweme'],['shell','input','keyevent','3']])
        for args in commands:
            self.assertNotIn('kill-server',args);self.assertNotIn('start-server',args)
            self.assertNotIn('text',args);self.assertNotIn('tap',args)

@unittest.skipUnless(os.environ.get('COLLECTION_REVIEW_ORIGINAL_FIXTURE'),'受控真实102副本')
class OriginalTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name).resolve()/'run';shutil.copytree(os.environ['COLLECTION_REVIEW_ORIGINAL_FIXTURE'],self.root,symlinks=True)
        self.runtime=self.root/'runtime'
    def test_actual_1486_returned_leaves_with_16_business_failures(self):
        r=m.verify_original(self.root,runtime_root=self.runtime)
        self.assertEqual(r['leaves'],1486);self.assertEqual(r['code_failures'],16)
        self.assertTrue(r['requests_returned']);self.assertFalse(r['execution_stopped'])


    def test_every_fixed_original_hash_rejects_mutation(self):
        root=self.root
        for name in m.CONTRACT['original_files']:
            p=root/name;raw=p.read_bytes()
            try:
                p.write_bytes(raw+b' ')
                with self.subTest(name=name),self.assertRaisesRegex(ValueError,'ORIGINAL_HASH'):
                    m.verify_original(root,runtime_root=self.runtime)
            finally:p.write_bytes(raw)
    def test_extra_scope_and_unknown_native_are_rejected(self):
        root=self.root;runtime=self.runtime
        extra=root/'collection-phone-scopes/foreign';extra.mkdir()
        try:
            with self.assertRaisesRegex(ValueError,'SCOPE_SET'):m.verify_original(root,runtime_root=runtime)
        finally:extra.rmdir()
        marker=root/'native-operations/foreign.unknown';marker.write_bytes(b'unknown')
        try:
            with self.assertRaisesRegex(ValueError,'NATIVE_SET'):m.verify_original(root,runtime_root=runtime)
        finally:marker.unlink()

# 真实文件guard/CAS；只替换生产固定根映射与合同，不接手机。
import copy
import shutil
import subprocess
import tempfile
from unittest.mock import patch

class ExactLockTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.home=Path(self.tmp.name).resolve();self.old=self.home/'legacy';self.durable=self.home/'durable'
        self.old.mkdir(mode=0o700);self.durable.mkdir(mode=0o700)
        names=['ANGYVB4227006983','ANGYVB4311010223','ANGYVB4402004137','47.100.213.173:10001','e6c7ef34']
        for root in [self.old,self.durable]:
            for n in names:(root/(n+'.guard')).write_bytes(b'')
            for n in [names[0],names[2]]:self.owner(root/(n+'.lock'),'other-'+n)
        self.owner(self.durable/(m.SCOPE['serial']+'.lock'),m.SCOPE['owner'])
        self.owner(self.durable/'.review-retired-prior101','ys261104032759_101')
        marker={'schema_version':1,'state':'complete','source_sha256':'a'*64,'legacy_root':str(self.old)}
        (self.durable/m.locks.MARKER).write_text(json.dumps(marker))
        record={'legacy':m.locks.inventory(self.old),'durable':m.locks.inventory(self.durable),'guards':{str(p):[p.stat().st_dev,p.stat().st_ino,p.stat().st_ctime_ns] for p in sorted([*self.old.glob('*.guard'),*self.durable.glob('*.guard')])}}
        contract=copy.deepcopy(m.CONTRACT);contract['lock_state']=record
        for ctx in [patch.object(m,'CONTRACT',contract),patch.object(m,'lock_paths',return_value=(self.old,self.durable,{})),patch.object(m.maintenance,'verify_legacy_binding',lambda _:None)]:ctx.start();self.addCleanup(ctx.stop)
    def owner(self,path,owner):
        path.mkdir(mode=0o700)
        for name,value in [('owner',owner+'\n'),('standalone_review_required',owner+'\n'),('acquired_at','123\n')]:
            (path/name).write_text(value);(path/name).chmod(0o600)
    def test_exact_single_directory_retirement_preserves_prior101_and_reenters(self):
        baseline=m.locks.inventory(self.old);prior=m.locks.inventory(self.durable/'.review-retired-prior101')
        with m.OwnedGuards(self.home) as g:r=g.retire(lambda:None)
        self.assertTrue(r['released']);self.assertFalse(r['central_lease_released'])
        self.assertEqual(m.locks.inventory(self.old),baseline)
        self.assertEqual(m.locks.inventory(self.durable/'.review-retired-prior101'),prior)
        self.assertFalse((self.durable/(m.SCOPE['serial']+'.lock')).exists())
        with m.OwnedGuards(self.home) as g:self.assertFalse(g.verify());self.assertTrue(g.retire(lambda:None)['released'])
    def test_extra_owner_or_changed_other_owner_denied(self):
        self.owner(self.durable/'foreign.lock','foreign')
        with self.assertRaisesRegex(ValueError,'LOCK_INVENTORY'):
            with m.OwnedGuards(self.home):pass
    def test_replaced_guard_and_target_directory_denied(self):
        with m.OwnedGuards(self.home) as g:
            target=g.target
            def replace():
                copy_path=self.home/'replacement';shutil.copytree(target,copy_path);shutil.rmtree(target);copy_path.rename(target)
            with self.assertRaisesRegex(ValueError,'TARGET_INODE'):g.retire(replace)
        self.assertTrue((self.durable/(m.SCOPE['serial']+'.lock')).exists())
    def test_guard_replacement_denied_before_phone_or_rename(self):
        p=next(self.old.glob('*.guard'));p.unlink();p.write_bytes(b'')
        with self.assertRaisesRegex(ValueError,'GUARD_IDENTITY'):
            with m.OwnedGuards(self.home):pass

    def test_crash_immediately_after_real_rename_keeps_exact_archive_and_readonly_reentry(self):
        rename=os.rename
        def fail_after(source,target):rename(source,target);raise OSError('injected after rename')
        with m.OwnedGuards(self.home) as g:
            with patch.object(os,'rename',side_effect=fail_after),self.assertRaisesRegex(OSError,'after rename'):g.retire(lambda:None)
        self.assertFalse((self.durable/(m.SCOPE['serial']+'.lock')).exists())
        self.assertTrue((self.durable/m.ARCHIVE).is_dir())
        with m.OwnedGuards(self.home) as g:self.assertFalse(g.verify())

phone_spec=importlib.util.spec_from_file_location('collection_review_phone',HERE/'collection-review-maintenance-phone.py')
phone=importlib.util.module_from_spec(phone_spec);phone_spec.loader.exec_module(phone)
class CleanupIntentTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.d=Path(self.tmp.name).resolve()
        self.p=phone.Phone.__new__(phone.Phone);self.p.events=[];self.calls=[]
        self.p.command=lambda args:self.calls.append(args)
        self.p.home_state=lambda:{'home':True,'launcher':'com.example.home'}
    def test_finite_cleanup_has_two_independent_inputs_and_durable_intent(self):
        self.p.cleanup(self.d,'a'*64,lambda:None)
        self.assertEqual(self.calls,m.cleanup_commands())
        intent=json.loads((self.d/'cleanup-intent.json').read_text());result=json.loads((self.d/'cleanup-result.json').read_text())
        self.assertEqual(intent['scope'],m.SCOPE);self.assertTrue(result['requests_returned']);self.assertFalse(result['execution_stopped'])
        self.assertEqual(result['intent_sha256'],m.sha((self.d/'cleanup-intent.json').read_bytes()))
    def test_timeout_crash_unknown_intent_never_resends(self):
        def fail(args):self.calls.append(args);raise ValueError('COLLECTION_REVIEW_CLEANUP_LEAF_TIMEOUT')
        self.p.command=fail
        with self.assertRaisesRegex(ValueError,'TIMEOUT'):self.p.cleanup(self.d,'a'*64,lambda:None)
        self.assertTrue((self.d/'cleanup-intent.json').exists());self.assertFalse((self.d/'cleanup-result.json').exists())
        with self.assertRaisesRegex(ValueError,'READBACK_ONLY'):self.p.cleanup(self.d,'a'*64,lambda:None)
        self.assertEqual(len(self.calls),1)
    def test_admission_drift_before_intent_never_sends(self):
        def fail():raise ValueError('claim changed')
        with self.assertRaises(ValueError):self.p.cleanup(self.d,'a'*64,fail)
        self.assertEqual(self.calls,[]);self.assertFalse((self.d/'cleanup-intent.json').exists())

@unittest.skipUnless(sys.platform=='darwin','真实Darwin nofork边界')
class NativeCleanupBoundaryTest(unittest.TestCase):
    def test_actual_nofork_client_returns_and_cannot_fork(self):
        with tempfile.TemporaryDirectory() as td:
            d=Path(td).resolve();c=d/'client.c';binary=d/'client'
            c.write_text('#include <stdio.h>\n#include <string.h>\n#include <unistd.h>\n#include <errno.h>\nint main(int n,char**a){if(n>1&&!strcmp(a[n-1],"fork")){int p=fork();if(p<0){fprintf(stderr,"fork_denied=%d",errno);return 77;}return 0;}puts("finite returned");return 0;}\n')
            subprocess.run(['cc',str(c),'-o',str(binary)],capture_output=True,check=True)
            env={'PATH':'/usr/bin:/bin:/usr/sbin:/sbin','HOME':str(d)}
            phone.sandbox_verified(env)
            raw,event=phone.leaf(binary,['shell','am','force-stop','com.ss.android.ugc.aweme'],env,m.sha(binary.read_bytes()))
            self.assertIn(b'finite returned',raw);self.assertEqual(event['code'],0);self.assertLessEqual(event['started_at'],event['ended_at'])
            with self.assertRaisesRegex(ValueError,'LEAF_UNVERIFIED'):phone.leaf(binary,['fork'],env,m.sha(binary.read_bytes()))

    def test_actual_finite_cleanup_to_native_home_png_xml_and_no_resend(self):
        import base64
        from types import SimpleNamespace
        fixture=json.loads((Path(__file__).parent/'fixtures/discovery-desktop-android15.json').read_text())
        with tempfile.TemporaryDirectory() as td:
            d=Path(td).resolve();c=d/'client.c';binary=d/'client';journal=d/'journal';journal.mkdir(mode=0o700)
            png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9FoAAAAASUVORK5CYII=')
            source='#include <stdio.h>\n#include <string.h>\n#include <stdlib.h>\n#include <unistd.h>\nint main(int n,char**a){char p[4096];snprintf(p,sizeof p,"%s/phone-home",getenv("HOME"));char calls[4096];snprintf(calls,sizeof calls,"%s/calls",getenv("HOME"));FILE*f=fopen(calls,"a");if(!f)return 9;fputs("call\\n",f);fclose(f);'
            source+='if(!strcmp(a[n-1],"android.intent.category.HOME")){fputs('+json.dumps(fixture['home'])+',stdout);return 0;}'
            source+='if(!strcmp(a[n-1],"displays")){fputs(access(p,F_OK)==0?'+json.dumps(fixture['focus'])+':'+json.dumps(fixture['focus'].replace('com.hihonor.android.launcher/','com.ss.android.ugc.aweme/'))+',stdout);return 0;}'
            source+='if(!strcmp(a[n-1],"3")){FILE*g=fopen(p,"w");if(!g)return 8;fputs("home",g);fclose(g);return 0;}'
            source+='if(!strcmp(a[n-1],"size")){puts("Physical size: 1x1");return 0;}'
            source+='for(int i=1;i<n;i++){if(!strcmp(a[i],"screencap")){unsigned char b[]={'+','.join(str(b) for b in png)+'};fwrite(b,1,sizeof b,stdout);return 0;}if(!strcmp(a[i],"cat")){fputs("<hierarchy><node package=\\"com.hihonor.android.launcher\\" /></hierarchy>",stdout);return 0;}}puts("ok");return 0;}\n'
            c.write_text(source);subprocess.run(['cc',str(c),'-o',str(binary)],capture_output=True,check=True)
            p=phone.Phone.__new__(phone.Phone);p.home=d;p.original=d;p.binary=binary;p.port='12345';p.env={'PATH':'/usr/bin:/bin:/usr/sbin:/sbin','HOME':str(d)}
            p.policy={'endpoint':'tcp:127.0.0.1:12345','adb_sha256':m.sha(binary.read_bytes())};p.events=[]
            p.route=SimpleNamespace(select_existing_unique_route=lambda *_:None,read_host_policy=lambda:None)
            phone.sandbox_verified(p.env)
            self.assertFalse(p.home_state()['home'])
            state=p.cleanup(journal,'a'*64,lambda:None);self.assertTrue(state['home'])
            proof=p.capture_desktop(journal,state)
            self.assertEqual(proof['png_sha256'],m.sha((journal/'desktop.png').read_bytes()))
            self.assertEqual(proof['xml_sha256'],m.sha((journal/'desktop.xml').read_bytes()))
            self.assertGreater(len(proof['leaves']),6);self.assertTrue(all(e['code']==0 and e['boundary']=='darwin-sandbox-deny-process-fork-v1' for e in proof['leaves']))
            count=(d/'calls').read_text()
            with self.assertRaisesRegex(ValueError,'READBACK_ONLY'):p.cleanup(journal,'a'*64,lambda:None)
            self.assertEqual((d/'calls').read_text(),count)

class DesktopAdmissionTest(unittest.TestCase):
    def setUp(self):
        self.fixture=json.loads((Path(__file__).parent/'fixtures/discovery-desktop-android15.json').read_text())
    def state(self,focus=None,launcher=None):
        p=phone.Phone.__new__(phone.Phone)
        outputs=iter([(launcher if launcher is not None else self.fixture['home']).encode(),(focus if focus is not None else self.fixture['focus']).encode()])
        p.command=lambda _:next(outputs)
        return p.home_state()
    def test_android15_duplicate_same_home_package_remains_valid(self):
        self.assertEqual(self.fixture['home'].count('packageName='),2)
        self.assertTrue(self.state()['home'])
    def test_two_exact_aweme_indicators_are_only_nonhome_cleanup_admission(self):
        focus=self.fixture['focus'].replace('com.hihonor.android.launcher/','com.ss.android.ugc.aweme/')
        self.assertFalse(self.state(focus)['home'])
    def test_every_missing_duplicate_malformed_extra_or_mixed_focus_rejects(self):
        good=self.fixture['focus'].replace('com.hihonor.android.launcher/','com.ss.android.ugc.aweme/')
        bad=[good.replace('mFocusedApp=','mCurrentFocus='),good+' mCurrentFocus garbage\n',
             good+' mFocusedApp=unparseable\n',good.replace('mFocusedApp=','other='),
             good.replace('com.ss.android.ugc.aweme/.unihome','foreign.package/.unihome'),
             good.replace(' t2274',' other.package/.Other t2274'),good.replace('u0 ','u10 '),
             good.replace('ActivityRecord{','SomethingElse{')]
        for value in bad:
            with self.subTest(focus=value),self.assertRaises(ValueError):self.state(value)
        for home in [self.fixture['home']+' packageName garbage\n',self.fixture['home']+' packageName=foreign.package\n']:
            with self.subTest(home=home),self.assertRaises(ValueError):self.state(launcher=home)

host_spec=importlib.util.spec_from_file_location('collection_review_host',HERE/'collection-review-maintenance-host.py')
host=importlib.util.module_from_spec(host_spec);host_spec.loader.exec_module(host)
class HostAdmissionTest(unittest.TestCase):
    def test_unknown_action_rejects_before_any_observation(self):
        with patch.object(host,'admission') as admission:
            with self.assertRaises(ValueError):host.execute('release-any',Path('/home/service'),'a'*40,'release')
            admission.assert_not_called()
    def test_original_or_claim_failure_never_enters_guards_or_phone(self):
        with patch.object(host,'admission',side_effect=ValueError('source changed')),patch.object(host.m,'OwnedGuards') as guards,patch.object(host.phone_module,'Phone') as p:
            with self.assertRaises(ValueError):host.execute('apply',Path('/home/service'),'a'*40,'release')
            guards.assert_not_called();p.assert_not_called()
    def test_plan_reads_only_and_never_creates_intent_or_sends_cleanup(self):
        with tempfile.TemporaryDirectory() as td:
            home=Path(td).resolve();authorization={'scope':m.SCOPE}
            with patch.object(host,'admission',return_value=(authorization,home)),patch.object(host.m,'OwnedGuards') as factory,patch.object(host.phone_module,'Phone') as p,patch.object(host,'private_directory') as private:
                factory.return_value.__enter__.return_value.verify.return_value=True
                p.return_value.home_state.return_value={'home':False}
                self.assertTrue(host.execute('plan',home,'a'*40,'release')['needs_new_cleanup'])
                p.return_value.cleanup.assert_not_called();p.return_value.command.assert_not_called();private.assert_not_called()

    def test_crash_after_rename_reconciles_from_exact_prerecord_without_phone_or_second_rename(self):
        with tempfile.TemporaryDirectory() as td:
            home=Path(td).resolve();authorization={'scope':m.SCOPE}
            directory=home/'.config/zenithjoy'/('collection-review-maintenance-'+m.TASK['id']);directory.mkdir(parents=True,mode=0o700)
            png=b'private prior verified PNG';xml=b'<hierarchy />'
            (directory/'desktop.png').write_bytes(png);(directory/'desktop.xml').write_bytes(xml)
            for p in directory.iterdir():p.chmod(0o600)
            inode=[1,2,3,4]
            retirement={'source':m.SCOPE['serial']+'.lock','target':m.ARCHIVE,'before_sha256':m.sha(m.canonical(m.CONTRACT['lock_state']['durable'])),'after_sha256':m.sha(m.canonical(m.primitives.changed_inventory(m.CONTRACT['lock_state']['durable'],m.SCOPE['serial']+'.lock',m.ARCHIVE)))}
            saved={'scope':m.SCOPE,'maintenance':m.TASK,'owner_inode':inode,'retirement':retirement,'admission_sha256':m.sha(m.canonical(authorization)),'execution_stopped':False,'original_business_status':'failed',
                   'desktop':{'home':{'home':True},'png_sha256':m.sha(png),'xml_sha256':m.sha(xml),'leaves':[{'code':0,'boundary':'darwin-sandbox-deny-process-fork-v1','pid':321,'intent_at':1,'started_at':2,'ended_at':3}]}}
            phone.atomic_new(directory/'pre-retirement.json',saved)
            with patch.object(host,'admission',return_value=(authorization,home)),patch.object(host.m,'OwnedGuards') as factory,patch.object(host.phone_module,'Phone') as p,patch.object(os,'rename') as rename:
                g=factory.return_value.__enter__.return_value;g.verify.return_value=False;g.target_identity=inode
                result=host.execute('apply',home,'a'*40,'release')
                self.assertTrue(result['released']);self.assertFalse(result['execution_stopped']);self.assertFalse(result['replayed_inputs'])
                self.assertTrue((directory/'completion.json').exists());p.assert_not_called();rename.assert_not_called()
                self.assertEqual(host.execute('apply',home,'a'*40,'release'),result)
                (directory/'desktop.png').write_bytes(b'changed')
                with self.assertRaisesRegex(ValueError,'PRE_RETIREMENT_EVIDENCE'):host.execute('apply',home,'a'*40,'release')
                (directory/'desktop.png').write_bytes(png)
                (directory/'completion.json').unlink();g.target_identity=[1,2,3,999]
                with self.assertRaisesRegex(ValueError,'INODE_OR_CAS'):host.execute('apply',home,'a'*40,'release')
                p.assert_not_called();rename.assert_not_called()

class RecorderGateTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name).resolve()
        self.evidence=self.root/'evidence';self.evidence.mkdir(mode=0o700);st=self.evidence.stat()
        entry={'path':str(self.evidence),'type':'directory','dev':st.st_dev,'ino':st.st_ino,'uid':st.st_uid,'mode':st.st_mode}
        scope={'evidence_identity':{'canonical_root':str(self.evidence),'entries':[entry]}}
        (self.root/'run-definition.json').write_text(json.dumps({'collection_phone_scope':scope}))
    def test_dead_regular_recorder_pid_allowed_but_symlink_even_to_dead_pid_rejected(self):
        dead=self.root/'dead';dead.write_text('99999999');dead.chmod(0o600)
        link=self.evidence/'old.rec.pid';link.symlink_to(dead)
        with self.assertRaisesRegex(ValueError,'RECORDER_FILE'):host.quiet_recorders(self.root)
        link.unlink();link.write_text('99999999');link.chmod(0o600);host.quiet_recorders(self.root)
    def test_live_recorder_pid_rejects(self):
        p=self.evidence/'live.rec.pid';p.write_text(str(os.getpid()));p.chmod(0o600)
        with self.assertRaisesRegex(ValueError,'RECORDER_ACTIVE'):host.quiet_recorders(self.root)

if __name__=='__main__':unittest.main()

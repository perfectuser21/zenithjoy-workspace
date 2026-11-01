import test from 'node:test';
import assert from 'node:assert/strict';
import {inheritedDeploymentStdio,verifyTransactionProtocol,restorationPlan} from '../deployment-protocol.mjs';

test('deployer v1 is required from fixed candidate source before production writing',()=>{
 assert.equal(verifyTransactionProtocol(Buffer.from('{"protocol":"phone-package-transaction-v1"}')),true);
 for(const value of ['{}','{"protocol":"unknown"}','{"protocol":"phone-package-transaction-v1","force":true}'])
  assert.throws(()=>verifyTransactionProtocol(Buffer.from(value)),/protocol/);
});

test('transport lock and response descriptors survive nested Node child launch',()=>{
 const stdio=inheritedDeploymentStdio({WF_DEPLOY_LOCK_FD:'4',WF_DEPLOY_RESPONSE_FD:'7'});
 assert.equal(stdio[4],4);assert.equal(stdio[7],7);assert.equal(stdio[0],'ignore');
 for(const value of ['1','0','-1','x','9999'])assert.throws(()=>inheritedDeploymentStdio({WF_DEPLOY_LOCK_FD:value,WF_DEPLOY_RESPONSE_FD:'7'}),/descriptor/);
 assert.throws(()=>inheritedDeploymentStdio({WF_DEPLOY_LOCK_FD:'4',WF_DEPLOY_RESPONSE_FD:'4'}),/descriptor/);
});

test('restore binds native original release IDs and source; never constructs a new release',()=>{
 const records=Object.fromEntries(['mmv','xian-m4'].map(target=>[target,{id:target,environment:'production',target,payload:{components:[{kind:'repo',repo:'perfectuser21/zenithjoy-workspace',revision:'a'.repeat(40)}],workflows:[{payload:{key:'a'},payload_sha256:'b'}]}}]));
 const manifests=Object.fromEntries(Object.keys(records).map(target=>[target,{release_id:target,source_repo:'perfectuser21/zenithjoy-workspace',source_commit:'a'.repeat(40)}]));
 const plan=restorationPlan(records,manifests);
 assert.deepEqual(plan.release_ids,{'mmv':'mmv','xian-m4':'xian-m4'});
 assert.equal(plan.source_commit,'a'.repeat(40));
 manifests.mmv.source_commit='c'.repeat(40);
 assert.throws(()=>restorationPlan(records,manifests),/source/);
});


test('backend rejects drift in every execution helper before guard or remote activity',async t=>{
 const {mkdtempSync,cpSync,rmSync,readFileSync,writeFileSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const {execFileSync}=await import('node:child_process');
 const {runPackageTransaction}=await import('../deployment-backend.mjs');
 const root=mkdtempSync(join(tmpdir(),'phone-backend-source-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const relative='services/phone-adb-controller',folder=join(root,relative);
 cpSync(new URL('../',import.meta.url),folder,{recursive:true});
 const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');git('add',relative);git('-c','user.name=Regression','-c','user.email=regression@example.invalid','commit','-qm','fixed source');
 const sha=git('rev-parse','HEAD');
 for(const name of ['deployment-preflight.mjs','deployment-targets.mjs','deployment-fixed-source.mjs','runtime-definition.mjs',
  'deployment-release.mjs','deployment-business-admission.mjs','company-config-readiness.mjs','company-config-lib.js','line-routes.js',
  'runtime-host.mjs','runtime-release.mjs','runtime-outbox.mjs','deployment-guard.py','deployment-installed.py',
  'deployment-candidate-fence.py','phone-lock-root.py','commander/wf-v2-io.py','drift-check.sh']){
  await t.test(name,async()=>{
   const path=join(folder,name),before=readFileSync(path);
   writeFileSync(path,Buffer.concat([before,Buffer.from('\n# accidental working-copy drift\n')]));
   try{await assert.rejects(runPackageTransaction({root,sha}),/部署工作区字节漂移/);}
   finally{writeFileSync(path,before);}
  });
 }
});


test('恢复实际持久descriptor/journal：未知事务、错SHA和双机身份错配均拒绝',async t=>{
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {execFileSync}=await import('node:child_process');
 const {verifyRecoveryDescriptor,verifyRecoveryJournal}=await import('../deployment-backend.mjs');
 const home=mkdtempSync(join(tmpdir(),'phone-original-descriptor-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const tx='phone-original',sha='b'.repeat(40),old='a'.repeat(40),ids={'xian-m4':'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',mmv:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},prior={'xian-m4':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',mmv:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'};
 const descriptor={schema_version:1,transaction:tx,source_commit:sha,plan:{source_commit:sha,release_ids:ids},previous_plan:{source_commit:old,release_ids:prior}};
 const code=`import importlib.util,json,sys\nfrom pathlib import Path\nhome=Path(sys.argv[1]).resolve();source=Path(sys.argv[2]);x=json.load(sys.stdin)\ndef module(name):\n s=importlib.util.spec_from_file_location(name,source/('deployment-'+name+'.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m\nhost=module('host');tx=module('transaction');d=x['descriptor'];tid=d['transaction'];host.record(home,tid,'coordinator',d,None)\nidentity={'target':'xian-m4','source_commit':d['source_commit'],'previous_source_commit':d['previous_plan']['source_commit'],'release_id':d['plan']['release_ids']['xian-m4'],'previous_release_id':d['previous_plan']['release_ids']['xian-m4']}\n(home/'bin-harvest').mkdir();tx.prepare(home,tid,[{'path':'bin-harvest/a.js','after':{'kind':'missing'}}],identity)\nprint(json.dumps({'descriptor':host.record(home,tid,'coordinator'),'unknown':host.record(home,'unknown','coordinator'),'journal':tx.read_transaction(home,tid)}))\n`;
 const actual=JSON.parse(execFileSync('python3',['-c',code,home,new URL('../',import.meta.url).pathname],{input:JSON.stringify({descriptor}),encoding:'utf8'}));
 assert.deepEqual(verifyRecoveryDescriptor(actual.descriptor,sha,tx),descriptor);
 assert.throws(()=>verifyRecoveryDescriptor(actual.unknown,sha,'unknown'),/原始事务身份/);
 assert.throws(()=>verifyRecoveryDescriptor(actual.descriptor,'c'.repeat(40),tx),/原始事务身份/);
 assert.throws(()=>verifyRecoveryDescriptor(actual.descriptor,sha,'other'),/原始事务身份/);
 assert.deepEqual(verifyRecoveryJournal(descriptor,'xian-m4',actual.journal),actual.journal);
 for(const [key,value] of [['source_commit','c'.repeat(40)],['previous_source_commit',sha],['release_id',ids.mmv],['previous_release_id',prior.mmv],['target','mmv']])assert.throws(()=>verifyRecoveryJournal(descriptor,'xian-m4',{...actual.journal,identity:{...actual.journal.identity,[key]:value}}),/journal身份/);
 assert.throws(()=>verifyRecoveryJournal(descriptor,'mmv',actual.journal),/journal身份/);
});

test('安装已开始且真实持久journal缺失时拒绝恢复，不视为prepare失败',async t=>{
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {execFileSync}=await import('node:child_process');
 const {verifyRecoveryJournal}=await import('../deployment-backend.mjs');
 const home=mkdtempSync(join(tmpdir(),'phone-started-missing-journal-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const code=`import importlib.util,json,sys\nfrom pathlib import Path\np=Path(sys.argv[2])/'deployment-host.py';s=importlib.util.spec_from_file_location('host',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);home=Path(sys.argv[1]).resolve();m.record(home,'phone-started','started',True,None)\nprint(json.dumps({'started':m.record(home,'phone-started','started'),'journal':m.dispatch(home,'inspect',{'transaction':'phone-started'})}))\n`;
 const actual=JSON.parse(execFileSync('python3',['-c',code,home,new URL('../',import.meta.url).pathname],{encoding:'utf8'}));
 assert.equal(actual.started,true);assert.equal(actual.journal,null);
 for(const host of ['xian-m4','mmv'])assert.throws(()=>verifyRecoveryJournal({transaction:'phone-started'},host,actual.journal,actual.started),/已开始安装.*journal缺失/);
 assert.equal(verifyRecoveryJournal({transaction:'phone-started'},'mmv',null,false),null);
});

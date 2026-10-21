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
  'runtime-host.mjs','runtime-release.mjs','runtime-outbox.mjs','deployment-guard.py','deployment-installed.py','commander/wf-v2-io.py','drift-check.sh']){
  await t.test(name,async()=>{
   const path=join(folder,name),before=readFileSync(path);
   writeFileSync(path,Buffer.concat([before,Buffer.from('\n# accidental working-copy drift\n')]));
   try{await assert.rejects(runPackageTransaction({root,sha}),/部署工作区字节漂移/);}
   finally{writeFileSync(path,before);}
  });
 }
});

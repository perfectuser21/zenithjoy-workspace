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

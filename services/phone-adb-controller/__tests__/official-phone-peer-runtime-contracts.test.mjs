import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,realpathSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import * as domain from '../leadgen-public-domain.mjs';
import * as runtime from '../official-phone-peer-runtime.mjs';
import {installPreflightPg,preflightPgDeployment,loadPreflightPg} from '../preflight-pg-dependencies.mjs';
test('remote finite partial只能凭当前client品牌及M4原finite判定进入独立验收',()=>{
 assert.equal(typeof domain.publicDomainFiniteEvidence,'function');const evidence={status:'partial',result:{stop_reason:'screen_limit'}};
 const discovery={discoveryFiniteStopEvidence:()=>null},activity={key:'collect_videos'};
 assert.equal(domain.publicDomainFiniteEvidence({activity,evidence,phonePeer:{isEvidence:()=>true,isFiniteEvidence:()=>true},discovery}),true);
 for(const peer of [{isEvidence:()=>false,isFiniteEvidence:()=>true},{isEvidence:()=>true,isFiniteEvidence:()=>false}])assert.equal(Boolean(domain.publicDomainFiniteEvidence({activity,evidence,phonePeer:peer,discovery})),false);
 assert.equal(Boolean(domain.publicDomainFiniteEvidence({activity,evidence:{...evidence,status:'failed'},phonePeer:{isEvidence:()=>true,isFiniteEvidence:()=>true},discovery})),false);
});
test('M4 fresh run从真实候选原件离线冻结PG，不能只copy snapshot.files',async t=>{
 assert.equal(typeof runtime.preparePhonePeerDependencies,'function');const root=realpathSync(mkdtempSync(join(tmpdir(),'peer-pg-freeze-')));t.after(()=>rmSync(root,{recursive:true,force:true}));const source=join(root,'source'),target=join(root,'runtime');mkdirSync(source,{mode:0o700});mkdirSync(target,{mode:0o700});const commit='a'.repeat(40),identity=await installPreflightPg({runtimeRoot:source,sourceCommit:commit});
 const frozen={deployment:{source_commit:commit},preflight_pg:identity.frozen},expectedDeployment=preflightPgDeployment({runtimeRoot:source,sourceCommit:commit});await runtime.preparePhonePeerDependencies({sourceRuntimeRoot:source,runtimeRoot:target,frozen,expectedDeployment});const pool=new (loadPreflightPg({runtimeRoot:target,frozen}).Pool)({max:1});await pool.end();assert.deepEqual(preflightPgDeployment({runtimeRoot:target,sourceCommit:commit}),expectedDeployment);
});

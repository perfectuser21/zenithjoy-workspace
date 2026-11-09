import test from 'node:test';
import assert from 'node:assert/strict';
import {readPublicDomainClaim} from '../public-domain-pg.mjs';

test('公共Task准入失败明确区分GET传输、HTTP与解析，保持拒绝且不重试',async t=>{
 const wire=Object.assign(Error('private-token-not-for-diagnostic'),{code:'ECONNRESET'});
 const cases=[
  {fetch:async()=>{throw wire;},code:'PUBLIC_DOMAIN_TASK_GET_TRANSPORT',cause:wire},
  {fetch:async()=>({ok:false,status:503}),code:'PUBLIC_DOMAIN_TASK_GET_HTTP'},
  {fetch:async()=>({ok:true,json:async()=>{throw wire;}}),code:'PUBLIC_DOMAIN_TASK_GET_BODY',cause:wire},
 ];
 for(const sample of cases){
  let calls=0;const mock=t.mock.method(globalThis,'fetch',async()=>{calls++;return sample.fetch();});
  try{await assert.rejects(()=>readPublicDomainClaim({identity:{task_id:'7037d210-2af1-4af9-8635-f93a805e58b6',run_binding:{}},env:{BRAIN_URL:'http://brain.test:5221',BRAIN_INTERNAL_TOKEN:'unit-only'}}),error=>error.message==='PUBLIC_DOMAIN_PG_SCOPE'&&error.code===sample.code&&error.cause===sample.cause);assert.equal(calls,1);}
  finally{mock.mock.restore();}
 }
});

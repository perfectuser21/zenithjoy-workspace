import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {digest} from '../runtime-definition.mjs';
import {workflowCommanderSession} from '../commander-owner-state.mjs';
import {authorityFixture} from './helpers/qualification-maintenance-fixture.mjs';
const api=await import('../qualification-maintenance-commander.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
function fixture(t) {
 const home=mkdtempSync(join(tmpdir(),'maintenance-owner-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const {scope}=authorityFixture(),identity={run_id:'douyin_video_processing-'+scope.run_tag+'__a1',binding_id:scope.binding_id,source_commit:scope.consumer_source,task_id:null};
 const session=workflowCommanderSession(identity),dir=join(home,'.openclaw','leadgen-owner-turns');mkdirSync(dir,{recursive:true,mode:0o700});
 const prefix=session.split(':').at(-1)+'.pending.json';
 for(let i=0;i<5;i++){const nonce=randomUUID(),original=JSON.stringify({protocol:'commander-owner-turn-v1',session,...identity,transport_nonce:nonce,status:'reserved'});
  writeFileSync(join(dir,prefix+'.'+nonce+'.returned.original.json'),original,{mode:0o600});
  writeFileSync(join(dir,prefix+'.'+nonce+'.returned.json'),JSON.stringify({protocol:'commander-owner-turn-v1',session,...identity,transport_nonce:nonce,status:'returned',original_sha256:digest(original),response_sha256:'a'.repeat(64)}),{mode:0o600});}
 const get=async(method,params)=>method==='sessions.describe'?{session:null}:method==='chat.history'?{sessionKey:session,pendingInputs:{items:[],total:0},sessionInfo:{key:session,hasActiveRun:false,activeRunIds:[]}}:{sessions:[],count:0,totalCount:0,hasMore:false,nextOffset:null};
 return {home,scope,session,dir,prefix,get};
}
test('五个returned原件逐对核SHA与scope+official当前无活跃/排队/children，不写旧owner',async t=>{
 const f=fixture(t);assert.equal(typeof api?.readCommanderClosure,'function');const out=await api.readCommanderClosure(f.scope,{home:f.home,get:f.get});assert.equal(out.status,'verified_inactive');assert.equal(out.os_full_stop,false);assert.equal(out.returned_turns,5);
});
for(const kind of ['pending','archive_mismatch','active','queued','child','truncated'])test(kind+'不得当原Commander已收口',async t=>{
 const f=fixture(t);assert.equal(typeof api?.readCommanderClosure,'function');
 if(kind==='pending')writeFileSync(join(f.dir,f.prefix),'{}',{mode:0o600});
 if(kind==='archive_mismatch'){const name=(await import('node:fs')).readdirSync(f.dir).find(n=>n.endsWith('.returned.original.json'));writeFileSync(join(f.dir,name),'{}');}
 const get=async(method,params)=>{const r=await f.get(method,params);if(method==='chat.history'&&kind==='active')r.sessionInfo.hasActiveRun=true;if(method==='chat.history'&&kind==='queued')r.pendingInputs={items:[{id:'queued'}],total:1};if(method==='sessions.list'&&kind==='child'){r.sessions=[{key:'child'}];r.count=1;}if(method==='sessions.list'&&kind==='truncated')r.hasMore=true;return r;};
 await assert.rejects(api.readCommanderClosure(f.scope,{home:f.home,get}),/MAINTENANCE_/);
});

import test from 'node:test';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {validateInput} from './fixtures/collection-input-wrapper.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const vid='7707600173446204723',run='recovery-business',nick='真实客户';
function fixture(index=2){const root=mkdtempSync(join(tmpdir(),'recovery-slot-'));for(const d of ['native','receipts'])mkdirSync(join(root,d));const asset=(dir,name,value)=>{const path=join(root,dir,name),bytes=typeof value==='string'?value:JSON.stringify(value);writeFileSync(path,bytes);return {path,sha256:hash(bytes)};};const producer={task_id:'old-task',run_id:'old-run',run_tag:run};const manifest=asset('receipts','producer.json',{schema:'activity-evidence/v1',identity:{...producer,workflow:'102'}});const c={assigned_workflow:'102',comment_limit:1,tasks:{'102':{task_id:'new-task',run_id:'new-run',run_tag:run}},verification:{qualification_sha256:{'qualification-artifacts.mjs':hash(readFileSync(new URL('../qualification-artifacts.mjs',import.meta.url)))},'102':{video_ids:[vid]}},recovery:{mode:'qualification-readonly-v1',producer,producer_manifest:manifest,collection:{video_id:vid,person_index:2}}};
const profile_eid=run+'-v'+vid+'-collection-person'+index+'-t1',video_eid=run+'-v'+vid+'-collection-after-card'+index,started=Math.floor(Date.now()/1000)-1,identity=c.tasks['102'];const profile=asset('native',profile_eid+'-profile.xml','profile'),returned=asset('native',profile_eid+'-returned.xml','returned');const receipt=(name,args,stdout,start)=>asset('receipts',name,{state:'terminal',binding:{kind:'phone',activity:'collection',identity,args},started_at:start,ended_at:start+0.1,result:{exit_code:0,stdout}});const input={video_id:vid,nickname:nick,douyin_id:'user123',comment_body:'本地部署怎么做',profile_eid,video_eid,started_at_epoch_seconds:started,profile,returned,profile_receipt:receipt('profile.json',['commenter-identity','1','1',Buffer.from(nick).toString('base64'),profile_eid],`douyin_id=user123\nprofile_evidence=${profile.path}\nreturn_evidence=${returned.path}`,started),video_identity:receipt('video.json',['current-video-link',video_eid],'',started+1)};
return {root,c,input,cleanup:()=>rmSync(root,{recursive:true,force:true})};}
test('real wrapper admits only the newly frozen recovery slot while comment quota stays one',()=>{const f=fixture();try{assert.equal(validateInput(f.root,f.c,f.input).videoId,vid);assert.equal(f.c.comment_limit,1);}finally{f.cleanup();}});
test('wrapper fixture remains exact to the recorded real source extraction',()=>{const meta=JSON.parse(readFileSync(new URL('./fixtures/collection-input-wrapper.provenance.json',import.meta.url)));assert.equal(hash(readFileSync(new URL('./fixtures/collection-input-wrapper.mjs',import.meta.url))),meta.fixture_sha256);});

for(const slot of [1,3])test('recovery frozen slot2 rejects evidence slot'+slot,()=>{const f=fixture(slot);try{assert.throws(()=>validateInput(f.root,f.c,f.input),/EID_PAIR/);}finally{f.cleanup();}});
const invalid={
 'foreign VID':f=>f.c.recovery.collection.video_id='7707600173446204000',
 'wrong pair':f=>f.input.video_eid+='1',
 'producer digest':f=>f.c.recovery.producer_manifest.sha256='f'.repeat(64),
 'producer identity':f=>f.c.recovery.producer.run_id='foreign',
 'same execution identity':f=>f.c.tasks['102'].run_id='old-run',
 'foreign business run':f=>f.c.tasks['102'].run_tag='other-business',
 'mode typo':f=>f.c.recovery.mode='qualification-readonly',
 'unfrozen module':f=>f.c.verification.qualification_sha256['qualification-artifacts.mjs']='f'.repeat(64),
};
for(const [name,change]of Object.entries(invalid))test('real wrapper rejects '+name,()=>{const f=fixture();try{change(f);assert.throws(()=>validateInput(f.root,f.c,f.input));}finally{f.cleanup();}});
test('ordinary non-recovery keeps original quota boundary',()=>{for(const slot of [1,2]){const f=fixture(slot);try{delete f.c.recovery;if(slot===1)assert.equal(validateInput(f.root,f.c,f.input).videoId,vid);else assert.throws(()=>validateInput(f.root,f.c,f.input),/EID_PAIR/);}finally{f.cleanup();}}});
test('candidate full wrapper extraction remains exactly the permanent real entry fixture',()=>{if(!process.env.COLLECTION_SLOT_CANDIDATE)return;const meta=JSON.parse(readFileSync(new URL('./fixtures/collection-input-wrapper.provenance.json',import.meta.url)));const s=readFileSync(process.env.COLLECTION_SLOT_CANDIDATE,'utf8');assert.equal(hash(s),meta.candidate_wrapper_sha256);const extracted=s.slice(0,s.indexOf('function write(')).replace("import {createDeps} from './runtime-deps.mjs';\n",'').replace("from '../qualification-artifacts.mjs'","from '../../qualification-artifacts.mjs'");assert.equal(extracted,readFileSync(new URL('./fixtures/collection-input-wrapper.mjs',import.meta.url),'utf8'));});

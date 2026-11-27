import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {serveStandaloneBilibiliVerify} from '../standalone-bilibili-verify.mjs';
import {callStandaloneSkillTool} from '../standalone-skill-ipc.mjs';

const pkg='tv.danmaku.bili', bvid='BV1a2b3Cd4eF', uid='1234567890';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC','base64');
const node=(id,text,extra='')=>`<node package="${pkg}" resource-id="${pkg}:id/${id}" text="${text}" ${extra}/>`;
const xml=(...nodes)=>Buffer.from('<?xml version="1.0"?><hierarchy>'+nodes.join('')+'</hierarchy>');
const videoRows=(bvid,title)=>`<node package="${pkg}" resource-id="${pkg}:id/recycler">
 <node>${node('avid',bvid)}</node>
 <node>${node('title','新建预约后可展示在此处')}</node>
 <node>${node('title',title)}${node('arrow','')}</node>
</node>`;
const uidRow=value=>`<node package="${pkg}" resource-id="${pkg}:id/uid_layout">${node('uid_prefix','UID')}${node('uid',value)}</node>`;
async function setup(t,transform=value=>value,{guard=()=>{},expired=false}={}){
 const scratch=realpathSync(mkdtempSync(join(tmpdir(),'zj-bilibili-verify-')));
 const directory=join(scratch,'agent');
 mkdirSync(directory,{mode:0o700});
 const scope={runId:randomUUID(),sourceRunId:'prior-read',owner:'bili-test-owner',profile:'white-fixture',serial:'fixture-serial',
  bvid,ownerUid:uid,title:'自有作品',durationSeconds:10,width:1,height:1,deadlineMs:Date.now()+(expired?-1:30000)};
 const evidenceDirectory=join(scratch,scope.runId);
 mkdirSync(evidenceDirectory,{mode:0o700});
 const requests=[];
 const response={
  package:pkg,sideEffects:{publish:0,share:0,visibilityChanges:0},account:xml(uidRow(uid)),author:xml(uidRow(uid)),
  detail:xml(videoRows(bvid,scope.title),node('tvTitle','本稿件已被设置为仅自己可见'),node('gemini_halfscreen_progress_text','00:10/00:10')),
  editor:xml(node('et_title',scope.title),node('tv_title','编辑稿件')),settings:xml(node('scSelfVisible','','checked="true"')),
  player:png,
 };
 const runtime=await serveStandaloneBilibiliVerify({scope,directory,evidenceDirectory,assertAuthority:guard,readOwnVideo:async request=>{
  requests.push(request);
  return transform({...response,runId:scope.runId,owner:scope.owner,profile:scope.profile,serial:scope.serial,bvid});
 }});
 t.after(async()=>{try{await runtime.close();}finally{rmSync(scratch,{recursive:true,force:true});}});
 return {runtime,scope,requests,directory,evidenceDirectory,call:(operation='verify_existing',data={})=>callStandaloneSkillTool(runtime.connectionPath,operation,data)};
}

test('the single private verify operation binds exact owner and work, then seals same-run native evidence',async t=>{
 const x=await setup(t);
 const response=await x.call();
 assert.equal(response.result.observation.bvid,bvid);
 assert.equal(response.result.observation.owner_uid,uid);
 assert.equal(response.result.observation.visibility,'private');
 assert.equal(response.result.observation.outward_actions,0);
 assert.equal(x.requests.length,1);
 assert.equal(x.requests[0].operation,'read_own_existing_video');
 assert.equal(readdirSync(x.directory).includes('bilibili-existing'),false);
 const evidence=join(x.evidenceDirectory,'bilibili-existing');
 for(const row of Object.values(response.result.files)){
  assert.equal(lstatSync(join(evidence,row.path)).mode&0o777,0o600);
 }
 assert.equal(JSON.parse(readFileSync(join(evidence,'receipt.json'),'utf8')).observation.run_id,x.scope.runId);
 await assert.rejects(x.call(),/IPC_CALL_FAILED/);
 assert.equal(x.requests.length,1);
});
test('rejects any outward, input-controlled, or extra work capability before invoking the handset',async t=>{
 const x=await setup(t);
 for(const [operation,input] of [['publish',{}],['phone',{command:'tap'}],['share',{}],['verify_existing',{bvid:'BV1z2b3Cd4eF'}]]){
  await assert.rejects(x.call(operation,input),/IPC_CALL_FAILED/);
 }
 assert.equal(x.requests.length,0);
 assert.equal(readdirSync(x.evidenceDirectory).includes('bilibili-existing'),false);
});
for(const [key,replace] of [
 ['runId',()=>randomUUID()],
 ['account',()=>xml(uidRow('1234567891'))],
 ['author',()=>xml(uidRow('1234567891'))],
 ['author',()=>xml(uidRow(uid),node('uid',uid))],
 ['editor',()=>xml(node('et_title','其他稿件'))],
 ['settings',()=>xml(node('scSelfVisible','','checked="false"'))],
 ['detail',()=>xml(videoRows('BV1z2b3Cd4eF','自有作品'),node('tvTitle','本稿件已被设置为仅自己可见'),node('gemini_halfscreen_progress_text','00:10/00:10'))],
 ['player',()=>Buffer.from('not a png')],
 ['sideEffects',()=>({publish:1,share:0,visibilityChanges:0})],
]){
 test(`rejects incomplete or mismatched trusted-handset ${key} without writing a receipt`,async t=>{
  const x=await setup(t,value=>({...value,[key]:replace()}));
  await assert.rejects(x.call(),/IPC_CALL_FAILED/);
  assert.equal(readdirSync(x.evidenceDirectory).includes('bilibili-existing'),false);
 });
}
test('the post-observation guard can reject a revoked lease before any evidence is sealed',async t=>{
 let guards=0;
 const x=await setup(t,value=>value,{guard:()=>{if(++guards===2)throw Error('revoked');}});
 await assert.rejects(x.call(),/IPC_CALL_FAILED/);
 assert.equal(x.requests.length,1);
 assert.equal(readdirSync(x.evidenceDirectory).includes('bilibili-existing'),false);
});

test('expired scope never starts a handset read',async t=>{
 const x=await setup(t,value=>value,{expired:true});
 await assert.rejects(x.call(),/IPC_CALL_FAILED/);
 assert.equal(x.requests.length,0);
 assert.equal(readdirSync(x.evidenceDirectory).includes('bilibili-existing'),false);
});

test('rejects an evidence root under the writable agent workspace',async t=>{
 const x=await setup(t);
 const nested=join(x.directory,x.scope.runId);
 mkdirSync(nested,{mode:0o700});
 await assert.rejects(serveStandaloneBilibiliVerify({scope:x.scope,directory:x.directory,
  evidenceDirectory:nested,assertAuthority:()=>{},readOwnVideo:()=>{}}),/EVIDENCE_DIRECTORY/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const library=new URL('../queued-video-lib.sh',import.meta.url).pathname;
const vid='7646309328911907195',owner='clean-open-run';
function open(t,{host='mmv',optin='1',mode='qualification',held=`lock=refreshed owner=${owner} ttl=1800s`,pid,closeFail=false,wrongVideo=false}={}){
 const root=mkdtempSync(join(tmpdir(),'queued-clean-open-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const evidence=join(root,'phone/evidence/cloud-phone-test');mkdirSync(evidence,{recursive:true});
 if(pid!==undefined){const file=join(evidence,owner+'-previous.rec.pid');
  if(pid==='symlink'){writeFileSync(join(root,'pid'),'123\n');symlinkSync(join(root,'pid'),file);}else writeFileSync(file,String(pid)+'\n');}
 const ctl=join(root,'ctl');writeFileSync(ctl,`#!/usr/bin/env node
const f=require('fs'),a=process.argv.slice(2);let owner='';if(a[2]==='--lock-owner'){owner=a[3];a.splice(2,2)}
const [flag,profile,cmd,...args]=a;f.appendFileSync(process.env.CALLS,JSON.stringify({cmd,owner,args})+'\\n');
if(cmd==='lock-refresh')console.log(process.env.HELD);
if(cmd==='close-app'){if(owner!=='clean-open-run')process.exit(7);if(process.env.CLOSE_FAIL==='1')process.exit(8);console.log('foreground=launcher');}
if(cmd==='current-video-link')console.log('content_type=video\\nvideo_id='+ (process.env.WRONG_VIDEO==='1'?'7646309328911907196':'7646309328911907195'));
`,{mode:0o755});
 const env={...process.env,C:ctl,P:'cloud-phone-test',TAG:owner,VID:vid,MODE:mode,WFR_HOSTKEY:host,
  LEADGEN_MMV_DEVICE_RUNTIME:optin,DOUYIN_PHONE_TMP_ROOT:join(root,'phone'),CALLS:join(root,'calls'),HELD:held,
  CLOSE_FAIL:closeFail?'1':'0',WRONG_VIDEO:wrongVideo?'1':'0',QV_LIB:library};
 delete env.WFR_RUN_DIR;delete env.QUEUED_VIDEO_EVIDENCE_ATTEMPT;
 const result=spawnSync('/bin/zsh',['-c','source "$QV_LIB" || exit $?; qv_open'],{env,encoding:'utf8',timeout:5000});
 const calls=readFileSync(join(root,'calls'),'utf8').trim().split('\n').map(JSON.parse);
 return {...result,calls};
}

test('explicit MMV qualification closes under exact owner before target and fresh identity',t=>{
 const r=open(t);assert.equal(r.status,0,r.stderr);
 assert.deepEqual(r.calls.map(c=>c.cmd),['lock-refresh','close-app','open-video','current-video-link']);
 assert.equal(r.calls[1].owner,owner);assert.equal(r.calls[2].args[0],vid);
 assert.equal(r.calls[3].owner,owner);
});
for(const opts of [{host:'xian-m4'},{optin:''},{mode:'identity'},{mode:'collection'}])test('existing path keeps no clean restart '+JSON.stringify(opts),t=>{
 const r=open(t,opts);assert.equal(r.status,0,r.stderr);
 assert.deepEqual(r.calls.map(c=>c.cmd),['lock-refresh','open-video','current-video-link']);
});
for(const held of ['lock=refreshed',`lock=refreshed owner=${owner}-foreign ttl=1800s`])test('MMV clean open refuses unverified exact owner '+held,t=>{
 const r=open(t,{held});assert.notEqual(r.status,0);assert.deepEqual(r.calls.map(c=>c.cmd),['lock-refresh']);
});
for(const pid of [process.pid,'bad-pid','symlink'])test('active or unknown managed recorder prevents close '+pid,t=>{
 const r=open(t,{pid});assert.notEqual(r.status,0);assert.deepEqual(r.calls.map(c=>c.cmd),['lock-refresh']);
});
test('failed owner close never opens target or verifies stale identity',t=>{
 const r=open(t,{closeFail:true});assert.notEqual(r.status,0);
 assert.deepEqual(r.calls.map(c=>c.cmd),['lock-refresh','close-app']);
});
test('clean open still rejects fresh wrong video identity',t=>{
 const r=open(t,{wrongVideo:true});assert.notEqual(r.status,0);
 assert.deepEqual(r.calls.map(c=>c.cmd),['lock-refresh','close-app','open-video','current-video-link']);
});

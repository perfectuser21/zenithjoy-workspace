import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHandlers} from '../leadgen-workflow.mjs';

test('workflow真实phone调用将本run owner传给取链，未取得本批锁不得调用',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'link-workflow-owner-')),calls=[],run='caller-current-run';
 try {
  const registry=join(dir,'accounts.tsv');writeFileSync(registry,'cloud\tregistered-account\n');
  const h=createHandlers({root:dir,env:{HOME:dir,WFR_RUN_DIR:dir,WFR_TAG:run,P:'cloud',SERIAL:'fake-sdk31',LEADGEN_LINE:'jinuo',DOUYIN_PHONE_ADB:'/fake/controller',DOUYIN_ACCOUNT_REGISTRY:registry,LOCK_OWNER:'another-run'},rpc:async()=>{throw Error('unexpected RPC');},execute:async(command,args)=>{
   calls.push({command,args});
   let stdout='';
   if(command==='adb')stdout=args.includes('get-state')?'device\n':args.includes('telephony.registry')?'mCallState=0\n':'';
   if(command==='/fake/controller'){
    const op=args[2]==='--lock-owner'?args[4]:args[2];
    stdout=({preflight:'serial=fake-sdk31\n','lock-acquire':'lock=acquired\n','lock-refresh':'lock=refreshed\n','account-current':'douyin_id=registered-account\n','current-video-link':'video_id=7646309328911907195\n'})[op]||'';
   }
   return {code:0,stdout,stderr:''};
  }});
  await assert.rejects(h.handoffPhone('current-video-link','before-lock'),/未持本批锁/);
  assert.equal(calls.length,0);
  await h.preflight();
  await h.handoffPhone('current-video-link','fresh-link','AI');
  const actual=calls.find(c=>c.args.includes('current-video-link'));
  assert.deepEqual(actual.args,['--profile','cloud','--lock-owner',run,'current-video-link','fresh-link','AI']);
  const index=calls.indexOf(actual);assert.deepEqual(calls[index-1].args,['--profile','cloud','lock-refresh',run]);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('102真实queued identity调用将已续期的业务TAG传给取链，不读取其它owner',()=>{
 const dir=mkdtempSync(join(tmpdir(),'link-queued-owner-')),ctl=join(dir,'controller'),run='queued-current-run',vid='7646309328911907195';
 try {
  writeFileSync(ctl,`#!/usr/bin/env node
const fs=require('fs');const a=process.argv.slice(2);fs.appendFileSync(process.env.CALLS,JSON.stringify(a)+'\\n');
const hasOwner=a[2]==='--lock-owner',op=a[hasOwner?4:2];
if(op==='lock-refresh')console.log('lock=refreshed');
if(op==='current-video-link'){if(!hasOwner||a[3]!==${JSON.stringify(run)}){console.error('SDK31_OWNER_REQUIRED');process.exit(2);}console.log('content_type=video\\nvideo_id=${vid}');}
`,{mode:0o755});
  const r=spawnSync('zsh',[new URL('../process-queued-video.sh',import.meta.url).pathname,'identity','cloud',vid,'https://www.douyin.com/video/'+vid,'','',run,'jinuo'],{encoding:'utf8',env:{...process.env,DOUYIN_PHONE_ADB:ctl,CALLS:join(dir,'calls'),LOCK_OWNER:'another-run'},timeout:10000});
  assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/IDENTITY\t7646309328911907195\tverified/);
  const calls=readFileSync(join(dir,'calls'),'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls[0],['--profile','cloud','lock-refresh',run]);
  assert.deepEqual(calls.find(a=>a.includes('current-video-link')),['--profile','cloud','--lock-owner',run,'current-video-link',run+'-v'+vid+'-identity-identity']);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

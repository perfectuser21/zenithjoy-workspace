import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHandlers} from '../leadgen-handlers.mjs';

function rig(t,{missing=false,foreign=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'discovery-cleanup-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 writeFileSync(join(dir,'accounts'),'legacy\t44997267357\n');
 const env={HOME:dir,WFR_RUN_DIR:dir,WFR_TAG:'cleanup101',WFR_RUN_ID:'douyin_video_discovery-cleanup101',WFR_ATTEMPT:'a1',WF_BRAIN_WORKFLOW:'douyin_video_discovery',P:'legacy',SERIAL:'ANGYVB4402004137',LEADGEN_LINE:'jinuo',LEADGEN_EVIDENCE_DIR:dir,DOUYIN_ACCOUNT_REGISTRY:join(dir,'accounts'),DOUYIN_PHONE_ADB:'/fixture/phone'};
 const calls=[],scope={run:'cleanup101',run_id:env.WFR_RUN_ID+'__a1',source_commit:'a'.repeat(40),profile:'legacy',serial:env.SERIAL};
 const execute=async(command,args)=>{let stdout='';
  if(args[0]===join(dir,'adb-existing-route.py'))stdout='5042\n';
  else if(command==='adb')stdout=args.includes('get-state')?'device\n':args.includes('telephony.registry')?'mCallState=0\n':'';
  else if(command==='/fixture/phone'){
   const i=args[2]==='--lock-owner'?4:2,op=args[i];calls.push(op);
   stdout={preflight:'serial='+env.SERIAL,'lock-acquire':'lock=acquired','lock-refresh':'lock=refreshed','lock-release':'lock=released','account-current':'douyin_id=44997267357','close-app':'foreground=mCurrentFocus com.hihonor.android.launcher/.Home','return-safe-desktop':'launcher=com.hihonor.android.launcher\nforeground_package=com.hihonor.android.launcher\nforeground=mCurrentFocus com.hihonor.android.launcher/.Home'}[op]||'';
   if(missing&&['close-app','return-safe-desktop'].includes(op))stdout='';
   if(op==='snapshot-evidence'){assert.equal(i,4);const file=join(dir,args[i+1]+'.png');writeFileSync(file,Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082','hex'));stdout=file;}
   if(op==='ui-evidence'){assert.equal(i,4);const file=join(dir,args[i+1]+'.xml');writeFileSync(file,`<hierarchy><node package="${foreign?'com.ss.android.ugc.aweme':'com.hihonor.android.launcher'}"/></hierarchy>`);stdout=file;}
  }
  return {code:0,stdout,stderr:''};
 };
 return {dir,scope,calls,h:createHandlers({root:dir,env,execute,sourceCommit:scope.source_commit,rpc:async()=>{throw Error('unexpected RPC');}})};
}
test('101 cleanup必须保留同run原生stdout与桌面原件并独立核验',async t=>{
 const r=rig(t);await r.h.preflight();const result=await r.h.cleanup();
 assert.equal(result.cleanup_readback_verified,1);assert.equal(result.safe_desktop_visible,1);assert.equal(result.lock_released,1);
 const {verifyCleanupReadback}=await import('../discovery-cleanup-readback.mjs');assert.equal(verifyCleanupReadback({runDir:r.dir,scope:r.scope}),true);
 const receipt=JSON.parse(readFileSync(join(r.dir,'cleanup-readback.json'),'utf8'));assert.match(receipt.desktop_stdout,/launcher=/);assert.match(receipt.close_stdout,/foreground=/);
 assert.equal(verifyCleanupReadback({runDir:r.dir,scope:{...r.scope,run_id:r.scope.run_id.replace('a1','a2')}}),false);
 writeFileSync(join(r.dir,'cleanup-readback','desktop.xml'),'<hierarchy/>');assert.equal(verifyCleanupReadback({runDir:r.dir,scope:r.scope}),false);
});
for(const options of [{missing:true},{foreign:true}])test('101 cleanup不得仅凭exit0或错误前台宣布读回通过 '+JSON.stringify(options),async t=>{
 const r=rig(t,options);await r.h.preflight();const result=await r.h.cleanup();assert.equal(result.status,'partial');assert.notEqual(result.cleanup_readback_verified,1);assert.equal(result.safe_desktop_visible,0);
});

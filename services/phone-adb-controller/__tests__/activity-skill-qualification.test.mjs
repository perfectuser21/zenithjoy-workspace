import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withCompanyFixture} from './company-config-fixture.mjs';
import {createHandlers as rawCreateHandlers} from '../leadgen-workflow.mjs';
const createHandlers=withCompanyFixture(rawCreateHandlers);
function native(eid){return {playback_proof_kind:'native_audio',native_audio:Object.fromEntries(['start','end'].map(phase=>[phase,{state:'started',uid:10203,pid:528,piid:73615,package_uid_verified:true,foreign_started:0,...Object.fromEntries([['evidence','audio.txt'],['package_uid','package-uid.txt'],['uid_owners','uid-owners.txt']].flatMap(([k,s])=>[[k+'_file',eid+'-playback-'+phase+'.'+s],[k+'_sha256','a'.repeat(64)]]))}]))};}
test('actual createHandlers fixture: partial qualification reuses own leases, preserves success and resumes only failed VID',async()=>{
 const d=mkdtempSync(join(tmpdir(),'skill-qualification-')),run='fixture102',vids=['7646309328911907195','7646309328911907196'];let claims=0,repair=false;const calls=[];
 try{
  const h=createHandlers({root:d,env:{HOME:d,WFR_RUN_DIR:d,WFR_TAG:run,P:'fixture',SERIAL:'fixture',LEADGEN_LINE:'jinuo'},rpc:async({request:q})=>{
   if(q.op==='claim_videos'){claims++;return {result:claims===1?vids.map(video_id=>({video_id,video_url:'https://www.douyin.com/video/'+video_id,title:'fixture',judgment_status:'pending'})):[]};}
   assert.equal(q.op,'renew_video');return {result:{}};
  },execute:async(command,args,{env})=>{
   const vid=args[3];calls.push({vid,attempt:env.QUEUED_VIDEO_EVIDENCE_ATTEMPT||null});
   writeFileSync(join(d,`${run}-identity-${vid}.json`),JSON.stringify({verified:true,observed_video_id:vid,content_type:'video'}));
   if(vid===vids[1]&&!repair)return {code:5,stdout:'',stderr:'fixture native playback failed'};
   const suffix=env.QUEUED_VIDEO_EVIDENCE_ATTEMPT?'-recovery'+env.QUEUED_VIDEO_EVIDENCE_ATTEMPT:'',eid=`${run}-v${vid}-qualification${suffix}-record`;
   writeFileSync(join(d,`${run}-recording-${vid}.json`),JSON.stringify({version:2,run,video_id:vid,evidence_id:eid,media_volume_verified:true,media_volume:1,playback_verified:true,playback_package:'com.ss.android.ugc.aweme',audio_status:'usable',mean_volume_db:-20,...native(eid)}));
   return {code:0,stdout:`QUAL\t${vid}\tmatched\tjudged\n`,stderr:''};
  }});
  h.state.budgetDeadline=Date.now()+60000;
  const first=await h.qualification();assert.equal(first.status,'partial');assert.equal(first.matched,1);
  const previous=readFileSync(join(d,`${run}-recording-${vids[0]}.json`),'utf8');repair=true;
  const second=await h.qualification();assert.equal(claims,1);assert.equal(second.claimed,2);assert.equal(second.matched,2);assert.equal(second.recordings_required,2);assert.equal(second.media_volume_verified,2);assert.equal(second.recordings_unverified,0);
  assert.deepEqual(calls.map(c=>c.vid),[...vids,vids[1]]);assert.equal(calls.at(-1).attempt,'1');
  assert.equal(readFileSync(join(d,`${run}-recording-${vids[0]}.json`),'utf8'),previous);
 }finally{rmSync(d,{recursive:true,force:true});}
});
test('unknown claim receipt is not re-claimed or converted into zero-row success',async()=>{
 const d=mkdtempSync(join(tmpdir(),'skill-claim-'));let claims=0;
 try{const h=createHandlers({root:d,env:{HOME:d,WFR_RUN_DIR:d,WFR_TAG:'fixture',LEADGEN_LINE:'jinuo'},rpc:async({request:q})=>{assert.equal(q.op,'claim_videos');claims++;throw Error('fixture lost claim receipt');},execute:async()=>{throw Error('must not execute');}});
 await assert.rejects(()=>h.qualification());await assert.rejects(()=>h.qualification(),/领取.*未知/);assert.equal(claims,1);
 }finally{rmSync(d,{recursive:true,force:true});}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,mkdirSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHandlers} from '../leadgen-handlers.mjs';
import {digest} from '../runtime-definition.mjs';

const task='28f30d70-7248-434b-a1d4-29afed626017',binding='00000000-0000-4000-8000-000000000001',comment='00000000-0000-4000-8000-000000000002';
function fixture(t,options={}){
  const dir=mkdtempSync(join(tmpdir(),'agent-resource-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const body={execution_mode:'agent',deployment:{source_commit:'a'.repeat(40)},files:{}};
  writeFileSync(join(dir,'run-definition.json'),JSON.stringify({...body,snapshot_sha256:digest(body)}));
  const env={HOME:dir,WFR_RUN_DIR:dir,WFR_TAG:'score_fixture',WFR_RUN_ID:'douyin_comment_scoring-score_fixture',WFR_ATTEMPT:'a1',P:'mmv-scoring',SERIAL:'none',LEADGEN_LINE:'yuesheng',LEADGEN_SOURCE_RUN:'source102',LEADGEN_LIMIT:String(options.limit||2),WF_BRAIN_WORKFLOW:'douyin_comment_scoring'};
  const candidates=Array.from({length:options.count||1},(_,i)=>`00000000-0000-4000-8000-${String(i+2).padStart(12,'0')}`);
  const calls=[];
  const h=createHandlers({root:dir,env,taskId:task,sourceCommit:'a'.repeat(40),execute:async()=>{throw Error('103不能触手机或整段脚本');},rpc:async body=>{
    calls.push(body);const op=body.request?.op;if(options.rpc){const result=await options.rpc(body.request,candidates);if(result!==undefined)return {result};}
    return {result:op==='company_config'?{company_id:'company',tenant_id:'tenant',version:1,run_id:'score_fixture'}:
      op==='score_scope'?{ids:[comment],sources:{[comment]:'source102'}}:
      op==='score'?{scored:1,ids:[comment],excluded:0,excluded_ids:[],blocked_ids:[]}:
      op==='score_readback'?{verified:true,failures:0,ids:[comment]}:
      op==='policy_review'?{verified:true,rows:[{id:comment,status:'pass'}]}:{verified:true}};
  }});
  h.scoring=async()=>{throw Error('不能调用原scoring handler');};
  const scope={workflow:env.WF_BRAIN_WORKFLOW,activity:'scoring',run:env.WFR_TAG,run_id:env.WFR_RUN_ID+'__a1',task_id:task,binding_id:binding,source_commit:'a'.repeat(40),snapshot_sha256:digest(body),profile:env.P,serial:env.SERIAL,line:env.LEADGEN_LINE,source_run:env.LEADGEN_SOURCE_RUN,limit:2,comment_limit:null,deadline_ms:Date.now()+20000};
  return {h,scope:{...scope,limit:options.limit||2},calls,candidates};
}
test('真实handlers提供独立原语factory；103经原队列单条评分/读回，不运行原handler',async t=>{
  const f=fixture(t);assert.equal(typeof f.h.createAgentTools,'function');
  const tools=await f.h.createAgentTools({key:'scoring'},f.scope);
  await tools.prepare();await tools.business('score_scope',{});await tools.business('score',{ids:[comment]});
  await tools.business('score_readback',{ids:[comment]});await tools.business('policy_review',{ids:[comment]});
  await tools.settle({execution_stopped:true});
  assert.equal(tools.getResult().scored,1);assert.equal(tools.getResult().scoring_readback_failures,0);
  assert.equal(f.calls.filter(c=>c.request?.op==='score').length,1);assert.equal(f.calls.find(c=>c.request?.op==='score').request.limit,1);
});
test('真实provider拒绝别run/source/Activity或未在原队列scope内的评论',async t=>{
  const f=fixture(t);assert.equal(typeof f.h.createAgentTools,'function');
  await assert.rejects(()=>f.h.createAgentTools({key:'scoring'},{...f.scope,run:'foreign'}),/SCOPE/);
  const tools=await f.h.createAgentTools({key:'scoring'},f.scope);await tools.prepare();await tools.business('score_scope',{});
  await assert.rejects(()=>tools.business('score',{ids:['00000000-0000-4000-8000-000000000003']}),/SCOPE/);
  assert.equal(f.calls.filter(c=>c.request?.op==='score').length,0);
});
test('Agent预检逐原语执行：Runner只取得资源，不调用整preflight或抢先导航',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'agent-preflight-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const body={execution_mode:'agent',deployment:{source_commit:'a'.repeat(40)},files:{}};writeFileSync(join(dir,'run-definition.json'),JSON.stringify({...body,snapshot_sha256:digest(body)}));
  const env={HOME:dir,WFR_RUN_DIR:dir,WFR_TAG:'phone_fixture',WFR_RUN_ID:'douyin_video_processing-phone_fixture',WFR_ATTEMPT:'a1',P:'fixture',SERIAL:'fixture-serial',LEADGEN_LINE:'yuesheng',LEADGEN_SOURCE_RUN:'source101',LEADGEN_LIMIT:'2',WF_BRAIN_WORKFLOW:'douyin_video_processing',DOUYIN_PHONE_ADB:'/fixture/controller',DOUYIN_ADB_BIN:'/fixture/adb'};
  const calls=[],central={held:false,async verifyTask(){return {id:task};},async acquire(){this.held=true;},async ensure(){},async verifyHeld(){}};
  const h=createHandlers({root:dir,env,taskId:task,sourceCommit:'a'.repeat(40),centralLease:central,
    rpc:async()=>({result:{company_id:'company',tenant_id:'tenant',version:1,run_id:env.WFR_TAG,device_binding:{company_id:'company',tenant_id:'tenant',version:1,run_id:env.WFR_TAG,profile:env.P,device_serial:env.SERIAL,douyin_id:'expected-account',verification_status:'verified',enabled:true}}}),
    execute:async(command,args)=>{
      if(args[0]===join(dir,'adb-existing-route.py'))return {code:0,stdout:'5042\n',stderr:''};
      const op=command==='/fixture/controller'?args[2]:args.includes('get-state')?'get-state':args.includes('telephony.registry')?'calls':'other';calls.push(op);
      return {code:0,stdout:{'get-state':'device\n',preflight:'serial=fixture-serial\n','lock-acquire':'lock=acquired\n','lock-refresh':'lock=refreshed\n',calls:'mCallState=0\n','account-current':'douyin_id=expected-account\n'}[op]||'',stderr:''};
    }});
  h.preflight=async()=>{throw Error('不得调用整preflight handler');};
  const scope={workflow:env.WF_BRAIN_WORKFLOW,activity:'preflight',run:env.WFR_TAG,run_id:env.WFR_RUN_ID+'__a1',task_id:task,binding_id:binding,source_commit:'a'.repeat(40),snapshot_sha256:digest(body),profile:env.P,serial:env.SERIAL,line:env.LEADGEN_LINE,source_run:env.LEADGEN_SOURCE_RUN,limit:2,comment_limit:null,deadline_ms:Date.now()+20000};
  const tools=await h.createAgentTools({key:'preflight'},scope);await tools.prepare();
  assert.equal(calls.includes('account-current'),false);assert.equal(calls.includes('open-app'),false);
  await tools.phone('open-app');await tools.phone('account-current');await tools.settle({execution_stopped:true});
  assert.equal(tools.getResult().account_verified,true);assert.equal(calls.filter(op=>op==='account-current').length,1);
});
async function phoneRig(t,options={}){
  const dir=mkdtempSync(join(tmpdir(),'agent-phone-resource-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const samplingInput=options.sample?{schema_version:1,workflow_key:'douyin_video_processing',run_tag:'phone_fixture',profile:'fixture',serial:'fixture-serial',line:'yuesheng',source_run:'source101',comment_limit:3}:null;
  const body={execution_mode:'agent',deployment:{source_commit:'a'.repeat(40)},files:{},...(samplingInput?{sampling_input:samplingInput}:{})};writeFileSync(join(dir,'run-definition.json'),JSON.stringify({...body,snapshot_sha256:digest(body)}));
  const env={HOME:dir,WFR_RUN_DIR:dir,WFR_TAG:'phone_fixture',WFR_RUN_ID:'douyin_video_processing-phone_fixture',WFR_ATTEMPT:'a1',P:'fixture',SERIAL:'fixture-serial',LEADGEN_LINE:'yuesheng',LEADGEN_SOURCE_RUN:'source101',LEADGEN_LIMIT:'2',WF_BRAIN_WORKFLOW:'douyin_video_processing',DOUYIN_PHONE_ADB:'/fixture/controller',DOUYIN_ADB_BIN:'/fixture/adb',LEADGEN_EVIDENCE_DIR:dir};
  if(options.sample)env.LEADGEN_COMMENT_LIMIT='3';
  mkdirSync(join(dir,'config'));writeFileSync(join(dir,'config/own-accounts.json'),JSON.stringify({nicknames:[],ids:[]}));
  const calls=[],vid='1234567890123456',control={owner:env.WFR_TAG,renewals:0,localRelease:true,centralReleases:0},launcher='com.hihonor.android.launcher';
  const central={held:false,async verifyTask(){},async acquire(){this.held=true;},async ensure(){},async verifyHeld(){if(control.centralOwnerLost)throw Error('CENTRAL_OWNER_CHANGED');},async release(){control.centralReleases++;return true;}};
  const h=createHandlers({root:dir,env,taskId:task,sourceCommit:'a'.repeat(40),centralLease:central,rpc:async({request})=>{
    calls.push(request?.op);const custom=await options.onQueue?.(request,{dir,env,control,vid});if(custom!==undefined)return {result:custom};const row={video_id:vid,process_status:'处理中:'+control.owner};
    if(request.op==='inspect_videos')return {result:[row]};
    if(request.op==='claim_videos')return {result:[row]};
    if(request.op==='renew_video'){if(control.renewUnknown)throw Error('lost renew ACK');assert.equal(control.owner,env.WFR_TAG);control.renewals++;return {result:{renewed:true}};}
    return {result:{company_id:'company',tenant_id:'tenant',version:1,run_id:env.WFR_TAG,device_binding:{company_id:'company',tenant_id:'tenant',version:1,run_id:env.WFR_TAG,profile:env.P,device_serial:env.SERIAL,douyin_id:'expected-account',verification_status:'verified',enabled:true}}};
  },execute:async(command,args,opts)=>{
    if(args[0]===join(dir,'adb-existing-route.py'))return {code:0,stdout:'5042\n',stderr:''};
    const index=args[2]==='--lock-owner'?4:2,op=command==='/fixture/controller'?args[index]:args.includes('get-state')?'get-state':args.includes('telephony.registry')?'calls':'other';calls.push(op);
    const custom=await options.onPhone?.(op,args.slice(index+1),{dir,env,control,vid,opts});if(custom!==undefined)return {code:0,stdout:custom,stderr:''};
    let stdout={'get-state':'device\n',preflight:'serial=fixture-serial\n','lock-acquire':'lock=acquired\n','lock-refresh':'lock=refreshed owner=phone_fixture ttl=120s\n','lock-release':control.localRelease?'lock=released':'lock=foreign',calls:'mCallState=0\n','account-current':'douyin_id=expected-account\n','close-app':`foreground=mCurrentFocus ${launcher}/.Home`,'return-safe-desktop':`launcher=${launcher}\nforeground_package=${launcher}\nforeground=mCurrentFocus ${launcher}/.Home`}[op]||'';
    if(op==='snapshot-evidence'){stdout=join(dir,args[index+1]+'.png');writeFileSync(stdout,Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082','hex'));}
    if(op==='ui-evidence'){stdout=join(dir,args[index+1]+'.xml');writeFileSync(stdout,`<hierarchy><node package="${launcher}"/></hierarchy>`);}
    return {code:0,stdout,stderr:''};
  }});
  const scope=activity=>({workflow:env.WF_BRAIN_WORKFLOW,activity,run:env.WFR_TAG,run_id:env.WFR_RUN_ID+'__a1',task_id:task,binding_id:binding,source_commit:'a'.repeat(40),snapshot_sha256:digest(body),profile:env.P,serial:env.SERIAL,line:env.LEADGEN_LINE,source_run:env.LEADGEN_SOURCE_RUN,limit:2,comment_limit:options.sample?3:null,deadline_ms:Date.now()+(options.durationMs||3600000)});
  if(options.code){env.DOUYIN_ACCOUNT_REGISTRY=join(dir,'account-routes.tsv');writeFileSync(env.DOUYIN_ACCOUNT_REGISTRY,'fixture\texpected-account\n');await h.preflight();}else{const pre=await h.createAgentTools({key:'preflight'},scope('preflight'));await pre.prepare();await pre.phone('account-current');await pre.settle({execution_stopped:true});}
  return {h,scope,calls,control,vid,dir,env,samplingInput};
}
test('真实provider每轮实际续本run视频租约，移主后无phone或提交且不能settle',async t=>{
  const r=await phoneRig(t);r.h.state.intakeVideoIds=[r.vid];
  const tools=await r.h.createAgentTools({key:'qualification'},r.scope('qualification'));await tools.prepare();await tools.business('claim_videos');
  const now=Date.now;let clock=now();Date.now=()=>clock;t.after(()=>{Date.now=now;});
  await tools.heartbeat();clock+=16*60000;await tools.heartbeat();assert.equal(r.control.renewals,2);
  await tools.business('renew_video',{video_id:r.vid});await tools.business('renew_video',{video_id:r.vid});assert.equal(r.control.renewals,4);
  r.control.owner='other-run';const before=r.calls.length;await assert.rejects(()=>tools.phone('open-video',r.vid),/LEASE_LOST/);
  assert.deepEqual(r.calls.slice(before),['inspect_videos']);await assert.rejects(()=>tools.heartbeat(),/LEASE_LOST|NATIVE_UNKNOWN/);await assert.rejects(()=>tools.settle({execution_stopped:true}),/LEASE_LOST|NATIVE_UNKNOWN/);
});
for(const fail of [false,true])test('102原生桌面独立核验后仅双停可释放，local失败保中央锁 '+fail,async t=>{
  const r=await phoneRig(t),tools=await r.h.createAgentTools({key:'cleanup'},r.scope('cleanup'));await tools.prepare();
  await tools.phone('close-app');await tools.phone('return-safe-desktop');await tools.phone('snapshot-evidence');await tools.phone('ui-evidence');
  await assert.rejects(()=>tools.release({execution_stopped:false}),/TERMINATION/);assert.equal(r.control.centralReleases,0);
  await tools.settle({execution_stopped:true});assert.equal(tools.getResult().cleanup_readback_verified,1);
  r.control.localRelease=!fail;
  if(fail){await assert.rejects(()=>tools.release({execution_stopped:true}),/RELEASE_UNVERIFIED|COMMIT_UNKNOWN/);assert.equal(r.control.centralReleases,0);}
  else{await tools.release({execution_stopped:true});assert.equal(tools.getResult().lock_released,1);assert.equal(r.control.centralReleases,1);}
});

test('真实provider续租ACK丢失跨Activity保隔离，不能另开cleanup释放',async t=>{
  const r=await phoneRig(t);r.h.state.intakeVideoIds=[r.vid];
  const tools=await r.h.createAgentTools({key:'qualification'},r.scope('qualification'));await tools.prepare();await tools.business('claim_videos');
  r.control.renewUnknown=true;await assert.rejects(()=>tools.heartbeat(),/UNKNOWN/);
  await assert.rejects(()=>r.h.createAgentTools({key:'cleanup'},r.scope('cleanup')),/NATIVE_UNKNOWN/);
  assert.equal(r.control.centralReleases,0);
});
for(const lostAck of [false,true])test('完整factory原生receipt两partial最终零新增collect保累计，精确PG行通过原samplingAdmission ACK丢失='+lostAck,async t=>{
  const {samplingAdmissionEvidence}=await import('../runtime-receipts.mjs');
  const {default:recipient}=await import('../queued-recipient-evidence.js');
  const pkg='com.ss.android.ugc.aweme',pg=new Map(),writes=[];let screen=1,footer=false,persistedCollected=false;
  const panelBase=readFileSync(new URL('./fixtures/honor-e1b-recipient/returned.xml',import.meta.url),'utf8');
  let panelBad=false,wrongVideo=false,nativeCalls=0,panelOpen=false,position=0,shareCount=0,openCount=0;const scrollCalls=[];
  const panel=()=>{if(panelBad)return '<hierarchy/>';let xml=panelBase.replaceAll('测试评论人','测试人'+screen).replaceAll('测试完整评论 首评','在哪里报名'+screen);if(footer){const last=xml.lastIndexOf('</node>'),index=xml.lastIndexOf('</node>',last-1);xml=xml.slice(0,index)+`<node package="${pkg}" text="暂时没有更多了"/>`+xml.slice(index);}return xml;};
  const timeoutEvidence=[];
  const r=await phoneRig(t,{sample:true,durationMs:450000,onQueue:async(q,{env,vid})=>{
    const v={video_id:vid,video_url:`https://www.douyin.com/video/${vid}`,title:'原视频',keyword:'关键词',line_key:'yuesheng',process_status:persistedCollected?'评论已采':'处理中:'+env.WFR_TAG,judgment_status:'matched',judgment_config:{company_id:'company',version:1,run_id:'prior102'}};
    if(q.op==='claim_videos'||q.op==='inspect_videos')return [v];
    if(q.op==='comment_history')return {version:1,status:'verified',line:'yuesheng',line_key:'yuesheng',run:env.WFR_TAG,source_run:'source101',video_id:vid,video_url:v.video_url,rows:[]};
    if(q.op==='collect'||q.op==='collect_partial'){
      let inserted=0;for(const c of q.comments){recipient.validateEvidence(c.recipientEvidence,{...c.recipientEvidence.scope,comment_body:c.commentBody},{companyBinding:c.recipientEvidence.company_binding});const key=JSON.stringify([c.douyinId,c.commentBody]);if(!pg.has(key)){inserted++;pg.set(key,{id:`00000000-0000-4000-8000-${String(pg.size+11).padStart(12,'0')}`,douyinId:c.douyinId,commentBody:c.commentBody,sourceVideoUrl:c.sourceVideoUrl});}}
      const out={video_id:vid,inserted,comments:q.comments.length,history_verified:0,coverage:q.comments.length};writes.push({op:q.op,inserted,coverage:out.coverage});if(q.op==='collect'){persistedCollected=true;if(lostAck)throw Error('lost final commit ACK');}return out;
    }
    if(q.op==='sample_readback'){assert.deepEqual(q.rows.map(x=>x.douyinId).sort(),[...pg.values()].map(x=>x.douyinId).sort());return {verified:true,video_id:vid,coverage:pg.size,rows:[...pg.values()]};}
    if(q.op==='comment_history_readback')return {verified:true,video_id:vid,history_verified:0,ids:[]};
  },onPhone:async(op,args,{dir,vid,opts})=>{
    nativeCalls++;if(op==='swipe-evidence'){assert.equal(panelOpen,true,'分享取链后评论panel实际关闭');position+=Number(args[1])>Number(args[3])?1:-1;scrollCalls.push(args);return 'swiped=1';}
    if(op==='open-video'||op==='back-evidence'){panelOpen=false;position=0;}
    if(op==='open-comments'){panelOpen=true;position=0;openCount++;const evidence=join(dir,args[0]+'-panel.xml');writeFileSync(evidence,panel(),{mode:0o600});return 'comments_opened=1\nevidence='+evidence+'\n';}
    if(['ui-evidence','commenter-identity'].includes(op)){assert.ok(opts.timeoutMs>440000&&opts.timeoutMs<=450000,op+' must use frozen remaining deadline; got '+opts.timeoutMs);timeoutEvidence.push(op);}
    if(op==='current-video-link'){shareCount++;panelOpen=false;const observed=wrongVideo?'9999999999999999':vid;return `content_type=video\nvideo_id=${observed}\nresolved_url=https://www.douyin.com/video/${observed}\n`;}
    if(op==='ui-evidence'){const file=join(dir,args[0]+'.xml');writeFileSync(file,panelOpen?panel():'<hierarchy><node package="com.ss.android.ugc.aweme" text="视频详情"/></hierarchy>',{mode:0o600});return file;}
    if(op==='commenter-identity'){
      const eid=args[3],profile=join(dir,eid+'-profile.xml'),returned=join(dir,eid+'-returned.xml');
      writeFileSync(profile,`<hierarchy><node package="${pkg}" text="测试人${screen}" content-desc="测试人${screen}，复制名字和修改备注"/><node package="${pkg}" text="抖音号：person${screen}"/></hierarchy>`,{mode:0o600});writeFileSync(returned,panel(),{mode:0o600});
      return `douyin_id=person${screen}\naccount_type=personal\nnickname=测试人${screen}\nprofile_evidence=${profile}\nreturn_evidence=${returned}\n`;
    }
  }});
  const previous=process.env.DOUYIN_PHONE_TMP_ROOT,phoneRoot=join(r.dir,'phone');mkdirSync(join(phoneRoot,'evidence'),{recursive:true});
  const {symlinkSync}=await import('node:fs');symlinkSync(r.dir,join(phoneRoot,'evidence','fixture'));process.env.DOUYIN_PHONE_TMP_ROOT=phoneRoot;t.after(()=>{if(previous===undefined)delete process.env.DOUYIN_PHONE_TMP_ROOT;else process.env.DOUYIN_PHONE_TMP_ROOT=previous;});
  r.h.state.intakeVideoIds=[r.vid];const qualification=await r.h.createAgentTools({key:'qualification'},r.scope('qualification'));await qualification.prepare();await qualification.business('claim_videos');await qualification.phone('open-video',r.vid);await qualification.phone('current-video-link');await qualification.business('qualify',{video_id:r.vid});await qualification.business('qualification_readback',{video_id:r.vid});await qualification.settle({execution_stopped:true});
  const tools=await r.h.createAgentTools({key:'collection'},r.scope('collection'));await tools.prepare();await tools.phone('open-video',r.vid);const beforeSession=nativeCalls;await assert.rejects(()=>tools.phone('swipe-evidence','up'),/PANEL_SESSION/);assert.equal(nativeCalls,beforeSession);await tools.phone('current-video-link');await tools.phone('open-comments');
  for(const args of [['0','0','0','0','0'],['100','2500','100','2500','0'],[],['left']]){const before=nativeCalls;await assert.rejects(()=>tools.phone('swipe-evidence',...args),/SWIPE_SCOPE|PHONE_INPUT/);assert.equal(nativeCalls,before);}
  await tools.phone('back-evidence');const afterNav=nativeCalls;await assert.rejects(()=>tools.phone('swipe-evidence','up'),/PANEL_SESSION/);assert.equal(nativeCalls,afterNav);await assert.rejects(()=>tools.phone('commenter-identity','111','1258',Buffer.from('测试人1').toString('base64')),/PANEL_SESSION/);assert.equal(nativeCalls,afterNav);await tools.phone('open-video',r.vid);await tools.phone('current-video-link');await tools.phone('open-comments');
  panelBad=true;await assert.rejects(()=>tools.phone('swipe-evidence','up'),/COMMENT_PANEL|SCROLL_VIEWPORT/);assert.equal(scrollCalls.length,0);panelBad=false;await tools.phone('open-comments');
  const beforeScrollShares=shareCount,beforeScrollOpens=openCount;
  await tools.phone('swipe-evidence','up');assert.equal(scrollCalls.length,1);assert.deepEqual(scrollCalls[0].slice(0,5),['600','2153','600','1499','500']);
  await tools.phone('swipe-evidence','up');assert.equal(position,2);assert.equal(shareCount,beforeScrollShares);assert.equal(openCount,beforeScrollOpens);
  await tools.phone('swipe-evidence','down');assert.deepEqual(scrollCalls[2].slice(0,5),['600','1499','600','2153','500']);
  const input={video_id:r.vid,video_url:`https://www.douyin.com/video/${r.vid}`};await tools.business('comment_history',input);
  const refs=[];for(screen=1;screen<=2;screen++){
    if(screen>1)await tools.phone('open-comments');
    const native=await tools.phone('commenter-identity','111','1258',Buffer.from('测试人'+screen).toString('base64'));refs.push({native_receipt:native.native_receipt});assert.equal(native.navigation.panel_session_available,false);const afterIdentity=nativeCalls;await assert.rejects(()=>tools.phone('swipe-evidence','up'),/PANEL_SESSION/);assert.equal(nativeCalls,afterIdentity);
    await tools.business('collect_partial',{...input,comments:[refs.at(-1)],history:[]});
  }
  screen=2;footer=true;await tools.phone('open-comments');await tools.phone('ui-evidence');
  if(lostAck){
    await assert.rejects(()=>tools.business('collect',{...input,comments:refs,history:[]}),/UNKNOWN/);
    assert.equal((await tools.heartbeat()).deferred,true);
    await tools.business('sample_readback',{...input,rows:[]});await tools.business('comment_history_readback',{...input,history:[]});
    assert.equal(readdirSync(join(r.dir,'agent-tools','collection')).filter(name=>name.endsWith('.readback.json')).length,2);
    const beforeSql=r.calls.length;
    await assert.rejects(()=>tools.business('sample_readback',{...input,video_id:'9999999999999999',rows:[]}),/UNKNOWN/);
    await assert.rejects(()=>tools.business('score_readback',{ids:[]}),/OPERATION/);
    await assert.rejects(()=>tools.business('sample_readback',{...input,rows:[],readOnly:true}),/INPUT_SCOPE/);
    assert.equal(r.calls.length,beforeSql);
    r.control.centralOwnerLost=true;await assert.rejects(()=>tools.business('sample_readback',{...input,rows:[]}),/CENTRAL_OWNER_CHANGED/);assert.equal(r.calls.length,beforeSql);r.control.centralOwnerLost=false;
    const before=nativeCalls;await assert.rejects(()=>tools.phone('ui-evidence'),/UNKNOWN/);assert.equal(nativeCalls,before);
    const writesBefore=writes.length;await assert.rejects(()=>tools.business('collect',{...input,comments:refs,history:[]}),/UNKNOWN/);assert.equal(writes.length,writesBefore);
    await assert.rejects(()=>tools.settle({execution_stopped:true}),/UNKNOWN/);await assert.rejects(()=>tools.release({execution_stopped:true}),/TERMINATION/);assert.equal(r.control.centralReleases,0);assert.equal(tools.getResult(),null);return;
  }
  await tools.business('collect',{...input,comments:refs,history:[]});
  await tools.business('sample_readback',{...input,rows:[]});await tools.business('comment_history_readback',{...input,history:[]});await tools.settle({execution_stopped:true});
  assert.deepEqual(writes,[{op:'collect_partial',inserted:1,coverage:1},{op:'collect_partial',inserted:1,coverage:2},{op:'collect',inserted:0,coverage:2}]);
  const result=tools.getResult();assert.equal(result.comments_inserted,2);assert.equal(result.coverage,2);assert.ok(timeoutEvidence.includes('ui-evidence'));assert.equal(timeoutEvidence.filter(op=>op==='commenter-identity').length,2);
  const admitted=samplingAdmissionEvidence({dir:r.dir,artifact:{result},frozen:{sampling_input:r.samplingInput,deployment:{source_commit:'a'.repeat(40)}},binding:{id:binding,run_id:r.scope('collection').run_id}});
  assert.deepEqual(admitted.videos[0].comment_ids.sort(),[...pg.values()].map(row=>row.id).sort());
});
test('103二十候选仅首次冻结五条，重读不扩scope且第六条评分拒绝，五条可交接mark',async t=>{
  const scored=new Set(),marked=new Set();let reads=0;
  const f=fixture(t,{count:20,limit:5,rpc:async(q,ids)=>{
    if(q.op==='score_scope'){reads++;const candidates=reads===1?ids:[...ids].reverse();return {ids:candidates,sources:Object.fromEntries(candidates.map(id=>[id,'source102']))};}
    if(q.op==='score'){q.ids.forEach(id=>scored.add(id));return {scored:q.ids.length,ids:q.ids,excluded_ids:[]};}
    if(q.op==='score_readback')return {verified:true,ids:[...scored],failures:0};
    if(q.op==='policy_review')return {verified:true};
    if(q.op==='mark_leads'){assert.deepEqual(q.ids,[...scored]);scored.forEach(id=>marked.add(id));return {marked:marked.size,ids:[...marked],lead_ids:[]};}
    if(q.op==='mark_readback')return {verified:true,failures:0};
    if(q.op==='bridge_outreach'){assert.deepEqual(q.comment_ids,[...marked]);return {verified:true,ids:[],comment_ids:[],created:0};}
    if(q.op==='bridge_readback')return {verified:true,failures:0};
  }});
  const tools=await f.h.createAgentTools({key:'scoring'},f.scope);await tools.prepare();
  const selected=await tools.business('score_scope');assert.deepEqual(selected.ids,f.candidates.slice(0,5));
  assert.deepEqual((await tools.business('score_scope')).ids,selected.ids);assert.equal(reads,1);
  await assert.rejects(()=>tools.business('score',{ids:[f.candidates[5]]}),/SCOPE/);
  for(const id of selected.ids)await tools.business('score',{ids:[id]});await tools.business('score_readback',{ids:selected.ids});await tools.business('policy_review',{ids:selected.ids});await tools.settle({execution_stopped:true});
  const marking=await f.h.createAgentTools({key:'mark_leads'},{...f.scope,activity:'mark_leads'});await marking.prepare();const markedReceipt=await marking.business('mark_leads');
  await marking.business('mark_readback',{ids:markedReceipt.ids,lead_ids:markedReceipt.lead_ids});await marking.business('bridge_outreach');await marking.business('bridge_readback',{ids:[]});await marking.settle({execution_stopped:true});
  assert.equal(marking.getResult().marked,5);assert.equal(scored.size,5);assert.equal(marked.size,5);assert.equal(f.candidates.filter(id=>!scored.has(id)).length,15);
});
test('Agent通条手机deadline随冻结剩余预算缩小，不采用120秒命令表',async t=>{
  const observed=[];
  const r=await phoneRig(t,{durationMs:450000,onPhone:async(op,args,{dir,opts})=>{if(op!=='ui-evidence')return;observed.push(opts.timeoutMs);const file=join(dir,args[0]+'.xml');writeFileSync(file,'<hierarchy><node package="com.hihonor.android.launcher"/></hierarchy>');return file;}});
  const tools=await r.h.createAgentTools({key:'qualification'},r.scope('qualification'));await tools.prepare();
  await tools.phone('ui-evidence');assert.ok(observed[0]>440000&&observed[0]<=450000);
  const now=Date.now,at=now();Date.now=()=>at+400000;t.after(()=>{Date.now=now;});await tools.phone('ui-evidence');assert.ok(observed[1]>40000&&observed[1]<=50000);
});

test('Code旧phone入口保留120秒默认，不继承Agent截止通条',async t=>{
 const observed=[];const r=await phoneRig(t,{code:true,onPhone:async(op,args,{dir,opts})=>{if(op!=='ui-evidence')return;observed.push(opts.timeoutMs);const file=join(dir,args[0]+'.xml');writeFileSync(file,'<hierarchy/>');return file;}});
 await r.h.handoffPhone('ui-evidence','code-ui');assert.deepEqual(observed,[120000]);
});

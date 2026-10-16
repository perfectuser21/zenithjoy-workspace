import {withCompanyFixture} from './company-config-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync,chmodSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parse as parseYaml} from 'yaml';

// 明示模拟本轮native v2工件；不宣称原始audio为实机采集。
function fakeNativeProof(eid){const runtime={client_sha256:'d474146594d6f42ec04eede0049391a647ab27cdcf30c627ac30b281cf5069d7',server_sha256:'8588238c9a5a00aa542906b6ec7e6d5541d9ffb9b5d0f6e1bc0e365e2303079e',evidence_file:eid+'.capture-runtime.json',evidence_sha256:'e'.repeat(64)};return {capture_runtime:runtime,capture_runtime_end:{...runtime},capture_audio_mode:'playback_dup',capture_audio_sdk:36,capture_audio_required:true,capture_audio_sdk_evidence_file:eid+'.capture-sdk.txt',capture_audio_sdk_evidence_sha256:'c'.repeat(64),capture_audio_verified:true,capture_audio_end:{mode:'playback_dup',sdk:36,required:true,sdk_evidence_file:eid+'.capture-sdk.txt',sdk_evidence_sha256:'c'.repeat(64)},audio_streams:1,playback_proof_kind:'native_audio',native_audio:Object.fromEntries(['start','end'].map(phase=>[phase,{state:'started',uid:10203,pid:528,piid:73615,package_uid_verified:true,foreign_started:0,...Object.fromEntries([['evidence','audio.txt'],['package_uid','package-uid.txt'],['uid_owners','uid-owners.txt']].flatMap(([k,s])=>[[k+'_file',eid+'-playback-'+phase+'.'+s],[k+'_sha256','a'.repeat(64)]]))}]))};}
test('正式录前音量Step判真实媒体回读，不能用静音内容电平代替',async()=>{
 const contract=parseYaml(readFileSync('product-map/contracts/douyin_video_processing.yaml','utf8'));
 const step=contract.activities.find(a=>a.key==='qualification').steps.find(s=>s.key==='unmute_before_record');
 const {judgeSteps}=await import('../step-judge.mjs');const d=mkdtempSync(join(tmpdir(),'media-step-'));
 try{const log=join(d,'activity.log');writeFileSync(log,'audio_rejected reason=silent_or_unknown_volume\n');
 const deployed=JSON.parse(readFileSync('services/phone-adb-controller/plans/douyin_video_processing.steps.json','utf8')).steps.find(s=>s.key.endsWith('.unmute_before_record'));
 for(const s of [{key:'volume',at:'qualification',mode:'checkpoint',readback:step.dod.readback},deployed]){
  const spec={steps:[s]};
  const ok=judgeSteps({spec,stage:'qualification',ctx:{logFile:log,metrics:{media_volume_failures:0}}});assert.equal(ok.steps[0].pass,true);
  const bad=judgeSteps({spec,stage:'qualification',ctx:{logFile:log,metrics:{media_volume_failures:1}}});assert.equal(bad.steps[0].pass,false);
  const unknown=judgeSteps({spec,stage:'qualification',ctx:{logFile:log,metrics:{}}});assert.equal(unknown.steps[0].pass,null);
 }
 }finally{rmSync(d,{recursive:true,force:true});}
});

test('采集返回partial时，Commander收到真实部分状态而不是脚本正常返回后的completed',async()=>{
 const {runWorkflow}=await import('../leadgen-workflow.mjs');const receipts=[];
 const result=await runWorkflow({activities:[{key:'collect_videos'},{key:'cleanup'}],context:{},
  handlers:{collect_videos:async()=>({status:'partial',stop_reason:'capture_failed',counts:{persisted:11,failed:1}}),cleanup:async()=>({released:true})},
  commander:async receipt=>{receipts.push(receipt);return {action:'continue',reason:'依据真实状态'};},record:async()=>{}});
 assert.equal(result.status,'partial');
 assert.equal(receipts.find(r=>r.activity==='collect_videos'&&r.phase==='after').evidence.status,'partial');
 assert.equal(receipts.find(r=>r.activity==='collect_videos'&&r.phase==='after').evidence.result.counts.persisted,11);
});

test('Commander叫停后不执行下一活动，锁内清场仍有前后Commander回执', async () => {
  const {runWorkflow} = await import('../leadgen-workflow.mjs');
  const executed=[],records=[];
  const result=await runWorkflow({activities:['source','dedup','cleanup'].map(key=>({key})),
    context:{run_id:'r'},handlers:Object.fromEntries(['source','dedup','cleanup'].map(k=>[k,async()=>{executed.push(k);return {ok:true};}])),
    commander:async r=>({action:r.activity==='source'&&r.phase==='after'?'finish':'continue',reason:'实际证据'}),
    record:async r=>records.push(r)});
  assert.deepEqual(executed,['source','cleanup']);
  assert.equal(result.status,'partial');
  assert.equal(records.filter(r=>r.activity==='cleanup'&&['before','after'].includes(r.phase)).length,2);
});

test('独立读回未知或失败不能让执行exit0成为活动成功',async()=>{
  const {runWorkflow}=await import('../leadgen-workflow.mjs');let cleaned=0;
  const r=await runWorkflow({activities:[{key:'source'},{key:'dedup'},{key:'cleanup'}],context:{},
    handlers:{source:async()=>({cards:2}),dedup:async()=>{throw Error('不应执行');},cleanup:async()=>{cleaned++;return {};}},
    commander:async()=>({action:'continue',reason:'检查证据'}),record:async()=>{},
    verify:async()=>({verified:false,reason:'必需步骤读不到'})});
  assert.equal(r.status,'failed');assert.equal(cleaned,1);
  assert.equal(r.results.find(a=>a.activity==='dedup').status,'blocked');
});

test('触达暂停预检不取单、不触碰手机、不发送',async()=>{
  const {createHandlers:rawCreateHandlers}=await import('../leadgen-workflow.mjs');const createHandlers=withCompanyFixture(rawCreateHandlers);
  const handlers=createHandlers({root:'/tmp',env:{HOME:'/tmp',P:'jinoshengyuan-work',WF_BRAIN_WORKFLOW:'douyin_lead_outreach'},
    rpc:async()=>{throw Error('不允许取单');},execute:async()=>{throw Error('不允许操作手机');}});
  assert.equal((await handlers.preflight()).status,'paused');
  await assert.rejects(handlers.send_dm(),/暂停/);
});

test('profile注册的手机与命令serial不符时，在拿锁与手势前拒绝',async()=>{
  const {createHandlers:rawCreateHandlers}=await import('../leadgen-workflow.mjs');const createHandlers=withCompanyFixture(rawCreateHandlers);const dir=mkdtempSync(join(tmpdir(),'leadgen-identity-'));const calls=[];
  try{
    const handlers=createHandlers({root:dir,env:{HOME:dir,WFR_RUN_DIR:dir,P:'work',SERIAL:'S1',WFR_TAG:'run'},rpc:async()=>{},
      execute:async(command,args)=>{calls.push({command,args});return {code:0,stdout:command==='adb'?'device\n':'serial=S2\n',stderr:''};}});
    await assert.rejects(handlers.preflight(),/serial不一致/);
    assert.ok(!calls.some(c=>c.args.includes('lock-acquire')||c.args.includes('input')));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('评分必须按实际处理ID读回，缺行在工件记录verified=false',async()=>{
  const {createHandlers:rawCreateHandlers}=await import('../leadgen-workflow.mjs');const createHandlers=withCompanyFixture(rawCreateHandlers);const dir=mkdtempSync(join(tmpdir(),'leadgen-score-'));const ops=[];
  try{
    const h=createHandlers({root:dir,env:{HOME:dir,WFR_RUN_DIR:dir,WFR_TAG:'run',LEADGEN_LINE:'jinuo'},
      rpc:async body=>{ops.push(body.request);return {result:body.request.op==='score'?{scored:1,ids:['c1']}:{verified:false,failures:1}};}});
    assert.equal((await h.scoring()).scoring_readback_failures,1);
    assert.deepEqual(ops[1].ids,['c1']);
    assert.equal(JSON.parse(readFileSync(join(dir,'run-scoring-readback.json'),'utf8')).verified,false);
    assert.deepEqual(JSON.parse(readFileSync(join(dir,'activity.log'),'utf8').trim().replace(/^SORT_STATS /,'')),{scored:1,ids:['c1']});
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('活动抛错与Commander断线都必须清场，并保留失败状态',async()=>{
  const {runWorkflow}=await import('../leadgen-workflow.mjs');
  for(const failure of ['script','model']){
    let cleaned=0;
    const result=await runWorkflow({activities:[{key:'preflight'},{key:'cleanup'}],context:{},
      handlers:{preflight:async()=>{throw Error('SCRIPT_FAILED');},cleanup:async()=>{cleaned++;return {released:true};}},
      commander:async r=>{if(failure==='model')throw Error('AUTH_UNAVAILABLE');return {action:'continue',reason:'记录失败'};},record:async()=>{}});
    assert.equal(cleaned,1);assert.equal(result.status,'failed');
  }
});

test('采集成功必须有同视频完成标记；非零返回时即使有LEAD也不能落完成',async()=>{
  const {parseCollection}=await import('../leadgen-workflow.mjs');
  const row='LEAD\t昵称\tid\tpersonal\t想报名\t今天\t陕西\t视频标题\t词\t西安\thttps://www.douyin.com/user/u\thttps://www.douyin.com/video/7646309328911907195';
  assert.throws(()=>parseCollection({code:6,stdout:row},'7646309328911907195'),/采集/);
  assert.throws(()=>parseCollection({code:0,stdout:row},'7646309328911907195'),/完成标记/);
  const comments=parseCollection({code:0,stdout:row+'\nCOLLECTION\t7646309328911907195\tcollected\t1'},'7646309328911907195');
  assert.equal(comments.length,1);assert.equal(comments[0].commentBody,'想报名');
  assert.deepEqual(parseCollection({code:0,stdout:'COLLECTION\t7646309328911907195\tno_comments\t0'},'7646309328911907195'),[]);
});

// 暂停流程没有本批设备锁，不能拿别批锁清场或伪报close-app通过。
test('暂停触达的清场标记skipped，保留partial而不伪造手机清场',async()=>{
 const {createHandlers,runWorkflow}=await import('../leadgen-workflow.mjs');let calls=0,verified=[];
 const handlers=createHandlers({root:'/tmp',env:{HOME:'/tmp',P:'work',WF_BRAIN_WORKFLOW:'douyin_lead_outreach'},
 rpc:async()=>{calls++;throw Error('不可调用');},execute:async()=>{calls++;throw Error('不可操作');}});
 const result=await runWorkflow({activities:[{key:'preflight'},{key:'cleanup'}],context:{},handlers,
 commander:async()=>({action:'continue',reason:'保留暂停'}),record:async()=>{},verify:async a=>{verified.push(a.key);return {verified:true};}});
 assert.equal(result.status,'partial');assert.equal(result.results[1].status,'skipped');
 assert.equal(calls,0);assert.deepEqual(verified,[]);
});

test('部分取链失败必须把活动记partial，不能把部分结果记completed',async()=>{
 const {runWorkflow}=await import('../leadgen-workflow.mjs');let next=0;
 const r=await runWorkflow({activities:[{key:'write_videos'},{key:'qualification'},{key:'cleanup'}],context:{},
 handlers:{write_videos:async()=>({status:'partial',persisted:1,failures:[{reason:'copy_failed'}]}),qualification:async()=>{next++;},cleanup:async()=>({status:'skipped',no_lock:true})},
 commander:async()=>({action:'continue',reason:'保留部分失败证据'}),record:async()=>{},verify:async()=>({verified:true})});
 assert.equal(r.status,'partial');assert.equal(r.results[0].status,'partial');assert.equal(next,0);
});

test('需要140秒的取链能够完整入库，但不能越过活动剩余预算',async()=>{
 const {createHandlers:rawCreateHandlers}=await import('../leadgen-workflow.mjs');const createHandlers=withCompanyFixture(rawCreateHandlers);
 // 明示的设备模拟：140秒代表本次真机nonce+UI重抓+复制+归位的完整动作，并不实际睡眠。
 for(const remaining of [480000,30000]){
  const dir=mkdtempSync(join(tmpdir(),'leadgen-link-envelope-'));
  const profile='test-profile',videoId='7663337150875733275',written=[],timeouts=[];
  const own=join(dir,'own.json'),registry=join(dir,'accounts.tsv');
  writeFileSync(own,JSON.stringify({nicknames:[],ids:[]}));writeFileSync(registry,`${profile}\ttest-account\n`);
  const env={HOME:dir,WFR_RUN_DIR:dir,WFR_TAG:'new-budget-run',P:profile,SERIAL:'test-serial',LEADGEN_LINE:'jinuo',LEADGEN_LIMIT:'1',
   DOUYIN_PHONE_ADB:'/test/phone-controller',DOUYIN_PHONE_TMP_ROOT:dir,DOUYIN_ACCOUNT_REGISTRY:registry,OWN_ACCOUNTS_CONF:own};
  const execute=async(command,args,opts={})=>{
   let stdout='';
   if(command==='adb')stdout=args.includes('get-state')?'device\n':args.includes('telephony.registry')?'mCallState=0\n':'';
   else if(command==='zsh')stdout='100\t200\t00:20\t目标视频\t别人\t0\n';
   else if(command==='/test/phone-controller'){
    const op=args[2]==='--lock-owner'?args[4]:args[2];
    if(op==='preflight')stdout='serial=test-serial\n';
    if(op==='lock-acquire')stdout='lock=acquired\n';
    if(op==='lock-refresh')stdout='lock=refreshed\n';
    if(op==='account-current')stdout='douyin_id=test-account\n';
    if(op==='search-kw-matches')stdout='kw_matches=1\n';
    if(op==='search-video-tab'){
     const path=join(dir,'evidence',profile,`${args[3]}-aftertab.xml`);mkdirSync(join(dir,'evidence',profile),{recursive:true});
     writeFileSync(path,'<hierarchy><node resource-id="com.ss.android.ugc.aweme:id/et_search_kw" text="人工智能训练师"/></hierarchy>');
    }
    if(op==='search-video-cards')stdout='100\t200\t00:20\t目标视频\t别人\t0\nvideo_tab=1\nend_of_results=1\nevidence=/test/grid.xml\n';
    if(op==='current-video-link'){
     timeouts.push(opts.timeoutMs);
     if(opts.timeoutMs<140000)throw Error('EXECUTION_DEADLINE');
     stdout=`return_mode=results\ncontent_type=video\nvideo_id=${videoId}\nshort_url=https://v.douyin.com/newTarget/\n`;
    }
   }
   return {code:0,stdout,stderr:''};
  };
  const rpc=async body=>{
   if(body.kind==='keywords')return {result:['人工智能训练师']};
   if(body.request.op==='inspect_videos')return {result:written.map(video_id=>({video_id,line_key:'jinuo'}))};
   assert.equal(body.request.op,'discover');written.push(body.request.video.videoId);return {result:{status:'pending',inserted:true}};
  };
  try{
   const h=createHandlers({root:dir,env,rpc,execute});
   await h.preflight();h.state.budgetDeadline=Date.now()+remaining;
   const result=await h.collect_videos();
   assert.equal(result.persisted,remaining===480000?1:0);
   assert.deepEqual(written,remaining===480000?[videoId]:[]);
   assert.equal(timeouts.length,1);assert.ok(timeouts[0]<=remaining);
   if(remaining===30000)assert.match(JSON.stringify(result.failures),/EXECUTION_DEADLINE/);
  }finally{rmSync(dir,{recursive:true,force:true});}
 }
});


test('资格动作容纳已实测的打开与身份核验组合耗时，仍受活动剩余预算限制',async()=>{
 const {createHandlers:rawCreateHandlers}=await import('../leadgen-workflow.mjs');const createHandlers=withCompanyFixture(rawCreateHandlers);
 // 明示模拟：真机打开约145秒，加取链、归位、录音、远端判定，整体需520秒。
 for(const remaining of [1800000,250000]){
  const dir=mkdtempSync(join(tmpdir(),'leadgen-qualification-envelope-'));
  const videoId='7663337150875733275',timeouts=[],released=[];
  const env={HOME:dir,WFR_RUN_DIR:dir,WFR_TAG:'fresh-processing',P:'work',SERIAL:'test',LEADGEN_LINE:'jinuo'};
  const rpc=async body=>{
   const op=body.request.op;
   if(op==='claim_videos')return {result:[{video_id:videoId,video_url:'https://v.douyin.com/fresh/',title:'新视频',keyword:'训练师',judgment_status:'pending'}]};
   if(op==='release_video')released.push(body.request.video_id);
   return {result:{}};
  };
  const execute=async(command,args,opts)=>{
   assert.equal(args[0],join(dir,'process-queued-video.sh'));assert.equal(args[1],'qualification');
   timeouts.push(opts.timeoutMs);
   if(opts.timeoutMs<520000)throw Error('EXECUTION_DEADLINE');
   writeFileSync(join(dir,`fresh-processing-identity-${videoId}.json`),JSON.stringify({verified:true,observed_video_id:videoId,content_type:'video'}));
   writeFileSync(join(dir,`fresh-processing-recording-${videoId}.json`),JSON.stringify({version:2,...fakeNativeProof(`fresh-processing-v${videoId}-qualification-record`),run:'fresh-processing',video_id:videoId,evidence_id:`fresh-processing-v${videoId}-qualification-record`,playback_verified:true,playback_package:'com.ss.android.ugc.aweme',playback_state:1,playback_end_state:1,media_volume_verified:true,media_volume:1,audio_status:'usable',mean_volume_db:-35}));
   return {code:0,stdout:`QUAL\t${videoId}\tmatched\tjudged\n`,stderr:''};
  };
  try{
   const h=createHandlers({root:dir,env,rpc,execute});h.state.budgetDeadline=Date.now()+remaining;
   if(remaining===1800000){const result=await h.qualification();assert.equal(result.matched,1);assert.equal(result.videos_verified,1);assert.deepEqual(result.failures,[]);}
   else{await assert.rejects(h.qualification(),/EXECUTION_DEADLINE/);await h.cleanup();assert.deepEqual(released,[videoId]);}
   assert.equal(timeouts.length,1);assert.ok(timeouts[0]<=remaining);assert.ok(timeouts[0]<=900000);
  }finally{rmSync(dir,{recursive:true,force:true});}
 }
});

test('dup静音捕获本轮保持pending，不能作为视频内容写PG拒绝或进入模型',async()=>{
 const {createHandlers:rawCreateHandlers}=await import('../leadgen-workflow.mjs');const createHandlers=withCompanyFixture(rawCreateHandlers);
 for(const badScope of [false,true]){
  const dir=mkdtempSync(join(tmpdir(),'silent-workflow-')),id='7663337150875733275',ops=[];
  const env={HOME:dir,WFR_RUN_DIR:dir,WFR_TAG:'silent-processing',P:'work',SERIAL:'test',LEADGEN_LINE:'jinuo'};
  const rpc=async body=>{const op=body.request.op;ops.push(op);if(op==='claim_videos')return {result:[{video_id:id,video_url:'https://v.douyin.com/fresh/',title:'新视频',keyword:'AI',judgment_status:'pending'}]};if(op==='reject_recording')return {result:{verified:true,video_id:id,verdict:'rejected',kind:'recording_silent'}};return {result:{}};};
  const execute=async()=>{writeFileSync(join(dir,`silent-processing-identity-${id}.json`),JSON.stringify({verified:true,observed_video_id:id,content_type:'video'}));writeFileSync(join(dir,`silent-processing-recording-${id}.json`),JSON.stringify({version:2,...fakeNativeProof(`silent-processing-v${id}-qualification-record`),run:badScope?'other':'silent-processing',video_id:id,evidence_id:`silent-processing-v${id}-qualification-record`,playback_verified:true,playback_package:'com.ss.android.ugc.aweme',playback_state:1,playback_end_state:1,media_volume_verified:true,media_volume:1,audio_status:'silent',capture_audio_verified:false,mean_volume_db:-91}));return {code:0,stdout:`QUAL\t${id}\trejected\trecording_silent\n`,stderr:''};};
  try{const h=createHandlers({root:dir,env,rpc,execute});h.state.budgetDeadline=Date.now()+1800000;const r=await h.qualification();assert.equal(r.matched,0);if(badScope){assert.equal(r.failures.length,1);assert.ok(!ops.includes('reject_recording'));assert.equal(r.media_volume_failures,1);}else{assert.equal(r.failures.length,1);assert.ok(!ops.includes('reject_recording'));assert.equal(r.recordings_silent_rejected,0);}}finally{rmSync(dir,{recursive:true,force:true});}
 }
});


test('已匹配视频的身份核验也包含打开与取链，不能沿用单取链时限',async()=>{
 const {createHandlers:rawCreateHandlers}=await import('../leadgen-workflow.mjs');const createHandlers=withCompanyFixture(rawCreateHandlers);
 const dir=mkdtempSync(join(tmpdir(),'leadgen-matched-identity-envelope-')),videoId='7657464669711404351';
 try{
  const h=createHandlers({root:dir,env:{HOME:dir,WFR_RUN_DIR:dir,WFR_TAG:'fresh-matched',P:'work',LEADGEN_LINE:'jinuo'},
   rpc:async b=>({result:b.request.op==='claim_videos'?[{video_id:videoId,judgment_status:'matched'}]:{}}),
   execute:async(c,a,o)=>{assert.equal(a[1],'identity');if(o.timeoutMs<420000)throw Error('EXECUTION_DEADLINE');assert.ok(o.timeoutMs<=480000);
    writeFileSync(join(dir,`fresh-matched-identity-${videoId}.json`),JSON.stringify({verified:true,observed_video_id:videoId,content_type:'video'}));
    return {code:0,stdout:'',stderr:''};}});
  h.state.budgetDeadline=Date.now()+1800000;
  const r=await h.qualification();assert.equal(r.matched,1);assert.equal(r.videos_verified,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('采集组合预算包含重新打开核验和本身480秒采集，但不越过活动剩余预算',async()=>{
 const {createHandlers:rawCreateHandlers}=await import('../leadgen-workflow.mjs');const createHandlers=withCompanyFixture(rawCreateHandlers);
 for(const remaining of [7200000,250000]){
  const dir=mkdtempSync(join(tmpdir(),'leadgen-collection-envelope-')),videoId='7657464669711404351',stored=[],timeouts=[];
  try{
   const h=createHandlers({root:dir,env:{HOME:dir,WFR_RUN_DIR:dir,WFR_TAG:'fresh-collection',P:'work',LEADGEN_LINE:'jinuo'},
    rpc:async b=>{if(b.request.op==='claim_videos')return {result:[{video_id:videoId,video_url:'https://www.douyin.com/video/'+videoId,judgment_status:'matched'}]};
     if(b.request.op==='comment_history')return {result:{version:1,status:'verified',line:'jinuo',line_key:'jinuo',run:'fresh-collection',source_run:null,video_id:videoId,video_url:b.request.video_url,rows:[]}};
     if(b.request.op==='comment_history_readback')return {result:{verified:true,video_id:videoId,ids:[],history_verified:0}};
     if(b.request.op==='collect'){stored.push(b.request.video_id);return {result:{comments:0,inserted:0,history_verified:0,coverage:0}};}return {result:{}};},
    execute:async(c,a,o)=>{if(a[1]==='identity')return {code:0,stdout:'',stderr:''};
     assert.equal(a[1],'collection');timeouts.push(o.timeoutMs);if(o.timeoutMs<800000)throw Error('EXECUTION_DEADLINE');
     return {code:0,stdout:`COLLECTION\t${videoId}\tno_comments\t0\nRESCAN\t${videoId}\t0\nAVATAR_RECOVERY\t${videoId}\t0\n`,stderr:''};}});
   h.state.budgetDeadline=Date.now()+1800000;await h.qualification();h.state.budgetDeadline=Date.now()+remaining;
   const r=await h.collection();assert.equal(r.collected,remaining===7200000?1:0);assert.deepEqual(stored,remaining===7200000?[videoId]:[]);
   assert.equal(timeouts.length,1);assert.ok(timeouts[0]<=remaining);assert.ok(timeouts[0]<=960000);
   if(remaining===250000)assert.match(JSON.stringify(r.failures),/EXECUTION_DEADLINE/);
  }finally{rmSync(dir,{recursive:true,force:true});}
 }
});


test('全部业务与清场验收通过后，清场after的正常finish应汇总为completed',async()=>{
 const {runWorkflow}=await import('../leadgen-workflow.mjs');const records=[];
 const r=await runWorkflow({activities:[{key:'write_videos'},{key:'cleanup'}],context:{},
  handlers:{write_videos:async()=>({persisted:2}),cleanup:async()=>({lock_released:1,no_lock:true})},
  commander:async q=>({action:q.activity==='cleanup'&&q.phase==='after'?'finish':'continue',reason:'本批收尾完成'}),
  record:async q=>records.push(q),verify:async()=>({verified:true})});
 assert.equal(r.status,'completed');assert.ok(r.results.every(a=>a.status==='completed'&&a.verification.verified));
 assert.equal(records.filter(q=>['before','after'].includes(q.phase)).length,4);
});

test('无锁清场skipped后的finish属于正常结束，不能把已完成评分标为partial',async()=>{
 const {runWorkflow}=await import('../leadgen-workflow.mjs');
 const r=await runWorkflow({activities:[{key:'scoring'},{key:'cleanup'}],context:{},
  handlers:{scoring:async()=>({scored:2}),cleanup:async()=>({status:'skipped',no_lock:true})},
  commander:async q=>({action:q.activity==='cleanup'&&q.phase==='after'?'finish':'continue',reason:'没有设备锁，无需清场'}),
  record:async()=>{},verify:async()=>({verified:true})});
 assert.equal(r.status,'completed');assert.equal(r.results[1].status,'skipped');
});

test('正常清场finish不能掩盖业务失败、清场验收失败、partial或escalate',async()=>{
 const {runWorkflow}=await import('../leadgen-workflow.mjs');
 for(const scenario of ['business_failure','cleanup_failure','cleanup_partial','cleanup_escalate']){
  const r=await runWorkflow({activities:[{key:'source'},{key:'cleanup'}],context:{},
   handlers:{source:async()=>{if(scenario==='business_failure')throw Error('真实失败');return {};},
    cleanup:async()=>scenario==='cleanup_partial'?{status:'partial',failures:[{reason:'未释放锁'}]}:{}},
   commander:async q=>({action:q.activity==='cleanup'&&q.phase==='after'?(scenario==='cleanup_escalate'?'escalate':'finish'):'continue',reason:'保留实际失败'}),
   record:async()=>{},verify:async a=>({verified:!(scenario==='cleanup_failure'&&a.key==='cleanup')})});
  assert.equal(r.status,['business_failure','cleanup_failure'].includes(scenario)?'failed':'partial');
 }
});

function upstreamFixture(dir,profile='work'){
 const source='capture101',upstream=join(dir,'douyin_video_discovery-'+source),current=join(dir,'douyin_video_processing-process102');mkdirSync(upstream);mkdirSync(current);
 return {source,upstream,current,env:{HOME:dir,WFR_RUN_DIR:current,WFR_TAG:'process102',P:profile,LEADGEN_LINE:'jinuo',LEADGEN_SOURCE_RUN:source,OWN_ACCOUNTS_CONF:join(dir,'own.json')}};
}
async function freezeFixture(f){const {digest}=await import('../runtime-definition.mjs');for(const [dir,cap,tag] of [[f.upstream,'douyin_video_discovery',f.source],[f.current,'douyin_video_processing','process102']]){
 const body={files:{},deployment:{source_commit:'a'.repeat(40)},run_identity:{capability:cap,tag,profile:f.env.P}};writeFileSync(join(dir,'run-definition.json'),JSON.stringify({...body,snapshot_sha256:digest(body)}));
 }writeFileSync(f.env.OWN_ACCOUNTS_CONF,JSON.stringify({nicknames:['自己'],ids:[]}));}
test('102按上游实际VID和PG终态判重，旧批次已采不重录、同标题新VID保留',async()=>{
 const {createHandlers:rawCreateHandlers}=await import('../leadgen-workflow.mjs');const createHandlers=withCompanyFixture(rawCreateHandlers),dir=mkdtempSync(join(tmpdir(),'intake102-'));
 try{const f=upstreamFixture(dir);await freezeFixture(f);const ids=['7685662999797258417','7684845398191623487','7684845398191623488'];
 const videos=ids.map((videoId,i)=>({videoId,title:'同标题',author:i===2?'自己':'别人'}));writeFileSync(join(f.upstream,'discovery-progress.json'),JSON.stringify({run:f.source,profile:'work',videos,captures:videos}));
 const requests=[];const h=createHandlers({root:dir,env:f.env,rpc:async b=>{requests.push(b.request);return {result:ids.map((video_id,i)=>({video_id,line_key:'jinuo',judgment_status:'pending',process_status:i===0?'评论已采':'待判定',harvest_batch:'old101'}))};}});
 const result=await h.dedup();assert.deepEqual(h.state.intakeVideoIds,[ids[1]]);assert.equal(result.skipped_completed,1);assert.equal(result.skipped_own,1);assert.equal(result.historical_filter_verified,1);assert.equal(requests[0].op,'inspect_videos');assert.deepEqual(requests[0].video_ids,ids);
 const proof=JSON.parse(readFileSync(join(f.current,'process102-intake-readback.json'),'utf8'));assert.equal(proof.verified,true);assert.deepEqual(proof.eligible_video_ids,[ids[1]]);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('102上游清单身份错或PG缺VID时拒绝，不退回全库认领',async()=>{
 const {createHandlers:rawCreateHandlers}=await import('../leadgen-workflow.mjs');const createHandlers=withCompanyFixture(rawCreateHandlers),dir=mkdtempSync(join(tmpdir(),'intake102-guard-'));
 try{const f=upstreamFixture(dir);await freezeFixture(f);const file=join(f.upstream,'discovery-progress.json'),video={videoId:'7685662999797258417',title:'标题',author:'别人'};let calls=0;
 writeFileSync(file,JSON.stringify({run:'wrong',profile:'work',videos:[video],captures:[video]}));const h=createHandlers({root:dir,env:f.env,rpc:async()=>{calls++;return {result:[]};}});
 await assert.rejects(h.dedup(),/上游/);assert.equal(calls,0);
 writeFileSync(file,JSON.stringify({run:f.source,profile:'work',videos:[video],captures:[video]}));await assert.rejects(h.dedup(),/PG.*缺/);assert.equal(calls,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('真实workflow包装器达到目标且仅有消失候选缺口时保留成功，数据库缺行仍partial',async()=>{
 const {createHandlers:rawCreateHandlers}=await import('../leadgen-workflow.mjs');const createHandlers=withCompanyFixture(rawCreateHandlers);
 for(const missingRow of [false,true]){
  const dir=mkdtempSync(join(tmpdir(),'leadgen-relocation-wrapper-')),registry=join(dir,'accounts.tsv');
  writeFileSync(registry,'work\ttest-account\n');
  let reads=0;const stored=[],taps=[];const vid='7663337150875733275';
  const env={HOME:dir,WFR_RUN_DIR:dir,WFR_TAG:'relocation-run',P:'work',SERIAL:'test-serial',LEADGEN_LINE:'jinuo',LEADGEN_LIMIT:'1',DOUYIN_PHONE_ADB:'/test/phone',DOUYIN_ACCOUNT_REGISTRY:registry};
  const execute=async(command,args)=>{
   let stdout='';
   if(command==='adb')stdout=args.includes('get-state')?'device\n':args.includes('telephony.registry')?'mCallState=0\n':'';
   if(command==='/test/phone'){
    const op=args[2]==='--lock-owner'?args[4]:args[2];
    const values={preflight:'serial=test-serial\n','lock-acquire':'lock=acquired\n','lock-refresh':'lock=refreshed\n','account-current':'douyin_id=test-account\n','search-kw-matches':'kw_matches=1\n'};stdout=values[op]||'';
    if(op==='search-video-cards'){
     reads++;stdout=(reads===1?'100\t200\t00:20\t消失候选\t甲\n':'')+'300\t200\t00:20\t存在候选\t乙\nvideo_tab=1\nloading=0\nend_of_results=1\nevidence=/test/fresh.xml\n';
    }
    if(op==='tap-evidence')taps.push(args[3]);
    if(op==='current-video-link')stdout='return_mode=results\ncontent_type=video\nvideo_id='+vid+'\nshort_url=https://v.douyin.com/freshLink/\n';
   }
   return {code:0,stdout,stderr:''};
  };
  const rpc=async body=>{
   if(body.kind==='keywords')return {result:['AI']};
   if(body.request.op==='discover'){stored.push(body.request.video.videoId);return {result:{status:'pending',inserted:true}};}
   assert.equal(body.request.op,'inspect_videos');return {result:missingRow?[]:stored.map(video_id=>({video_id,line_key:'jinuo'}))};
  };
  try {
   const h=createHandlers({root:dir,env,rpc,execute});await h.preflight();const out=await h.collect_videos();
   assert.equal(out.stop_reason,'limit_reached');assert.equal(out.counts.persisted,1);assert.equal(out.known_gaps[0].kind,'candidate_disappeared');
   assert.deepEqual(taps,['300']);assert.equal(out.status,missingRow?'partial':undefined);
   assert.equal(out.manifest_verified,missingRow?0:1);
  }finally{rmSync(dir,{recursive:true,force:true});}
 }
});


test('历史输入逐VID局部绑定，scope失败不假报通过；无qualified明确0样本',async()=>{
 const {createHandlers:rawCreateHandlers}=await import('../leadgen-workflow.mjs');const createHandlers=withCompanyFixture(rawCreateHandlers);
 const dir=mkdtempSync(join(tmpdir(),'history-workflow-')),ids=['7646309328911907195','7646309328911907196'],actions=[];
 try{
  const env={HOME:dir,WFR_RUN_DIR:dir,WFR_TAG:'history-run',P:'work',LEADGEN_LINE:'jinuo',LEADGEN_SOURCE_RUN:'source101',QUEUED_COMMENT_HISTORY_FILE:'/outside/previous-video.json'};
  const h=createHandlers({root:dir,env,rpc:async({request:q})=>{
   if(q.op==='claim_videos')return {result:ids.map(video_id=>({video_id,video_url:'https://www.douyin.com/video/'+video_id,judgment_status:'matched'}))};
   if(q.op==='renew_video')return {result:{renewed:true}};
   if(q.op==='comment_history')return {result:{version:1,status:'verified',line:q.video_id===ids[0]?'jinuo':'yuesheng',line_key:'jinuo',run:'history-run',source_run:'source101',video_id:q.video_id,video_url:q.video_url,rows:[]}};
   if(q.op==='collect')return {result:{comments:0,inserted:0,history_verified:0,coverage:0}};
   if(q.op==='comment_history_readback')return {result:{verified:true,video_id:q.video_id,ids:[],history_verified:0}};
   throw Error('unexpected '+q.op);
  },execute:async(c,a,o)=>{actions.push({args:a,env:o.env});if(a[1]==='identity'){assert.equal(o.env.QUEUED_COMMENT_HISTORY_FILE,'');return {code:0,stdout:'',stderr:''};}
   assert.equal(o.env.QUEUED_COMMENT_HISTORY_FILE,join(dir,'history-run-history-'+a[3]+'.json'));
   return {code:0,stdout:`COLLECTION\t${a[3]}\tcollected\t0\nRESCAN\t${a[3]}\t0\nAVATAR_RECOVERY\t${a[3]}\t0\n`,stderr:''};}});
  await h.qualification();const r=await h.collection();
  assert.equal(r.status,'partial');assert.equal(r.history_required_count,2);assert.equal(r.history_scoped_count,1);assert.equal(r.history_consumption_count,1);assert.equal(r.history_failures,1);
  assert.equal(r.history_scope_verified,0);assert.equal(r.history_consumption_readback,0);assert.equal(actions.filter(a=>a.args[1]==='collection').length,1);
  assert.equal(env.QUEUED_COMMENT_HISTORY_FILE,'/outside/previous-video.json');
  const empty=createHandlers({root:dir,env:{...env,WFR_TAG:'empty'},rpc:async()=>{throw Error('无qualified不应查PG历史');},execute:async()=>{throw Error('无qualified不应动手机');}});
  const zero=await empty.collection();assert.equal(zero.history_required_count,0);assert.equal(zero.history_scoped_count,0);assert.equal(zero.history_consumption_count,0);assert.equal(zero.history_failures,0);assert.equal(zero.history_scope_verified,0);assert.equal(zero.history_consumption_readback,0);assert.equal(zero.status,undefined);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

async function sampleFixture(dir){
 const f=upstreamFixture(dir);Object.assign(f.env,{SERIAL:'S',WFR_RUN_ID:'douyin_video_processing-process102',WFR_ATTEMPT:'a1',WF_BRAIN_WORKFLOW:'douyin_video_processing',LEADGEN_COMMENT_LIMIT:'5'});await freezeFixture(f);
 const {digest}=await import('../runtime-definition.mjs');
 const file=join(f.current,'run-definition.json'),{snapshot_sha256,...body}=JSON.parse(readFileSync(file));body.sampling_input={schema_version:1,workflow_key:'douyin_video_processing',run_tag:'process102',profile:'work',serial:'S',line:'jinuo',source_run:f.source,comment_limit:5};writeFileSync(file,JSON.stringify({...body,snapshot_sha256:digest(body)}));
 const videoId='7646309328911907195',video={videoId,title:'AI',author:'别人'};writeFileSync(join(f.upstream,'discovery-progress.json'),JSON.stringify({run:f.source,profile:'work',videos:[video],captures:[video]}));
 return {...f,videoId,url:'https://www.douyin.com/video/'+videoId};
}
for(const mode of ['quota','footer','bad_pg','fake_footer','budget'])test('真实102 wrapper采样持租约与PG状态 '+mode,async()=>{
 const {createHandlers:rawCreateHandlers}=await import('../leadgen-workflow.mjs');const createHandlers=withCompanyFixture(rawCreateHandlers),dir=mkdtempSync(join(tmpdir(),'sample-wrapper-'));
 try{
  const f=await sampleFixture(dir),calls=[],n=mode==='footer'?3:mode==='budget'?1:5;
  const h=createHandlers({root:dir,env:f.env,rpc:async({request:q})=>{
   calls.push(q);
   if(q.op==='inspect_videos')return {result:[{video_id:f.videoId,line_key:'jinuo',judgment_status:'matched',process_status:'待判定'}]};
   if(q.op==='claim_videos'){assert.deepEqual(q.video_ids,[f.videoId]);return {result:[{video_id:f.videoId,video_url:f.url,judgment_status:'matched'}]};}
   if(q.op==='renew_video'||q.op==='release_video')return {result:{}};
   if(q.op==='comment_history')return {result:{version:1,status:'verified',line:'jinuo',line_key:'jinuo',run:f.env.WFR_TAG,source_run:f.source,video_id:f.videoId,video_url:f.url,rows:[]}};
   if(q.op==='collect_partial'||q.op==='collect')return {result:{comments:n,inserted:n,history_verified:0,coverage:mode==='bad_pg'?4:n}};
   if(q.op==='comment_history_readback')return {result:{verified:true,video_id:f.videoId,ids:[],history_verified:0}};
   if(q.op==='sample_readback')return {result:{verified:true,video_id:f.videoId,coverage:n,rows:q.rows.map((r,i)=>({...r,id:'id'+i}))}};
   throw Error('unexpected '+q.op);
  },execute:async(c,a,o)=>{
   if(a[1]==='identity')return {code:0,stdout:'',stderr:''};assert.equal(o.env.LEADGEN_COMMENT_LIMIT,'5');
   const rows=Array.from({length:n},(_,i)=>`LEAD\t昵称\tperson${i}\tpersonal\t完整正文${i}\t今天\t陕西\tAI\tAI\t西安\thttps://www.douyin.com/user/u\t${f.url}`).join('\n');
   const marker=mode==='budget'?`partial\t${n}`:mode==='footer'?`collected\t${n}\t${n}\t5\tfooter=1`:mode==='fake_footer'?`collected\t${n}`:`sampled\t${n}\t5\t5`;
   return {code:mode==='budget'?7:0,stdout:rows+`\nCOLLECTION\t${f.videoId}\t${marker}\nRESCAN\t${f.videoId}\t0\nAVATAR_RECOVERY\t${f.videoId}\t0\n`,stderr:''};
  }});
  await h.dedup();await h.qualification();const out=await h.collection();
  if(mode==='bad_pg'||mode==='fake_footer'||mode==='budget'){assert.equal(out.status,'partial');assert.deepEqual(out.fulfilled_sample_video_ids,[]);}
  else {assert.deepEqual(out.fulfilled_sample_video_ids,[f.videoId]);assert.equal(out.videos_collected,mode==='footer'?1:0);assert.equal(out.videos_sampled,mode==='quota'?1:0);assert.equal(out.comments_inserted,n);assert.equal(out.sampling_receipts[0].all_comments_scanned,mode==='footer');assert.ok(!('pg_rows' in out.sampling_receipts[0]));const receipt=JSON.parse(readFileSync(join(f.current,'process102-sampling-readback.json')));assert.equal(receipt.videos[0].pg_rows.length,n);}
  if(mode==='quota')assert.ok(calls.some(q=>q.op==='collect_partial')&&!calls.some(q=>q.op==='collect'));
  if(mode==='fake_footer')assert.ok(!calls.some(q=>q.op==='collect'));
  await h.cleanup();if(mode==='quota')assert.ok(calls.some(q=>q.op==='release_video'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

for(const bad of ['none','pg_missing','wrong_quota','wrong_source','failed_activity','blocked_activity','wrong_profile','wrong_serial','wrong_line','wrong_sha','wrong_vid','bad_digest','symlink','missing_run_id','wrong_run_id','false_verification','missing_verification','wrong_attempt','bad_binding_digest','wrong_frozen_serial','failed_run','failed_run_bad_binding','failed_run_wrong_final_scope','failed_run_wrong_id'])test('前序采样排除只限同源冻结事实且intake/claim一致 '+bad,async()=>{
 const {createHandlers:rawCreateHandlers}=await import('../leadgen-workflow.mjs');const createHandlers=withCompanyFixture(rawCreateHandlers),{digest}=await import('../runtime-definition.mjs'),dir=mkdtempSync(join(tmpdir(),'sample-prior-'));
 try{
  const f=await sampleFixture(dir),priorDir=join(dir,'douyin_video_processing-prior102');mkdirSync(priorDir);
  const {snapshot_sha256,...current}=JSON.parse(readFileSync(join(f.current,'run-definition.json')));
  const si={...current.sampling_input,run_tag:'prior102',...(bad==='wrong_quota'?{comment_limit:4}:{}),...(bad==='wrong_source'?{source_run:'other101'}:{}),...(bad==='wrong_profile'?{profile:'other'}:{}),...(bad==='wrong_serial'?{serial:'other'}:{}),...(bad==='wrong_line'?{line:'yuesheng'}:{})};
  const prior={...current,...(bad==='wrong_sha'?{deployment:{source_commit:'b'.repeat(40)}}:{}),sampling_input:si,run_identity:{...current.run_identity,tag:'prior102',serial:bad==='wrong_frozen_serial'?'OTHER':'S',run_id:'douyin_video_processing-prior102'}};writeFileSync(join(priorDir,'run-definition.json'),JSON.stringify({...prior,snapshot_sha256:bad==='bad_digest'?'0'.repeat(64):digest(prior)}));
  mkdirSync(join(priorDir,'run-bindings'));const bound='douyin_video_processing-prior102__a1';writeFileSync(join(priorDir,'run-bindings/a1.request.json'),JSON.stringify({run_id:bound,runtime_snapshot_sha256:['bad_binding_digest','failed_run_bad_binding'].includes(bad)?'0'.repeat(64):digest(prior),body:{}}));writeFileSync(join(priorDir,'run-bindings/a1.ack.json'),JSON.stringify({binding:{id:'binding-prior',run_id:bound}}));
  const pg_rows=Array.from({length:5},(_,i)=>({id:'id'+i,douyinId:'person'+i,commentBody:'全文'+i,sourceVideoUrl:f.url}));
  const v={video_id:bad==='wrong_vid'?'7646309328911907196':f.videoId,video_url:f.url,source_run:f.source,comment_limit:5,stop_reason:'quota_reached',coverage:5,comments:5,comments_inserted:5,history_verified:0,all_comments_scanned:false,pg_rows};
  writeFileSync(join(priorDir,'prior102-sampling-readback.json'),JSON.stringify({verified:true,run_id:bound,sampling_input:si,videos:[v]}));chmodSync(join(priorDir,'prior102-sampling-readback.json'),0o600);if(bad==='symlink'){const file=join(priorDir,'prior102-sampling-readback.json');const body=readFileSync(file);rmSync(file);writeFileSync(join(dir,'outside-receipt.json'),body,{mode:0o600});symlinkSync(join(dir,'outside-receipt.json'),file);}const {pg_rows:privateRows,...publicReceipt}=v;
  writeFileSync(join(priorDir,'split-result.json'),JSON.stringify({status:bad.startsWith('failed_run')?'failed':'partial',...(bad==='missing_run_id'?{}:{run_id:['wrong_run_id','failed_run_wrong_id'].includes(bad)?'other__a1':bad==='wrong_attempt'?'douyin_video_processing-prior102__a2':bound}),profile:bad==='failed_run_wrong_final_scope'?'other':'work',sampling_input:si,source_commit:current.deployment.source_commit,workflow_key:'douyin_video_processing',results:[{activity:'collection',status:bad==='failed_activity'||bad.startsWith('failed_run')?'failed':bad==='blocked_activity'?'blocked':'partial',...(bad==='missing_verification'?{}:{verification:{verified:bad!=='false_verification'&&!bad.startsWith('failed_run')}}),result:{sampling_receipts:[publicReceipt]}}]}));
  const calls=[];const h=createHandlers({root:dir,env:f.env,rpc:async({request:q})=>{calls.push(q);if(q.op==='inspect_videos')return {result:[{video_id:f.videoId,line_key:'jinuo',judgment_status:'matched',process_status:'待判定'}]};if(q.op==='sample_readback')return {result:{verified:bad!=='pg_missing',video_id:f.videoId,coverage:5,rows:pg_rows}};if(q.op==='claim_videos')return {result:[]};throw Error('unexpected '+q.op);}});
  if(!['none','wrong_quota','wrong_source','failed_run'].includes(bad))await assert.rejects(h.dedup());
  else {const out=await h.dedup();assert.deepEqual(h.state.intakeVideoIds,bad==='none'?[]:[f.videoId]);assert.equal(out.skipped_sample_fulfilled,bad==='none'?1:0);if(bad==='failed_run'){assert.equal(out.ignored_failed_sampling_runs,1);assert.equal(calls.filter(q=>q.op==='sample_readback').length,0);const proof=JSON.parse(readFileSync(join(f.current,'process102-intake-readback.json')));assert.deepEqual(proof.ignored_failed_sampling_runs,[{prior_run:'prior102',run_id:bound,status:'failed'}]);}await h.qualification();assert.deepEqual(calls.find(q=>q.op==='claim_videos').video_ids,h.state.intakeVideoIds);}
 }finally{rmSync(dir,{recursive:true,force:true});}
});

for(const verified of [true,false])test('采样collection partial仍执行原独立verify，不把失败回执兑现 '+verified,async()=>{
 const {runWorkflow}=await import('../leadgen-workflow.mjs');let called=0;
 const out=await runWorkflow({activities:[{key:'collection'},{key:'cleanup'}],context:{},handlers:{collection:async()=>({status:'partial',sampling_receipts:[{video_id:'7646309328911907195',coverage:5}],remaining_video_ids:['other']}),cleanup:async()=>({status:'skipped'})},commander:async()=>({action:'continue'}),record:async()=>{},verify:async(a)=>{assert.equal(a.key,'collection');called++;return {verified};}});
 assert.equal(called,1);assert.equal(out.status,verified?'partial':'failed');assert.equal(out.results[0].verification.verified,verified);assert.equal(out.results[0].status,verified?'partial':'failed');
});
for(const config of [{budget:undefined,max:960},{budget:'1620',max:2100},{budget:'6720',max:7200},{budget:'1620',max:2100,globalNear:true}])test('逐视频collection显式预算真实作用且保持全局截止 '+JSON.stringify(config),async()=>{
 const {createHandlers:rawCreateHandlers}=await import('../leadgen-workflow.mjs');const createHandlers=withCompanyFixture(rawCreateHandlers),{digest}=await import('../runtime-definition.mjs');const dir=mkdtempSync(join(tmpdir(),'collection-explicit-budget-'));
 try{const f=await sampleFixture(dir);if(config.budget){f.env.QUEUED_VIDEO_COLLECTION_SECONDS=config.budget;const file=join(f.current,'run-definition.json'),{snapshot_sha256,...body}=JSON.parse(readFileSync(file));body.sampling_input.collection_budget_s=Number(config.budget);writeFileSync(file,JSON.stringify({...body,snapshot_sha256:digest(body)}));}
 Object.assign(f.env,{WF_RUN_MAX_SECONDS:'3600',WF_RUN_START_TS:String(Math.floor(Date.now()/1000)-(config.globalNear?3598:0))});const actions=[],requests=[];
 const h=createHandlers({root:dir,env:f.env,rpc:async({request:q})=>{requests.push(q);if(q.op==='inspect_videos')return {result:[{video_id:f.videoId,line_key:'jinuo',judgment_status:'matched',process_status:'待采评论'}]};if(q.op==='claim_videos')return {result:[{video_id:f.videoId,video_url:f.url,judgment_status:'matched'}]};if(q.op==='renew_video')return {result:{renewed:true}};if(q.op==='comment_history')return {result:{version:1,status:'verified',line:'jinuo',line_key:'jinuo',run:f.env.WFR_TAG,source_run:f.source,video_id:f.videoId,video_url:f.url,rows:[]}};if(q.op==='collect')return {result:{comments:0,inserted:0,history_verified:0,coverage:0}};if(q.op==='comment_history_readback')return {result:{verified:true,video_id:f.videoId,ids:[],history_verified:0}};if(q.op==='sample_readback')return {result:{verified:true,video_id:f.videoId,coverage:0,rows:[]}};throw Error('unexpected '+q.op);},execute:async(c,a,o)=>{actions.push({a,o});return {code:0,stdout:a[1]==='identity'?'':`COLLECTION\t${f.videoId}\tno_comments\t0\nRESCAN\t${f.videoId}\t0\nAVATAR_RECOVERY\t${f.videoId}\t0\n`,stderr:''};}});
 await h.dedup();await h.qualification();h.state.budgetDeadline=Date.now()+7200*1000;await h.collection();const a=actions.find(a=>a.a[1]==='collection');assert.equal(a.o.maxDurationS,config.max);assert.equal(a.o.env.QUEUED_VIDEO_COLLECTION_SECONDS,config.budget||'480');assert.ok(a.o.timeoutMs<=config.max*1000);if(config.globalNear)assert.ok(a.o.timeoutMs<=2000,'实际global剩余不能被7200 Activity替代');
 const proof=JSON.parse(readFileSync(join(f.current,'process102-collection-budget-readback.json')));assert.equal(proof.collection_budget_s,Number(config.budget||480));assert.equal(proof.action_max_duration_s,config.max);assert.equal(proof.sampling_input?.collection_budget_s,config.budget?Number(config.budget):undefined);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('非法collection预算在RPC和手机动作之前拒绝',async()=>{const {createHandlers:rawCreateHandlers}=await import('../leadgen-workflow.mjs');const createHandlers=withCompanyFixture(rawCreateHandlers);for(const value of ['0','-1','6721','abc','1.5','0480',''])assert.throws(()=>createHandlers({root:'/tmp',env:{HOME:'/tmp',QUEUED_VIDEO_COLLECTION_SECONDS:value},rpc:async()=>{throw Error('不可RPC');},execute:async()=>{throw Error('不可phone');}}),/采集.*预算/);});
test('仅真实冻结采样intake才给claim matched优先flag',async()=>{const {createHandlers:rawCreateHandlers}=await import('../leadgen-workflow.mjs');const createHandlers=withCompanyFixture(rawCreateHandlers);const dir=mkdtempSync(join(tmpdir(),'sample-claim-priority-'));try{const f=await sampleFixture(dir),qs=[];const h=createHandlers({root:dir,env:f.env,rpc:async({request:q})=>{qs.push(q);return {result:q.op==='inspect_videos'?[{video_id:f.videoId,line_key:'jinuo',judgment_status:'matched',process_status:'待采评论'}]:[]};}});await h.dedup();await h.qualification();const q=qs.find(q=>q.op==='claim_videos');assert.equal(q.prefer_matched,true);assert.equal(q.source_run,f.source);assert.deepEqual(q.video_ids,[f.videoId]);}finally{rmSync(dir,{recursive:true,force:true});}});
test('真实videoAction显式1620必须突破旧960但不越过截止',async()=>{const {createHandlers:rawCreateHandlers}=await import('../leadgen-workflow.mjs');const createHandlers=withCompanyFixture(rawCreateHandlers);const dir=mkdtempSync(join(tmpdir(),'budget-action-red-')),vid='7646309328911907195',url='https://www.douyin.com/video/'+vid;try{let seen;const env={HOME:dir,WFR_RUN_DIR:dir,WFR_TAG:'budget-test',P:'work',LEADGEN_LINE:'jinuo',LEADGEN_SOURCE_RUN:'source101',QUEUED_VIDEO_COLLECTION_SECONDS:'1620',WF_RUN_MAX_SECONDS:'3600'};const h=createHandlers({root:dir,env,rpc:async({request:q})=>({result:q.op==='claim_videos'?[{video_id:vid,video_url:url,judgment_status:'matched'}]:q.op==='comment_history'?{version:1,status:'verified',line:'jinuo',line_key:'jinuo',run:'budget-test',source_run:'source101',video_id:vid,video_url:url,rows:[]}:q.op==='collect'?{comments:0,inserted:0,history_verified:0,coverage:0}:q.op==='comment_history_readback'?{verified:true,video_id:vid,ids:[],history_verified:0}:{}}),execute:async(c,a,o)=>{if(a[1]==='collection'){seen=o;return {code:0,stdout:`COLLECTION\t${vid}\tno_comments\t0\nRESCAN\t${vid}\t0\nAVATAR_RECOVERY\t${vid}\t0\n`,stderr:''};}return {code:0,stdout:'',stderr:''};}});await h.qualification();await h.collection();assert.equal(seen.maxDurationS,2100,'原960秒进程上限与显式1620软预算冲突');assert.equal(seen.env.QUEUED_VIDEO_COLLECTION_SECONDS,'1620');}finally{rmSync(dir,{recursive:true,force:true});}});
test('collection到实际global截止不再renew/history/phone，不假完成',async()=>{const {createHandlers:rawCreateHandlers}=await import('../leadgen-workflow.mjs');const createHandlers=withCompanyFixture(rawCreateHandlers);const dir=mkdtempSync(join(tmpdir(),'collection-expired-')),vid='7646309328911907195',url='https://www.douyin.com/video/'+vid;try{let phase='qualification';const env={HOME:dir,WFR_RUN_DIR:dir,WFR_TAG:'expired',P:'work',LEADGEN_LINE:'jinuo',WF_RUN_MAX_SECONDS:'3600',QUEUED_VIDEO_COLLECTION_SECONDS:'1620'};const h=createHandlers({root:dir,env,rpc:async({request:q})=>{if(phase==='collection')throw Error('expired must not RPC');return {result:q.op==='claim_videos'?[{video_id:vid,video_url:url,judgment_status:'matched'}]:{}};},execute:async()=>{assert.equal(phase,'qualification');return {code:0,stdout:'',stderr:''};}});await h.qualification();phase='collection';env.WF_RUN_START_TS=String(Math.floor(Date.now()/1000)-3601);h.state.budgetDeadline=Date.now()+7200000;const r=await h.collection();assert.equal(r.status,'partial');assert.equal(r.videos_collected,0);assert.match(r.failures[0].reason,/EXECUTION_DEADLINE/);}finally{rmSync(dir,{recursive:true,force:true});}});

test('无本轮播放证明的静音录制不得经PG业务拒绝，cleanup释放视频租约',async()=>{
 const {createHandlers:rawCreateHandlers}=await import('../leadgen-workflow.mjs');const createHandlers=withCompanyFixture(rawCreateHandlers);
 const dir=mkdtempSync(join(tmpdir(),'paused-recording-workflow-')),id='7663337150875733275',ops=[];
 const env={HOME:dir,WFR_RUN_DIR:dir,WFR_TAG:'paused-processing',P:'work',SERIAL:'test',LEADGEN_LINE:'jinuo'};
 const rpc=async body=>{const op=body.request.op;ops.push(op);if(op==='claim_videos')return {result:[{video_id:id,video_url:'https://v.douyin.com/fresh/',title:'新视频',keyword:'AI',judgment_status:'pending'}]};if(op==='reject_recording')return {result:{verified:true,video_id:id,verdict:'rejected',kind:'recording_silent'}};return {result:{}};};
 const execute=async()=>{writeFileSync(join(dir,`paused-processing-identity-${id}.json`),JSON.stringify({verified:true,observed_video_id:id,content_type:'video'}));writeFileSync(join(dir,`paused-processing-recording-${id}.json`),JSON.stringify({version:1,run:'paused-processing',video_id:id,evidence_id:`paused-processing-v${id}-qualification-record`,media_volume_verified:true,media_volume:1,audio_status:'silent',mean_volume_db:-91}));return {code:0,stdout:`QUAL\t${id}\trejected\trecording_silent\n`,stderr:''};};
 try{const h=createHandlers({root:dir,env,rpc,execute});h.state.budgetDeadline=Date.now()+1800000;const result=await h.qualification();assert.equal(result.matched,0);assert.ok(!ops.includes('reject_recording'),'播放器未播放的死寂不是业务淘汰');assert.equal(result.failures.length,1);await h.cleanup();assert.ok(ops.includes('release_video'));}finally{rmSync(dir,{recursive:true,force:true});}
});

// 现场 run/eid 保留原格式，客户 ID/正文显式模拟；不冒称 mock proof 为真机证据。
for(const fault of ['none','mixed_3new_2history','legacy_hyphen','wrong_run','wrong_vid','wrong_sha','traversal','missing_proof','wrong_identity','wrong_profile_sha','unverified','pg_readback'])test('HISTORY正式underscore消费及拒绝边界 '+fault,async()=>{
 const {createHandlers:rawCreateHandlers}=await import('../leadgen-workflow.mjs');const createHandlers=withCompanyFixture(rawCreateHandlers),{createHash}=await import('node:crypto');
 const dir=mkdtempSync(join(tmpdir(),'history-formal-eid-')),vid='7664177880607247666',url='https://v.douyin.com/Vn_ErpbjvQg/',run=fault==='legacy_hyphen'?'history-run':'codexp_blue_20261012T113917Z_102_01';
 const row={id:'11111111-1111-4111-8111-111111111111',douyin_id:'mock_history_user',comment_body:'模拟历史评论'},calls=[];
 const mixed=fault==='mixed_3new_2history',historyRows=mixed?[row,{...row,id:'22222222-2222-4222-8222-222222222222',douyin_id:'mock_history_user2',comment_body:'模拟历史评论2'}]:[row];
 const env={HOME:dir,WFR_RUN_DIR:dir,WFR_TAG:run,P:'work',LEADGEN_LINE:'AI人工智能训练师',LEADGEN_SOURCE_RUN:'codexp_blue_20261012T113917Z_101'};
 try{
  const h=createHandlers({root:dir,env,rpc:async({request:q})=>{
   calls.push(q);
   if(q.op==='claim_videos')return {result:[{video_id:vid,video_url:url,judgment_status:'matched'}]};
   if(q.op==='renew_video')return {result:{renewed:true}};
   if(q.op==='comment_history')return {result:{version:1,status:'verified',line:env.LEADGEN_LINE,line_key:'jinuo',run,source_run:env.LEADGEN_SOURCE_RUN,video_id:vid,video_url:url,rows:historyRows}};
   if(q.op==='collect')return {result:{comments:mixed?3:0,inserted:mixed?3:0,history_verified:historyRows.length,coverage:mixed?5:1}};
   if(q.op==='comment_history_readback')return {result:{verified:fault!=='pg_readback',video_id:vid,ids:historyRows.map(r=>r.id),history_verified:historyRows.length}};
   throw Error('unexpected '+q.op);
  },execute:async(c,a,o)=>{
   if(a[1]==='identity')return {code:0,stdout:'',stderr:''};
   const receiptBytes=readFileSync(o.env.QUEUED_COMMENT_HISTORY_FILE),sha=createHash('sha256').update(receiptBytes).digest('hex');
   let eid=`${run}-v${vid}-collection-person3-t1`;
   if(fault==='wrong_run')eid=eid.replace(run,'other_run');
   if(fault==='wrong_vid')eid=eid.replace(vid,'7664177880607247667');
   if(fault==='traversal')eid='../'+eid;
   const proof={version:1,verified:fault!=='unverified',video_id:vid,...row,identity_eid:fault==='wrong_identity'?'other-proof':eid,history_sha256:sha,profile_sha256:fault==='wrong_profile_sha'?'bad':'7e69e339a25101bdd37ff1be62dec132b10c73ec40b77dc0d3091b6b59dd1176',returned_sha256:'b9a05eea17ee34cd229a4905d1866e8e9fa9eab7ee8faa7b7abbefb300ae59ec',comment_context_verified:true};
   // Wrong-scope proof is deliberately present: absence must not accidentally implement binding.
   if(!['missing_proof','traversal'].includes(fault))writeFileSync(join(dir,eid+'-history-readback.json'),JSON.stringify(proof),{mode:0o600});
   const key=Buffer.from(JSON.stringify([row.douyin_id,row.comment_body])).toString('base64');
   let extra='';
   if(mixed){const second=historyRows[1],eid2=`${run}-v${vid}-collection-person1-t1`;writeFileSync(join(dir,eid2+'-history-readback.json'),JSON.stringify({...proof,...second,identity_eid:eid2}),{mode:0o600});extra=`HISTORY\t${vid}\t${second.id}\t${Buffer.from(JSON.stringify([second.douyin_id,second.comment_body])).toString('base64')}\t${eid2}\t${sha}\n`+Array.from({length:3},(_,i)=>`LEAD\t模拟昵称\tmock_new${i}\tpersonal\t模拟新评论${i}\t今天\t陕西\tAI\tAI\t西安\thttps://www.douyin.com/user/mock${i}\t${url}\n`).join('');}
   return {code:0,stdout:extra+`HISTORY\t${vid}\t${row.id}\t${key}\t${eid}\t${fault==='wrong_sha'?'0'.repeat(64):sha}\nCOLLECTION\t${vid}\tcollected\t${mixed?3:0}\nRESCAN\t${vid}\t0\nAVATAR_RECOVERY\t${vid}\t0\n`,stderr:''};
  }});
  await h.qualification();const out=await h.collection();
  if(['none','mixed_3new_2history','legacy_hyphen'].includes(fault)){
   assert.equal(out.history_failures,0,JSON.stringify(out.failures));assert.equal(out.history_consumption_readback,1);assert.equal(out.history_verified,historyRows.length);assert.equal(out.comments_inserted,mixed?3:0);assert.equal(out.coverage,mixed?5:1);assert.equal(out.videos_collected,1);assert.equal(out.status,undefined);
   assert.ok(calls.find(q=>q.op==='collect').history.some(r=>r.identity_eid===`${run}-v${vid}-collection-person3-t1`));
   const consumption=JSON.parse(readFileSync(join(dir,`${run}-history-consumption-${vid}.json`)));assert.equal(consumption.verified,true);assert.equal(consumption.run,run);assert.deepEqual(new Set(consumption.ids),new Set(historyRows.map(r=>r.id)));
  }else{
   assert.equal(out.status,'partial');assert.equal(out.history_failures,1);assert.equal(out.history_consumption_readback,0);assert.equal(out.videos_collected,0);
   assert.equal(calls.some(q=>q.op==='collect'),fault==='pg_readback','invalid proof must fail before collect RPC');
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});

for(const mode of ['avatar','identity','missing_avatar','malformed_avatar'])test('真实collection解析分类恢复计数及正式探针/部署Step '+mode,async()=>{
 const {createHandlers:rawCreateHandlers}=await import('../leadgen-workflow.mjs'),createHandlers=withCompanyFixture(rawCreateHandlers),{judgeSteps}=await import('../step-judge.mjs');
 const dir=mkdtempSync(join(tmpdir(),'categorized-rescan-'));
 try{
  const f=await sampleFixture(dir),n=5,identity=mode==='identity'?2:0;
  const h=createHandlers({root:dir,env:f.env,rpc:async({request:q})=>{
   if(q.op==='inspect_videos')return {result:[{video_id:f.videoId,line_key:'jinuo',judgment_status:'matched',process_status:'待判定'}]};
   if(q.op==='claim_videos')return {result:[{video_id:f.videoId,video_url:f.url,judgment_status:'matched'}]};
   if(q.op==='renew_video'||q.op==='release_video')return {result:{}};
   if(q.op==='comment_history')return {result:{version:1,status:'verified',line:'jinuo',line_key:'jinuo',run:f.env.WFR_TAG,source_run:f.source,video_id:f.videoId,video_url:f.url,rows:[]}};
   if(q.op==='collect_partial')return {result:{comments:n,inserted:n,history_verified:0,coverage:n}};
   if(q.op==='comment_history_readback')return {result:{verified:true,video_id:f.videoId,ids:[],history_verified:0}};
   if(q.op==='sample_readback')return {result:{verified:true,video_id:f.videoId,coverage:n,rows:q.rows.map((r,i)=>({...r,id:'id'+i}))}};
   throw Error('unexpected '+q.op);
  },execute:async(c,a)=>{
   if(a[1]==='identity')return {code:0,stdout:'',stderr:''};
   const rows=Array.from({length:5},(_,i)=>`LEAD\t昵称\tperson${i}\tpersonal\t全文${i}\t今天\t陕西\tAI\tAI\t西安\thttps://www.douyin.com/user/u\t${f.url}`).join('\n');
   return {code:0,stdout:rows+`\nCOLLECTION\t${f.videoId}\tsampled\t5\t5\t5\nRESCAN\t${f.videoId}\t${identity}\n`+(mode==='missing_avatar'?'':`AVATAR_RECOVERY\t${f.videoId}\t${mode==='malformed_avatar'?'unknown':2}\n`),stderr:''};
  }});
  await h.dedup();await h.qualification();const out=await h.collection();
  if(mode.includes('avatar')&&mode!=='avatar'){assert.equal(out.status,'partial');assert.equal(out.videos_sampled,0);assert.match(out.failures[0].reason,/头像恢复/);return;}
  assert.equal(out.comments_inserted,5);assert.equal(out.avatar_recovery_count,2);assert.equal(out.identity_rescan_count,identity);assert.equal(out.rescan_count,identity);assert.equal(out.rescan_rate,identity);
  const spec=JSON.parse(readFileSync('services/phone-adb-controller/plans/douyin_video_processing.steps.json','utf8'));const step=spec.steps.find(s=>s.key.endsWith('.return_to_results'));const result=judgeSteps({spec:{steps:[step]},stage:'collection',ctx:{metrics:out}});assert.equal(result.steps[0].pass,mode==='avatar');
  const checks=parseYaml(readFileSync('services/phone-adb-controller/checks/douyin-video-processing.yaml','utf8')),probe=checks.probes.find(p=>p.key==='coll_rescan_rate');assert.equal(probe.expect.value,0.3);assert.equal(probe.probe.ref,'metrics.rescan_rate');assert.equal(out.rescan_rate<=probe.expect.value,mode==='avatar');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

// 263实机首错：qv_open身份取链失败先退出，未产录音proof；不得被lstat ENOENT改写成音量故障。
test('102上游取链失败保留首错，未读回录音的音量判未知且不采评论',async()=>{
 const {createHandlers:rawCreateHandlers}=await import('../leadgen-workflow.mjs');
 const {judgeSteps}=await import('../step-judge.mjs');
 const dir=mkdtempSync(join(tmpdir(),'qualification-upstream-failure-')),id='7696462490024676025';
 const env={HOME:dir,WFR_RUN_DIR:dir,WFR_TAG:'failed-open',P:'work',SERIAL:'test',LEADGEN_LINE:'jinuo'};
 const stderr='CLIPBOARD_NONCE_FIELD_ABSENT:typed\nCLIPBOARD_NONCE_PROOF_FAILED\nfailure_class=WRONG_FOREGROUND\n';
 const actions=[];
 try{
  const h=withCompanyFixture(rawCreateHandlers)({root:dir,env,
   rpc:async({request:q})=>({result:q.op==='claim_videos'?[{video_id:id,video_url:'https://www.douyin.com/video/'+id,judgment_status:'pending'}]:{}}),
   execute:async(_c,args)=>{actions.push(args[1]);return {code:4,stdout:'',stderr};}});
  const r=await h.qualification();
  assert.equal(r.status,'partial');assert.equal(r.matched,0);assert.equal(r.videos_verified,0);
  assert.equal(r.failures[0].code,4);assert.match(r.failures[0].reason,/CLIPBOARD_NONCE_FIELD_ABSENT:typed/);
  assert.doesNotMatch(r.failures[0].reason,/ENOENT/);
  assert.equal(r.recordings_required,0);assert.equal(r.recording_outcomes_failures,0);
  assert.equal(r.media_volume_failures,null);
  const spec={steps:[{key:'volume',at:'qualification',mode:'checkpoint',readback:{type:'metric',ref:'metrics.media_volume_failures',expect:{op:'==',value:0}}}]};
  assert.equal(judgeSteps({spec,stage:'qualification',ctx:{metrics:r}}).steps[0].pass,null);
  await h.collection();assert.deepEqual(actions,['qualification']);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('102动作exit0仍缺录音proof时保留真实证据失败，不能借首错修复放行',async()=>{
 const {createHandlers:rawCreateHandlers}=await import('../leadgen-workflow.mjs');
 const dir=mkdtempSync(join(tmpdir(),'qualification-missing-proof-')),id='7696462490024676025';
 try{
  const h=withCompanyFixture(rawCreateHandlers)({root:dir,env:{HOME:dir,WFR_RUN_DIR:dir,WFR_TAG:'missing-proof',P:'work',LEADGEN_LINE:'jinuo'},
   rpc:async({request:q})=>({result:q.op==='claim_videos'?[{video_id:id,video_url:'https://www.douyin.com/video/'+id,judgment_status:'pending'}]:{}}),
   execute:async()=>({code:0,stdout:`QUAL\t${id}\tmatched\tjudged\n`,stderr:''})});
  const r=await h.qualification();
  assert.equal(r.status,'partial');assert.equal(r.matched,0);assert.equal(r.recordings_required,1);
  assert.equal(r.recording_outcomes_failures,1);assert.equal(r.media_volume_failures,1);
  assert.equal(r.recordings_unverified,0);assert.match(r.failures[0].reason,/ENOENT/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('102 persisted failed record-start proof retains earliest native error and unknown volume',async()=>{
 const {createHandlers:rawCreateHandlers}=await import('../leadgen-workflow.mjs');
 const dir=mkdtempSync(join(tmpdir(),'qualification-native-proof-')),id='7696462490024676025',run='native-first';
 try{
  writeFileSync(join(dir,`${run}-recording-${id}.json`),JSON.stringify({version:2,run,video_id:id,evidence_id:`${run}-v${id}-qualification-record`,media_volume:null,media_volume_verified:false,earliest_error:{phase:'record_start',exit_code:2,stderr:'RECORD_NATIVE_AUDIO_UNVERIFIED state=unknown'}}));
  const h=withCompanyFixture(rawCreateHandlers)({root:dir,env:{HOME:dir,WFR_RUN_DIR:dir,WFR_TAG:run,P:'work',SERIAL:'test',LEADGEN_LINE:'jinuo'},rpc:async({request:q})=>({result:q.op==='claim_videos'?[{video_id:id,video_url:'https://www.douyin.com/video/'+id,judgment_status:'pending'}]:{}}),execute:async()=>({code:5,stdout:'',stderr:'recording_pending reason=media_volume_unverified'})});
  const r=await h.qualification();assert.equal(r.matched,0);assert.equal(r.status,'partial');assert.equal(r.failures[0].code,2);assert.equal(r.failures[0].stage,'record_start');assert.match(r.failures[0].reason,/RECORD_NATIVE_AUDIO_UNVERIFIED/);assert.equal(r.media_volume_failures,null);assert.equal(r.recordings_unverified,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('102 persisted failed set-speed proof retains earliest native error and unknown volume',async()=>{
 const {createHandlers:rawCreateHandlers}=await import('../leadgen-workflow.mjs');
 const dir=mkdtempSync(join(tmpdir(),'qualification-native-proof-')),id='7696462490024676025',run='native-first';
 try{
  writeFileSync(join(dir,`${run}-recording-${id}.json`),JSON.stringify({version:2,run,video_id:id,evidence_id:`${run}-v${id}-qualification-record`,media_volume:null,media_volume_verified:false,earliest_error:{phase:'set_playback_speed',exit_code:2,stderr:'SPEED_CONTROL_FAILED state=unknown'}}));
  const h=withCompanyFixture(rawCreateHandlers)({root:dir,env:{HOME:dir,WFR_RUN_DIR:dir,WFR_TAG:run,P:'work',SERIAL:'test',LEADGEN_LINE:'jinuo'},rpc:async({request:q})=>({result:q.op==='claim_videos'?[{video_id:id,video_url:'https://www.douyin.com/video/'+id,judgment_status:'pending'}]:{}}),execute:async()=>({code:5,stdout:'',stderr:'recording_pending reason=media_volume_unverified'})});
  const r=await h.qualification();assert.equal(r.matched,0);assert.equal(r.status,'partial');assert.equal(r.failures[0].code,2);assert.equal(r.failures[0].stage,'set_playback_speed');assert.match(r.failures[0].reason,/SPEED_CONTROL_FAILED/);assert.equal(r.media_volume_failures,null);assert.equal(r.recordings_unverified,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('qualification independently rejects forged or incomplete capture strategy proof',async()=>{
 const {createHandlers:rawCreateHandlers}=await import('../leadgen-workflow.mjs');
 const id='7696462490024676025',run='capture-contract',eid=run+'-v'+id+'-qualification-record';
 const changes=[{capture_audio_mode:'output'},{capture_audio_sdk:32},{capture_audio_required:false},{audio_streams:0},{capture_audio_verified:false},{capture_audio_sdk_evidence_file:'other.capture-sdk.txt'},{capture_audio_end:null},{capture_audio_end:{mode:'playback_dup',sdk:35,required:true,sdk_evidence_file:eid+'.capture-sdk.txt',sdk_evidence_sha256:'c'.repeat(64)}}];
 for(const change of changes){const dir=mkdtempSync(join(tmpdir(),'capture-proof-'));
 try{const ops=[];const h=withCompanyFixture(rawCreateHandlers)({root:dir,env:{HOME:dir,WFR_RUN_DIR:dir,WFR_TAG:run,P:'work',SERIAL:'test',LEADGEN_LINE:'jinuo'},rpc:async({request:q})=>{ops.push(q.op);return {result:q.op==='claim_videos'?[{video_id:id,video_url:'https://www.douyin.com/video/'+id,judgment_status:'pending'}]:{}};},execute:async()=>{writeFileSync(join(dir,run+'-identity-'+id+'.json'),JSON.stringify({verified:true,observed_video_id:id,content_type:'video'}));writeFileSync(join(dir,run+'-recording-'+id+'.json'),JSON.stringify({version:2,...fakeNativeProof(eid),run,video_id:id,evidence_id:eid,media_volume:1,media_volume_verified:true,playback_verified:true,playback_package:'com.ss.android.ugc.aweme',audio_status:'usable',mean_volume_db:-35,...change}));return {code:0,stdout:'QUAL\t'+id+'\tmatched\tjudged\n',stderr:''};}});h.state.budgetDeadline=Date.now()+1800000;const r=await h.qualification();assert.equal(r.matched,0,JSON.stringify(change));assert.equal(r.status,'partial');assert.equal(r.failures.length,1);assert.match(r.failures[0].reason,/RECORD_CAPTURE_STRATEGY_UNVERIFIED|RECORD_AUDIO_TRACK_UNVERIFIED/);assert.ok(!ops.includes('reject_recording'));}finally{rmSync(dir,{recursive:true,force:true});}}
});

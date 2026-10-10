import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

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
  const {createHandlers}=await import('../leadgen-workflow.mjs');
  const handlers=createHandlers({root:'/tmp',env:{HOME:'/tmp',P:'jinoshengyuan-work',WF_BRAIN_WORKFLOW:'douyin_lead_outreach'},
    rpc:async()=>{throw Error('不允许取单');},execute:async()=>{throw Error('不允许操作手机');}});
  assert.equal((await handlers.preflight()).status,'paused');
  await assert.rejects(handlers.send_dm(),/暂停/);
});

test('profile注册的手机与命令serial不符时，在拿锁与手势前拒绝',async()=>{
  const {createHandlers}=await import('../leadgen-workflow.mjs');const dir=mkdtempSync(join(tmpdir(),'leadgen-identity-'));const calls=[];
  try{
    const handlers=createHandlers({root:dir,env:{HOME:dir,WFR_RUN_DIR:dir,P:'work',SERIAL:'S1',WFR_TAG:'run'},rpc:async()=>{},
      execute:async(command,args)=>{calls.push({command,args});return {code:0,stdout:command==='adb'?'device\n':'serial=S2\n',stderr:''};}});
    await assert.rejects(handlers.preflight(),/serial不一致/);
    assert.ok(!calls.some(c=>c.args.includes('lock-acquire')||c.args.includes('input')));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('评分必须按实际处理ID读回，缺行在工件记录verified=false',async()=>{
  const {createHandlers}=await import('../leadgen-workflow.mjs');const dir=mkdtempSync(join(tmpdir(),'leadgen-score-'));const ops=[];
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
 const {createHandlers}=await import('../leadgen-workflow.mjs');
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
 const {createHandlers}=await import('../leadgen-workflow.mjs');
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


test('已匹配视频的身份核验也包含打开与取链，不能沿用单取链时限',async()=>{
 const {createHandlers}=await import('../leadgen-workflow.mjs');
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
 const {createHandlers}=await import('../leadgen-workflow.mjs');
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
     return {code:0,stdout:`COLLECTION\t${videoId}\tno_comments\t0\nRESCAN\t${videoId}\t0\n`,stderr:''};}});
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
 const {createHandlers}=await import('../leadgen-workflow.mjs'),dir=mkdtempSync(join(tmpdir(),'intake102-'));
 try{const f=upstreamFixture(dir);await freezeFixture(f);const ids=['7685662999797258417','7684845398191623487','7684845398191623488'];
 const videos=ids.map((videoId,i)=>({videoId,title:'同标题',author:i===2?'自己':'别人'}));writeFileSync(join(f.upstream,'discovery-progress.json'),JSON.stringify({run:f.source,profile:'work',videos,captures:videos}));
 const requests=[];const h=createHandlers({root:dir,env:f.env,rpc:async b=>{requests.push(b.request);return {result:ids.map((video_id,i)=>({video_id,line_key:'jinuo',judgment_status:'pending',process_status:i===0?'评论已采':'待判定',harvest_batch:'old101'}))};}});
 const result=await h.dedup();assert.deepEqual(h.state.intakeVideoIds,[ids[1]]);assert.equal(result.skipped_completed,1);assert.equal(result.skipped_own,1);assert.equal(result.historical_filter_verified,1);assert.equal(requests[0].op,'inspect_videos');assert.deepEqual(requests[0].video_ids,ids);
 const proof=JSON.parse(readFileSync(join(f.current,'process102-intake-readback.json'),'utf8'));assert.equal(proof.verified,true);assert.deepEqual(proof.eligible_video_ids,[ids[1]]);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('102上游清单身份错或PG缺VID时拒绝，不退回全库认领',async()=>{
 const {createHandlers}=await import('../leadgen-workflow.mjs'),dir=mkdtempSync(join(tmpdir(),'intake102-guard-'));
 try{const f=upstreamFixture(dir);await freezeFixture(f);const file=join(f.upstream,'discovery-progress.json'),video={videoId:'7685662999797258417',title:'标题',author:'别人'};let calls=0;
 writeFileSync(file,JSON.stringify({run:'wrong',profile:'work',videos:[video],captures:[video]}));const h=createHandlers({root:dir,env:f.env,rpc:async()=>{calls++;return {result:[]};}});
 await assert.rejects(h.dedup(),/上游/);assert.equal(calls,0);
 writeFileSync(file,JSON.stringify({run:f.source,profile:'work',videos:[video],captures:[video]}));await assert.rejects(h.dedup(),/PG.*缺/);assert.equal(calls,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('真实workflow包装器达到目标且仅有消失候选缺口时保留成功，数据库缺行仍partial',async()=>{
 const {createHandlers}=await import('../leadgen-workflow.mjs');
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
 const {createHandlers}=await import('../leadgen-workflow.mjs');
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
   return {code:0,stdout:`COLLECTION\t${a[3]}\tcollected\t0\nRESCAN\t${a[3]}\t0\n`,stderr:''};}});
  await h.qualification();const r=await h.collection();
  assert.equal(r.status,'partial');assert.equal(r.history_required_count,2);assert.equal(r.history_scoped_count,1);assert.equal(r.history_consumption_count,1);assert.equal(r.history_failures,1);
  assert.equal(r.history_scope_verified,0);assert.equal(r.history_consumption_readback,0);assert.equal(actions.filter(a=>a.args[1]==='collection').length,1);
  assert.equal(env.QUEUED_COMMENT_HISTORY_FILE,'/outside/previous-video.json');
  const empty=createHandlers({root:dir,env:{...env,WFR_TAG:'empty'},rpc:async()=>{throw Error('无qualified不应查PG历史');},execute:async()=>{throw Error('无qualified不应动手机');}});
  const zero=await empty.collection();assert.equal(zero.history_required_count,0);assert.equal(zero.history_scoped_count,0);assert.equal(zero.history_consumption_count,0);assert.equal(zero.history_failures,0);assert.equal(zero.history_scope_verified,0);assert.equal(zero.history_consumption_readback,0);assert.equal(zero.status,undefined);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

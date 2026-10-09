import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

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
    if(op==='search-video-cards')stdout='100\t200\t00:20\t目标视频\t别人\t0\n';
    if(op==='current-video-link'){
     timeouts.push(opts.timeoutMs);
     if(opts.timeoutMs<140000)throw Error('EXECUTION_DEADLINE');
     stdout=`content_type=video\nvideo_id=${videoId}\nshort_url=https://v.douyin.com/newTarget/\n`;
    }
   }
   return {code:0,stdout,stderr:''};
  };
  const rpc=async body=>{
   if(body.kind==='keywords')return {result:['人工智能训练师']};
   if(body.request.op==='history')return {result:[]};
   assert.equal(body.request.op,'discover');written.push(body.request.video.videoId);return {result:{status:'pending',inserted:true}};
  };
  try{
   const h=createHandlers({root:dir,env,rpc,execute});
   await h.preflight();await h.source();await h.dedup();h.state.budgetDeadline=Date.now()+remaining;
   const result=await h.write_videos();
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

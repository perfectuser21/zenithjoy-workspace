import {test} from 'node:test';
import assert from 'node:assert/strict';
import video from '../judge-video.js';
import qualify from '../qualify-video.js';
import queue from '../leadgen-queue.js';
const snapshot={company_id:'company-A',tenant_id:'tenant-A',company_key:'jinuo',version:7,wiki:{products:['产品A'],audiences:['测试人群'],customer_portrait:'画像A'},runtime_config:{video_judgment:{instructions:'判断规则A'},comment_scoring:{criteria:{A:'报名',B:'咨询',C:'互动','不相关':'跑题'},confidence_threshold:.8}},product_ids:['product-A'],policy_id:'policy-A'};
test('102缺运行号不触发判定',async()=>{let called=0;await assert.rejects(()=>video.runJudgeVideo({lineHint:'jinuo',pool:{},deps:{listPendingVideos:async()=>{called++;return[]}}}),/运行|RUN/);assert.equal(called,0)});
test('102实际判定包含冻结公司规则并返回版本',async()=>{let state,write;const r=await video.runJudgeVideo({lineHint:'jinuo',runId:'run-A',pool:{},deps:{freezeCompanyConfig:async()=>snapshot,listPendingVideos:async()=>[{video_id:'v1',title:'内容',comment_count:1}],judgeContent:async(_t,p)=>{state=p;return{verdict:'matched',reason:'符合'}},markVideoJudgment:async(_p,a)=>{write=a}}});assert.match(state,/产品A/);assert.match(state,/判断规则A/);assert.equal(r.config.version,7);assert.equal(write.configEvidence.company_id,'company-A')});
test('102旧版缓存重新判断且写本版来源',async()=>{let judged=0;const r=await qualify.runQualify({cmd:'judge',args:{line:'jinuo',videoId:'v1',run:'run-A'},pool:{},deps:{freezeCompanyConfig:async()=>snapshot,getVideo:async()=>({video_id:'v1',title:'内容',judgment_status:'matched',judgment_config:{company_id:'company-A',version:6}}),judgeContent:async()=>{judged++;return{verdict:'matched',reason:'新版'}},markVideoJudgment:async()=>{}}});assert.equal(judged,1);assert.equal(r.config.version,7)});
test('103缺启用配置不调用模型或写评分',async()=>{let called=0;await assert.rejects(()=>queue.queueRequest({connect:async()=>{called++;throw Error('unexpected')}},{line:'jinuo',run:'run-A',op:'score'},{freezeCompanyConfig:async()=>{throw Error('COMPANY_CONFIG_NOT_ACTIVE')},judgeComment:async()=>{called++}}),/COMPANY_CONFIG_NOT_ACTIVE/);assert.equal(called,0)});

test('102模型真实HTTP body保公司版本产品和视频规则',async()=>{
  const jev=(await import('../judge-jev.js')).default;
  let body;
  await video.runJudgeVideo({lineHint:'jinuo',runId:'run-http102',pool:{},deps:{freezeCompanyConfig:async()=>snapshot,listPendingVideos:async()=>[{video_id:'v1',title:'报名视频',comment_count:1}],markVideoJudgment:async()=>{},judgeContent:(text,profile)=>jev.judgeContent(text,profile,{apiKey:'explicit-test-only',httpPost:async(_url,b)=>{body=b;return{answers:{verdict:{choice:'matched',confidence:.99}}}}})}});
  assert.match(body.state,/company-A/);assert.match(body.state,/产品A/);assert.match(body.state,/判断规则A/);assert.match(body.state,/"version":7/);
});
test('103主判HTTP评分标准和阈值读取冻结配置，复核包含同版规则',async()=>{
  const comments=(await import('../judge-comment.js')).default;
  const bodies=[];
  const profile=JSON.stringify(snapshot);
  const result=await comments.judgeComment('要报名','视频',profile,{apiKey:'explicit-test-only',scoringRules:snapshot.runtime_config.comment_scoring,httpPost:async(_url,body)=>{bodies.push(body);return bodies.length===1?{answers:{grade:{choice:'A',confidence:.7}}}:{choices:[{message:{content:'B'}}]}}});
  assert.equal(result.grade,'B');assert.deepEqual(bodies[0].questions.grade.criteria,snapshot.runtime_config.comment_scoring.criteria);
  assert.match(bodies[0].state,/"version":7/);assert.match(bodies[1].messages[0].content,/评分规则/);assert.match(bodies[1].messages[0].content,/产品A/);
});

test('102显式VID旧rejected可被新版领取但不重置旧事实',async()=>{
  const calls=[];
  const client={query:async(sql,args)=>{calls.push({sql,args});return{rows:sql.startsWith('WITH')?[{video_id:'7646309328911907195',judgment_status:'rejected',judgment_config:{version:6}}]:[]}},release(){}};
  const rows=await queue.queueRequest({connect:async()=>client},{line:'jinuo',run:'run-new',op:'claim_videos',config_required:true,video_ids:['7646309328911907195']},{freezeCompanyConfig:async()=>snapshot});
  assert.equal(rows.length,1);const claim=calls.find(c=>c.sql.startsWith('WITH'));assert.match(claim.sql,/judgment_config IS NULL/);assert.equal(claim.args[6],'company-A');assert.equal(claim.args[7],'7');assert.ok(!/SET[^]*judgment_status\s*=/.test(claim.sql));
});
test('队列释放租约不读取公司配置，仍可恢复',async()=>{
  let froze=false;
  const result=await queue.queueRequest({query:async()=>({rowCount:1})},{line:'jinuo',run:'run-recovery',op:'release_video',video_id:'v1'},{freezeCompanyConfig:async()=>{froze=true;throw Error('COMPANY_CONFIG_MISSING')}});
  assert.equal(result.released,true);assert.equal(froze,false);
});
test('103评分落库与版本来源同一次SQL并返回冻结版本',async()=>{
  let n=0,update;
  const client={query:async(sql,args)=>{if(sql.startsWith('SELECT'))return{rows:n++===0?[{id:'comment-A',comment_body:'报名',source_video:'视频A'}]:[]};if(sql.startsWith('UPDATE'))update={sql,args};return{rows:[]}},release(){}};
  const result=await queue.queueRequest({connect:async()=>client},{line:'jinuo',run:'run-score',op:'score',limit:1},{freezeCompanyConfig:async()=>snapshot,judgeComment:async(_c,_v,profile,opts)=>{assert.match(profile,/产品A/);assert.equal(opts.scoringRules.confidence_threshold,.8);return{grade:'A',relevance:'相关',reason:'报名'}}});
  assert.match(update.sql,/judgment_config=\$5/);assert.equal(JSON.parse(update.args[4]).version,7);assert.equal(result.config.company_id,'company-A');
});
test('104缺公司快照不读取批准话术或领取订单',async()=>{
  const {createOutreachHandlers}=await import('../leadgen-outreach.mjs');
  let read=0;
  const h=createOutreachHandlers({env:{HOME:'/tmp/no-company-outreach-test',LEADGEN_SEND:'1',LEADGEN_LIMIT:'1',P:'jinoshengyuan-work',WFR_TAG:'r104',LEADGEN_LINE:'jinuo'},state:{source_commit:'a'.repeat(40),account:'test-id'},phone:async()=>{},queue:async()=>{},rpc:async()=>{read++;return {result:{profile:'jinoshengyuan-work',sender_douyin_id:'test-id',daily_cap:1,template:{message:'已批准'}}}}});
  await assert.rejects(()=>h.preflight(),/COMPANY_CONFIG_RECEIPT_MISSING/);assert.equal(read,0);
});
test('103上游配置未知时不能默取最新版本并调用模型',async()=>{
  let model=0;
  await assert.rejects(()=>queue.queueRequest({connect:async()=>{throw Error('unexpected DB')}},{line:'jinuo',run:'r103',source_run:'missing-r102',op:'score'},{freezeCompanyConfig:async(_p,input)=>{if(input.sourceRun==='missing-r102')throw Error('COMPANY_SOURCE_RUN_MISSING');return snapshot},judgeComment:async()=>{model++}}),/COMPANY_SOURCE_RUN_MISSING/);
  assert.equal(model,0);
});
test('101显式任务关键词与数量交PG运行冻结，不漂移',async()=>{
  const {companyKeywords}=(await import('../next-keywords.js')).default;
  let inputs;
  await companyKeywords({}, {lineHint:'jinuo',runId:'r101',limit:4,keywords:['任务新词']},{freezeCompanyConfig:async(_p,input)=>{inputs=input;return {...snapshot,runtime_config:{...snapshot.runtime_config,search_strategy:{keywords:['配置词']}}}}});
  assert.deepEqual(inputs.taskInputs,{keywords:['任务新词'],limit:4});
});
test('102选项字符串不能占用运行快照',async()=>{let calls=0;await assert.rejects(()=>video.runJudgeVideo({lineHint:'jinuo',runId:'--help',pool:{},deps:{freezeCompanyConfig:async()=>{calls++;return snapshot},listPendingVideos:async()=>[]}}),/RUN|运行/);assert.equal(calls,0)});
test('101无效词或非有限整数数量在冻结前拒绝，同run可修正恢复',async()=>{
 const {companyKeywords}=(await import('../next-keywords.js')).default;
 for(const input of [{keywords:[]},{keywords:['']},{keywords:[null]},{limit:Infinity},{limit:NaN},{limit:1.5}]) {
  let froze=0;
  await assert.rejects(()=>companyKeywords({}, {lineHint:'jinuo',runId:'r-bad',...input},{freezeCompanyConfig:async()=>{froze++;throw Error('unexpected freeze')}}),/COMPANY_TASK_KEYWORDS_INVALID|COMPANY_SEARCH_LIMIT_INVALID/);
  assert.equal(froze,0);
 }
});

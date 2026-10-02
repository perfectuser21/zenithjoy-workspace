import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyFixture, manifest } from './frozen-legacy-cli-fixture.mjs';
import { route, ids } from './workflow-cli-fixture.mjs';
import { keywordFixture } from './keyword-workflow-cli-fixture.mjs';
import { alignFixtureClock } from './fixture-clock.mjs';

function audit(name,old,current,legacy,modern){
 const directory=process.env.FROZEN_EQUIVALENCE_REPORT_DIR;if(!directory)return;
 mkdirSync(directory,{recursive:true});
 const jsonl=(f,file)=>{const path=join(f.home,file);return existsSync(path)?readFileSync(path,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];};
 writeFileSync(join(directory,name+'.json'),JSON.stringify({
  scenario:name,baseline:{commit:manifest.commit,archive_sha256:manifest.archive_sha256,files:manifest.files},
  old:{input:{words:readFileSync(join(old.home,'words'),'utf8'),config:old.read('fixture-config.json')},
   ...legacy,pool:[...old.pool.values()],leads:[...old.leads.values()],videos:[...old.videos.values()],pg:old.read('pg.json'),phone:old.read('phone-state.json'),
   root_log:readFileSync(join(old.home,'harvest-cron.log'),'utf8'),sql:jsonl(old,'sql-events.jsonl'),probes:jsonl(old,'probe-events.jsonl'),
   transport_events:old.persistedEvents,model_calls:old.modelCalls,model_checkpoints:old.modelSnapshots},
  current:{input:current.input,...modern,pool:[...current.pool.values()],leads:[...current.leads.values()],videos:[...current.videos.values()],pg:current.read('pg.json'),phone:current.read('phone-state.json'),
   log:current.log(),sql:jsonl(current,'sql-events.jsonl'),transport_events:current.persistedEvents,model_calls:current.modelCalls}
 },null,2)+'\n');
}

function assertVideoPool(old,current,items,{requireEquality=false,currentDiscoveryTime}={}){
  const expected=items.map(({id,title,word,comments},i)=>({record_id:'lead-'+(i+1),fields:{
    视频ID:id,视频链接:{link:`https://v.douyin.com/${id}/`,text:`https://v.douyin.com/${id}/`},
    '视频标题/文案':title,命中关键词:word,评论数:comments,发现时间:'2026-10-02 18:40(UTC+8)',
    处理状态:'评论已采',采收批次:'cecelia-cli-smoke',
  }}));
  assert.equal(old.videos.size,items.length,'旧push-videos真实飞书视频池行数必须完整保留');
  assert.deepEqual([...old.videos.values()],expected,'旧飞书视频池全部实际业务字段直接校验，不规范或删列');
  if(requireEquality) {
    const currentExpected=currentDiscoveryTime===undefined?expected:expected.map(row=>({...row,fields:{...row.fields,发现时间:currentDiscoveryTime}}));
    assert.deepEqual([...current.videos.values()],currentExpected,'原PRD要求配送push_videos：完成采集的视频池全部业务字段必须相等；预算案例显式保留真实发现时间');
  } else assert.deepEqual([...current.videos.values()],[],'首评论后取消尚未产生原生VIDEO成功行，新视频池必须零行，不能将局部评论伪装成完整视频确认');
  const writes=f=>f.calls.filter(row=>row.url.includes('/tables/'+route.video+'/records')&&['POST','PUT'].includes(row.method));
  assert.equal(writes(old).length,items.length,'旧视频池真实HTTP写入次数');
  assert.equal(writes(current).length,requireEquality?items.length:0,'视频池真实HTTP写入次数，运输边界允许其写入以避免自造零产物');
}
const twoVideos=(comments=1)=>[
  {id:ids[0],title:'AI课程1',word:'AI 考证',comments},
  {id:ids[1],title:'AI课程2',word:'AI 报名',comments},
];

const history={
 pool:{record_id:'pool-history',fields:{原始评论ID:'历史客户|900|已结算旧评论',处理状态:'已分拣',进入最终线索:true,评论者昵称:'历史客户',评论原文:'已结算旧评论',运行批次:'historical-run'}},
 lead:{record_id:'lead-1',fields:{抖音昵称:'客户1',抖音号:'101',重复命中次数:2}},
 video:{video_id:ids[2],harvest_batch:'historical-run',keyword:'历史词',video_url:`https://v.douyin.com/${ids[2]}/`,line_key:'jinuo',judgment_status:'matched',judgment_reason:'历史资格判定',transcript:'历史转写',process_status:'评论已采'},
};
function seedHistory(f){
 f.pool.set(history.pool.record_id,structuredClone(history.pool));f.leads.set(history.lead.record_id,structuredClone(history.lead));
 const db=JSON.parse(readFileSync(join(f.home,'pg.json'),'utf8'));db.videos[ids[2]]=structuredClone(history.video);writeFileSync(join(f.home,'pg.json'),JSON.stringify(db));
}

test('冻结历史整链与真实新compiler CLI：同两词评论/线索/视频池/PG完整字段直接对账', { timeout: 120000 }, async t => {
  const old = await legacyFixture(t);
  const current = await keywordFixture(t);
  seedHistory(old);seedHistory(current);
  const legacy = await old.run();
  alignFixtureClock(current);
  const modern = await current.run();
  audit('normal-history-duplicates',old,current,legacy,modern);
  assertVideoPool(old,current,twoVideos(),{requireEquality:true});
  assert.equal(legacy.output.code, 0, legacy.output.stderr + legacy.log);
  assert.equal(modern.output.code, 0, modern.output.stderr);
  assert.equal(legacy.final, modern.receipt.status, JSON.stringify({log:legacy.log,stderr:legacy.output.stderr,artifacts:legacy.artifacts}));
  assert.equal(old.pool.size, 3, legacy.log);
  assert.equal(current.pool.size, old.pool.size);
  assert.equal(current.leads.size, old.leads.size);
  assert.equal(old.leads.get('lead-1').fields.重复命中次数,3);assert.equal(current.leads.get('lead-1').fields.重复命中次数,3);
  assert.deepEqual(old.businessRows(old.pool), old.businessRows(current.pool));
  const leads = old.businessRows(current.leads).map(row => {
    const prior=old.leads.get(row.record_id);
    const suffix = `[comment-delivery:${route.pool}:pool-${Number(row.record_id.slice(5))+1}]`;
    const expected=[prior.fields.重复轨迹,suffix].filter(Boolean).join('\n');
    assert.equal(row.fields.重复轨迹, expected, '新增凭证精确对应池记录，保留原重复轨迹业务文本');
    const fields = { ...row.fields };
    if(prior.fields.重复轨迹===undefined)delete fields.重复轨迹;else fields.重复轨迹=prior.fields.重复轨迹;
    return { ...row, fields };
  });
  assert.deepEqual(old.businessRows(old.leads), leads);
  assert.deepEqual(old.read('pg.json'), current.read('pg.json'));
  assert.equal(old.read('phone-state.json').owner, null);
  const sql = f => readFileSync(join(f.home,'sql-events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  const latest = rows => Object.fromEntries(rows.filter(row=>!row.key.startsWith('step:')).map(({key,values,answer})=>[key+JSON.stringify(values),{key,values,answer}]));
  assert.deepEqual(latest(sql(old)),latest(sql(current)), '全部真实SQL探针观测值对账，保留词与视频行作用域');
  const failed=legacy.artifacts.filter(row=>row.status!=='completed');
  assert.deepEqual(failed.map(row=>[row.stage_id,row.stage_attempt]),[['discovery',2]], '冻结旧跨词重复计数使discovery度量2、PG该词读回1，真实误红须保留');
  assert.match(failed[0].summary,/postcondition_failed: disc_candidates_persisted/);
  const secondCollection=legacy.artifacts.find(row=>row.stage_id==='collection'&&row.stage_attempt===2);
  const collectedReadback=secondCollection.step_dod.find(row=>row.key==='keyword_acquisition.collection.mark_video_collected');
  assert.deepEqual({observed:collectedReadback.observed,pass:collectedReadback.pass},{observed:1,pass:false},'旧跨词重复再次采集自报2，真实逐词PG采集读回1；失败检查点仍保留');
  assert.equal(secondCollection.status,'completed','旧checkpoint失败没有改变collection工件状态，不能伪装全DoD通过');
  assert.deepEqual([...new Set(legacy.artifacts.map(row=>row.stage_id))].sort(), [...new Set(modern.receipt.activities.map(row=>row.key))].sort());
  assert.match(legacy.log,/PUSH_COMMENTS_STATS .*\"dup\":1/);
  assert.equal(modern.receipt.outputs.workflow_artifacts.discovery.metrics.duplicates_skipped,1);
  assert.equal((legacy.log.match(/开采评论/g)||[]).length,3, '真实旧链在跨词重复视频上再次采集，保留过程差异');
  assert.equal((current.log().match(/adb open-comments/g)||[]).length,2, '新发现提前去重');
  assert.equal(current.read('phone-state.json').owner, null);
});


test('去评分：评论/线索对账冻结旧模型前检查点；视频池完整相等门禁', { timeout: 120000 }, async t => {
  const old = await legacyFixture(t);
  const current = await keywordFixture(t,['matched','matched'],{withoutScore:true});
  const legacy = await old.run();
  alignFixtureClock(current);
  const modern = await current.run();
  audit('without-scoring-checkpoint',old,current,legacy,modern);
  assertVideoPool(old,current,twoVideos(),{requireEquality:true});
  assert.equal(legacy.output.code,0,legacy.log);assert.equal(legacy.final,'completed');
  assert.equal(modern.output.code,0,modern.output.stderr);assert.equal(modern.receipt.status,'completed');
  assert.equal(old.modelSnapshots.length,2,'原历史链仍真实执行评分，检查点必须来自第一次真实模型请求');
  assert.equal(current.modelCalls.length,0);assert.equal(current.leads.size,0);
  assert.deepEqual(old.modelSnapshots[0].pool,[...current.pool.values()]);
  assert.deepEqual(old.modelSnapshots[0].leads,[...current.leads.values()]);
  assert.deepEqual(old.read('pg.json'),current.read('pg.json'));
  assert.equal(old.read('phone-state.json').owner,null);assert.equal(current.read('phone-state.json').owner,null);
  assert.ok(modern.receipt.activities.every(row=>row.key!=='scoring'));
});

function mixedPhoneInput(f) {
  const path=join(f.home,'.local/bin/douyin-phone-adb');
  const cards='10\t100\t00:30\tAI课程1\n30\t300\t00:30\tAI课程2\n20\t200\t00:30\t待判课程';
  const controller=readFileSync(path,'utf8').replace(/case 'search-video-cards':[\s\S]*?;break;/,
    `case 'search-video-cards':locked();emit(${JSON.stringify(cards)});break;`);
  writeFileSync(path,controller);
  const ssh=join(f.home,'.local/bin/ssh');
  writeFileSync(ssh,readFileSync(ssh,'utf8').replace(/if\(command.includes\('fetch-seen-videos.js'\)\)\{emit\([^;]+;\}/,
    "if(command.includes('fetch-seen-videos.js')){emit('');}"));
}

test('资格混合：冻结旧与新真实探针、matched/rejected/pending视频终态直接对账；保留旧finalize差异', { timeout: 120000 }, async t => {
  const statuses=['matched','rejected','pending'];
  const old=await legacyFixture(t,statuses),current=await keywordFixture(t,statuses,{singleWord:true});
  writeFileSync(join(old.home,'words'),'AI 考证\n');mixedPhoneInput(old);mixedPhoneInput(current);
  const legacy=await old.run();
  alignFixtureClock(current);
  const modern=await current.run();
  audit('mixed-qualification',old,current,legacy,modern);
  assertVideoPool(old,current,twoVideos().slice(0,1),{requireEquality:true});
  assert.equal(legacy.output.code,0,legacy.log);assert.equal(modern.output.code,2,modern.output.stderr);
  assert.deepEqual(old.read('pg.json'),current.read('pg.json'));
  assert.equal(old.pool.size,1);assert.equal(current.pool.size,1);
  assert.deepEqual([...old.pool.values()],[...current.pool.values()]);
  const oldCalls=readFileSync(join(old.home,'calls'),'utf8');
  assert.equal((oldCalls.match(/adb open-comments/g)||[]).length,1,'旧侧不合格及pending零开评论区');
  assert.equal((current.log().match(/adb open-comments/g)||[]).length,1,'新侧不合格及pending零开评论区');
  const oldProbes=readFileSync(join(old.home,'probe-events.jsonl'),'utf8').trim().split('\n').map(JSON.parse).flatMap(row=>row.result.probes);
  assert.ok(oldProbes.some(row=>row.key==='qual_none_pending'&&row.observed===1&&row.pass===false));
  const modernProbes=modern.receipt.outputs.workflow_artifacts.qualification.probes.flatMap(row=>row.probes);
  assert.ok(modernProbes.some(row=>row.key==='qual_none_pending'&&row.observed===1&&row.pass===false));
  assert.ok(legacy.artifacts.some(row=>row.stage_id==='qualification'&&row.status==='failed'));
  // 旧finalize只验cleanup和STOP，对fail_stage资格失败仍报completed；新聚合真实失败报partial。
  // 这是冻结旧行为差异证据，不能用映射把旧completed改成partial声称终态等价。
  assert.equal(legacy.final,'completed');assert.equal(modern.receipt.status,'partial');
  assert.equal(old.read('phone-state.json').owner,null);assert.equal(current.read('phone-state.json').owner,null);
});

function rawTimeProjection(rows) {
  return rows.map(row=>{
    assert.match(row.fields.采集时间,/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}\(UTC\+8\)$/,'只规范明确时间格式；业务字段必须原样比较');
    return {...row,fields:{...row.fields,采集时间:'<采集时间>'}};
  });
}

test('首评论后总预算：两侧真实deadline收工、原评论与PG绑定保留；冻结评分终态差异', { timeout:120000 }, async t=>{
  const old=await legacyFixture(t,['matched','matched'],{runtimeRoot:true,mode:'budget'});
  const current=await keywordFixture(t,['matched'],{singleWord:true,modelDelayMs:20000});
  current.input.run_budget_s=16; // 通用运行器使用真实可推进时间，绝不固定Date.now。
  const legacy=await old.run();
  const currentStartedAt=Date.now(),modern=await current.run(),currentFinishedAt=Date.now();
  audit('run-budget',old,current,legacy,modern);
  const currentDiscoveryTime=[...current.videos.values()][0]?.fields.发现时间;
  assert.match(currentDiscoveryTime,/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}\(UTC\+8\)$/,'预算新侧发现时间必须保留真实配送时钟，不可冻结截止时间');
  const discoveredAt=Date.parse(currentDiscoveryTime.replace('(UTC+8)','+08:00').replace(' ','T'));
  assert.ok(discoveredAt<=currentFinishedAt&&discoveredAt+60000>currentStartedAt,'发现时间必须在此次新链真实执行窗口内，仅允许旧字段本身的分钟精度');
  assertVideoPool(old,current,twoVideos().slice(0,1),{requireEquality:true,currentDiscoveryTime});
  assert.equal(legacy.output.code,0,legacy.log);assert.equal(legacy.final,'partial');
  assert.match(legacy.log,/整批总时限到\(5s\)/);
  assert.equal(modern.output.code,2,modern.output.stderr);assert.equal(modern.receipt.status,'partial');
  assert.ok(existsSync(join(current.home,'model-ready')),'新预算必须实际发生在首评论模型HTTP已经开始之后');
  assert.equal(modern.receipt.activities.find(row=>row.key==='scoring').status,'partial');
  assert.equal(current.modelCalls.length,1);assert.equal(old.modelCalls.length,1);
  assert.equal(old.pool.size,1);assert.equal(current.pool.size,1);
  assert.deepEqual(rawTimeProjection(old.modelSnapshots[0].pool),rawTimeProjection([...current.pool.values()]));
  assert.deepEqual(old.read('pg.json'),current.read('pg.json'));
  assert.equal(old.leads.size,1,'旧视频/词边界到点后仍真实跑评分');assert.equal(current.leads.size,0,'新活动预算到点中止评分、原评论待分拣');
  assert.equal([...old.pool.values()][0].fields.处理状态,'已分拣');assert.equal([...current.pool.values()][0].fields.处理状态,'待分拣');
  assert.equal(old.read('phone-state.json').owner,null);assert.equal(current.read('phone-state.json').owner,null);
  assert.ok(modern.receipt.activities.some(row=>row.key==='delivery'));assert.ok(modern.receipt.activities.some(row=>row.key==='cleanup'));
});

test('首评论后根TERM：冻结旧继续整批与新软取消差异；双方首条原评论保留且本tag锁释放', { timeout:120000 }, async t=>{
  const old=await legacyFixture(t,['matched','matched'],{runtimeRoot:true,mode:'cancel'});
  const current=await keywordFixture(t,['matched','matched'],{mode:'cancel'});
  const legacy=await old.run(),modern=await current.run({cancelWhen:join(current.home,'cancel-ready')});
  audit('root-term',old,current,legacy,modern);
  assertVideoPool(old,current,twoVideos(2));
  assert.equal(readFileSync(join(old.home,'term-issued'),'utf8'),'SIGTERM','旧根TERM必须在实际TSV已出现LEAD后发送');
  assert.equal(legacy.output.signal,null);assert.equal(legacy.output.code,0,legacy.log);
  assert.equal(modern.output.signal,null);assert.equal(modern.output.code,2,modern.output.stderr);
  assert.equal(legacy.final,'completed','旧zsh根TERM trap并不停止在途batch2，它继续整批');
  assert.equal(modern.receipt.status,'partial');
  assert.equal(old.pool.size,4,'旧侧TERM后继续采后续评论与视频，不得投影成只采1条');
  assert.equal(current.pool.size,1);assert.equal(current.leads.size,0);assert.equal(old.leads.size,2);
  assert.equal(old.modelCalls.length,4);assert.equal(current.modelCalls.length,0);
  assert.deepEqual(rawTimeProjection([old.modelSnapshots[0].pool[0]]),rawTimeProjection([...current.pool.values()]));
  const oldDb=old.read('pg.json'),newDb=current.read('pg.json');
  assert.equal(oldDb.videos[ids[0]].process_status,'评论已采');assert.equal(newDb.videos[ids[0]].process_status,'待判定','新采集被取消，不能谎报评论已采');
  assert.deepEqual(oldDb.videos[ids[0]],{...newDb.videos[ids[0]],process_status:'评论已采'},'精确声明采集终态差异，其余视频业务字段直接相等');
  assert.equal(Object.keys(oldDb.videos).length,2);assert.equal(Object.keys(newDb.videos).length,2,'新发现先持久化两词候选，取消后第二视频留pending');
  assert.equal(newDb.videos[ids[1]].judgment_status,'pending');assert.equal(newDb.videos[ids[1]].process_status,'待判定');
  assert.deepEqual(oldDb.videos[ids[1]],{...newDb.videos[ids[1]],judgment_status:'matched',judgment_reason:'fixture真实资格理由',process_status:'评论已采'},'第二视频完整比较，精确保留旧继续判采与新候选pending差异');
  assert.equal(old.read('phone-state.json').owner,null);assert.equal(current.read('phone-state.json').owner,null);
  assert.match(legacy.log,/词2: AI 报名/);assert.doesNotMatch(current.log(),/commenter-identity 30 40/);
});


test('冻结时钟跨JS与shell同源且继续推进，不会随现实日期越过整链deadline', async t => {
 const home=mkdtempSync(join(tmpdir(),'frozen-clock-contract-'));
 t.after(()=>rmSync(home,{recursive:true,force:true}));
 mkdirSync(join(home,'.local/bin'),{recursive:true});
 writeFileSync(join(home,'http-fixture.cjs'),'');
 const f={home,env:{HOME:home,PATH:process.env.PATH}};
 // 故意使用遥远历史，不能依赖今天更新某个固定常量。
 const epoch=Date.parse('2001-01-01T00:00:00Z');alignFixtureClock(f,epoch);
 const nodeTime=()=>Number(execFileSync(process.execPath,['--require',join(home,'http-fixture.cjs'),'-e','process.stdout.write(String(Date.now()))'],{env:f.env,encoding:'utf8'}));
 const shellTime=()=>Number(execFileSync(join(home,'.local/bin/date'),['+%s'],{env:f.env,encoding:'utf8'}))*1000;
 const first=nodeTime(), firstShell=shellTime();assert.ok(Math.abs(first-epoch)<2000);
 assert.ok(Math.abs(first-shellTime())<2000,'原JS历史时间与shell现实时间差距必须消除');
 await new Promise(resolve=>setTimeout(resolve,1100));
 assert.ok(nodeTime()-first>=1000,'统一时钟必须推进，不能冻结预算');
 assert.ok(shellTime()-firstShell>=1000,'shell时钟也必须推进，不能冻结预算');
 assert.ok(Math.abs(nodeTime()-shellTime())<2000);
});

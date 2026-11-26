import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import YAML from 'yaml';
import {validatePatrolCaller} from '../implementation-patrol-scope.mjs';
const file=new URL('../../../.github/workflows/pilot-release-verification.yml',import.meta.url);
// 固定已独立验真的工具来源；消费者合并前核实该提交可达 Cecelia main。
const revision='0edd6b0f47d972f0ea7d6a11d7d36b5d98f37411';
function config(){assert.ok(existsSync(file),'独立完整发布验证caller必须存在');return YAML.parse(readFileSync(file,'utf8'));}
test('完整发布caller名称与路径固定，仅main push/手动触发，不借PR影响结果',()=>{
 const w=config();assert.equal(w.name,'Pilot release verification');
 assert.deepEqual(Object.keys(w.on).sort(),['push','workflow_dispatch']);assert.deepEqual(w.on.push.branches,['main']);
 assert.equal(w.on.push.paths,undefined);assert.equal(w.concurrency,undefined);
 assert.equal(w.jobs.verify.if,"github.ref == 'refs/heads/main'");
});
test('完整发布使用同次提交的本地入口，工具仍固定实际合并SHA且只传四项输入',()=>{
 const j=config().jobs.verify;
 assert.equal(j.uses,'./.github/workflows/pilot-release-regression.yml');
 assert.deepEqual(j.with,{source_repo:'perfectuser21/zenithjoy-workspace',scope:'zenithjoy',head_revision:'${{ github.sha }}',tooling_revision:revision});
 assert.equal(j['continue-on-error'],undefined);assert.deepEqual(j.needs,['caller-contract','authoring-main-source']);
});
test('通用Commander复用完整发布验证并保留原zenithjoy范围',()=>{
 const w=config(),j=w.jobs['verify-commander'];
 assert.ok(j,'commander-generic须有独立完整发布验证');
 assert.equal(j.if,"github.ref == 'refs/heads/main'");
 assert.deepEqual(j.needs,['caller-contract','authoring-main-source']);
 assert.equal(j.uses,w.jobs.verify.uses);
 assert.deepEqual(j.with,{...w.jobs.verify.with,scope:'commander-generic'});
 assert.deepEqual(j.secrets,w.jobs.verify.secrets);
 assert.equal(j['continue-on-error'],undefined);
 assert.equal(w.jobs.verify.with.scope,'zenithjoy');
});
test('发布caller显式传中央Skill只读凭据及原三项secret，保read权限和实际main拒绝闸',()=>{
 const w=config();assert.deepEqual(w.permissions,{contents:'read',actions:'read'});
 assert.deepEqual(w.jobs.verify.secrets,{TS_AUTHKEY:'${{ secrets.TS_AUTHKEY }}',CECELIA_INTERNAL_TOKEN:'${{ secrets.CECELIA_INTERNAL_TOKEN }}',BRAIN_DEPLOY_URL:'${{ secrets.BRAIN_DEPLOY_URL }}',SKILLS_SOURCE_SSH_KEY:'${{ secrets.SKILLS_SOURCE_SSH_KEY }}'});
 const guard=w.jobs['caller-contract'].steps.find(s=>s.env?.RUN_REF==='${{ github.ref }}');
 assert.equal(guard.run,'test "$RUN_REF" = refs/heads/main');
});
test('发布协议断言在现有PR检查和自身main检查永久执行，旧影响caller保留',()=>{
 const command='node --test scripts/ci/__tests__/pilot-release-workflow.test.mjs';
 const w=config(),legacy=YAML.parse(readFileSync(new URL('../../../.github/workflows/implementation-impact.yml',import.meta.url),'utf8'));
 assert.ok(w.jobs['caller-contract'].steps.some(s=>s.run===command));
 assert.ok(legacy.jobs['caller-contract'].steps.some(s=>s.run===command));
 assert.ok(legacy.on.pull_request);assert.match(legacy.jobs.impact.uses,/\/implementation-impact.yml@[a-f0-9]{40}$/);
 assert.equal(validatePatrolCaller(legacy),true,'独立Pilot协议守卫也拒绝禁用旧caller，避免自检job关闭后失声');
});
test('巡查定义有独立完整发布证明，保留现有范围且不以影响N/A冒充通过',()=>{
 const w=config(),j=w.jobs['verify-patrol-definitions'];
 assert.ok(j,'cecelia-device-patrol-definitions须有独立完整发布验证');
 assert.equal(j.if,"github.ref == 'refs/heads/main'");
 assert.deepEqual(j.needs,['caller-contract','authoring-main-source']);
 assert.equal(j.uses,w.jobs.verify.uses);
 assert.deepEqual(j.with,{...w.jobs.verify.with,scope:'cecelia-device-patrol-definitions'});
 assert.deepEqual(j.secrets,w.jobs.verify.secrets);
 assert.equal(j['continue-on-error'],undefined);
});

function regression(){return YAML.parse(readFileSync(new URL('../../../.github/workflows/pilot-release-regression.yml',import.meta.url),'utf8'));}

async function runSnapshotStep(t,responses,{main}={}){
 const root=mkdtempSync(join(tmpdir(),'pilot-refresh-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const identity={scope:'zenithjoy',repo:'perfectuser21/zenithjoy-workspace',revision:'a'.repeat(40)},token='fixture-local-token';
 const calls=[];
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):null;
  calls.push({method:req.method,path:url.pathname,identity:body??Object.fromEntries(url.searchParams),authenticated:req.headers['x-internal-token']===token});
  const reply=responses[calls.length-1];
  if(reply==='drop')return req.socket.destroy();
  if(reply?.truncated)return res.writeHead(reply.status,{'Content-Length':100,'Connection':'close'}).end('{}');
  const snapshot={schema_version:1,...identity,status:'verified',gaps:[],snapshot_sha256:'b'.repeat(64),...reply?.snapshot};
  res.writeHead(reply?.status??(reply?200:500),{'Content-Type':'application/json'}).end(JSON.stringify(reply?.body??{snapshot}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.closeAllConnections();server.close();});
 writeFileSync(join(root,'gh'),'#!/bin/sh\nprintf "%s\\n" "$FIXTURE_MAIN"\n',{mode:0o700});
 const step=regression().jobs.snapshot.steps.find(s=>s.name==='仅主线刷新并导出中央规范快照');
 const child=spawn('bash',['-c',step.run],{cwd:root,env:{...process.env,PATH:`${root}:${process.env.PATH}`,MAP_SCOPE:identity.scope,SOURCE_REPO:identity.repo,HEAD:identity.revision,FIXTURE_MAIN:main??identity.revision,BRAIN_URL:`http://127.0.0.1:${server.address().port}`,CECELIA_INTERNAL_TOKEN:token}});
 let stderr='';child.stderr.on('data',data=>stderr+=data);child.stdout.resume();
 const timeout=setTimeout(()=>child.kill('SIGKILL'),15000);
 let status;try{status=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});}finally{clearTimeout(timeout);}
 for(const call of calls){
  assert.deepEqual(call.identity,identity);
  assert.equal(call.authenticated,true);
  assert.equal(call.path,`/api/brain/implementation-ci/${call.method==='POST'?'refresh':'snapshot'}`);
 }
 const load=name=>{const path=join(root,`evidence/${name}.json`);return existsSync(path)?JSON.parse(readFileSync(path,'utf8')):null;};
 return {status,stderr,methods:calls.map(call=>call.method),head:load('head'),gap:load('gap')};
}
const exactMissing={snapshot:{status:'unknown',gaps:[{code:'definition_snapshot_missing'},{code:'scope_manifest_missing'}],definitions:{workflows:[],activities:[]},map:{manifest:null}}};
test('Pilot POST 断线后复用已提交的同范围同提交快照，不重发刷新',async t=>{
 const r=await runSnapshotStep(t,['drop',{}]);
 assert.equal(r.status,0,r.stderr);assert.deepEqual(r.methods,['POST','GET']);assert.equal(r.head.snapshot.status,'verified');assert.equal(r.gap,null);
});
test('Cecelia 重启期间只重试读取，待恢复后复用准确快照',async t=>{
 const r=await runSnapshotStep(t,['drop','drop',{}]);
 assert.equal(r.status,0,r.stderr);assert.deepEqual(r.methods,['POST','GET','GET']);assert.equal(r.head.snapshot.status,'verified');
});
test('Pilot 只在准确证实尚无定义及地图快照时重发一次，二次断线仅做最终只读核验',async t=>{
 const recovered=await runSnapshotStep(t,['drop',exactMissing,{}]);
 assert.equal(recovered.status,0,recovered.stderr);assert.deepEqual(recovered.methods,['POST','GET','POST']);
 const r=await runSnapshotStep(t,['drop',exactMissing,'drop',{}]);
 assert.equal(r.status,0,r.stderr);assert.deepEqual(r.methods,['POST','GET','POST','GET']);assert.equal(r.head.snapshot.status,'verified');
 const exhausted=await runSnapshotStep(t,['drop',exactMissing,'drop',exactMissing]);
 assert.notEqual(exhausted.status,0);assert.deepEqual(exhausted.methods,['POST','GET','POST','GET']);assert.equal(exhausted.head,null);assert.equal(exhausted.gap.status,'unknown');
});
test('Pilot 拒绝错误身份、残缺定义、诊断错误、正式HTTP错误、main前移',async t=>{
 const refused=[
  {name:'other scope',requests:['drop',{snapshot:{scope:'commander-generic'}}],methods:['POST','GET']},
  {name:'other repo',requests:['drop',{snapshot:{repo:'perfectuser21/cecelia'}}],methods:['POST','GET']},
  {name:'other revision',requests:['drop',{snapshot:{revision:'c'.repeat(40)}}],methods:['POST','GET']},
  {name:'missing gaps',requests:['drop',{snapshot:{gaps:null}}],methods:['POST','GET']},
  {name:'misconfigured definitions',requests:['drop',{snapshot:{...exactMissing.snapshot,gaps:[{code:'scope_repository_missing'}]}}],methods:['POST','GET']},
  {name:'partial write',requests:['drop',{snapshot:{...exactMissing.snapshot,definitions:{workflows:[{}],activities:[]}}}],methods:['POST','GET']},
  {name:'GET HTTP error',requests:['drop',{status:404}],methods:['POST','GET']},
  {name:'HTTP failure',requests:[{status:503},{}],methods:['POST']},
  {name:'HTTP failure with a truncated body',requests:[{status:503,truncated:true},{}],methods:['POST']},
  {name:'complete unknown result',requests:[exactMissing,{}],methods:['POST']},
  {name:'source moved',requests:[{status:409,body:{error:{code:'IMPLEMENTATION_CI_MAIN_MOVED'}}},{}],methods:['POST']},
  {name:'main moved before retry',requests:['drop',exactMissing,{}],methods:['POST','GET'],main:'c'.repeat(40)},
 ];
 for(const {name,requests,methods,main} of refused)await t.test(name,async t=>{
  const r=await runSnapshotStep(t,requests,{main});
  assert.notEqual(r.status,0);assert.deepEqual(r.methods,methods);assert.equal(r.head,null);assert.equal(r.gap.status,'unknown');
 });
});
test('非 verified 同版本快照只记录少量允许代码，仍退出 1 且从不重发',async t=>{
 const allowed=[
  'activity_snapshot_missing','authoring_definition_missing','capability_mapping_missing',
  'definition_snapshot_ambiguous','definition_snapshot_missing','manifest_source_mismatch',
  'manifest_snapshot_ambiguous',
 ];
 const secret='fixture-local-token';
 const gaps=[
  {code:'scope_manifest_missing\n::error title=untrusted',message:secret},
  {code:'fixture_local_token',detail:secret},
  {code:{value:secret}},
  null,
  ...allowed.map(code=>({code,message:secret,entity_id:'private-entity'})),
  {code:allowed[0]},
  ...Array(32).fill({code:'unrecognized'}),
  {code:'authoring_adapter_invalid'},
 ];
 const r=await runSnapshotStep(t,[{snapshot:{status:'unknown',gaps}},{}]);
 assert.equal(r.status,1);assert.deepEqual(r.methods,['POST']);assert.equal(r.head,null);
 assert.deepEqual(r.gap,{status:'unknown',stage:'pilot_snapshot',exit_code:1,code:'PILOT_SNAPSHOT_NOT_VERIFIED',gap_codes:allowed.toSorted().slice(0,6)});
 assert.equal(r.stderr,'Pilot snapshot rejected: '+JSON.stringify(r.gap)+'\n');
 assert.doesNotMatch(r.stderr,/untrusted|fixture[-_]local|private-entity/);
});
test('读回诊断只采纳同版本有效快照，退出码与未验证门禁保持一致',async t=>{
 const conflict={status:409,body:{error:{code:'ACTIVITY_CONTRACT_SNAPSHOT_CHANGED'}}};
 const same=await runSnapshotStep(t,[conflict,exactMissing]);
 assert.equal(same.status,1);assert.deepEqual(same.methods,['POST','GET']);assert.equal(same.head,null);
 assert.deepEqual(same.gap.gap_codes,['definition_snapshot_missing','scope_manifest_missing']);
 const wrong={snapshot:{...exactMissing.snapshot,revision:'c'.repeat(40)}};
 const mismatch=await runSnapshotStep(t,[conflict,wrong]);
 assert.equal(mismatch.status,1);assert.deepEqual(mismatch.methods,['POST','GET']);assert.equal(mismatch.head,null);
 assert.deepEqual(mismatch.gap,{status:'unknown',stage:'pilot_snapshot',exit_code:1});
 assert.doesNotMatch(mismatch.stderr,/Pilot snapshot rejected|definition_snapshot_missing/);
});
test('Pilot 并发冲突只允许读回已经认证的准确快照',async t=>{
 const conflict={status:409,body:{error:{code:'ACTIVITY_CONTRACT_SNAPSHOT_CHANGED'}}};
 const r=await runSnapshotStep(t,[conflict,{}]);
 assert.equal(r.status,0,r.stderr);assert.deepEqual(r.methods,['POST','GET']);
 const unknown=await runSnapshotStep(t,[conflict,exactMissing]);
 assert.notEqual(unknown.status,0);assert.deepEqual(unknown.methods,['POST','GET']);assert.equal(unknown.head,null);
});
function extractSnapshot(input){
 const step=regression().jobs.verify.steps.find(s=>s.name==='准备固定中央Skill对象缓存');
 const command=step.run.split('\n').find(line=>line.trimStart().startsWith('jq '));
 assert.ok(command,'执行实际工作流中的快照转换命令');
 const root=mkdtempSync(join(tmpdir(),'pilot-snapshot-'));
 try{
  mkdirSync(join(root,'snapshot'));writeFileSync(join(root,'snapshot/head.json'),input);
  const result=spawnSync('bash',['-euo','pipefail','-c',command],{cwd:root,encoding:'utf8'});
  const target=join(root,'snapshot/canonical.json');
  return {...result,canonical:existsSync(target)?readFileSync(target,'utf8'):''};
 }finally{rmSync(root,{recursive:true,force:true});}
}
test('完整发布本地兼容入口仅允许被调用，固定工具、同SHA及真实回归合同保留',()=>{
 const w=regression();assert.deepEqual(Object.keys(w.on),['workflow_call']);
 assert.deepEqual(Object.keys(w.on.workflow_call.inputs).sort(),['head_revision','scope','source_repo','tooling_revision']);
 assert.equal(w.jobs.verify.needs,'snapshot');assert.equal(w.jobs.verify['timeout-minutes'],40);
 const steps=w.jobs.verify.steps;
 assert.equal(steps.find(s=>s.with?.path==='tooling').with.ref,'${{ inputs.tooling_revision || github.sha }}');
 assert.equal(steps.find(s=>s.with?.path==='source').with.ref,'${{ inputs.head_revision || github.sha }}');
 assert.ok(steps.some(s=>s.run?.includes('node tooling/scripts/ci/pilot-release-verification.mjs --repo-root "$PWD/source"')));
 assert.ok(steps.some(s=>s.run?.includes('--snapshot "$PWD/snapshot/head.json"')));
 const refresh=w.jobs.snapshot.steps.find(s=>s.run?.includes('.snapshot.status == "verified" and (.snapshot.gaps | length == 0)'));
 assert.equal(refresh['timeout-minutes'],12);
 assert.equal(refresh.env.GH_TOKEN,'${{ github.token }}');
});
test('发布产物按 attempt 命名，verify 下载其 snapshot 依赖实际使用的 attempt',()=>{
 const {snapshot,verify}=regression().jobs;
 const uploadSnapshot=snapshot.steps.find(s=>s.uses==='actions/upload-artifact@v4');
 const downloadSnapshot=verify.steps.find(s=>s.uses==='actions/download-artifact@v4');
 const uploadReport=verify.steps.find(s=>s.uses==='actions/upload-artifact@v4');
 assert.equal(uploadReport.with.name,'pilot-release-verification-${{ inputs.scope }}-${{ inputs.head_revision || github.sha }}-attempt-${{ github.run_attempt }}');
 assert.equal(uploadSnapshot.with.name,'pilot-release-snapshot-${{ inputs.scope }}-${{ inputs.head_revision || github.sha }}-attempt-${{ github.run_attempt }}');
 assert.equal(snapshot.outputs.run_attempt,'${{ github.run_attempt }}');
 assert.equal(downloadSnapshot.with.name,'pilot-release-snapshot-${{ inputs.scope }}-${{ inputs.head_revision || github.sha }}-attempt-${{ needs.snapshot.outputs.run_attempt }}');
});
test('真实工作流转换保持大型快照完整且紧凑，避免漂亮格式越过原4MiB文件上限',()=>{
 const snapshot={status:'verified',items:Array.from({length:90000},(_,id)=>({id,value:'abcdefghijklmnop'}))};
 const limit=4*1024*1024;
 assert.ok(Buffer.byteLength(JSON.stringify(snapshot,null,2))>limit,'触发原漂亮格式膨胀');
 const result=extractSnapshot(JSON.stringify({snapshot}));
 assert.equal(result.status,0,result.stderr);
 assert.deepEqual(JSON.parse(result.canonical),snapshot,'不裁剪、更改或过滤规范快照内容');
 assert.ok(Buffer.byteLength(result.canonical)<limit,'仍遵守原4MiB上限');
});
test('真实工作流快照转换拒绝空输入、缺失及非对象，不产出可接受的规范快照',()=>{
 for(const input of ['', '{}', '{"snapshot":null}', '{"snapshot":[]}', '{"snapshot":"verified"}', '{']){
  const result=extractSnapshot(input);assert.notEqual(result.status,0,`不得接受${JSON.stringify(input)}`);
  assert.equal(result.canonical.trim(),'');
 }
});

for(const variant of ['lightweight','single-check'])test(`${variant} 101 发布验证绑定单独 scope，仅在 main 显式触发`,()=>{
 const workflow=YAML.parse(readFileSync(new URL(`../../../.github/workflows/${variant}-101-release-verification.yml`,import.meta.url),'utf8'));
 const scope=`leadgen-101-${variant}`;
 const original=config();
 assert.deepEqual(Object.keys(workflow.on),['workflow_dispatch']);
 assert.deepEqual(workflow.permissions,original.permissions);
 assert.deepEqual(workflow.jobs,{verify:{
  if:original.jobs.verify.if,
  uses:original.jobs.verify.uses,
  with:{...original.jobs.verify.with,scope},
  secrets:original.jobs.verify.secrets,
 }});
 assert.equal(original.jobs.verify.with.scope,'zenithjoy');
 assert.equal(original.jobs['verify-commander'].with.scope,'commander-generic');
 assert.equal(original.jobs['verify-patrol-definitions'].with.scope,'cecelia-device-patrol-definitions');
 const admission=regression().jobs.snapshot.steps.find(s=>s.env?.CALLER_REPO);
 assert.match(admission.run,new RegExp('perfectuser21/zenithjoy-workspace:'+scope+'[|)]'));
 assert.match(admission.run,/test "\$HEAD" = "\$CALLER_SHA"/);
 assert.match(admission.run,/git\/ref\/heads\/main/);
});

test('发布范围守卫拒绝已退役的 KR，同时接受所有现役调用方', () => {
 const workflow = regression();
 const admission = workflow.jobs.snapshot.steps.find(step => step.env?.CALLER_REPO);
 const repo = 'perfectuser21/zenithjoy-workspace';
 const active = ['zenithjoy', 'commander-generic', 'cecelia-device-patrol-definitions', 'leadgen-101-lightweight', 'leadgen-101-single-check'];
 const head = '1'.repeat(40);
 const env = {...process.env, HEAD: head, CALLER_SHA: head};
 const command = 'gh() { printf "%s\\n" "$HEAD"; }\n' + admission.run;
 const admit = (source, scope) => spawnSync('bash', ['-c', command], {
  encoding: 'utf8',
  env: {...env, SOURCE_REPO: source, CALLER_REPO: source, MAP_SCOPE: scope},
 });
 for (const scope of active) assert.equal(admit(repo, scope).status, 0, scope);
 assert.notEqual(admit(repo, '').status, 0, '缺范围须拒绝');
 assert.notEqual(admit('perfectuser21/cecelia', 'cecelia-kr').status, 0, '已退役范围须在调用 Brain 前拒绝');
 assert.equal(workflow.jobs.snapshot.env.MAP_SCOPE, '${{ inputs.scope }}');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

const require=createRequire(import.meta.url);
const {SCOPE,runFor,validateRequest,planBatch,recover,readback,recoverBatch}=require('../qualification-quarantine-recovery-102n.js');
const {createAuthority,checkStopped}=require('../qualification-quarantine-recovery-102n-authority.js');
const videos=['7690206754872817819','7701984906457456467'];
const request={op:'recover_102n_qualification',line:'jinuo',run:runFor(videos[0]),
 decision_id:'e7c48034-723b-4dc4-9927-b2593a5a0a7d',maintenance_task_id:'630fead3-9b17-4132-9208-92df60b1db3e',video_id:videos[0]};

test('102n恢复范围只含原101n/102n、公司v14与两条隔离VID',()=>{
 assert.deepEqual(SCOPE.video_ids,videos);
 assert.equal(SCOPE.original_101_run,'accept7252_jinuo101n_20261031T0251');
 assert.equal(SCOPE.original_102_run,'accept7252_jinuo102n_20261031T0303');
 assert.equal(SCOPE.original_source_commit,'7252b6d2d6f279768753f086abc8c29ba968ea45');
 assert.equal(SCOPE.company_config_version,14);
 assert.equal(SCOPE.allow_direct_messages,false);
});

test('单VID入口不收第三条、批量、错运行及请求自带终止证明',()=>{
 assert.equal(validateRequest(request).video_id,videos[0]);
 assert.equal(validateRequest({...request,video_id:videos[1],run:runFor(videos[1])}).video_id,videos[1]);
 for(const change of [{video_id:'7699316353698753663'},{video_ids:videos},{run:'foreign'},
  {source_run:'foreign'},{old_execution_stopped:true},{line:'yuesheng'}]){
  assert.throws(()=>validateRequest({...request,...change}),/RECOVERY_102N_/);
 }
});

test('批计划逐条独立，第一条成功第二条失败不冒称整批成功',()=>{
 const summary=planBatch(videos,[{video_id:videos[0],status:'applied'},
  {video_id:videos[1],status:'blocked',reason:'RESOURCE_UNKNOWN'}]);
 assert.equal(summary.status,'partial');
 assert.deepEqual(summary.applied,[videos[0]]);
 assert.deepEqual(summary.blocked,[{video_id:videos[1],reason:'RESOURCE_UNKNOWN'}]);
 const unknown=planBatch(videos,[{video_id:videos[0],status:'commit_unknown'}]);
 assert.equal(unknown.status,'unknown');assert.deepEqual(unknown.unknown.map(x=>x.video_id),[videos[0]]);
 assert.deepEqual(unknown.pending,[videos[1]]);
 assert.throws(()=>planBatch(videos,[{video_id:videos[0],status:'applied'},
  {video_id:videos[0],status:'applied'}]),/RECOVERY_102N_/);
});

test('旧执行停止须8份原生回执覆盖108身份且两机无旧进程',()=>{
 const observed={original_run:SCOPE.original_102_run,original_source_commit:SCOPE.original_source_commit,
  run_status:'failed',native_receipts:8,identities:108,same_live:0,group_members:0,tagged_processes:0,
  local_tagged_processes:0,observed_at:Date.now(),evidence_sha256:'a'.repeat(64)};
 assert.equal(checkStopped(observed),observed);
 for(const change of [{same_live:1},{group_members:1},{tagged_processes:1},{local_tagged_processes:1},
  {native_receipts:7},{identities:107},{run_status:'completed'},{observed_at:1}])
  assert.throws(()=>checkStopped({...observed,...change}),/RECOVERY_102N_OLD_EXECUTION_UNKNOWN/);
});

test('伪用户批准、错项目和请求自带停止布尔均不能触PG',async()=>{
 const good={decision:{id:request.decision_id,made_by:'user',status:'active',decision:JSON.stringify(SCOPE)},
  originalTask:{id:SCOPE.original_task_id,status:'blocked'},maintenanceTask:{id:request.maintenance_task_id,
   project_id:SCOPE.project_id,status:'in_progress',claimed_by:'codex:qualification-recovery-102n'},
  actor:'codex:qualification-recovery-102n',evidence_sha256:'a'.repeat(64)};
 const pool={query:()=>{throw Error('PG must not be touched');},connect:()=>{throw Error('PG must not be touched');}};
 for(const change of [{decision:{...good.decision,made_by:'cecelia'}},
  {maintenanceTask:{...good.maintenanceTask,project_id:'other'}},
  {originalTask:{...good.originalTask,status:'in_progress'}}])
  await assert.rejects(recover(pool,request,{readAuthority:async()=>({...good,...change}),acquireGuard:async()=>{throw Error('must not lock');}}),/RECOVERY_102N_AUTHORITY_INVALID/);
 await assert.rejects(recover(pool,{...request,old_execution_stopped:true},{readAuthority:async()=>good}),/RECOVERY_102N_SCOPE_INVALID/);
});

test('Brain用户决策与双锁独占后才取得可复核guard，释放本人两锁',async()=>{
 let local='lock=free',central=null,releases=0;
 const receiptRoot='/private/tmp/openclaw-phone/evidence/jinoshengyuan-work';
 const receipts={};
 const decision={id:request.decision_id,made_by:'user',status:'active',decision:JSON.stringify(SCOPE)};
 const original={id:SCOPE.original_task_id,status:'blocked'},maintenance={id:request.maintenance_task_id,
  project_id:SCOPE.project_id,status:'in_progress',claimed_by:'codex:qualification-recovery-102n'};
 const observed={original_run:SCOPE.original_102_run,original_source_commit:SCOPE.original_source_commit,
  run_status:'failed',native_receipts:8,identities:108,same_live:0,group_members:0,tagged_processes:0,
  local_tagged_processes:0,observed_at:Date.now(),evidence_sha256:'a'.repeat(64)};
 const brain=async(path,body)=>{
  if(path.startsWith('/strategic-decisions'))return {success:true,data:[decision]};
  if(path==='/tasks/'+SCOPE.original_task_id)return original;
  if(path==='/tasks/'+request.maintenance_task_id)return maintenance;
  if(path==='/device-locks')return {success:true,locks:[{device_name:'ANGYVB4227006983',locked_by:central,
   expires_at:new Date(Date.now()+300000).toISOString()}]};
  if(path==='/device-locks/acquire'){assert.equal(central,null);central=body.locked_by;return {acquired:true,lock:{locked_by:central}};}
  if(path==='/device-locks/release'){assert.equal(central,body.locked_by);central=null;releases++;return {success:true};}
  throw Error('unexpected brain path '+path);
 };
 const lockReceipt=(kind,owner)=>{const acquire=kind==='acquire',eid=owner+'-lock-'+kind,
  message=(acquire?'run_claim=recorded owner='+owner+'\n':'')+'lock='+(acquire?'acquired':'released')+' owner='+owner;
  const now=Date.now(),event={seq:1,at_epoch_ms:now,command:acquire?'lock-acquire-new':'lock-release-exact',
   requested_owner:owner,rc:0,result:'ok',receipt:message,stderr:'',profile:'jinoshengyuan-work',
   serial:'ANGYVB4227006983',readback_command:'lock-status',readback_state:acquire?'held':'free',
   readback_owner:acquire?owner:null,readback:acquire?local:'lock=free'};
  receipts[kind]={schema:'lock_receipt_v1',evidence_id:eid,run_id:owner,kind,events:[event],latest:event};
  return message+'\nlock_evidence_id='+eid+' lock_evidence='+receiptRoot+'/'+eid+'.json readback_state='+(acquire?'held':'free')+'\n';};
 const phone=async(cmd,owner)=>{if(cmd==='lock-status')return local;
  assert.equal(owner,request.run);
  if(cmd==='lock-acquire-new'){assert.equal(local,'lock=free');local='lock=held owner='+owner+' age=0s stale=false reclaimable=false ttl=300s';return lockReceipt('acquire',owner);}
  if(cmd==='lock-release-exact'){local='lock=free';return lockReceipt('release',owner);}
  throw Error('unexpected phone command');};
 const io={brain,phone,readReceipt:async path=>{assert.ok(path.startsWith(receiptRoot));return receipts[path.includes('-lock-acquire')?'acquire':'release'];},
  native:async()=>({...observed,observed_at:Date.now()})};
 const a=createAuthority(io);
 assert.equal((await a.readAuthority(request)).decision.id,request.decision_id);
 const guard=await a.acquireGuard(request),proof=await guard.read();
 assert.equal(proof.old_execution_stopped,true);assert.equal(proof.central_owner,request.maintenance_task_id);
 await guard.release();assert.equal(local,'lock=free');assert.equal(central,null);assert.equal(releases,1);
 const denied=createAuthority({...io,native:async()=>({...observed,same_live:1,observed_at:Date.now()})});
 await assert.rejects(denied.acquireGuard(request),/OLD_EXECUTION_UNKNOWN/);
 assert.equal(central,null);assert.equal(local,'lock=free');
 const bad=createAuthority({...io,readReceipt:async path=>{
  const kind=path.includes('-lock-acquire')?'acquire':'release',r=receipts[kind];
  return kind==='acquire'?{...r,latest:{...r.latest,requested_owner:'foreign'}}:r;}});
 await assert.rejects(bad.acquireGuard(request),/LOCK_RECEIPT_INVALID/);
 assert.equal(central,null);assert.equal(local,'lock=free');
});

test('scratch PG：102n逐VID恢复、审计、重放与隔离旁行',{skip:process.env.ZJ_METRICS_PG_REQUIRED!=='1'},async()=>{
 const {Pool}=require('pg'),pool=new Pool({database:'cecelia_scratch',max:3});
 const db=(await pool.query('SELECT current_database() AS db')).rows[0].db;
 assert.equal(db,'cecelia_scratch');
 const schema='recovery102n_'+randomUUID().replaceAll('-','');
 await pool.query(`CREATE SCHEMA ${schema}`);
 const rewrite=sql=>sql.replaceAll('zenithjoy.',schema+'.');
 const scoped={query:(q,a)=>pool.query(rewrite(q),a),connect:async()=>{
  const c=await pool.connect();return {query:(q,a)=>c.query(rewrite(q),a),release:destroy=>c.release(destroy)};}};
 const snapshot={company_id:SCOPE.company_id,tenant_id:SCOPE.tenant_id,version:14,policy_id:SCOPE.policy_id,
  config_status:'enabled',runtime_config:{routing:{line_key:'jinuo'}}};
 let held=false;
 const authority=()=>({decision:{id:request.decision_id,made_by:'user',status:'active',decision:JSON.stringify(SCOPE)},
  originalTask:{id:SCOPE.original_task_id,status:'blocked'},maintenanceTask:{id:request.maintenance_task_id,
   project_id:SCOPE.project_id,status:'in_progress',claimed_by:'codex:qualification-recovery-102n'},
  actor:'codex:qualification-recovery-102n',evidence_sha256:'a'.repeat(64)});
 const dep={readAuthority:async()=>authority(),acquireGuard:async(input)=>{
  assert.equal(held,false,'guard owner须独占');held=true;return {read:async()=>({original_run:SCOPE.original_102_run,
   original_source_commit:SCOPE.original_source_commit,old_execution_stopped:true,local_owner:input.run,
   central_owner:request.maintenance_task_id,guard_held:true,active:0,pending:0,observed_at:Date.now(),
   evidence_sha256:'b'.repeat(64)}),release:async()=>{held=false;}};}};
 try{
  const migration=readFileSync(new URL('../../../apps/api/db/migrations/20260922_220000_leadgen_ssot_tables.sql',import.meta.url),'utf8');
  await scoped.query(migration.match(/CREATE TABLE IF NOT EXISTS zenithjoy\.leadgen_videos \([\s\S]+?\n\);/)[0]);
  await scoped.query('ALTER TABLE zenithjoy.leadgen_videos ADD COLUMN judgment_config jsonb');
  const audit=readFileSync(new URL('../../../apps/api/db/migrations/20260820_120000_structured_workbench.sql',import.meta.url),'utf8');
  await scoped.query(audit.match(/CREATE TABLE IF NOT EXISTS zenithjoy\.db_audit \([\s\S]+?\n\);/)[0]);
  await scoped.query('CREATE TABLE zenithjoy.leadgen_comments(id uuid,line_key text,source_video_url text,harvest_batch text)');
  await scoped.query('CREATE TABLE zenithjoy.company_config_runs(company_id uuid,tenant_id uuid,version int,run_id text,source_run text,snapshot jsonb)');
  for(const [run,source] of [[SCOPE.original_101_run,null],[SCOPE.original_102_run,SCOPE.original_101_run]])
   await scoped.query('INSERT INTO zenithjoy.company_config_runs VALUES($1,$2,14,$3,$4,$5::jsonb)',
    [SCOPE.company_id,SCOPE.tenant_id,run,source,JSON.stringify(snapshot)]);
  const other='7699316353698753663';
  for(const id of [...videos,other])await scoped.query(`INSERT INTO zenithjoy.leadgen_videos
   (line_key,video_id,video_url,harvest_batch,process_status,judgment_status)
   VALUES($1,$2,$3,$4,$5,'pending')`,['jinuo',id,'https://www.douyin.com/video/'+id,SCOPE.original_102_run,SCOPE.source_status]);
  const row=async id=>(await scoped.query('SELECT to_jsonb(v) AS video FROM zenithjoy.leadgen_videos v WHERE video_id=$1',[id])).rows[0].video;
  const otherBefore=await row(other),secondBefore=await row(videos[1]);
  const first=await recover(scoped,request,dep);assert.equal(first.status,'applied');
  assert.equal((await row(videos[0])).process_status,'待判定');
  assert.equal((await row(videos[0])).harvest_batch,SCOPE.original_101_run);
  assert.deepEqual(await row(videos[1]),secondBefore);assert.deepEqual(await row(other),otherBefore);
  assert.equal((await readback(scoped,request,dep)).status,'already_applied');
  assert.equal((await recover(scoped,request,dep)).status,'already_applied');
  await scoped.query('UPDATE zenithjoy.leadgen_videos SET judgment_status=$2 WHERE video_id=$1',[videos[1],'matched']);
  const second={...request,video_id:videos[1],run:runFor(videos[1])};
  await assert.rejects(recover(scoped,second,dep),/RECOVERY_102N_VIDEO_SCOPE_CONFLICT/);
  const summary=planBatch(videos,[{video_id:videos[0],status:'applied'},
   {video_id:videos[1],status:'blocked',reason:'VIDEO_SCOPE_CONFLICT'}]);
  assert.equal(summary.status,'partial');
  const outcome=await recoverBatch(scoped,{op:'recover_102n_qualification_batch',line:'jinuo',
   decision_id:request.decision_id,maintenance_task_id:request.maintenance_task_id},dep);
  assert.equal(outcome.status,'partial');assert.deepEqual(outcome.applied,[videos[0]]);
  assert.deepEqual(outcome.blocked.map(x=>x.video_id),[videos[1]]);
  assert.equal((await scoped.query('SELECT count(*)::int AS n FROM zenithjoy.db_audit')).rows[0].n,1);
  assert.deepEqual(await row(other),otherBefore);assert.equal(held,false);
  await scoped.query("UPDATE zenithjoy.leadgen_videos SET process_status='处理中:next102',harvest_batch='next102' WHERE video_id=$1",[videos[0]]);
  await assert.rejects(readback(scoped,request,dep),/RECOVERY_102N_CONSUMED_SOURCE_CONFLICT/);
  await scoped.query('INSERT INTO zenithjoy.company_config_runs VALUES($1,$2,14,$3,$4,$5::jsonb)',
   [SCOPE.company_id,SCOPE.tenant_id,'next102',SCOPE.original_101_run,JSON.stringify(snapshot)]);
  assert.equal((await readback(scoped,request,dep)).status,'consumed');
  assert.deepEqual((await row(videos[0])).harvest_batch,'next102');
  await scoped.query("UPDATE zenithjoy.leadgen_videos SET process_status='评论已采',judgment_status='matched',judgment_config=$2::jsonb WHERE video_id=$1",
   [videos[0],JSON.stringify({company_id:SCOPE.company_id,tenant_id:SCOPE.tenant_id,version:14,policy_id:SCOPE.policy_id,run_id:'next102'})]);
  assert.equal((await readback(scoped,request,dep)).status,'consumed');
  await scoped.query("UPDATE zenithjoy.leadgen_videos SET judgment_config=jsonb_set(judgment_config,'{policy_id}',to_jsonb($2::text)) WHERE video_id=$1",[videos[0],'foreign']);
  await assert.rejects(readback(scoped,request,dep),/RECOVERY_102N_CONSUMED_SOURCE_CONFLICT/);
 }finally{await pool.query(`DROP SCHEMA ${schema} CASCADE`);await pool.end();}
});

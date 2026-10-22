// Maintenance only: current owner inactivity is not the lost turn's outcome,
// native-operation termination, business success, or permission to release devices.
import {readFileSync,lstatSync,openSync,closeSync,fstatSync,constants,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {execInput} from './leadgen-client.mjs';
import {ownerPending,workflowCommanderSession} from './commander-owner-state.mjs';
import {acquireOwnerLock} from './commander-owner-lock.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const fail=reason=>{throw Error('COMMANDER_OWNER_RECONCILE_'+reason);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function snapshot(file){
 const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const s=fstatSync(fd),raw=readFileSync(fd),after=fstatSync(fd),path=lstatSync(file);
  if(!s.isFile()||s.uid!==process.getuid()||(s.mode&0o077)!==0||s.size>16384||s.nlink!==1||s.dev!==path.dev||s.ino!==path.ino||s.ctimeMs!==after.ctimeMs||s.size!==raw.length)fail('PENDING_INVALID');
  return {raw,stat:{dev:s.dev,ino:s.ino,size:s.size,ctime:s.ctimeMs},sha256:hash(raw),record:JSON.parse(raw)};
 }finally{closeSync(fd);}
}
function verify(request,value,session){
 const {scope,expected}=request,r=value.record;
 if(!Object.hasOwn(scope,'task_id')||!(scope.task_id===null||typeof scope.task_id==='string'&&scope.task_id.length>0)||request.session!==session
  ||r.protocol!=='commander-owner-turn-v1'||r.status!=='reserved'||r.session!==session
  ||['run_id','binding_id','source_commit','task_id'].some(k=>r[k]!==scope[k])
  ||!expected||!Number.isSafeInteger(expected.dev)||!Number.isSafeInteger(expected.ino)||expected.dev!==value.stat.dev||expected.ino!==value.stat.ino
  ||!/^[a-f0-9]{64}$/.test(expected.sha256||'')||expected.sha256!==value.sha256
  ||typeof r.transport_nonce!=='string'||!/^[a-f0-9-]{36}$/.test(r.transport_nonce)||expected.transport_nonce!==r.transport_nonce||!Number.isFinite(Date.parse(r.started_at)))fail('SCOPE_INVALID');
}
function privateDir(path){const s=lstatSync(path);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o022)!==0)fail('DIRECTORY_INVALID');return {dev:s.dev,ino:s.ino};}
export function readOwnerHost(scope,nonce){
 const raw=execFileSync('/bin/ps',['-axo','pid=,ppid=,uid=,lstart=,command='],{encoding:'utf8',timeout:5000,maxBuffer:4*1024*1024});
 const rows=raw.trim().split('\n').map(line=>{
  const m=line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(.+)$/);
  if(!m)fail('HOST_CENSUS_UNKNOWN');return {pid:Number(m[1]),ppid:Number(m[2]),uid:Number(m[3]),started_at_ms:Date.parse(m[4]),command:m[5]};
 });
 const gateways=rows.filter(r=>/\/openclaw\/dist\/index\.js gateway(?:\s|$)/.test(r.command)&&r.uid===process.getuid());
 if(gateways.length!==1||!Number.isFinite(gateways[0].started_at_ms))fail('GATEWAY_UNKNOWN');
 const terms=[scope.run_id,scope.binding_id,workflowCommanderSession(scope),nonce];
 const active=rows.filter(r=>r.pid!==process.pid&&(
  /(?:leadgen-rpc|leadgen-skill-agent)\.mjs(?:\s|$)/.test(r.command)
  ||/\/openclaw\/dist\/index\.js agent(?:\s|$)/.test(r.command)
  ||/(?:openclaw|leadgen-rpc|leadgen-skill-agent)/.test(r.command)&&terms.some(x=>r.command.includes(x))));
 const g=gateways[0];return {observed_at:Date.now(),gateway:{pid:g.pid,started_at_ms:g.started_at_ms,command_sha256:hash(g.command)},scope_processes:active.map(r=>({pid:r.pid,started_at_ms:r.started_at_ms,command_sha256:hash(r.command)})),census_sha256:hash(raw)};
}
async function officialReader(method,params,timeout){
 const r=await execInput('openclaw',['gateway','call',method,'--params',JSON.stringify(params),'--json','--timeout',String(timeout)],{timeoutMs:timeout,maxBuffer:1024*1024});
 if(r.code!==0||r.signal)fail('OFFICIAL_UNKNOWN');return JSON.parse(r.stdout);
}
function hostInactive(host,start,original){
 if(!host||!Number.isFinite(host.observed_at)||host.observed_at<start||host.observed_at>Date.now()+1000||!Array.isArray(host.scope_processes)||host.scope_processes.length
  ||!Number.isSafeInteger(host.gateway?.pid)||host.gateway.pid<2||!Number.isFinite(host.gateway.started_at_ms)||host.gateway.started_at_ms<=Date.parse(original.started_at)
  ||host.gateway.started_at_ms>Date.now()||!/^[a-f0-9]{64}$/.test(host.gateway.command_sha256||''))fail('HOST_NOT_INACTIVE');
}
export async function reconcileWorkflowCommanderTurn(request,{home=homedir(),readOfficial=officialReader,readHost=readOwnerHost}={}){
 if(!request?.scope)fail('REQUEST_INVALID');
 const {file,session}=ownerPending(request.scope,home),release=await acquireOwnerLock(file);
 try{
  const start=Date.now(),end=start+30000,original=snapshot(file);verify(request,original,session);
  const directory=resolve(file,'..'),identity=privateDir(directory),parentIdentity=privateDir(resolve(directory,'..'));
  const evidence=[];
  const read=async(method,params)=>{const timeout=end-Date.now();if(timeout<=0)fail('READBACK_TIMEOUT');const result=await readOfficial(method,params,Math.min(timeout,10000));if(!result||typeof result!=='object'||result.ok===false||result.error)fail('OFFICIAL_UNKNOWN');evidence.push({method,params,result,result_sha256:hash(JSON.stringify(result)),digest_encoding:'JSON.stringify UTF-8',observed_at:Date.now()});return result;};
  const hostBefore=await readHost(request.scope,original.record.transport_nonce);hostInactive(hostBefore,start,original.record);
  let sessionId;
  const describe=async()=>{
   const {session:row}=await read('sessions.describe',{key:session,agentId:'work-commander'});
   if(row?.key!==session||typeof row.sessionId!=='string'||!row.sessionId||row.hasActiveRun!==false||!Array.isArray(row.activeRunIds)||row.activeRunIds.length
    ||!Number.isFinite(row.snapshotAt)||row.snapshotAt<start-1000||row.snapshotAt>Date.now()+1000||sessionId&&row.sessionId!==sessionId)fail('OWNER_NOT_INACTIVE');
   sessionId=row.sessionId;
  };
  await describe();
  const transcript=await read('sessions.get',{key:session,agentId:'work-commander',limit:1});
  if(!Array.isArray(transcript.messages)||!transcript.messages.length)fail('TRANSCRIPT_UNKNOWN');
  const inactiveSurfaces=async()=>{
  const history=await read('chat.history',{sessionKey:session,limit:1});
  const queue=history.pendingInputs;
  if(history.sessionKey!==session||history.sessionId!==sessionId||!queue||queue.total!==0||!Array.isArray(queue.items)||queue.items.length||queue.queuedCount!==undefined&&queue.queuedCount!==0||queue.nextBefore!==undefined)fail('PENDING_UNKNOWN');
  const children=await read('sessions.list',{agentId:'work-commander',spawnedBy:session,limit:5,includeLastMessage:false,includeDerivedTitles:false,includeActivitySummary:false});
  if(!Number.isFinite(children.ts)||children.ts<start-1000||children.ts>Date.now()+1000||children.hasMore!==false||!Array.isArray(children.sessions)||children.sessions.length)fail('CHILDREN_UNKNOWN');
  const core=await read('tools.invoke',{name:'subagents',sessionKey:session,args:{action:'list'}}),d=core.output?.details;
  if(core.ok!==true||core.toolName!=='subagents'||core.source!=='core'||d?.status!=='ok'||d.action!=='list'||d.callerIsSubagent!==false||d.callerSessionKey!==session||d.requesterSessionKey!==session||!Array.isArray(d.active)||d.active.length)fail('CHILDREN_UNKNOWN');
  };
  await inactiveSurfaces();
  await describe();
  await inactiveSurfaces();
  const hostAfter=await readHost(request.scope,original.record.transport_nonce);hostInactive(hostAfter,start,original.record);
  if(!same(hostBefore.gateway,hostAfter.gateway)||Date.now()>end)fail('GENERATION_CHANGED');
  release.assertHeld();
  const current=snapshot(file);verify(request,current,session);
  if(!same(current.stat,original.stat)||!same(identity,privateDir(directory))||!same(parentIdentity,privateDir(resolve(directory,'..'))))fail('CAS_CHANGED');
  const archive=file+'.'+original.record.transport_nonce+'.'+randomUUID()+'.reconciled_inactive';mkdirSync(archive,{mode:0o700});
  const receipt={protocol:'commander-owner-reconcile-v1',status:'reconciled_inactive',business_result:'unknown',original:original.record,original_sha256:original.sha256,original_identity:original.stat,scope:request.scope,session,host_before:hostBefore,host_after:hostAfter,official_evidence:evidence,reconciled_at:new Date().toISOString(),limitations:['仅当前登记owner与本机观察集合inactive；不追认丢失turn结果或全集原生停止','不释放设备、不改变旧失败或未知副作用']};
  const originalPath=join(archive,'original.pending.json'),receiptPath=join(archive,'receipt.json');
  writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
  // All participating launchers hold the same kernel guard; preserve the exact
  // original inode/bytes before making a later launch possible.
  const final=snapshot(file);if(!same(final.stat,original.stat)||final.sha256!==original.sha256)fail('CAS_CHANGED');
  release.assertHeld();
  renameSync(file,originalPath);
  return {status:'reconciled_inactive',business_result:'unknown',original_path:originalPath,receipt_path:receiptPath,receipt_sha256:hash(readFileSync(receiptPath))};
 }catch(error){if(/^COMMANDER_OWNER_RECONCILE_/.test(error.message))throw error;fail('READBACK_OR_CAS_UNKNOWN');}
 finally{await release();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==3)fail('USAGE_REQUEST_JSON_REQUIRED');
  const result=await reconcileWorkflowCommanderTurn(JSON.parse(readFileSync(process.argv[2],'utf8')));
  process.stdout.write(JSON.stringify(result)+'\n');
 }catch(error){process.stderr.write(String(error.message).slice(0,200)+'\n');process.exitCode=1;}
}

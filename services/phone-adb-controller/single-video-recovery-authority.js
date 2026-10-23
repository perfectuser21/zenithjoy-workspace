// 固定单VID维护的真实读取/资源适配；JSON请求不能提供证明或执行器。
'use strict';
const {readFileSync,openSync,fstatSync,closeSync,constants}=require('node:fs');
const {resolve,join}=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {createHash}=require('node:crypto');
const {homedir}=require('node:os');
const {SCOPE,DECISION,RECOVERY_RUN,hash}=require('./single-video-recovery.js');
const exec=promisify(execFile),DEVICE='ANGYVB4402004137',SESSION='agent:work-commander:workflow-1cc217514f7153f5308c722757c05a3d',SESSION_ID='a4e63bbb-1ce2-4feb-af1f-daa1cbd73dff';
const fail=x=>{throw Error('RECOVERY_'+x);};
const proofs={
 'root-24c9-102-comment-pg.json':'b8b5c39e32be41ae39eedf83b3088e2dfcba898ce516dc7a4d377719a14ac171',
 'root-24c9-102-qualification-pg.json':'4cd90539e30475dfd643eaa386bdc091fe737f319c194f88a5430d78a59bbf81',
 'honor24c9-102-original-split-result.json':'1130da52907e8bafce7f35b7695917ceb0fb523ec589e46a2627d8332b20e221',
 'honor24c9-102-mmv-stop-proof.json':'736d776d0e4852d1c22a6e664839b3122642f6bc7d1a6f6d20b9b0c3b65637c8',
 'honor24c9-102-xian-m4-stop-proof.json':'9bf276ff3f5cbe7279ebfc6d7a3d880caa67514dfea96790b2962b7d362079f0',
 'honor24c9-102-group-readback.json':'3475520dd07fd3fcc5356a338894a75fa190202925585f1246288cbf439f6c31',
 'honor24c9-102-central-lock-readback.json':'34312fe718f5412d00a03bf7f4e0b8fab7ec85a83e72bc5a81500b3ac0ff77af',
 'honor24c9-102-local-lock-status.json':'77c2e2922f0ce42e6821c6c0a683a757699e74a0c1a1ab6fe8b555f0a7d88a73'};
const allowed=new Set(['op','line','run','decision_id','maintenance_task_id','video_id','evidence_root']);
function request(input,run=RECOVERY_RUN){if(!input||input.run!==run||Object.keys(input).some(k=>!allowed.has(k)))fail('REQUEST_INVALID');}
function proofFiles(root,config={}){
 const scope=config.scope||SCOPE,proofSet=config.proofs||proofs;
 const records={};for(const [name,sha]of Object.entries(proofSet)){const fd=openSync(join(root,name),constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=fstatSync(fd),raw=readFileSync(fd);if(!s.isFile()||s.nlink!==1||s.size>10*1024*1024||createHash('sha256').update(raw).digest('hex')!==sha)fail('EVIDENCE_INVALID');if(name===(config.lockTextFile||'honor24c9-102-local-lock-status.json')){if(raw.toString().trim()!=='lock=free')fail('EVIDENCE_INVALID');}else records[name]=JSON.parse(raw);}finally{closeSync(fd);}}
 const record=records[config.splitFile||'honor24c9-102-original-split-result.json'],p=config.splitContainer?record[config.splitContainer]:record;if(p.status!=='failed'||p.run_id!==`douyin_video_processing-${scope.original_run}__a1`||p.source_commit!=='24c9e6b97b81ae144985474d9e33665bf65a6a8e')fail('EVIDENCE_INVALID');
 return records;
}
// 原PID的真实内核start identity和PGID读回；未知/权限失败不是退出证明。
const hostProgram=String.raw`
import sys,json,ctypes,struct,subprocess,os,base64
p=json.loads(base64.b64decode(sys.argv[1]));lib=ctypes.CDLL('/usr/lib/libproc.dylib',use_errno=True)
def info(pid):
 b=ctypes.create_string_buffer(136)
 if lib.proc_pidinfo(pid,3,0,b,136)!=136:
  try:os.kill(pid,0)
  except ProcessLookupError:return None
  raise RuntimeError('identity unknown')
 x=b.raw;return {'pid':pid,'pgid':struct.unpack_from('=I',x,100)[0],'start':str(struct.unpack_from('=Q',x,120)[0])+':'+str(struct.unpack_from('=Q',x,128)[0])}
live=[];groups=[];active=[]
for r in p['identities']:
 a=info(r['pid'])
 if a and a['start']==r['expected']:live.append(r['pid'])
for line in subprocess.check_output(['/bin/ps','-axo','pid=,pgid=,command='],text=True).splitlines():
 v=line.strip().split(None,2)
 if len(v)!=3:raise RuntimeError('census invalid')
 pid=int(v[0]);pgid=int(v[1]);cmd=v[2]
 if pid==os.getpid():continue
 if pgid in p['groups']:groups.append(pid)
 if p['old'] in cmd or p['session'] in cmd or p['device'] in cmd or ('douyin-phone' in cmd and 'legacy' in cmd):active.append(pid)
print(json.dumps({'live':live,'groups':groups,'active':active}))
`;
function createAuthority(io={},config={}){
 const scope=config.scope||SCOPE,decision=config.decision||DECISION,recoveryRun=config.run||RECOVERY_RUN,proofSet=config.proofs||proofs;
 const session=config.session||SESSION,sessionId=config.sessionId||SESSION_ID;
 const validate=input=>request(input,recoveryRun);
 const execute=io.execute||(async(command,args,options)=>{const p=exec(command,args,options);p.child.stdin?.end(options.input||'');return p;}),readProofs=io.readProofs||(root=>proofFiles(root,config));
 const token=io.readToken||(()=>{const fd=openSync(join(homedir(),'.credentials/single-video-recovery-internal.env'),constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=fstatSync(fd);if(!s.isFile()||s.uid!==process.getuid()||(s.mode&0o077)!==0)fail('CREDENTIAL_INVALID');const m=readFileSync(fd,'utf8').match(/^CECELIA_INTERNAL_TOKEN=([^\r\n]+)$/m);if(!m)fail('CREDENTIAL_INVALID');return m[1];}finally{closeSync(fd);}});
 const brain=io.brain||(async(path,body)=>{
  if(!/^\/(?:strategic-decisions\?made_by=user&limit=100|tasks\/[a-f0-9-]{36}|device-locks(?:\/acquire|\/release)?)$/.test(path))fail('BRAIN_ORIGIN_INVALID');
  const response=await(io.fetch||globalThis.fetch)('http://localhost:5221/api/brain'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Internal-Token':token()},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)fail('AUTHORITY_UNAVAILABLE');return response.json();
 });
 const run=async(command,args,timeout=20000,input)=>{try{const r=await execute(command,args,{encoding:'utf8',timeout,maxBuffer:4*1024*1024,input});return r.stdout;}catch{fail('EXECUTION_UNKNOWN');}};
 const official=async(method,params)=>{try{return JSON.parse(await run('openclaw',['gateway','call',method,'--params',JSON.stringify(params),'--json','--timeout','10000'],12000));}catch{fail('SESSION_UNKNOWN');}};
 async function readAuthority(input){validate(input);let d,t,m;
  try{const list=await brain('/strategic-decisions?made_by=user&limit=100');const rows=list?.success===true?list.data:null;const matches=Array.isArray(rows)?rows.filter(r=>r.id===decision):[];
   if(matches.length!==1||list.has_more||list.hasMore)fail('DECISION_NOT_FOUND');d=matches[0];
   t=await brain('/tasks/'+scope.original_task_id);m=await brain('/tasks/'+input.maintenance_task_id);
  }catch(e){if(e.message==='RECOVERY_DECISION_NOT_FOUND')throw e;fail('AUTHORITY_UNAVAILABLE');}
  let records;try{records=readProofs(input.evidence_root||'/tmp');}catch{fail('EVIDENCE_INVALID');}
  return {decision:d,originalTask:t,maintenanceTask:m,actor:'codex:single-video-recovery',evidence_sha256:hash(proofSet),records};
 }
 async function stopped(records){
  const start=Date.now(),fresh=value=>Number.isFinite(value)&&value>=start-1000&&value<=Date.now()+1000;
  const d=await official('sessions.describe',{key:session,agentId:'work-commander'}),s=d.session;
  if(s?.key!==session||s.sessionId!==sessionId||s.hasActiveRun!==false||!Array.isArray(s.activeRunIds)||s.activeRunIds.length||s.status!=='done'||!Number.isFinite(s.endedAt)||!fresh(s.snapshotAt))fail('SESSION_ACTIVE_OR_UNKNOWN');
  const h=await official('chat.history',{sessionKey:session,limit:1}),q=h.pendingInputs;
  if(h.sessionKey!==session||h.sessionId!==sessionId||q?.total!==0||!Array.isArray(q.items)||q.items.length||q.queuedCount!==undefined&&q.queuedCount!==0||q.nextBefore!==undefined)fail('SESSION_ACTIVE_OR_UNKNOWN');
  const c=await official('sessions.list',{agentId:'work-commander',spawnedBy:session,limit:5,includeLastMessage:false,includeDerivedTitles:false,includeActivitySummary:false});
  if(!fresh(c.ts)||c.hasMore!==false||!Array.isArray(c.sessions)||c.sessions.length)fail('SESSION_ACTIVE_OR_UNKNOWN');
  const core=await official('tools.invoke',{name:'subagents',sessionKey:session,args:{action:'list'}}),v=core.output?.details;
  if(core.ok!==true||core.toolName!=='subagents'||core.source!=='core'||v?.status!=='ok'||v.action!=='list'||v.callerIsSubagent!==false||v.callerSessionKey!==session||v.requesterSessionKey!==session||!Array.isArray(v.active)||v.active.length)fail('SESSION_ACTIVE_OR_UNKNOWN');
  const host=[];
  for(const name of ['mmv','xian-m4']){
   const proof=records[name==='mmv'?(config.mmvProofFile||'honor24c9-102-mmv-stop-proof.json'):(config.xianProofFile||'honor24c9-102-xian-m4-stop-proof.json')],identities=proof.native_start_identity_readback||[];
   if(name==='xian-m4'&&identities.length!==(config.identityCount||246))fail('NATIVE_EVIDENCE_INVALID');
   const data=Buffer.from(JSON.stringify({identities,groups:name==='xian-m4'?(config.groupsFromNative?[...new Set(records[config.splitFile].native.flatMap(r=>r.processes||[]).map(p=>p.pgid).filter(Number.isSafeInteger))]:records['honor24c9-102-group-readback.json'].original_groups):[],old:scope.original_run,session:sessionId,device:DEVICE})).toString('base64');
   const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
   const raw=name==='mmv'?await run('python3',['-c',hostProgram,data]):await run('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','xian-m4','python3 - '+quote(data)],30000,hostProgram);
   const r=JSON.parse(raw);if(!Array.isArray(r.live)||r.live.length||!Array.isArray(r.groups)||r.groups.length||!Array.isArray(r.active)||r.active.length)fail('NATIVE_ACTIVE_OR_UNKNOWN');host.push(r);
  }
  return hash({session:s,queue:q,children:c,core,host});
 }
 async function acquireGuard(input){validate(input);const auth=await readAuthority(input);await stopped(auth.records);
  let manifest;try{manifest=io.readManifest?io.readManifest():JSON.parse(readFileSync(resolve(__dirname,'deployment-manifest.json'),'utf8'));}catch{fail('SOURCE_INVALID');}if(!/^[a-f0-9]{40}$/.test(manifest.source_commit||''))fail('SOURCE_INVALID');
  const relative='.local/share/zenithjoy/phone-candidates/'+manifest.source_commit+'/runtime/douyin-phone-adb';
  const phone=async(command,owner)=>{
   if(!['lock-status','lock-acquire-new','lock-release-exact'].includes(command))fail('PHONE_ACTION_FORBIDDEN');
   return run('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','xian-m4','zsh "$HOME/'+relative+'" --profile legacy '+command+(owner?' '+owner:'')],30000);
  };
  const evidenceRoot=io.evidenceRoot||'/private/tmp/openclaw-phone/evidence/legacy';
  const readLockReceipt=io.readLockReceipt||(async({path})=>{
   const code='import os,stat,sys;fd=os.open(sys.argv[1],os.O_RDONLY|os.O_NOFOLLOW);s=os.fstat(fd);assert stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_size<1048576;print(os.read(fd,1048576).decode())';
   return JSON.parse(await run('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','xian-m4',"python3 -I -c '"+code+"' '"+path+"'"],30000));
  });
  const held=value=>new RegExp('^lock=held owner='+input.run+' age=[0-9]+s stale=false reclaimable=false ttl=[0-9]+s\\n?$').test(value);
  async function verifyReceipt(kind,stdout,started){
   const acquire=kind==='acquire',eid=input.run+'-lock-'+kind,path=evidenceRoot+'/'+eid+'.json';
   const receipt=(acquire?'run_claim=recorded owner='+input.run+'\n':'')+'lock='+(acquire?'acquired':'released')+' owner='+input.run;
   if(stdout!==receipt+'\nlock_evidence_id='+eid+' lock_evidence='+path+' readback_state='+(acquire?'held':'free')+'\n')fail('LOCK_RECEIPT_INVALID');
   let d;try{d=await readLockReceipt({kind,run:input.run,path});}catch{fail('LOCK_RECEIPT_UNKNOWN');}
   const e=d?.latest;
   if(d?.schema!=='lock_receipt_v1'||d.evidence_id!==eid||d.run_id!==input.run||d.kind!==kind||!Array.isArray(d.events)||d.events.length!==1||!e||hash(d.events[0])!==hash(e)
    ||e?.seq!==1||e.command!==(acquire?'lock-acquire-new':'lock-release-exact')||e.requested_owner!==input.run||e.rc!==0||e.result!=='ok'||e.receipt!==receipt||e.stderr!==''
    ||e.profile!=='legacy'||e.serial!==DEVICE||e.readback_command!=='lock-status'||e.readback_state!==(acquire?'held':'free')||e.readback_owner!==(acquire?input.run:null)
    ||!Number.isSafeInteger(e.at_epoch_ms)||e.at_epoch_ms<started-1000||e.at_epoch_ms>Date.now()+1000||Date.parse(e.at)!==e.at_epoch_ms
    ||(acquire?!held(e.readback):e.readback!=='lock=free'))fail('LOCK_RECEIPT_INVALID');
   const actual=await phone('lock-status');if(acquire?!held(actual):actual.trim()!=='lock=free')fail('LOCK_LOST');
  }
  const central=async()=>{const d=await brain('/device-locks');const a=d.locks?.filter(r=>r.device_name===DEVICE);if(d.success!==true||a?.length!==1)fail('LOCK_UNKNOWN');return a[0];};
  const c=await central();if(c.locked_by!==null||(await phone('lock-status')).trim()!=='lock=free')fail('LOCK_BUSY');
  let centralHeld=false,localHeld=false,localAttempted=false;
  const release=async()=>{if(localHeld){const started=Date.now();await verifyReceipt('release',await phone('lock-release-exact',input.run),started);localHeld=false;}
   if(centralHeld){const r=await brain('/device-locks/release',{device_name:DEVICE,locked_by:input.maintenance_task_id});if(r.success!==true||(await central()).locked_by!==null)fail('LOCK_RELEASE_UNKNOWN');centralHeld=false;}};
  try{
   const a=await brain('/device-locks/acquire',{device_name:DEVICE,locked_by:input.maintenance_task_id,ttl_minutes:5});if(a.acquired!==true||a.lock?.locked_by!==input.maintenance_task_id)fail('LOCK_BUSY');centralHeld=true;
   localAttempted=true;const started=Date.now();await verifyReceipt('acquire',await phone('lock-acquire-new',input.run),started);localHeld=true;
   return {read:async()=>{const stopHash=await stopped(auth.records);const c=await central(),local=await phone('lock-status');if(c.locked_by!==input.maintenance_task_id||Date.parse(c.expires_at)<Date.now()+30000||!held(local))fail('LOCK_LOST');return {observed_at:Date.now(),old_session_terminal:true,old_native_stopped:true,pending:0,active:0,guard_held:true,local_owner:input.run,central_owner:input.maintenance_task_id,evidence_sha256:hash({stopHash,central:c,local})};},release};
  }catch(e){if(localAttempted&&!localHeld){const status=await phone('lock-status');if(new RegExp('^lock=held owner='+input.run+'(?: |\\n|$)').test(status))localHeld=true;else if(status.trim()!=='lock=free')fail('LOCK_ACQUIRE_UNKNOWN');}await release();throw e;}
 }
 return {readAuthority,acquireGuard,inspectStopped:async input=>{const a=await readAuthority(input);return {status:'observed_stopped',evidence_sha256:await stopped(a.records),observed_at:new Date().toISOString(),side_effects:'GET/official RPC/host process reads only; no locks or phone actions'};}};
}
module.exports={createAuthority,...createAuthority()};

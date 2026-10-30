// 102n隔离恢复仅从Brain决定/任务和当下原生进程/双锁读证，不收调用方证明。
'use strict';
const {openSync,readFileSync,fstatSync,closeSync,constants}=require('node:fs');
const {join}=require('node:path');
const {homedir}=require('node:os');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {SCOPE,runFor,validateRequest,digest}=require('./qualification-quarantine-recovery-102n.js');
const exec=promisify(execFile),SERIAL='ANGYVB4227006983',PROFILE='jinoshengyuan-work';
const fail=reason=>{throw Error('RECOVERY_102N_'+reason);};
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const receiptRoot='/private/tmp/openclaw-phone/evidence/'+PROFILE;
const nativeProgram=String.raw`
import os,glob,json,stat,hashlib,ctypes,struct,subprocess,time
source='${SCOPE.original_102_run}'
commit='${SCOPE.original_source_commit}'
root=os.path.expanduser('~/.local/share/zenithjoy/phone-candidate-runs/'+commit+'/ledger/douyin_video_processing-'+source)
def secure(path):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  s=os.fstat(fd)
  if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1 or s.st_size>10485760: raise ValueError('file')
  return os.read(fd,10485761)
 finally: os.close(fd)
split_bytes=secure(os.path.join(root,'split-result.json'))
split=json.loads(split_bytes)
if split.get('status')!='failed' or split.get('source_commit')!=commit or split.get('run_id')!='douyin_video_processing-'+source+'__a1': raise ValueError('split')
paths=sorted(glob.glob(os.path.join(root,'native-operations','*.json')))
if len(paths)!=8: raise ValueError('receipts')
identities={};groups=set();files=[hashlib.sha256(split_bytes).hexdigest()]
for path in paths:
 raw=secure(path);files.append(hashlib.sha256(raw).hexdigest());r=json.loads(raw)
 if r.get('run_id')!=split['run_id'] or r.get('owner')!=source or r.get('source_commit')!=commit or r.get('status')!='unknown' or r.get('process_coverage')!='observed_only' or r.get('execution_stopped') is not False: raise ValueError('receipt')
 for p in r.get('processes',[]):
  pid=p.get('pid');start=p.get('start_identity');group=p.get('pgid')
  if not isinstance(pid,int) or pid<1 or not isinstance(start,str) or not start or not isinstance(group,int) or group<1: raise ValueError('identity')
  if pid in identities and identities[pid]!=start: raise ValueError('pid reuse in receipt')
  identities[pid]=start;groups.add(group)
if len(identities)!=108: raise ValueError('coverage')
lib=ctypes.CDLL('/usr/lib/libproc.dylib',use_errno=True)
def live_start(pid):
 b=ctypes.create_string_buffer(136)
 if lib.proc_pidinfo(pid,3,0,b,136)!=136:
  try: os.kill(pid,0)
  except ProcessLookupError:return None
  raise ValueError('identity unknown')
 x=b.raw;return str(struct.unpack_from('=Q',x,120)[0])+':'+str(struct.unpack_from('=Q',x,128)[0])
same=sum(live_start(pid)==start for pid,start in identities.items())
ancestors=set();p=os.getpid()
while p>1:
 ancestors.add(p)
 try:p=os.getppid() if p==os.getpid() else int(subprocess.check_output(['/bin/ps','-o','ppid=','-p',str(p)],text=True).strip())
 except (ValueError,subprocess.CalledProcessError):break
members=[];tagged=[]
for line in subprocess.check_output(['/bin/ps','-axo','pid=,pgid=,command='],text=True).splitlines():
 parts=line.strip().split(None,2)
 if len(parts)!=3:raise ValueError('ps')
 pid,group,command=int(parts[0]),int(parts[1]),parts[2]
 if pid in ancestors:continue
 if group in groups:members.append(pid)
 if source in command:tagged.append(pid)
result={'original_run':source,'original_source_commit':commit,'run_status':'failed','native_receipts':len(paths),'identities':len(identities),'same_live':same,'group_members':len(members),'tagged_processes':len(tagged),'observed_at':int(time.time()*1000)}
result['evidence_sha256']=hashlib.sha256(json.dumps({'files':files,'result':result},sort_keys=True).encode()).hexdigest()
print(json.dumps(result))
`;
function token(){
 const fd=openSync(join(homedir(),'.credentials/single-video-recovery-internal.env'),constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const s=fstatSync(fd);if(!s.isFile()||s.uid!==process.getuid()||(s.mode&0o077)!==0)fail('CREDENTIAL_INVALID');
  const value=readFileSync(fd,'utf8').match(/^CECELIA_INTERNAL_TOKEN=([^\r\n]+)$/m)?.[1];
  if(!value)fail('CREDENTIAL_INVALID');return value;
 }finally{closeSync(fd);}
}
async function defaultBrain(path,body){
 if(!/^\/(?:strategic-decisions\?made_by=user&limit=100|tasks\/[a-f0-9-]{36}|device-locks(?:\/(?:acquire|release))?)$/.test(path))fail('BRAIN_PATH_INVALID');
 const r=await fetch('http://localhost:5221/api/brain'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Internal-Token':token()},
  body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!r.ok)fail('BRAIN_UNAVAILABLE');return r.json();
}
async function defaultNative(){
 let stdout;try{({stdout}=await exec('ssh',['-o','ControlMaster=no','-o','ControlPath=none','-o','BatchMode=yes',
  '-o','ConnectTimeout=10','xian-m4','python3 -I -c '+quote(nativeProgram)],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024}));}
 catch{fail('OLD_EXECUTION_UNKNOWN');}
 let census;try{census=JSON.parse(stdout);}catch{fail('OLD_EXECUTION_UNKNOWN');}
 let local;try{({stdout:local}=await exec('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8',timeout:10000,maxBuffer:4*1024*1024}));}
 catch{fail('OLD_EXECUTION_UNKNOWN');}
 const records=local.trim().split('\n').map(line=>{const m=line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);if(!m)fail('OLD_EXECUTION_UNKNOWN');return {pid:Number(m[1]),ppid:Number(m[2]),command:m[3]};});
 const parents=new Map(records.map(r=>[r.pid,r.ppid])),ancestors=new Set();
 for(let pid=process.pid;pid>1&&!ancestors.has(pid);pid=parents.get(pid)||0)ancestors.add(pid);
 return {...census,local_tagged_processes:records.filter(r=>!ancestors.has(r.pid)&&r.command.includes(SCOPE.original_102_run)).length};
}
function checkStopped(x){
 if(x?.original_run!==SCOPE.original_102_run||x.original_source_commit!==SCOPE.original_source_commit||x.run_status!=='failed'
  ||x.native_receipts!==8||x.identities!==108||x.same_live!==0||x.group_members!==0||x.tagged_processes!==0
  ||x.local_tagged_processes!==0||!Number.isSafeInteger(x.observed_at)||Date.now()-x.observed_at>5000
  ||x.observed_at>Date.now()+1000||!/^[a-f0-9]{64}$/.test(x.evidence_sha256||''))fail('OLD_EXECUTION_UNKNOWN');
 return x;
}
function createAuthority(io={}){
 const brain=io.brain||defaultBrain,native=io.native||defaultNative,phone=io.phone||defaultPhone,readReceipt=io.readReceipt||defaultReceipt;
 async function readAuthority(input){
  validateRequest(input);
  let decisions,originalTask,maintenanceTask;
  try{[decisions,originalTask,maintenanceTask]=await Promise.all([
   brain('/strategic-decisions?made_by=user&limit=100'),brain('/tasks/'+SCOPE.original_task_id),brain('/tasks/'+input.maintenance_task_id)]);}
  catch{fail('AUTHORITY_UNAVAILABLE');}
  const rows=decisions?.success===true?decisions.data:null,matches=Array.isArray(rows)?rows.filter(d=>d.id===input.decision_id):[];
  if(matches.length!==1||decisions.has_more||decisions.hasMore)fail('DECISION_NOT_FOUND');
  return {decision:matches[0],originalTask,maintenanceTask,actor:'codex:qualification-recovery-102n',
   evidence_sha256:digest({decision:matches[0],originalTask,maintenanceTask})};
 }
 async function central(){const result=await brain('/device-locks');const rows=result?.locks?.filter(r=>r.device_name===SERIAL);
  if(result?.success!==true||rows?.length!==1)fail('LOCK_UNKNOWN');return rows[0];}
 async function acquireGuard(input){
  validateRequest(input);
  checkStopped(await native());
  const oldCentral=await central(),oldLocal=await phone('lock-status');
  if(oldCentral.locked_by!==null||oldLocal.trim()!=='lock=free')fail('LOCK_BUSY');
  let centralHeld=false,localHeld=false,localAttempted=false;
  const held=x=>new RegExp('^lock=held owner='+input.run+' age=[0-9]+s stale=false reclaimable=false ttl=[0-9]+s\\n?$').test(x);
  async function verifyReceipt(kind,stdout,started){
   const acquire=kind==='acquire',eid=input.run+'-lock-'+kind,path=receiptRoot+'/'+eid+'.json';
   const action=acquire?'lock-acquire-new':'lock-release-exact',message=(acquire?'run_claim=recorded owner='+input.run+'\n':'')+'lock='+(acquire?'acquired':'released')+' owner='+input.run;
   if(stdout!==message+'\nlock_evidence_id='+eid+' lock_evidence='+path+' readback_state='+(acquire?'held':'free')+'\n')fail('LOCK_RECEIPT_INVALID');
   let data;try{data=await readReceipt(path);}catch{fail('LOCK_RECEIPT_UNKNOWN');}
   const e=data?.latest;
   if(data?.schema!=='lock_receipt_v1'||data.evidence_id!==eid||data.run_id!==input.run||data.kind!==kind
    ||!Array.isArray(data.events)||data.events.length!==1||digest(data.events[0])!==digest(e)||e?.seq!==1
    ||e.command!==action||e.requested_owner!==input.run||e.rc!==0||e.result!=='ok'||e.receipt!==message||e.stderr!==''
    ||e.profile!==PROFILE||e.serial!==SERIAL||e.readback_command!=='lock-status'
    ||e.readback_state!==(acquire?'held':'free')||e.readback_owner!==(acquire?input.run:null)
    ||!Number.isSafeInteger(e.at_epoch_ms)||e.at_epoch_ms<started-1000||e.at_epoch_ms>Date.now()+1000
    ||(acquire?!held(e.readback):e.readback!=='lock=free'))fail('LOCK_RECEIPT_INVALID');
   const actual=await phone('lock-status');if(acquire?!held(actual):actual.trim()!=='lock=free')fail('LOCK_LOST');
  }
  const release=async()=>{
   if(localHeld){const started=Date.now();await verifyReceipt('release',await phone('lock-release-exact',input.run),started);localHeld=false;}
   if(centralHeld){const r=await brain('/device-locks/release',{device_name:SERIAL,locked_by:input.maintenance_task_id});
    if(r.success!==true||(await central()).locked_by!==null)fail('CENTRAL_RELEASE_UNKNOWN');centralHeld=false;}
  };
  try{
   const a=await brain('/device-locks/acquire',{device_name:SERIAL,locked_by:input.maintenance_task_id,ttl_minutes:5});
   if(a.acquired!==true||a.lock?.locked_by!==input.maintenance_task_id)fail('LOCK_BUSY');centralHeld=true;
   localAttempted=true;const started=Date.now();await verifyReceipt('acquire',await phone('lock-acquire-new',input.run),started);localHeld=true;
   return {read:async()=>{const stop=checkStopped(await native()),c=await central(),local=await phone('lock-status');
    if(c.locked_by!==input.maintenance_task_id||Date.parse(c.expires_at)<Date.now()+30000||!held(local))fail('LOCK_LOST');
    return {original_run:SCOPE.original_102_run,original_source_commit:SCOPE.original_source_commit,old_execution_stopped:true,
     local_owner:input.run,central_owner:input.maintenance_task_id,guard_held:true,active:0,pending:0,observed_at:Date.now(),
     evidence_sha256:digest({stop,central:c,local})};},release};
  }catch(e){
   if(localAttempted&&!localHeld){const status=await phone('lock-status');if(held(status))localHeld=true;
    else if(status.trim()!=='lock=free')fail('LOCAL_ACQUIRE_UNKNOWN');}
   await release();throw e;
  }
 }
 return {readAuthority,acquireGuard};
}
async function defaultPhone(command,owner){
 if(!['lock-status','lock-acquire-new','lock-release-exact'].includes(command)||owner&&!SCOPE.video_ids.some(id=>owner===runFor(id)))fail('PHONE_ACTION_INVALID');
 const manifest=JSON.parse(readFileSync(join(__dirname,'deployment-manifest.json'),'utf8'));
 if(!/^[a-f0-9]{40}$/.test(manifest.source_commit||''))fail('SOURCE_INVALID');
 const root='.local/share/zenithjoy/phone-candidates/'+manifest.source_commit+'/runtime/douyin-phone-adb';
 let stdout;try{({stdout}=await exec('ssh',['-o','ControlMaster=no','-o','ControlPath=none','-o','BatchMode=yes',
  '-o','ConnectTimeout=10','xian-m4','zsh "$HOME/'+root+'" --profile '+PROFILE+' '+command+(owner?' '+owner:'')],
  {encoding:'utf8',timeout:30000,maxBuffer:1024*1024}));}catch{fail('PHONE_UNKNOWN');}
 return stdout;
}
async function defaultReceipt(path){
 if(!/^\/private\/tmp\/openclaw-phone\/evidence\/jinoshengyuan-work\/qualification_recovery_102n_\d{16,24}-lock-(?:acquire|release)\.json$/.test(path))fail('LOCK_RECEIPT_PATH_INVALID');
 const code='import os,stat,sys;fd=os.open(sys.argv[1],os.O_RDONLY|os.O_NOFOLLOW);s=os.fstat(fd);assert stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_size<1048576;print(os.read(fd,1048576).decode())';
 let stdout;try{({stdout}=await exec('ssh',['-o','ControlMaster=no','-o','ControlPath=none','-o','BatchMode=yes',
  '-o','ConnectTimeout=10','xian-m4','python3 -I -c '+quote(code)+' '+quote(path)],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024}));}
 catch{fail('LOCK_RECEIPT_UNKNOWN');}
 try{return JSON.parse(stdout);}catch{fail('LOCK_RECEIPT_UNKNOWN');}
}
module.exports={createAuthority,checkStopped,defaultNative,nativeProgram};

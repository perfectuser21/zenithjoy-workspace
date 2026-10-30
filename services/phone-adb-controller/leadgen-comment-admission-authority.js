// 102g comment admission uses current Brain authority and a live native-process census.
// Neither request JSON nor a saved historical receipt can assert that the old process stopped.
'use strict';
const {readFileSync,openSync,fstatSync,closeSync,constants}=require('node:fs');
const {join}=require('node:path');
const {homedir}=require('node:os');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {createHash}=require('node:crypto');
const {SOURCE_RUN,SOURCE_COMMIT,VIDEO_ID}=require('./leadgen-comment-admission.js');
const exec=promisify(execFile);
const fail=code=>{const error=Error('ADMISSION_'+code);error.code=error.message;throw error;};
const nativeProgram=String.raw`
import os,glob,json,stat,hashlib,ctypes,struct,subprocess,time
source='${SOURCE_RUN}'
commit='${SOURCE_COMMIT}'
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
if len(paths)!=11: raise ValueError('receipt count')
identities={};groups=set();digests=[hashlib.sha256(split_bytes).hexdigest()]
for path in paths:
 raw=secure(path);digests.append(hashlib.sha256(raw).hexdigest());r=json.loads(raw)
 if r.get('run_id')!=split['run_id'] or r.get('owner')!=source or r.get('source_commit')!=commit or r.get('status')!='unknown' or r.get('process_coverage')!='observed_only' or r.get('execution_stopped') is not False: raise ValueError('receipt')
 for p in r.get('processes',[]):
  pid=p.get('pid');start=p.get('start_identity');group=p.get('pgid')
  if not isinstance(pid,int) or pid<1 or not isinstance(start,str) or not start or not isinstance(group,int) or group<1: raise ValueError('identity')
  if pid in identities and identities[pid]!=start: raise ValueError('pid ambiguity')
  identities[pid]=start;groups.add(group)
if len(identities)!=207: raise ValueError('coverage')
lib=ctypes.CDLL('/usr/lib/libproc.dylib',use_errno=True)
def live_start(pid):
 b=ctypes.create_string_buffer(136)
 if lib.proc_pidinfo(pid,3,0,b,136)!=136:
  try: os.kill(pid,0)
  except ProcessLookupError: return None
  raise ValueError('process identity unknown')
 x=b.raw
 return str(struct.unpack_from('=Q',x,120)[0])+':'+str(struct.unpack_from('=Q',x,128)[0])
same=sum(live_start(pid)==start for pid,start in identities.items())
ancestors=set();p=os.getpid()
while p>1:
 ancestors.add(p)
 try: p=os.getppid() if p==os.getpid() else int(subprocess.check_output(['/bin/ps','-o','ppid=','-p',str(p)],text=True).strip())
 except (ValueError,subprocess.CalledProcessError): break
group_members=[];tagged=[]
for line in subprocess.check_output(['/bin/ps','-axo','pid=,pgid=,command='],text=True).splitlines():
 parts=line.strip().split(None,2)
 if len(parts)!=3: raise ValueError('ps')
 pid,group,command=int(parts[0]),int(parts[1]),parts[2]
 if pid in ancestors: continue
 if group in groups: group_members.append(pid)
 if source in command: tagged.append(pid)
result={'source_run':source,'source_commit':commit,'run_status':'failed','native_receipts':len(paths),'observed_identities':len(identities),'same_live':same,'group_members':len(group_members),'tagged_processes':len(tagged),'observed_at':int(time.time()*1000)}
result['evidence_sha256']=hashlib.sha256(json.dumps({'files':digests,'result':result},sort_keys=True).encode()).hexdigest()
print(json.dumps(result))
`;
function token(){
  const fd=openSync(join(homedir(),'.credentials/single-video-recovery-internal.env'),constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const s=fstatSync(fd);if(!s.isFile()||s.uid!==process.getuid()||(s.mode&0o077)!==0)fail('CREDENTIAL_INVALID');
    const value=readFileSync(fd,'utf8').match(/^CECELIA_INTERNAL_TOKEN=([^\r\n]+)$/m)?.[1];
    if(!value)fail('CREDENTIAL_INVALID');return value;
  }finally{closeSync(fd);}
}
async function brain(path){
  if(!/^\/(?:strategic-decisions\?made_by=user&limit=100|tasks\/[a-f0-9-]{36})$/.test(path))fail('AUTHORITY_INVALID');
  const response=await fetch('http://localhost:5221/api/brain'+path,{headers:{'X-Internal-Token':token()},
    redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)fail('AUTHORITY_UNAVAILABLE');return response.json();
}
async function readAuthority(input){
  let decisions,maintenanceTask;
  try{[decisions,maintenanceTask]=await Promise.all([
    brain('/strategic-decisions?made_by=user&limit=100'),brain('/tasks/'+input.maintenance_task_id)]);}
  catch{fail('AUTHORITY_UNAVAILABLE');}
  const rows=decisions?.success===true?decisions.data:null;
  const matches=Array.isArray(rows)?rows.filter(d=>d.id===input.decision_id):[];
  if(matches.length!==1||decisions.has_more||decisions.hasMore)fail('AUTHORITY_INVALID');
  return {decision:matches[0],maintenanceTask};
}
async function inspectStopped(){
  const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
  let stdout;
  try{({stdout}=await exec('ssh',['-o','ControlMaster=no','-o','ControlPath=none','-o','BatchMode=yes',
    '-o','ConnectTimeout=10','xian-m4','python3 -I -c '+quote(nativeProgram)],
    {encoding:'utf8',timeout:30000,maxBuffer:1024*1024}));}
  catch{fail('OLD_EXECUTION_UNKNOWN');}
  let census;try{census=JSON.parse(stdout);}catch{fail('OLD_EXECUTION_UNKNOWN');}
  if(census.source_run!==SOURCE_RUN||census.source_commit!==SOURCE_COMMIT||!census.evidence_sha256)fail('OLD_EXECUTION_UNKNOWN');
  let local;
  try{({stdout:local}=await exec('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8',timeout:10000,maxBuffer:4*1024*1024}));}
  catch{fail('OLD_EXECUTION_UNKNOWN');}
  const records=local.trim().split('\n').map(line=>{
    const m=line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);if(!m)fail('OLD_EXECUTION_UNKNOWN');
    return {pid:Number(m[1]),ppid:Number(m[2]),command:m[3]};
  });
  const parents=new Map(records.map(r=>[r.pid,r.ppid])),ancestors=new Set();
  for(let pid=process.pid;pid>1&&!ancestors.has(pid);pid=parents.get(pid)||0)ancestors.add(pid);
  const tagged=records.filter(r=>!ancestors.has(r.pid)&&r.command.includes(SOURCE_RUN));
  return {...census,local_tagged_processes:tagged.length,
    evidence_sha256:createHash('sha256').update(JSON.stringify({remote:census.evidence_sha256,local_tagged:tagged.length})).digest('hex')};
}
module.exports={readAuthority,inspectStopped};

#!/usr/bin/env python3
"""Actions与任意调用机共享MMV上的内核部署锁；SSH失联则终止本次部署。"""
import fcntl,json,os,selectors,shlex,signal,stat,subprocess,sys,time
from pathlib import Path
ADMISSION_SOURCE = r'''
import contextlib,datetime,fcntl,hashlib,json,math,os,re,shlex,stat,subprocess,time,urllib.request
from pathlib import Path

def require(ok,reason):
 if not ok:raise ValueError('Commander deployment admission: '+reason)

def canonical(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def digest(value):return hashlib.sha256(canonical(value)).hexdigest()
def timestamp(value):return datetime.datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()

def raw(path,limit=16777216):
 path=Path(path)
 require(path.is_absolute(),'absolute evidence path required')
 for parent in [path,*path.parents]:require(not parent.is_symlink(),'symlink evidence/lock rejected')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  before=os.fstat(fd);require(stat.S_ISREG(before.st_mode) and before.st_size<=limit,'regular bounded file required')
  data=b''
  while len(data)<=limit:
   block=os.read(fd,min(65536,limit+1-len(data)))
   if not block:break
   data+=block
  after=os.fstat(fd);named=path.stat()
  require(len(data)<=limit and (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns) and (named.st_dev,named.st_ino)==(after.st_dev,after.st_ino),'file changed during read')
  return data
 finally:os.close(fd)
def read(path):return json.loads(raw(path,1048576))

def lock_fd(path,create=False):
 path=Path(path)
 for parent in [path,*path.parents]:require(not parent.is_symlink(),'symlink lock rejected')
 fd=os.open(path,os.O_RDWR|os.O_NOFOLLOW|(os.O_CREAT if create else 0),0o600)
 try:
  require(stat.S_ISREG(os.fstat(fd).st_mode),'regular lock required');fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  info=os.fstat(fd);require((info.st_dev,info.st_ino)==(path.stat().st_dev,path.stat().st_ino),'lock identity changed')
  return fd
 except BaseException:os.close(fd);raise

def brain_get(path,timeout=30):
 require(re.fullmatch(r'/api/brain/(?:tasks/[a-f0-9-]{36}|runs/[A-Za-z0-9._-]{1,80}/reconciliation|releases/[a-f0-9-]{36}/(?:gate|observations/[a-f0-9-]{36}))',path),'invalid authority path')
 cache=Path.home()/'.credentials/cecelia-internal.env';info=cache.lstat()
 require(stat.S_IMODE(info.st_mode)==0o600 and info.st_uid==os.getuid(),'credential mirror permission')
 lines=raw(cache,65536).decode().splitlines();values=[x.partition('=')[2] for x in lines if x.partition('=')[0].strip()=='CECELIA_INTERNAL_TOKEN']
 token=shlex.split(values[-1])[0] if values else ''
 require(token and '\n' not in token and '\r' not in token,'credential unavailable')
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*args,**kwargs):return None
 request=urllib.request.Request('http://localhost:5221'+path,headers={'Authorization':'Bearer '+token,'Connection':'close'},method='GET')
 try:
  with urllib.request.build_opener(NoRedirect).open(request,timeout=min(30,timeout)) as response:
   require(response.status==200,'authority HTTP status');data=response.read(4194305)
   require(len(data)<=4194304,'authority response too large');return json.loads(data)
 except Exception:raise ValueError('Commander deployment authority GET unavailable') from None

def installed_runtime(home,original,get):
 root=home/'.openclaw/commander';manifest_raw=raw(root/'runtime-manifest.json',1048576);manifest=json.loads(manifest_raw);files=manifest.get('files')
 require(manifest.get('protocol')=='commander-v2' and isinstance(files,dict) and 0<len(files)<=300 and manifest.get('runtime_snapshot_sha256')==digest(files),'installed runtime manifest')
 total=0
 for name,sha in files.items():
  require(isinstance(name,str) and not name.startswith('/') and all(x not in ('','..','.') for x in name.split('/')) and re.fullmatch('[a-f0-9]{64}',sha),'runtime file identity')
  data=raw(root/name);total+=len(data);require(total<=33554432 and hashlib.sha256(data).hexdigest()==sha,'installed runtime bytes')
 if canonical(files)==canonical(original):return
 # A later official deployment can replace the original failed runtime. Reuse its existing
 # authority-backed observation and original measured evidence; never trust a self-signed map.
 releases=manifest.get('releases');require(isinstance(releases,dict) and len(releases)==1,'installed release map')
 release_id=next(iter(releases));require(re.fullmatch('[a-f0-9-]{36}',release_id),'installed release id')
 local=read(home/'.openclaw/leadgen-scripts/deployment-manifest.json')
 require(local.get('release_id')==release_id and local.get('target')=='mmv' and local.get('environment')=='production' and local.get('source_repo')=='perfectuser21/zenithjoy-workspace' and re.fullmatch('[a-f0-9]{40}',local.get('source_commit','')),'installed release source/target')
 observation_id=local.get('observation_id');require(re.fullmatch('[a-f0-9-]{36}',observation_id or ''),'installed observation id')
 gate=get('/api/brain/releases/'+release_id+'/gate')
 require(gate.get('release_id')==release_id and gate.get('deployed') is True and gate.get('actual_matches') is True and gate.get('current_status')=='deployed' and gate.get('current_observation_id')==observation_id and gate.get('gaps')==[],'installed official release gate')
 obs=get('/api/brain/releases/'+release_id+'/observations/'+observation_id).get('observation',{});payload=obs.get('payload',{})
 require(obs.get('id')==observation_id and obs.get('release_id')==release_id and obs.get('payload_sha256')==digest(payload) and payload.get('target')=='mmv' and payload.get('environment')=='production','installed official observation')
 repos=[x for x in payload.get('components',[]) if x.get('kind')=='repo']
 require(repos==[{'kind':'repo','repo':local['source_repo'],'revision':local['source_commit']}],'installed official source revision')
 attempt=payload.get('attempt_key');require(isinstance(attempt,str) and 0<len(attempt)<=200,'installed attempt identity')
 key=digest({'release_id':release_id,'host':'mmv','attempt_key':attempt})
 evidence=json.loads(raw(home/'.config/zenithjoy/deployments'/(key+'.evidence.json'),16777216))
 require(payload.get('evidence_ref')=='deployment-sha256:'+digest(evidence) and evidence.get('source_repo')==local['source_repo'] and evidence.get('source_commit')==local['source_commit'] and evidence.get('installed_runtime_manifest_sha256')==hashlib.sha256(manifest_raw).hexdigest(),'installed authoritative measured runtime')
 require(raw(root/'runtime-manifest.json',1048576)==manifest_raw,'installed runtime manifest changed')

def failed_proof(home,directory,get):
 e=read(directory/'envelope.json');require(e.get('protocol')=='commander-v2' and e.get('run_id')==directory.name,'original run envelope')
 require(re.fullmatch(r'[a-f0-9-]{36}',e.get('task_id','')),'task identity')
 require(time.time()>=timestamp(e['cleanup_deadline_at'])>=timestamp(e['deadline_at']),'original cleanup budget still open')
 task=get('/api/brain/tasks/'+e['task_id']);c=task.get('result',{}).get('workflow_control',{});p=c.get('failed_reconciliation',{})
 require(task.get('id')==e['task_id'] and task.get('status')=='failed' and task.get('task_type')=='workflow_dispatch' and task.get('payload',{}).get('commander_protocol')=='commander-v2','authoritative task lifecycle')
 require(canonical(c.get('envelope'))==canonical(e),'authoritative frozen envelope mismatch')
 require(canonical(read(directory/'input.json'))==canonical(e['input']) and canonical(read(directory/'contract.json'))==canonical(e['contract']),'original input/contract drift')
 require(c.get('phase')=='final' and c.get('verdict')=='FAIL' and c.get('effects')=='unknown' and c.get('retry_safe') is False and c.get('execution_stopped') is True and not c.get('delivery'),'authoritative failed control required')
 identity={key:e[key] for key in ('task_id','run_id','attempt','owner_epoch','input_sha256')};identity['definition_snapshot_sha256']=e['definition']['snapshot_sha256'];identity['runtime_snapshot_sha256']=e['definition']['runtime_snapshot_sha256']
 require(p.get('schema_version')==1 and all(type(p.get(k)) is type(v) and p.get(k)==v for k,v in identity.items()),'failed proof frozen identity')
 require(p.get('verdict')=='FAIL' and p.get('effects')=='unknown' and p.get('retry_safe') is False and p.get('sha256')==digest({k:v for k,v in p.items() if k!='sha256'}),'failed proof digest/verdict')
 for k in ('attestation_sha256','cleanup_sha256','terminal_sha256','binding_sha256','request_sha256','previous_control_sha256'):require(re.fullmatch('[a-f0-9]{64}',p.get(k,'')),'failed proof hash '+k)
 auth=task['result'].get('commander_failure_reconciliation',{})
 require(auth.get('operator_actor')==p.get('actor') and auth.get('verification_task_id')==p.get('verification_task_id') and all(auth.get(k)==v for k,v in identity.items() if k!='runtime_snapshot_sha256'),'pre-registered failure authority')
 require(isinstance(p.get('principal'),str) and p['principal'] and timestamp(p['observed_at'])<=time.time(),'authority provenance/time')
 r=get('/api/brain/runs/'+e['run_id']+'/reconciliation');row=r.get('task_run',{})
 require(r.get('run_id')==e['run_id'] and r.get('run_binding_id') and r.get('release_id')==e['definition'].get('release_id') and r.get('links',{}).get('task_id')==e['task_id'] and r['links'].get('task_run_id')==row.get('id'),'official run binding')
 require(row.get('run_id')==e['run_id'] and row.get('task_id')==e['task_id'] and row.get('status')=='failed' and row.get('ended_at') and timestamp(row['ended_at'])<=time.time(),'official task run not failed/ended')
 require(canonical(row.get('context',{}).get('commander_envelope'))==canonical(e) and canonical(row.get('result',{}).get('failed_reconciliation'))==canonical(p),'official task run proof/envelope')
 original=p.get('runtime_files');require(isinstance(original,dict) and 0<len(original)<=300 and digest(original)==identity['runtime_snapshot_sha256'],'authoritative original runtime closure')
 installed_runtime(home,original,get)
 binding=read(directory/'agent-binding.json');request=read(directory/'agent-request.json');closed=read(directory/'handoff-closed.json');claimed=read(directory/'spawn-claimed.json')
 require(digest(binding)==p['binding_sha256'] and binding.get('run_id')==e['run_id'] and binding.get('task_id')==e['task_id'] and binding.get('parent_session_key')=='agent:work-commander:'+e['run_id'],'original child binding')
 require(isinstance(binding.get('nonce'),str) and binding['nonce'] and all(x.get('nonce')==binding['nonce'] for x in (request,claimed)) and type(closed.get('at')) in (int,float) and math.isfinite(closed['at']) and 0<closed['at']<=time.time(),'original nonce not closed')
 require(request.get('run_id')==e['run_id'] and request.get('task_id')==e['task_id'] and request.get('protocol')==e['protocol'] and request.get('parent_session_key')==binding['parent_session_key'] and request.get('expires_at')==timestamp(e['deadline_at']),'original request')
 child=p.get('original_child',{})
 require(child.get('run_id')==binding.get('child_run_id') and child.get('session_key')==binding.get('child_session_key') and child.get('status') in ('error','timeout','aborted'),'official original child failure')
 require(all(type(child.get(k)) in (int,float) and math.isfinite(child[k]) for k in ('started_at','ended_at')) and 0<child['started_at']<=child['ended_at']<=timestamp(e['cleanup_deadline_at'])*1000,'original child failure time')
 for name in ('delivery.json','execution-failure.json','agent-completion.json','agent-terminal.json','child-stop.json','child-stop-readback.json','agent-delivery.json'):
  require(not (directory/name).exists() and not (directory/name).is_symlink(),'conflicting local terminal/delivery')
 cleanup_raw=raw(directory/'cleanup.json',1048576);cleanup=json.loads(cleanup_raw);shell=cleanup.get('_shell',{})
 require(hashlib.sha256(cleanup_raw).hexdigest()==p['cleanup_sha256'] and cleanup.get('completed') is True and cleanup.get('failure') is None and cleanup.get('lock_status')=='free','original completed cleanup')
 require(shell.get('run_id')==e['run_id'] and shell.get('attempt')==e['attempt'] and shell.get('activity_key')=='cleanup' and canonical(shell.get('files'))==canonical(p.get('files')),'original cleanup identity/references')
 require(child['ended_at']<=timestamp(shell['started_at'])*1000<=timestamp(shell['ended_at'])*1000<=timestamp(e['cleanup_deadline_at'])*1000,'original cleanup time')
 refs=p.get('files');require(isinstance(refs,list) and 0<len(refs)<=200,'bounded cleanup files')
 seen=set();total=0
 for ref in refs:
  name=ref.get('path');sha=ref.get('sha256');require(isinstance(name,str) and name.startswith(str(directory)+'/') and all(x not in ('','..','.') for x in name[len(str(directory))+1:].split('/')) and name not in seen and re.fullmatch('[a-f0-9]{64}',sha or ''),'original cleanup file path/hash')
  seen.add(name);data=raw(Path(name));total+=len(data);require(total<=33554432 and hashlib.sha256(data).hexdigest()==sha,'original cleanup evidence bytes')
 require(isinstance(cleanup.get('evidence'),list) and cleanup['evidence'] and all(x in seen for x in cleanup['evidence']),'cleanup evidence coverage')
 roots=read(directory/'root-identity.json');current={}
 for name,path in [('run',directory),('evidence',directory/'evidence'),('commander',home/'.openclaw/commander')]:
  require(path.resolve(strict=True)==path and path.is_dir(),'original root moved/symlinked');info=path.stat();current[name]={'realpath':str(path),'st_dev':info.st_dev,'st_ino':info.st_ino}
 require(canonical(current)==canonical(roots) and str(directory/'root-identity.json') in seen,'original frozen roots mismatch')
 return p['sha256']

@contextlib.contextmanager
def commander_admission(home,get=brain_get):
 deadline=time.monotonic()+60
 original_get=get
 def get(path):
  require(time.monotonic()<deadline,'admission budget exhausted')
  result=brain_get(path,deadline-time.monotonic()) if original_get is brain_get else original_get(path)
  require(time.monotonic()<deadline,'admission budget exhausted');return result
 home=Path(home).resolve();root=home/'.openclaw/commander';root.mkdir(parents=True,exist_ok=True);fds=[];locks=[];fixed=[]
 def hold(path,create=False):
  fd=lock_fd(path,create);fds.append(fd);locks.append((path,os.fstat(fd)))
 def identity(path):
  info=path.lstat();return (info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns,info.st_ctime_ns)
 root_identity=identity(root)[:2]
 try:
  hold(root/'.admission.lock',True)
  active=subprocess.run(['pgrep','-f','[w]f-agent-run.sh|[w]f-v2.py worker'],stdout=subprocess.DEVNULL).returncode==0
  require(not active,'active Commander process')
  runs=home/'wf-agent-runs';require(not runs.is_symlink(),'run root symlink')
  paths=sorted(runs.glob('*/runtime.json'));require(len(paths)<=1000,'bounded run census')
  for path in paths:
   state=read(path)
   if state.get('execution_stopped') is True and state.get('phase')=='awaiting_verify' and (path.parent/'delivery.json').is_file():continue
   hold(path.parent/'.worker.lock')
   names=['envelope.json','input.json','contract.json','agent-binding.json','agent-request.json','handoff-closed.json','spawn-claimed.json','cleanup.json','root-identity.json']
   refs=read(path.parent/'cleanup.json')['_shell']['files'];require(isinstance(refs,list) and 0<len(refs)<=200,'bounded cleanup references')
   for ref in refs:
    name=ref.get('path');require(isinstance(name,str) and name.startswith(str(path.parent)+'/') and all(x not in ('','..','.') for x in name[len(str(path.parent))+1:].split('/')),'cleanup reference outside original run')
    names.append(name)
   for name in names:
    file=Path(name) if Path(name).is_absolute() else path.parent/name
    fixed.append((file,identity(file)))
   failed_proof(home,path.parent,get)
  marker=root/'.deploying';require(not marker.is_symlink(),'deployment marker symlink')
  fd=os.open(marker,os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW|os.O_NONBLOCK,0o600)
  try:
   info=os.fstat(fd);require(stat.S_ISREG(info.st_mode) and identity(marker)[:2]==(info.st_dev,info.st_ino),'regular deployment marker required');marker_identity=(info.st_dev,info.st_ino)
  finally:os.close(fd)
  def verify(marked=True):
   require(identity(root)[:2]==root_identity and not root.is_symlink(),'Commander root replaced')
   for path,info in locks:
    named=path.lstat();require(stat.S_ISREG(named.st_mode) and (named.st_dev,named.st_ino)==(info.st_dev,info.st_ino),'held lock path replaced')
   for path,expected in fixed:require(identity(path)==expected,'frozen failed-run evidence changed')
   if marked:require(not marker.is_symlink() and identity(marker)[:2]==marker_identity,'deployment marker lost/replaced')
  require(time.monotonic()<deadline,'admission budget exhausted');verify();yield verify
 finally:
  for fd in reversed(fds):os.close(fd)
'''
exec(ADMISSION_SOURCE,globals())
SERVER = ADMISSION_SOURCE + r'''
import sys,select
root=Path.home().resolve()/'.openclaw/commander';root.mkdir(parents=True,exist_ok=True)
fd=lock_fd(root/'.deployment.lock',True);deployment_info=os.fstat(fd)
try:
 print(json.dumps({'locked':True,'target':'mmv'}),flush=True)
 with contextlib.ExitStack() as stack:
  verify=None;complete=False
  while True:
   named=(root/'.deployment.lock').lstat();require(stat.S_ISREG(named.st_mode) and (named.st_dev,named.st_ino)==(deployment_info.st_dev,deployment_info.st_ino),'deployment lock replaced')
   if verify:verify(not complete)
   if not select.select([sys.stdin],[],[],.2)[0]:continue
   line=sys.stdin.readline(4097)
   if not line:break
   require(len(line)<=4096,'bounded deployment message');message=json.loads(line)
   if message=={'action':'admit'} and verify is None:
    verify=stack.enter_context(commander_admission(Path.home()))
    print(json.dumps({'admitted':True,'target':'mmv'}),flush=True)
   elif message=={'action':'complete'} and verify and not complete:
    verify();(root/'.deploying').unlink();complete=True
    print(json.dumps({'completed':True,'target':'mmv'}),flush=True)
   else:raise ValueError('invalid deployment admission message')
finally:os.close(fd)
'''

def inherited():
 fd=int(os.environ['WF_DEPLOY_LOCK_FD']);info=os.fstat(fd)
 if not stat.S_ISFIFO(info.st_mode) or os.environ.get('WF_DEPLOY_LOCK_INODE')!=str(info.st_ino):raise ValueError('部署锁传输FD身份不符')
 return fd

def request_admission(action="admit"):
 fd=inherited();response=int(os.environ['WF_DEPLOY_RESPONSE_FD']);info=os.fstat(response)
 if not stat.S_ISFIFO(info.st_mode) or os.environ.get('WF_DEPLOY_RESPONSE_INODE')!=str(info.st_ino):raise ValueError('部署锁回执FD身份不符')
 os.write(fd,(json.dumps({'action':action})+'\n').encode())
 data=b'';deadline=time.monotonic()+75
 with selectors.DefaultSelector() as selector:
  selector.register(response,selectors.EVENT_READ)
  while not data.endswith(b'\n'):
   if len(data)>4096 or not selector.select(max(0,deadline-time.monotonic())):raise ValueError('Commander部署准入回执超时')
   block=os.read(response,1)
   if not block:raise ValueError('Commander部署准入通道关闭')
   data+=block
 if json.loads(data)!={('admitted' if action=='admit' else 'completed'):True,'target':'mmv'}:raise ValueError('Commander部署准入回执不符')

def guarded(argv, transport=None):
 command=transport or ['ssh','-T','-o','BatchMode=yes','-o','ConnectTimeout=10','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=3','mmv','python3 -u -c '+shlex.quote(SERVER)]
 lease=None;child=None
 watched=(signal.SIGTERM,signal.SIGHUP,signal.SIGINT)
 previous={sig:signal.getsignal(sig) for sig in watched}
 def interrupted(signum,_frame):raise ValueError('部署守卫收到终止信号: '+str(signum))
 for sig in watched:signal.signal(sig,interrupted)
 try:
  lease=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE)
  with selectors.DefaultSelector() as selector:
   selector.register(lease.stdout,selectors.EVENT_READ)
   if not selector.select(15):raise ValueError('MMV部署锁握手超时')
   line=lease.stdout.readline(4096)
  if not line or json.loads(line)!=dict(locked=True,target='mmv'):raise ValueError('另一部署持锁或MMV锁通道失败')
  fd=lease.stdin.fileno();response=lease.stdout.fileno();env=dict(os.environ,WF_DEPLOY_LOCK_FD=str(fd),WF_DEPLOY_LOCK_INODE=str(os.fstat(fd).st_ino),WF_DEPLOY_RESPONSE_FD=str(response),WF_DEPLOY_RESPONSE_INODE=str(os.fstat(response).st_ino))
  child=subprocess.Popen(argv,env=env,pass_fds=(fd,response),start_new_session=True)
  while child.poll() is None:
   if lease.poll() is not None:raise ValueError('MMV部署锁通道丢失，终止部署')
   time.sleep(0.1)
  if lease.poll() is not None:raise ValueError('部署完成前MMV锁丢失')
  return child.returncode
 finally:
  # 重复终止信号不能打断停止进程组→关闭锁通道的顺序。
  for sig in watched:signal.signal(sig,signal.SIG_IGN)
  try:
   if child:
    try:os.killpg(child.pid,signal.SIGTERM)
    except ProcessLookupError:pass
    deadline=time.monotonic()+5
    while time.monotonic()<deadline:
     child.poll()
     try:os.killpg(child.pid,0)
     except ProcessLookupError:break
     except PermissionError:pass  # Darwin exiting group: still unknown, keep the original wait/KILL budget.
     time.sleep(.05)
    else:
     try:os.killpg(child.pid,signal.SIGKILL)
     except ProcessLookupError:pass
    child.wait()
   if lease:
    lease.stdin.close()
    try:lease.wait(timeout=5)
    except subprocess.TimeoutExpired:lease.kill();lease.wait()
    lease.stdout.close()
  finally:
   for sig,handler in previous.items():signal.signal(sig,handler)

if __name__=='__main__':
 try:
  if sys.argv[1]=='check':inherited()
  elif sys.argv[1] in ('admit','complete'):request_admission(sys.argv[1])
  else:sys.exit(guarded(sys.argv[1:]))
 except (ValueError,OSError,KeyError) as error:print(str(error),file=sys.stderr);sys.exit(2)

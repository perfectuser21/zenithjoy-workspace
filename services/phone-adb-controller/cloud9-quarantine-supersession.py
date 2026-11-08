#!/usr/bin/env python3
"""云9固定源RECV未知的非重放迁移；不重放手机或修饰旧unknown。"""
import hashlib, stat, types, json, os, sys, subprocess, tarfile, io, struct, http.client, re
from pathlib import Path
_here=Path(__file__).resolve().parent
TRANSACTION_SOURCE_SHA256='ca0e6eb6cd5a2a2e164150a225d29951ae9131b1ce59c7dd43d7bbc10936cb5b'
def pinned_transaction():
 path=_here/'cloud7-quarantine-supersession.py'
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  before=os.fstat(fd)
  if not stat.S_ISREG(before.st_mode) or before.st_uid!=os.geteuid() or before.st_mode&0o022 or before.st_nlink!=1 or before.st_size>1024*1024:
   raise ValueError('CLOUD9_TRANSACTION_SOURCE_FILE')
  with os.fdopen(os.dup(fd),'rb') as stream:raw=stream.read(1024*1024+1)
  after,current=os.fstat(fd),path.lstat()
  fields=['st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns']
  if len(raw)!=before.st_size or any(getattr(before,k)!=getattr(after,k) or getattr(before,k)!=getattr(current,k) for k in fields):
   raise ValueError('CLOUD9_TRANSACTION_SOURCE_CHANGED')
  if hashlib.sha256(raw).hexdigest()!=TRANSACTION_SOURCE_SHA256:
   raise ValueError('CLOUD9_TRANSACTION_SOURCE_HASH')
 finally:os.close(fd)
 # Compile only the exact bytes just verified. Import loaders may execute an
 # unpinned valid timestamp pyc even when the on-disk .py itself is unchanged.
 module=types.ModuleType('cloud8_private_transaction');module.__file__=str(path)
 exec(compile(raw,str(path),'exec'),module.__dict__)
 return module


_tx=pinned_transaction()
read_bytes,load,lines,sha,need,relative=_tx.read_bytes,_tx.load,_tx.lines,_tx.sha,_tx.need,_tx.relative
TASK='8e8fbff5-21dd-4e4b-83ed-f06d9b4ea68d'
FIX_TASK='ffd2d337-b10e-4f96-8e3e-bd35cd57bac1'
CLAIM=dict(claimed_by='codex-cloud-leadgen-e2e',claimed_at='2026-11-08T10:09:59.271Z')
COMMIT='1255614a804af02f11f7e792bf517d71fa3a94a1'
TAG='potato20261108_101_cloud9'
RUN='douyin_video_discovery-'+TAG+'__a1'
BINDING='bd948684-3ff1-4122-a948-59b4a5439d57'
EPOCH='942b1338-68f8-41b8-872a-35e7d8bb3e39'
SERIAL='47.100.213.173:10001'
PROTOCOL='cloud9-source-recv-quarantine-supersession/v1'
IDENTITY=dict(task_id=TASK,run_id=RUN,binding_id=BINDING,source_commit=COMMIT,profile='cloud-phone-test',serial=SERIAL,owner=TAG,epoch=EPOCH)
SUCCESSOR=dict(run_tag='potato20261108_101_cloud10',workflow_key='douyin_video_discovery',host='mmv',broker_host='mmv',profile='cloud-phone-test',serial=SERIAL,adb_endpoint='tcp:127.0.0.1:5041',expected_account='77980009922',line='yuesheng',execution_mode='code',required_entry='PUBLIC_FULL_FROZEN_WORKFLOW_CLI')
LOCK_FIELDS=dict(owner=TAG,preflight_epoch=EPOCH,preflight_proof_required=EPOCH,standalone_review_required=TAG,preflight_quarantined=EPOCH,acquired_at='1794137958')
PINS=dict(archive='fb95bdee9a6b8cae6b2e84e18b8692c97a9cd619e220329570b979eecc340d76',marker='93f87e8203feda81381ab49c8e303351a67529c5264c04047053f01e6b03a05a')
EVIDENCE_PIN='f543fdfb57a07d23dfddcac659b91f83281459672aef2fe98ac40072d2aabc0e'

def layout():
 home=_tx.system_home();root=home/'.local/share/zenithjoy/phone-locks'
 run=home/'.local/share/zenithjoy/phone-candidate-runs'/COMMIT/'ledger'/('douyin_video_discovery-'+TAG)
 evidence=home/'.codex-team1/artifacts/cloud-leadgen-e2e-20261108/cloud9-audit'
 _tx.directory(home);_tx.directory(root,True)
 return home,root,run,evidence

def evidence_policy():
 raw=read_bytes(_here/'config/cloud9-nonreplay-evidence.json');need(sha(raw)==EVIDENCE_PIN,'CLOUD9_POLICY_PIN');return json.loads(raw)

def check_review_pin():
 registry=load(_here/'config/native-phone-command-sources.json')
 rows=[r for r in registry['device_sources'] if r.get('profile')==IDENTITY['profile'] and r.get('serial')==SERIAL]
 need(len(rows)==1 and rows[0]['review']['path']=='config/native-phone-reviews/cloud-phone-test-sdk31.md' and rows[0]['review']['sha256']==sha(read_bytes(_here/rows[0]['review']['path'])),'CLOUD9_REVIEW_PIN')

def source_authority(require_main=True):
 repo=_here.parents[1]
 def git(*args):return subprocess.check_output(['git','-C',str(repo),*args],timeout=10,stderr=subprocess.DEVNULL)
 commit=git('rev-parse','HEAD').decode().strip()
 if require_main:
  try:git('merge-base','--is-ancestor',commit,'origin/main')
  except subprocess.CalledProcessError:need(False,'CLOUD9_RECOVERY_SOURCE_NOT_MAIN')
 names=['cloud9-quarantine-supersession.py','cloud7-quarantine-supersession.py','config/cloud9-nonreplay-evidence.json','config/native-phone-reviews/cloud-phone-test-sdk31.md','config/native-phone-command-sources.json'];files={}
 for name in names:
  path='services/phone-adb-controller/'+name;b=read_bytes(repo/path);need(b==git('show',commit+':'+path),'CLOUD9_RECOVERY_SOURCE_DIRTY');files[path]=sha(b)
 check_review_pin();evidence_policy();return dict(commit=commit,files=files,main_required=require_main)

def preserved_archive(run,evidence):
 raw=read_bytes(evidence/'original-runtime-evidence.tar.gz');need(sha(raw)==PINS['archive'],'CLOUD9_ARCHIVE_HASH');original={}
 with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as t:
  seen=set()
  for m in t.getmembers():
   relative(m.name.rstrip('/'));need(m.name not in seen and (m.isfile() or m.isdir()),'CLOUD9_ARCHIVE_TYPE');seen.add(m.name)
   if m.isfile():
    need(m.name.startswith('ledger/'),'CLOUD9_ARCHIVE_SCOPE');name=relative(m.name[7:]);b=t.extractfile(m).read(_tx.MAX_FILE+1);need(len(b)==m.size and len(b)<=_tx.MAX_FILE,'CLOUD9_ARCHIVE_SIZE');original[name]=sha(b)
 actual=set()
 for f in run.rglob('*'):
  need(not f.is_symlink(),'CLOUD9_RUN_SYMLINK')
  if f.is_file():actual.add(f.relative_to(run).as_posix())
 need(len(original)==986 and actual==set(original),'CLOUD9_RUN_INVENTORY')
 for name,digest in original.items():need(sha(read_bytes(run/name))==digest,'CLOUD9_ORIGINAL_CHANGED')
 return original

def check_identity(value,keys):need(all(value.get(k)==IDENTITY[k] for k in keys),'CLOUD9_IDENTITY')
def closed(value,caller=False):
 need(value.get('sealed') is True and value.get('pending')==0 and value.get('execution_stopped') is True and all(value.get(k) is False for k in ['execution_unknown','external_effect_unknown','previous_caller_stop_unproven']),'CLOUD9_CLOSED')
 if caller:need(value.get('caller_execution_stopped') is True and value.get('final_record_failed') is False,'CLOUD9_CALLER')

def check_observer(domain):
 need(domain.get('domain')=='runner-phone-observer/v1' and domain.get('execution_stopped') is True and domain.get('execution_unknown') is False and [a['activity'] for a in domain['activities']]==['preflight','cleanup'],'CLOUD9_OBSERVER')
 for a in domain['activities']:
  v=a['evidence'];need(v.get('domain')=='runner-official-observer/v1' and v.get('execution_stopped') is True and v.get('execution_unknown') is False,'CLOUD9_OBSERVER_STOP');closed(v['sdk']);closed(v['control'],True)
  owner=v['owner'];need(owner.get('sealed') is True and owner.get('pending')==0 and owner.get('execution_stopped') is True and owner.get('execution_unknown') is False,'CLOUD9_OWNER_STOP')
  leaves=owner['leaves'];need(len(leaves)==(6 if a['activity']=='preflight' else 0),'CLOUD9_LEAVES')
  if leaves:need(owner.get('calibration')==dict(positive_closed=True,fork_denied=True),'CLOUD9_CALIBRATION')
  for i,l in enumerate(leaves):
   need(l.get('purpose')==('calibration-positive' if i==0 else 'calibration-negative' if i==1 else 'owner') and l.get('code')==(1 if i==1 else 0) and l.get('signal') is None and l.get('unknown') is False and l.get('closing') is True and all(l.get(k) is True for k in ['process_closed','stdin_closed','stdout_closed','stderr_closed','fd_closed']),'CLOUD9_LEAF_CLOSED')

def closed_callers(run):
 finals=list(run.rglob('official-caller-final-*.json'));need(len(finals)==6,'CLOUD9_CALLER_INVENTORY');turns=[]
 for f in finals:
  v=load(f);check_identity(v,['task_id','run_id','binding_id','source_commit']);closed(v['snapshot'],True)
  need(v.get('not_recovery_authority') is True and v.get('journal_closed') is True and v.get('evidence_complete') is True,'CLOUD9_CALLER_FINAL')
  for a in [v['ledger'],*v['artifacts']]:
   b=read_bytes(f.parent/relative(a['file']));need(sha(b)==a['sha256'] and len(b)==a['bytes'],'CLOUD9_CALLER_ARTIFACT')
  turns.extend(v['raw_turns'])
 need(len(turns)==1 and turns[0].get('index')==0 and all(turns[0].get(k) is False for k in ['dispatched','accepted','official_terminal','recovered']),'CLOUD9_WORKER_NOT_STARTED')

PATH='/system/framework/uiautomator.jar'
def request(s):return f'{len(s.encode()):04x}'.encode()+s.encode()
WIRES=[request('host:transport:'+SERIAL),request('sync:'),b'RECV'+struct.pack('<I',len(PATH))+PATH.encode(),b'QUIT'+bytes(4)]
def check_wire(directory):
 expected={'read-18.intent.json','read-18.unknown.json',*[f'read-18-write-{i}.intent.json' for i in range(4)]}
 actual={f.name for f in directory.glob('read-18*')};need(actual==expected and not list(directory.glob('read-19*')),'CLOUD9_WIRE_INVENTORY')
 need(load(directory/'read-18.intent.json').get('path')==PATH and load(directory/'read-18.intent.json').get('id')==18 and load(directory/'read-18.unknown.json')==dict(id=18,code='NATIVE_PHONE_READ_UNKNOWN'),'CLOUD9_READ_ONLY_UNKNOWN')
 for i,b in enumerate(WIRES):need(load(directory/f'read-18-write-{i}.intent.json')==dict(bytes=len(b),sha256=sha(b)),'CLOUD9_WIRE_BYTES')

def closed_native(run):
 records=lines(run/'preflight-native-domain-close.jsonl');need(len(records)==2,'CLOUD9_NATIVE_INVENTORY')
 for i,v in enumerate(records):
  check_identity(v,list(IDENTITY));p=v['physical'];need(v.get('activity')==['preflight','cleanup'][i] and v.get('resource_unknown') is False and p.get('execution_stopped') is True and p.get('pending')==0 and p.get('command_failures')==0 and v['control']==dict(sealed=True,execution_stopped=True,pending=0),'CLOUD9_NATIVE_STOP')
  need(v.get('official_stopped') is (i==0) and v.get('agent_not_launched') is (i==1),'CLOUD9_NATIVE_MODEL')
  leaves=p['adb']['leaves'];need(len(leaves)==(2 if i==0 else 0) and all(l.get('request_returned') is True and l.get('code')==0 and l.get('tainted') is False for l in leaves),'CLOUD9_ADB_STOP')
  local=p['local'];need(local.get('sealed') is True and local.get('execution_stopped') is True and len(local['leaves'])==(2 if i==0 else 0) and all(l.get('code')==0 and l.get('tainted') is False and l.get('ended_at') for l in local['leaves']),'CLOUD9_LOCAL_STOP')
 check_wire(run/'native-phone/cleanup/source')
 for activity in ['preflight','cleanup']:
  d=run/'native-phone'/activity/'source';reads=list(d.glob('read-*.returned.json'));need(len(reads)==(19 if activity=='preflight' else 18),'CLOUD9_READ_INVENTORY')
  need(len(list(d.glob('read-*.unknown.json')))==(0 if activity=='preflight' else 1),'CLOUD9_UNKNOWN_INVENTORY')
 need(not list((run/'native-phone/cleanup').glob('command-*')),'CLOUD9_CLEANUP_COMMAND')
 need(len(list((run/'native-phone/preflight').glob('command-*.native.json')))==4,'CLOUD9_COMMAND_INVENTORY')
 for i,op in enumerate(['sdk','model','telecom','foreground']):
  v=load(run/f'native-phone/preflight/command-{i}.native.json');need(v['operation']==op and v['error_code'] is None and v['wire_snapshot']['sealed'] is True and v['wire_snapshot']['pending']==0 and v['wire_snapshot']['open_sockets']==0 and v['wire_snapshot']['unknown'] is False,'CLOUD9_COMMAND_CLOSED')

def owner_inventory(home,policy):
 root=home/'.openclaw/leadgen-owner-turns';base=policy['owner_prefix'];need({f.name for f in root.glob(base+'*')}==set(policy['owners']),'CLOUD9_OWNER_FILES')
 for name,v in policy['owners'].items():
  p=root/name;b=read_bytes(p,True);need(sha(b)==v['sha256'] and len(b)==v['bytes'],'CLOUD9_OWNER_CHANGED')
 pending=load(root/(base+'.pending.json'));check_identity(pending,['task_id','run_id','binding_id','source_commit']);need(pending.get('status')=='reserved' and pending.get('transport_nonce')=='4ad0f5ce-af2e-4474-abd1-1f6daacf362c','CLOUD9_PENDING')
 return {k:v['sha256'] for k,v in policy['owners'].items()}

def verify_evidence(require_main=True):
 home,root,run,evidence=layout();original=preserved_archive(run,evidence);policy=evidence_policy()
 frozen=load(run/'run-definition.json');need(frozen['deployment']['source_commit']==COMMIT,'CLOUD9_SOURCE')
 for name,digest in frozen['files'].items():need(original.get(name)==digest,'CLOUD9_FROZEN_HASH')
 preflight=load(run/'activity-preflight.json');cleanup=load(run/'activity-cleanup.json')
 need(preflight.get('error')=='COMPANY_ACCOUNT_IDENTITY_UNVERIFIED' and preflight.get('execution_stopped') is True and cleanup.get('error')=='AGENT_TOOL_COMMIT_UNKNOWN_READBACK_REQUIRED' and cleanup.get('execution_stopped') is False and cleanup.get('external_effect')=='unknown','CLOUD9_OLD_UNKNOWN')
 need(load(run/'activity-collect_videos.json')['status']=='blocked','CLOUD9_NO_BUSINESS')
 q=load(run/'resource-quarantine.json');need(q==dict(verified=True,device=dict(applicable=True,verified=True,physical_actions=0),videos=[],claim_receipt_unknown=False),'CLOUD9_QUARANTINE')
 observers=[x['evidence'] for x in lines(run/'activity-events.jsonl') if x.get('phase')=='commander_domain_closed'];need(len(observers)==1,'CLOUD9_OBSERVER_INVENTORY');check_observer(observers[0]);closed_callers(run);closed_native(run);owners=owner_inventory(home,policy)
 launchdir=evidence.parent/'cloud9-101'
 for name,digest in policy['launcher'].items():need(sha(read_bytes(launchdir/name))==digest,'CLOUD9_PARENT_WAIT')
 need(load(launchdir/'exit.json')['exit_code']==1,'CLOUD9_PARENT_EXIT')
 return dict(protocol=PROTOCOL,identity=IDENTITY,successor=SUCCESSOR,pins=PINS,owner_files=owners,frozen_sha256=original['run-definition.json'],original_execution_stopped=False,authority_basis='closed-all-producers-fixed-read-only-sync-recv-noninterference',recovery_source=source_authority(require_main))

def brain_authority():
 old=_tx.brain_get('/tasks/'+TASK);old=old.get('task',old)
 current=_tx.brain_get('/tasks/'+FIX_TASK);current=current.get('task',current)
 need(old.get('id')==TASK and old.get('status')=='failed','CLOUD9_ORIGINAL_TASK')
 need(current.get('id')==FIX_TASK and current.get('status')=='in_progress' and all(current.get(k)==v for k,v in CLAIM.items()),'CLOUD9_FIX_CLAIM')
 values=_tx.brain_get('/device-locks');rows=[v for v in values.get('locks',[]) if v.get('device_name')==SERIAL]
 need(values.get('success') is True and len(rows)==1 and rows[0].get('locked_by') in [None,TASK],'CLOUD9_CENTRAL_FOREIGN_OWNER')
 return dict(original_task=TASK,original_status='failed',fix_task=FIX_TASK,claim=CLAIM,central_owner=rows[0]['locked_by'])

def brain_release():
 # Same existing owner-CAS endpoint as central-device-lease; never force-release.
 raw=read_bytes(_tx.system_home()/'.credentials/cecelia-internal.env',True).decode()
 matches=re.findall(r'^(?:export )?CECELIA_INTERNAL_TOKEN=([^\r\n]+)$',raw,re.M);need(len(matches)==1,'CLOUD9_CREDENTIAL')
 token=matches[0].strip().strip('\'"');need(token and '\r' not in token and '\n' not in token,'CLOUD9_CREDENTIAL')
 c=http.client.HTTPConnection('127.0.0.1',5221,timeout=10)
 try:
  c.request('POST','/api/brain/device-locks/release',body=json.dumps(dict(device_name=SERIAL,locked_by=TASK)),headers={'X-Internal-Token':token,'Content-Type':'application/json','Connection':'close'})
  with c.getresponse() as response:
   need(response.status==200 and response.getheader('Content-Type','').startswith('application/json'),'CLOUD9_RELEASE_RESPONSE');body=response.read(1024*1024+1);need(len(body)<=1024*1024,'CLOUD9_RELEASE_LIMIT')
  return json.loads(body)
 finally:c.close()

def journal_dir(root):
 path=root/('.quarantine-supersession-cloud9-'+EPOCH)
 if not path.exists():path.mkdir(mode=0o700);_tx.sync_dir(root)
 _tx.directory(path,True)
 need({p.name for p in path.iterdir()} <= {'plan.json','apply.intent.json','apply.returned.json','central.intent.json','central.returned.json'},'CLOUD9_JOURNAL_INVENTORY')
 return path

def archive_path(root):return root/('.quarantine-supersession-cloud9-'+EPOCH+'.superseded')
def validate_plan(root,journal,facts):
 p=load(journal/'plan.json');need(set(p)=={'protocol','state','identity','evidence','lock','superseded_path','machine_authority'} and p['protocol']==PROTOCOL and p['state']=='planned' and p['identity']==IDENTITY and p['evidence']==facts and p['superseded_path']==str(archive_path(root)),'CLOUD9_PLAN_DRIFT')
 a=p['machine_authority'];need(a==dict(original_task=TASK,original_status='failed',fix_task=FIX_TASK,claim=CLAIM,central_owner=a.get('central_owner')) and a.get('central_owner') in [None,TASK],'CLOUD9_PLAN_AUTHORITY');return p

def release_central(journal,facts,checkpoint):
 intent=journal/'central.intent.json';returned=journal/'central.returned.json'
 scope=dict(protocol=PROTOCOL,identity=IDENTITY,evidence_sha256=sha(_tx.encode(facts)))
 if intent.exists():
  need(load(intent)==scope,'CLOUD9_RELEASE_INTENT_DRIFT')
  # A free GET cannot attribute an earlier lost ACK. Never retry that POST.
  need(returned.exists(),'CLOUD9_RELEASE_UNKNOWN')
  receipt=load(returned);need(receipt.get('scope')==scope and receipt.get('original_execution_stopped') is False and receipt.get('operation') in ['owner_cas_released','observed_free'],'CLOUD9_RELEASE_RECEIPT')
  need(receipt.get('central_readback',{}).get('central_owner','missing') is None,'CLOUD9_RELEASE_RECEIPT_READBACK')
  if receipt['operation']=='owner_cas_released':
   response=receipt.get('response',{});need(response.get('success') is True and response.get('released',{}).get('device_name')==SERIAL and response['released'].get('locked_by','missing') is None,'CLOUD9_RELEASE_RECEIPT_RESPONSE')
  need(brain_authority()['central_owner'] is None,'CLOUD9_RELEASE_OWNER_CHANGED');checkpoint();return receipt
 need(not returned.exists(),'CLOUD9_RELEASE_ORPHAN_RETURN')
 a=brain_authority();need(a['central_owner'] in [None,TASK],'CLOUD9_RELEASE_FOREIGN_OWNER');checkpoint()
 _tx.durable(intent,scope);checkpoint()
 if a['central_owner'] is None:
  need(brain_authority()['central_owner'] is None,'CLOUD9_RELEASE_OWNER_CHANGED');checkpoint()
  receipt=dict(scope=scope,operation='observed_free',original_execution_stopped=False,central_readback=a)
 else:
  # Evidence and local inode are rechecked after HTTP reads and before POST.
  response=brain_release()
  need(response.get('success') is True and response.get('released',{}).get('device_name')==SERIAL and response['released'].get('locked_by','missing') is None,'CLOUD9_RELEASE_RESPONSE')
  checkpoint();readback=brain_authority();need(readback['central_owner'] is None,'CLOUD9_RELEASE_READBACK');checkpoint()
  receipt=dict(scope=scope,operation='owner_cas_released',original_execution_stopped=False,response=response,central_readback=readback)
 _tx.durable(returned,receipt);checkpoint();return receipt

# Private pinned transaction. No old7/8 entry constants or implementation change.
for key in ['TASK','FIX_TASK','CLAIM','COMMIT','TAG','RUN','BINDING','EPOCH','SERIAL','PROTOCOL','IDENTITY','SUCCESSOR','LOCK_FIELDS','PINS']:
 setattr(_tx,key,globals()[key])
for key in ['layout','verify_evidence','journal_dir','archive_path','validate_plan']:
 setattr(_tx,key,globals()[key])

def free_authority():
 a=brain_authority();need(a['central_owner'] is None,'CLOUD9_CENTRAL_NOT_FREE');return a

def plan():
 _tx.brain_authority=brain_authority
 return _tx.plan()

def apply():
 with _tx.device_guard() as (root,guard):
  facts=verify_evidence();journal=journal_dir(root);p=validate_plan(root,journal,facts)
  active,retired=root/(SERIAL+'.lock'),archive_path(root)
  need(active.exists()!=retired.exists(),'CLOUD9_LOCK_LOCATION')
  def checkpoint():
   _tx.boundary(facts,guard)
   need(_tx.lock_snapshot(active if active.exists() else retired)==p['lock'],'CLOUD9_LOCK_DRIFT')
  checkpoint();release_central(journal,facts,checkpoint)
 # The pinned local transaction independently rechecks facts, guard, owner and
 # free central state after this boundary. No evidence or expiry asserts stop.
 _tx.brain_authority=free_authority
 return _tx.apply()

def main():
 need(len(sys.argv)==2 and sys.argv[1] in ['inspect','plan','apply'],'USAGE: cloud9-quarantine-supersession.py inspect|plan|apply')
 if sys.argv[1]=='inspect':
  print(json.dumps(dict(state='candidate-inspection',not_recovery_authority=True,evidence=verify_evidence(False)),ensure_ascii=False,sort_keys=True))
 else:print(json.dumps(plan() if sys.argv[1]=='plan' else apply(),ensure_ascii=False,sort_keys=True))
if __name__=='__main__':
 try:main()
 except Exception as error:
  print(str(error) if isinstance(error,ValueError) else 'CLOUD9_SUPERSESSION_IO_UNKNOWN',file=sys.stderr);sys.exit(2)

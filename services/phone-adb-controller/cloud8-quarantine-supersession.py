#!/usr/bin/env python3
"""Exact cloud8 observer-only non-replay supersession. No old task recovery.

The cloud7 entry is unchanged. A private module instance reuses its reviewed
CAS transaction; this entry supplies its own immutable identity and evidence.
inspect is read-only and is explicitly not an apply/recovery capability.
"""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import io

_here = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location('cloud8_private_transaction', _here/'cloud7-quarantine-supersession.py')
_tx = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_tx)
read_bytes, load, lines, sha, need, relative = _tx.read_bytes, _tx.load, _tx.lines, _tx.sha, _tx.need, _tx.relative
TASK = 'deeb4021-2b05-45e5-b8a6-712a38cdd0c7'
FIX_TASK = '000e3f10-978f-4c4c-9720-8386a5aae210'
CLAIM = dict(claimed_by='codex-cloud8-nonreplay-authority', claimed_at='2026-11-08T10:22:51.535Z')
COMMIT = '41490a0aba7cbea0de32d15f575ee2169dd4198f'
TAG = 'potato20261107_101_cloud8'
RUN = 'douyin_video_discovery-'+TAG+'__a1'
BINDING = '0ff7412e-c9b3-4e6a-8849-29eb1860efd6'
EPOCH = 'd185baf6-b32f-4de5-801f-52ee6bb35f26'
SERIAL = '47.100.213.173:10001'
PROTOCOL = 'cloud8-observer-quarantine-supersession/v1'
IDENTITY = dict(task_id=TASK,run_id=RUN,binding_id=BINDING,source_commit=COMMIT,profile='cloud-phone-test',serial=SERIAL,owner=TAG,epoch=EPOCH)
SUCCESSOR = dict(run_tag='potato20261108_101_cloud9',workflow_key='douyin_video_discovery',host='mmv',broker_host='mmv',profile='cloud-phone-test',serial=SERIAL,adb_endpoint='tcp:127.0.0.1:5041',expected_account='77980009922',line='yuesheng',required_entry='PUBLIC_FULL_FROZEN_WORKFLOW_CLI-task-run-ack-agent-primary-official-observer')
LOCK_FIELDS = dict(owner=TAG,preflight_epoch=EPOCH,preflight_proof_required=EPOCH,standalone_review_required=TAG,preflight_quarantined=EPOCH,acquired_at='1794083228')
PINS = dict(archive='8996c496d9ecc7b86cdd1b8c772e0bbbb81dbce2d684ae6a1cebb81468a31ef2',marker='93f87e8203feda81381ab49c8e303351a67529c5264c04047053f01e6b03a05a')
LEAVES = [('calibration-positive',49570,0),('calibration-negative',49571,1),('owner',49572,0),('owner',49695,0),('owner',55819,0),('owner',59212,0)]
CLOSED_FIELDS = ['process_closed','stdin_closed','stdout_closed','stderr_closed','fd_closed']
OWNER_BASE = 'workflow-221f48d825783840520d97b854ccb958.pending.json'
OWNER_FILES = {'workflow-221f48d825783840520d97b854ccb958.pending.json': 'd6f7b194405114d78d32f1a9638ca174166bdcfa86460effc199ab144da1e46f', 'workflow-221f48d825783840520d97b854ccb958.pending.json.31678c04-4fdb-4032-922c-9855247c0ff4.returned.json': '5b317dce0cb79f46b53a8c65a3585921415384acb4121ed9226d36f50acf4681', 'workflow-221f48d825783840520d97b854ccb958.pending.json.31678c04-4fdb-4032-922c-9855247c0ff4.returned.original.json': '4f8ffef2bc31f96ff729d12e89337576827a906a3ce416c8bb192407e7bc327b', 'workflow-221f48d825783840520d97b854ccb958.pending.json.348fa4b1-85dd-4c7c-a397-dbfe7e934d01.returned.json': 'ddca94eba565cf7214714d38afcdc09268d91a8b72270fd3edeef32dda97a5db', 'workflow-221f48d825783840520d97b854ccb958.pending.json.348fa4b1-85dd-4c7c-a397-dbfe7e934d01.returned.original.json': 'ae4f4e338ca990b22beca6854574a97ed029d5550f3fe7a8d20aa3d1c036fbce', 'workflow-221f48d825783840520d97b854ccb958.pending.json.b3650b5d-9bb1-44f5-b6a6-d823ea7a3be6.returned.json': '0567233cc9143f307230987f1138e5dd491dbb1ec11b0e1e06da9a053881bacd', 'workflow-221f48d825783840520d97b854ccb958.pending.json.b3650b5d-9bb1-44f5-b6a6-d823ea7a3be6.returned.original.json': '6db398bf4ddb8ea5062e8dda778b95b7340104afe558fb6f528e95759d2d17d9'}


def layout():
 home=_tx.system_home();root=home/'.local/share/zenithjoy/phone-locks'
 run=home/'.local/share/zenithjoy/phone-candidate-runs'/COMMIT/'ledger'/('douyin_video_discovery-'+TAG)
 evidence=home/'perfect21/runner-deploy-evidence/potato-runner-commander-20261107/recovery5-cloud8'
 _tx.directory(home);_tx.directory(root,True)
 return home,root,run,evidence


def check_identity(value, keys):
 need(all(value.get(k)==IDENTITY[k] for k in keys),'CLOUD8_IDENTITY')


def check_observer(domain):
 need(domain.get('domain')=='runner-phone-observer/v1' and domain.get('execution_stopped') is False
      and domain.get('execution_unknown') is True and len(domain.get('activities',[]))==1,'CLOUD8_AGGREGATE')
 activity=domain['activities'][0];need(activity.get('activity')=='preflight','CLOUD8_ACTIVITY')
 value=activity['evidence']
 need(value.get('domain')=='runner-official-observer/v1' and value.get('execution_stopped') is False
      and value.get('execution_unknown') is True,'CLOUD8_OBSERVER_UNKNOWN')
 for name in ['sdk','control']:
  snap=value[name]
  need(snap.get('sealed') is True and snap.get('execution_stopped') is True and snap.get('pending')==0
       and all(snap.get(k) is False for k in ['execution_unknown','external_effect_unknown','previous_caller_stop_unproven']),'CLOUD8_CLOSED_'+name)
 need(value['control'].get('caller_execution_stopped') is True and value['control'].get('final_record_failed') is False,'CLOUD8_CALLER')
 owner=value['owner']
 need(owner.get('sealed') is True and owner.get('execution_stopped') is False and owner.get('execution_unknown') is True
      and owner.get('pending')==0 and owner.get('calibration')==dict(positive_closed=True,fork_denied=True),'CLOUD8_OWNER')
 leaves=owner['leaves'];need(len(leaves)==len(LEAVES),'CLOUD8_LEAF_INVENTORY')
 for i,(leaf,(purpose,pid,code)) in enumerate(zip(leaves,LEAVES)):
  need(leaf.get('purpose')==purpose and leaf.get('pid')==pid and leaf.get('code')==code and leaf.get('signal') is None
       and leaf.get('ready') is (i>1) and leaf.get('closing') is True and leaf.get('unknown') is (i==5)
       and all(leaf.get(k) is True for k in CLOSED_FIELDS),'CLOUD8_LEAF_CLOSURE')


def source_authority(require_main=True):
 repo=_here.parents[1]
 def git(*args):return subprocess.check_output(['git','-C',str(repo),*args],timeout=10,stderr=subprocess.DEVNULL)
 commit=git('rev-parse','HEAD').decode().strip()
 if require_main:
  try:git('merge-base','--is-ancestor',commit,'origin/main')
  except subprocess.CalledProcessError:need(False,'CLOUD8_RECOVERY_SOURCE_NOT_MAIN')
 names=['cloud8-quarantine-supersession.py','cloud7-quarantine-supersession.py','config/native-phone-reviews/cloud-phone-test-sdk31.md','config/native-phone-command-sources.json']
 files={}
 for name in names:
  path='services/phone-adb-controller/'+name;b=read_bytes(repo/path)
  need(b==git('show',commit+':'+path),'CLOUD8_RECOVERY_SOURCE_DIRTY');files[path]=sha(b)
 check_review_pin()
 return dict(commit=commit,files=files,main_required=require_main)


def check_review_pin():
 registry=load(_here/'config/native-phone-command-sources.json')
 rows=[r for r in registry['device_sources'] if r.get('profile')==IDENTITY['profile'] and r.get('serial')==SERIAL]
 need(len(rows)==1 and rows[0]['review']['path']=='config/native-phone-reviews/cloud-phone-test-sdk31.md'
      and rows[0]['review']['sha256']==sha(read_bytes(_here/rows[0]['review']['path'])),'CLOUD8_REVIEW_PIN')


def preserved_archive(run,evidence):
 archive=read_bytes(evidence/'cloud8-original-runtime-evidence.tar.gz')
 need(sha(archive)==PINS['archive'],'CLOUD8_ARCHIVE_HASH')
 with tarfile.open(fileobj=io.BytesIO(archive),mode='r:gz') as t:
  members=t.getmembers();need(len({m.name for m in members})==len(members),'CLOUD8_ARCHIVE_DUPLICATE')
  original={}
  for m in members:
   relative(m.name.rstrip('/'));need(m.isfile() or m.isdir(),'CLOUD8_ARCHIVE_TYPE')
   if m.isfile() and m.name.startswith('ledger/'):
    name=relative(m.name[7:]);b=t.extractfile(m).read(_tx.MAX_FILE+1)
    need(len(b)==m.size and len(b)<=_tx.MAX_FILE,'CLOUD8_ARCHIVE_SIZE');original[name]=sha(b)
  actual=set()
  for f in run.rglob('*'):
   need(not f.is_symlink(),'CLOUD8_RUN_SYMLINK')
   if f.is_file():actual.add(f.relative_to(run).as_posix())
  need(original and actual==set(original),'CLOUD8_RUN_INVENTORY')
  for name,digest in original.items():need(sha(read_bytes(run/name))==digest,'CLOUD8_ORIGINAL_CHANGED')
 return original


def closed_callers(run):
 finals=list(run.rglob('official-caller-final-*.json'));need(len(finals)==3,'CLOUD8_CALLER_INVENTORY')
 worker_count=0
 for f in finals:
  v=load(f);check_identity(v,['task_id','run_id','binding_id','source_commit']);s=v['snapshot']
  need(v.get('not_recovery_authority') is True and v.get('journal_closed') is True and v.get('evidence_complete') is True
       and v.get('activity_key')=='preflight' and all(s.get(k) is True for k in ['sealed','execution_stopped','caller_execution_stopped'])
       and s.get('pending')==0 and all(s.get(k) is False for k in ['execution_unknown','external_effect_unknown','previous_caller_stop_unproven','final_record_failed']),'CLOUD8_CALLER_STOP')
  for a in [v['ledger'],*v['artifacts']]:
   b=read_bytes(f.parent/relative(a['file']));need(sha(b)==a['sha256'] and len(b)==a['bytes'],'CLOUD8_CALLER_ARTIFACT')
  raw=v['raw_turns']
  if f.parent==run/'skill-primary/preflight/official-control':
   need(len(raw)==1 and raw[0].get('dispatched') is True and raw[0].get('official_terminal') is True,'CLOUD8_WORKER_TERMINAL');worker_count+=1
  else:need(raw==[],'CLOUD8_OBSERVER_RAW_TOOLS')
 need(worker_count==1,'CLOUD8_WORKER_INVENTORY')


def closed_native(run):
 records=lines(run/'preflight-native-domain-close.jsonl');need(len(records)==1,'CLOUD8_NATIVE_INVENTORY')
 d=records[0];check_identity(d,list(IDENTITY));p=d['physical'];c=d['control']
 need(d.get('official_stopped') is True and d.get('resource_unknown') is False and p.get('execution_stopped') is True
      and p.get('pending')==0 and p.get('command_failures')==0 and c.get('sealed') is True
      and c.get('pending')==0 and c.get('execution_stopped') is True,'CLOUD8_NATIVE_STOP')
 need(p['adb'].get('complete') is True and p['adb'].get('requests_returned') is True
      and all(x.get('tainted') is False and x.get('request_returned') is True and x.get('code')==0 for x in p['adb']['leaves'])
      and p['local'].get('sealed') is True and p['local'].get('execution_stopped') is True,'CLOUD8_PHYSICAL_CLOSURE')


def owner_inventory(home):
 root=home/'.openclaw/leadgen-owner-turns';_tx.directory(root)
 actual={f.name for f in root.glob(OWNER_BASE+'*') if f.name!=OWNER_BASE+'.guard'}
 need(actual==set(OWNER_FILES),'CLOUD8_OWNER_FILE_INVENTORY')
 for name,digest in OWNER_FILES.items():need(sha(read_bytes(root/name,True))==digest,'CLOUD8_OWNER_FILE_CHANGED')
 pending=load(root/OWNER_BASE);check_identity(pending,['task_id','run_id','binding_id','source_commit'])
 need(pending.get('status')=='reserved' and pending.get('transport_nonce')=='c67b7db9-10ea-4c18-beb4-bd579433aa3c','CLOUD8_PENDING_PRESERVED')
 return OWNER_FILES


def verify_evidence(require_main=True):
 home,root,run,evidence=layout();original=preserved_archive(run,evidence)
 frozen=load(run/'run-definition.json');need(frozen['deployment']['source_commit']==COMMIT,'CLOUD8_SOURCE')
 for name,digest in frozen['files'].items():need(original.get(name)==digest,'CLOUD8_FROZEN_HASH')
 preflight=load(run/'activity-preflight.json');cleanup=load(run/'activity-cleanup.json')
 need(preflight.get('execution_stopped') is True and preflight.get('status')=='needs_review'
      and preflight.get('error')=='COMPANY_ACCOUNT_IDENTITY_UNVERIFIED','CLOUD8_PREFLIGHT')
 need(cleanup.get('error')=='RUNNER_OBSERVER_DRAIN_DEADLINE' and cleanup.get('status')=='needs_review'
      and load(run/'activity-collect_videos.json').get('status')=='blocked','CLOUD8_NO_BUSINESS')
 q=load(run/'resource-quarantine.json');need(q.get('verified') is True and q.get('videos')==[]
      and q.get('claim_receipt_unknown') is False and q['device'].get('physical_actions')==0,'CLOUD8_NO_WRITES')
 records=[x for x in lines(run/'activity-events.jsonl') if x.get('phase')=='commander_domain_closed']
 need(len(records)==1,'CLOUD8_OBSERVER_INVENTORY');check_observer(records[0]['evidence'])
 closed_callers(run);closed_native(run);owners=owner_inventory(home)
 sdk=run/'commander-preflight/sdk';ids={'5d09f923-304f-4205-995c-eb2feac6a5f6','b7840f5c-ad20-4d2a-9e1a-9cdc264f8d75','36ed1b37-1898-418e-a0e6-2d42fd2d0311','c0fbb093-72e2-491a-9cda-5538321ecaed'}
 need({f.name[:-14] for f in sdk.glob('*.terminal.json')}==ids and not list(sdk.glob('*.failure.json')),'CLOUD8_SDK_TERMINALS')
 return dict(protocol=PROTOCOL,identity=IDENTITY,successor=SUCCESSOR,pins=PINS,owner_files=owners,
             frozen_sha256=original['run-definition.json'],original_execution_stopped=False,
             authority_basis='sealed-worker-native-sdk-caller-observer-only-local-owner-noninterference',recovery_source=source_authority(require_main))


def brain_authority():
 old=_tx.brain_get('/tasks/'+TASK);old=old.get('task',old)
 current=_tx.brain_get('/tasks/'+FIX_TASK);current=current.get('task',current)
 need(old.get('id')==TASK and old.get('status')=='failed','CLOUD8_ORIGINAL_TASK')
 need(current.get('id')==FIX_TASK and current.get('status')=='in_progress' and all(current.get(k)==v for k,v in CLAIM.items()),'CLOUD8_FIX_CLAIM')
 locks=_tx.brain_get('/device-locks');found=[x for x in locks.get('locks',[]) if x.get('device_name')==SERIAL]
 need(locks.get('success') is True and len(found)==1 and found[0].get('locked_by') is None,'CLOUD8_CENTRAL_OWNER')
 # The shared transaction checks a stable authorization label, not old stop.
 return dict(original_task=TASK,original_status='failed',fix_task=FIX_TASK,claim=CLAIM,central_owner=None)


def journal_dir(root):
 path=root/('.quarantine-supersession-cloud8-'+EPOCH)
 if not path.exists():path.mkdir(mode=0o700);_tx.sync_dir(root)
 _tx.directory(path,True)
 need({p.name for p in path.iterdir()}<={'plan.json','apply.intent.json','apply.returned.json'},'CLOUD8_JOURNAL_INVENTORY')
 return path


def archive_path(root):return root/('.quarantine-supersession-cloud8-'+EPOCH+'.superseded')


def validate_plan(root,journal,evidence):
 p=json.loads(read_bytes(journal/'plan.json',True))
 need(set(p)=={'protocol','state','identity','evidence','lock','superseded_path','machine_authority'}
      and p['protocol']==PROTOCOL and p['state']=='planned' and p['identity']==IDENTITY
      and p['evidence']==evidence and p['superseded_path']==str(archive_path(root)),'CLOUD8_PLAN_DRIFT')
 a=p['machine_authority']
 need(a==dict(original_task=TASK,original_status='failed',fix_task=FIX_TASK,claim=CLAIM,central_owner=None),'CLOUD8_PLAN_AUTHORITY')
 return p


# Private transaction instance only: cloud7's CLI and globals stay unchanged.
for _key in ['TASK','FIX_TASK','CLAIM','COMMIT','TAG','RUN','BINDING','EPOCH','SERIAL','PROTOCOL','IDENTITY','SUCCESSOR','LOCK_FIELDS','PINS']:
 setattr(_tx,_key,globals()[_key])
for _key in ['layout','verify_evidence','brain_authority','journal_dir','archive_path','validate_plan']:
 setattr(_tx,_key,globals()[_key])
plan,apply=_tx.plan,_tx.apply


def main():
 need(len(sys.argv)==2 and sys.argv[1] in ['inspect','plan','apply'],'USAGE: cloud8-quarantine-supersession.py inspect|plan|apply')
 if sys.argv[1]=='inspect':
  facts=verify_evidence(False)
  home,root,run,evidence=layout()
  print(json.dumps(dict(state='candidate-inspection',not_recovery_authority=True,evidence=facts,
                       proposed_transaction=dict(operation='rename-exact-quarantine-directory',lock=_tx.lock_snapshot(root/(SERIAL+'.lock')),
                       archive_path=str(archive_path(root)),requires_merged_main=True,preserve_old_unknown=True,preserve_owner_pending=True)),ensure_ascii=False,sort_keys=True))
 else:print(json.dumps(plan() if sys.argv[1]=='plan' else apply(),ensure_ascii=False,sort_keys=True))

if __name__=='__main__':
 try:main()
 except Exception as error:
  print(str(error) if isinstance(error,ValueError) else 'CLOUD8_SUPERSESSION_IO_UNKNOWN',file=sys.stderr);sys.exit(2)

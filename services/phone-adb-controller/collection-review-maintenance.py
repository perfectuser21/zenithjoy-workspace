#!/usr/bin/env python3
"""仅ys20261103235714_102：新维护授权，不恢复旧WeakMap或旧OS停止结论。"""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
from datetime import datetime

import sys
sys.dont_write_bytecode=True

HERE=Path(__file__).resolve().parent
SCOPE={'source_commit':'75f3ea59b6c430e28111196f9b5bede87f957230','run_id':'douyin_video_processing-ys20261103235714_102__a1','owner':'ys20261103235714_102','profile':'xiaolongxia','serial':'ANGYVB4311010223','task_id':'6ca6e356-d63b-4a1f-92b7-9f5a7798b916','binding_id':'ee9c8087-e1ed-4524-98d4-9f510b532b72'}
TASK={'id':'f10777a6-9691-4633-ac50-04c898a05ba1','status':'in_progress','claimed_by':'headed-102-collection-fix','claimed_at':'2026-11-04T02:32:46.537Z','project_id':'68ca6b4f-5e53-4ccf-a2aa-874e5c32bbe6'}
CONTRACT=json.loads((HERE/'collection-review-maintenance-contract.json').read_bytes())
ARCHIVE='.review-retired-collection-review-'+TASK['id']+'-'+SCOPE['serial']

def need(value,reason):
    if not value:raise ValueError('COLLECTION_REVIEW_'+reason)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def load(name):
    spec=importlib.util.spec_from_file_location(name.replace('-','_'),HERE/name)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def read(path,limit=32*1024*1024):
    p=Path(path)
    need(p.is_absolute(),'ABSOLUTE')
    for parent in p.parents:need(parent.is_dir() and not parent.is_symlink(),'PARENT')
    fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        st=os.fstat(fd);need(stat.S_ISREG(st.st_mode) and st.st_uid==os.geteuid() and not st.st_mode&0o022 and st.st_size<=limit,'FILE')
        raw=os.read(fd,limit+1);after=os.fstat(fd)
        need(len(raw)==st.st_size and (st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns),'FILE_DRIFT')
        return raw
    finally:os.close(fd)
def verify_task(task):
    need(isinstance(task,dict) and all(task.get(k)==v for k,v in TASK.items()) and task.get('payload',{}).get('headed_manual')=='true','TASK_CLAIM')
    return dict(TASK)
def ms(value):return int(datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()*1000)

def verify_leaf_log(raw):
    need(isinstance(raw,str) and raw.endswith('\n') and raw.strip(),'LEAF_TRUNCATED')
    rows=[json.loads(x) for x in raw.splitlines()];need(len(rows)%3==0,'LEAF_PHASES');last=0;first=None;failed=0
    for n in range(0,len(rows),3):
        i,s,e=rows[n:n+3];need([x.get('phase') for x in [i,s,e]]==['intent','started','exit'],'LEAF_PHASES')
        for k in ['sequence','argv_sha256','intent_at','boundary']:need(k in i and s.get(k)==e.get(k)==i[k],'LEAF_IDENTITY')
        need(type(i['sequence']) is int and i['sequence']==n//3+1 and re.fullmatch(r'[a-f0-9]{64}',i['argv_sha256']) and i['boundary']=='darwin-sandbox-deny-process-fork-v1','LEAF_SEQUENCE')
        need(type(s.get('pid')) is int and s['pid']>1 and e.get('pid')==s['pid'] and type(i['intent_at']) is int and type(s.get('started_at')) is int and e.get('started_at')==s['started_at'] and type(e.get('ended_at')) is int and last<=i['intent_at']<=s['started_at']<=e['ended_at'],'LEAF_TIME')
        need(e.get('request_returned') is True and e.get('signal') is None and e.get('tainted') is False and type(e.get('code')) is int and e['code'] in [0,1],'LEAF_UNRETURNED')
        failed+=int(e['code']!=0);last=e['ended_at'];first=i['intent_at'] if first is None else first
    return {'leaves':len(rows)//3,'first_intent':first,'last_exit':last,'code_failures':failed,'requests_returned':True,'execution_stopped':False}

def verify_original(run_root,*,runtime_root=None):
    root=Path(run_root);need(root.is_dir() and not root.is_symlink(),'RUN_ROOT')
    need(sorted(p.name for p in root.iterdir())==CONTRACT['top_entries'],'RUN_ENTRY_SET')
    raw={}
    for name,expected in CONTRACT['original_files'].items():
        need(all(x not in ['','.','..'] for x in name.split('/')),'ORIGINAL_PATH');b=read(root/name);need(sha(b)==expected,'ORIGINAL_HASH_'+name);raw[name]=b
    document=lambda name:json.loads(raw[name])
    frozen=document('run-definition.json');need(frozen['deployment']['source_commit']==SCOPE['source_commit'] and frozen['deployment']['target']=='xian-m4','SOURCE')
    runtime=Path(runtime_root) if runtime_root else root/'runtime';count=0
    for name,expected in frozen['files'].items():
        if name.startswith('runtime/'):
            need(all(x not in ['','.','..'] for x in name.split('/')),'RUNTIME_PATH');need(sha(read(runtime/name[8:]))==expected,'RUNTIME_HASH');count+=1
    need(count==341 and set(frozen['files'])=={*('runtime/'+n[8:] for n in frozen['files'] if n.startswith('runtime/')),'workflow.plan','step-dod.json'},'RUNTIME_CLOSURE')
    for name in ['workflow.plan','step-dod.json']:need(sha(read(root/name))==frozen['files'][name],'FROZEN_PLAN_HASH')
    ack=document('run-bindings/a1.ack.json')['binding'];need(ack['id']==SCOPE['binding_id'] and ack['run_id']==SCOPE['run_id'] and ack.get('task_id') is None,'BINDING')
    a=document('central-task-association.json');need(all(a.get(k)==SCOPE[k] for k in ['source_commit','run_id','task_id','binding_id']) and a['device_name']==SCOPE['serial'] and a['central_owner']==SCOPE['task_id'] and a['runtime_snapshot_sha256']==frozen['snapshot_sha256'],'ASSOCIATION')
    locks=[json.loads(x) for x in raw['central-lock-events.jsonl'].splitlines()];need(len(locks)==1 and locks[0]['event']=='acquired' and locks[0]['task_id']==SCOPE['task_id'] and locks[0]['device_name']==SCOPE['serial'],'CENTRAL_LEASE')
    events=[json.loads(x) for x in raw['activity-events.jsonl'].splitlines()]
    starts=[x for x in events if x.get('activity')=='collection' and x.get('phase')=='start'];exits=[x for x in events if x.get('activity')=='collection' and x.get('phase')=='execution']
    need(len(starts)==len(exits)==1 and starts[0]['attempt']==1 and starts[0]['recovery'] is False and exits[0]['evidence']=={'status':'failed','attempt':1,'error':'OLD_EXECUTION_TERMINATION_UNKNOWN','execution_stopped':False},'POST_FINALLY')
    result=document('activity-collection.json');need(result['execution_stopped'] is False and len(result['attempts'])==1 and result['attempts'][0]['recovery'] is False,'ORIGINAL_FAILURE')
    scope=root/'collection-phone-scopes';need(scope.is_dir() and not scope.is_symlink() and sorted(p.name for p in scope.iterdir())==['57f9fba2-a464-4079-8220-5f8a8c293557'],'SCOPE_SET')
    sd=scope/'57f9fba2-a464-4079-8220-5f8a8c293557';need(sorted(p.name for p in sd.iterdir())==['bin','collection-leaves-9698ac352da9f520.jsonl','policy.json'],'SCOPE_ENTRIES')
    binary=sd/'bin';need(binary.is_dir() and not binary.is_symlink() and sorted(p.name for p in binary.iterdir())==['node','python3','zsh'],'SCOPE_BIN')
    for name,key in [('python3','python'),('node','node'),('zsh','zsh')]:
        p=binary/name;need(p.is_symlink() and os.readlink(p)==frozen['collection_phone_scope']['executables'][key]['path'],'SCOPE_BIN_LINK')
    native=root/'native-operations';expected=sorted(n.split('/')[1] for n in CONTRACT['original_files'] if n.startswith('native-operations/'))
    need(sorted(p.name for p in native.iterdir())==expected and not any(n.endswith('.unknown') for n in expected),'NATIVE_SET')
    summary=verify_leaf_log(raw['collection-phone-scopes/57f9fba2-a464-4079-8220-5f8a8c293557/collection-leaves-9698ac352da9f520.jsonl'].decode())
    need(summary['leaves']==1486 and summary['code_failures']==16 and ms(starts[0]['observed_at'])<summary['first_intent']<=summary['last_exit']<ms(exits[0]['observed_at']),'LEAF_TOTAL_OR_TIME')
    need(document('ys20261103235714_102-sampling-readback.json')['run_id']==SCOPE['run_id'],'ENTERED_COLLECTION')
    return {**summary,'protocol':'collection-review-closed-domain-v1','scope':dict(SCOPE),'runtime_files':count,'frozen_files':count+2,'original_files':CONTRACT['original_files'],'post_finally_at':exits[0]['observed_at']}

def cleanup_commands():
    return [['shell','am','force-stop','com.ss.android.ugc.aweme'],['shell','input','keyevent','3']]

# 无业务常量的盘点/guard/原子落盘原语；不导入旧101维护策略。
locks=load('phone-lock-root.py')
primitives=load('maintenance-reopen-lock.py')
maintenance=load('deployment-maintenance.py')

def legacy_record(home):
    p=home/'.local/share/zenithjoy/phone-transactions/phone-safety-3fe8783b021fd9fa1a8cd424/maintenance.json'
    b=read(p);need(sha(b)==CONTRACT['legacy_record_sha256'],'LEGACY_RECORD')
    record=json.loads(b);maintenance.verify_legacy_binding(record);return record

def lock_paths(home):
    record=legacy_record(home);logical=Path(record['legacy_root'])
    old,binding=maintenance.legacy_binding(record['legacy_binding']['home'],logical)
    need(binding==record['legacy_binding'],'LEGACY_BINDING')
    durable=home/'.local/share/zenithjoy/phone-locks';marker=locks.verify(durable)
    need(marker['legacy_root']==str(logical) and marker['entries']==207 and marker['review_owners']==2,'MIGRATION_MARKER')
    return old,durable,record

def preserved_legacy_path(name):
    # 两个精确path-component域；外部业务状态只保留，不裁定其合法性或停止。
    parts=name.split('/')
    return parts[0]=='ANGYVB4227006983.lock' or parts[:2]==['standalone-claims','ANGYVB4227006983']

def legacy_diff(entries):
    before={r[0]:r for r in CONTRACT['lock_state']['legacy']};after={r[0]:r for r in entries}
    return [{'path':p,'before':before.get(p),'after':after.get(p)} for p in sorted(before.keys()|after.keys()) if before.get(p)!=after.get(p)]

class OwnedGuards:
    def __init__(self,home,*,legacy_snapshot=None):
        self.home=home;self.fds=[];self.legacy_snapshot=legacy_snapshot
    def __enter__(self):
        self.old,self.durable,self.legacy=lock_paths(self.home)
        try:
            paths=sorted([*self.old.glob('*.guard'),*self.durable.glob('*.guard')])
            need(len(paths)==10 and {str(p) for p in paths}==set(CONTRACT['lock_state']['guards']),'GUARD_SET')
            for p in paths:
                fd=os.open(p,os.O_RDWR|os.O_NOFOLLOW);self.fds.append((fd,p));s=os.fstat(fd)
                need(stat.S_ISREG(s.st_mode) and s.st_uid==os.geteuid() and not s.st_mode&0o022,'GUARD')
                fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            self.verify();return self
        except BaseException:
            self.__exit__(None,None,None);raise
    def verify(self):
        primitives._guard_inodes(self.fds);maintenance.verify_legacy_binding(self.legacy)
        for fd,p in self.fds:
            st=os.fstat(fd);need([st.st_dev,st.st_ino,st.st_ctime_ns]==CONTRACT['lock_state']['guards'][str(p)],'GUARD_IDENTITY')
        need(sorted([*self.old.glob('*.guard'),*self.durable.glob('*.guard')])==[p for _,p in self.fds],'GUARD_SET_DRIFT')
        before=CONTRACT['lock_state']['durable'];after=primitives.changed_inventory(before,SCOPE['serial']+'.lock',ARCHIVE)
        current=locks.inventory(self.durable)
        observed=locks.inventory(self.old)
        need(all(preserved_legacy_path(d['path']) for d in legacy_diff(observed)) and current in [before,after],'LOCK_INVENTORY')
        if self.legacy_snapshot is None:
            need(locks.inventory(self.old)==observed and locks.inventory(self.durable)==current,'LEGACY_SNAPSHOT_UNSTABLE')
            self.legacy_snapshot=observed
        else:need(observed==self.legacy_snapshot,'LEGACY_SNAPSHOT_DRIFT')
        target=self.durable/(SCOPE['serial']+'.lock' if current==before else ARCHIVE)
        primitives.owner_directory(target,SCOPE['owner'])
        st=target.lstat();identity=[st.st_dev,st.st_ino,st.st_uid,st.st_mode]
        if hasattr(self,'target_identity'):need(identity==self.target_identity,'TARGET_INODE')
        else:self.target_identity=identity
        self.current=current;self.target=target;return current==before
    def retire(self,before_commit):
        active=self.verify();before_commit();need(self.verify()==active,'LOCK_PHASE_DRIFT')
        if active:
            need(not os.path.lexists(self.durable/ARCHIVE),'ARCHIVE_CONFLICT')
            os.rename(self.target,self.durable/ARCHIVE);primitives.tx.sync_directory(self.durable)
        need(self.verify() is False,'ARCHIVE_READBACK')
        need(locks.check_serial(self.durable,SCOPE['serial'])['state']=='free','TARGET_NOT_FREE')
        return {'released':True,'archive':ARCHIVE,'owner':SCOPE['owner'],'serial':SCOPE['serial'],'other_owners_unchanged':True,'central_lease_released':False}
    def __exit__(self,*_):
        for fd,_ in self.fds:os.close(fd)
        self.fds=[]

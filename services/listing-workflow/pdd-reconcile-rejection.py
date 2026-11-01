#!/usr/bin/env python3
"""One historical R21c controller rejection. No ADB/UI/media or new business action.
Run on the original device host, after independent review. Keeps historical unknown.
"""
import fcntl
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import time
from urllib.request import Request, urlopen
from uuid import uuid4

OWNER='manual-pdd-native-98549a255bd5438aa8fb8e2b6f23a9cf'
RUN='pdd-native-r21c-6483edbe-c1b9-4c58-a56f-2cee5434f53f'
ROOT=Path('/private/tmp/pdd-native-98549a25-5bd5-438a-a8fb-8e2b6f23a9cf')
PROFILE='pdd98549a255bd5438aa8fb8e2b6f23a9cf'
SERIAL='ANGYVB4311010223'
JOB='e3bde6d1-db57-4706-b575-927e5db8a966'
CONTROLLER=Path('/Users/jinnuoshengyuan/bin-harvest/douyin-phone-adb')
CONTROLLER_SHA='620fc1a8b0f1a7969d7d057740ce0c5611f4b6ae238e33eddf5c9d9d05cb8f33'
JOB_SHA='bd693821aaf44ec63570a3ef489dd731e86c4472cfcce05cb7846dddcb120362'
REJECTION='required lock owner is supported only for standalone read commands'
FENCE_DOC_SHA='0a9d757a38607d2af130f4eeaafbeff43d0d0a7e638bb2fccc9ce9013bff1669'
POLICY_SHA='8283255f9f424d9e2cfb3c360668da7f7d54da056f86d79e70c6f9dfa9d8c8fc'
JOBS_SHA='314dddee1df36a793dcf5417afb7e4e59df687587fc3b8c2242aea2c3fa48c5a'
PROFILE_SHA='0617fa6ba478e056fa88b82750aca7f07d085ec96c45a1f68f6b585cb83cb3a0'
TRUSTED_HASHES={'douyin-phone-adb':CONTROLLER_SHA,'phone-lock-lib.sh':'ed2840ffbd5ded0aaa2b142a4b14405946610575536a55740c38247d5c440271','phone-lock-helper.py':'9f583cbfd989e57f1b0c5320dad3b7b6f1d5d31bf2ab9cb0d97db003b7890c4a','text-input-focus.py':'2918eaacad5a16eb712d82df5db137bec1bd6a0af8a2d8c6b920b7724b91a70f'}
# Lock lib/focus match reviewed repo bytes; helper matches git c1855774c97f32a22df823ae0a9f3cc28d7d01b6.
FENCE='r21c-rejected-before-swipe-'+JOB
BRAIN='http://100.79.41.61:5221/api/brain/device-locks'
LOCK=Path('/private/tmp/openclaw-phone/locks')/(SERIAL+'.lock')


def require(ok,reason):
    if not ok: raise ValueError('RECONCILE_'+reason)


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()).hexdigest()


def read(path):
    path=Path(path);require(not path.is_symlink() and path.is_file(),'UNSAFE_FILE')
    require(path.stat().st_uid==os.geteuid() and not path.stat().st_mode&0o022,'FILE_OWNER_MODE')
    return path.read_bytes()


def load(path): return json.loads(read(path))


def store(path,value):
    require(not path.is_symlink(),'UNSAFE_JOURNAL')
    temporary=path.with_name(path.name+'.pending-'+uuid4().hex)
    fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as stream:
        json.dump(value,stream,ensure_ascii=False);stream.flush();os.fsync(stream.fileno())
    os.replace(temporary,path)
    fd=os.open(path.parent,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)


def verify_terminal(job,processes):
    require(digest(job)==JOB_SHA,'JOB_BYTES_CHANGED')
    require(job.get('owner')==OWNER and job.get('command')=='audit-tabs-swipe' and job.get('status')=='finished' and job.get('exitCode')==2 and job.get('stderr')==REJECTION+'\n' and job.get('stdout')=='' and job.get('remoteUnknown') is True,'NOT_EXACT_REJECTION')
    require(job.get('pid')==71322,'JOB_PID')
    for line in processes.splitlines():
        parts=line.split(None,3)
        if len(parts)<4:continue
        try:ids=list(map(int,parts[:3]))
        except ValueError:continue
        require(job['pid'] not in ids,'ORIGINAL_PROCESS_OR_GROUP_PRESENT')


def source_hashes():
    raw=read(CONTROLLER)
    require(hashlib.sha256(raw).hexdigest()==CONTROLLER_SHA,'BOUND_CONTROLLER_CHANGED')
    # This whole source hash was independently reviewed: unique die(exit 2) at 4432, swipe at 4604.
    require(raw.count(REJECTION.encode())==1,'REJECTION_SOURCE')
    names=['douyin-phone-adb','phone-lock-lib.sh','phone-lock-helper.py','text-input-focus.py']
    hashes={name:hashlib.sha256(read(CONTROLLER.parent/name)).hexdigest() for name in names}
    require(hashes==TRUSTED_HASHES,'UNREVIEWED_SUPPORT_SOURCE')
    return hashes


def policy_base(policy):
    require(isinstance(policy,dict),'MATERIAL_POLICY')
    base=dict(policy);fence=base.pop('recoveryFence',None)
    require(fence in (None,FENCE) and digest(base)==POLICY_SHA,'OTHER_FENCE_OR_POLICY')
    return base


def verify_jobs(jobs,processes):
    require(isinstance(jobs,dict) and len(jobs)==52 and digest(jobs)==JOBS_SHA,'JOB_SET_CHANGED')
    verify_terminal(jobs['job-'+JOB+'-audit.json'],processes)
    for name,row in jobs.items():
        require(row.get('owner')==OWNER and row.get('status')=='finished','OTHER_JOB_NOT_TERMINAL')
        if name!='job-'+JOB+'-audit.json':require(row.get('exitCode')==0 and row.get('remoteUnknown') is False,'OTHER_JOB_UNKNOWN')
        for line in processes.splitlines():
            parts=line.split(None,3)
            if len(parts)<4:continue
            try:ids=list(map(int,parts[:3]))
            except ValueError:continue
            require(row['pid'] not in ids,'OTHER_JOB_PROCESS_OR_GROUP_PRESENT')


def verify():
    require(ROOT.is_dir() and not ROOT.is_symlink(),'ROOT')
    c=load(ROOT/'config.json')
    require(c.get('owner')==OWNER and c.get('runId')==RUN and c.get('profile')==PROFILE and c.get('remoteRoot')==str(ROOT),'IDENTITY')
    b=c['binding'];require(b.get('serial')==SERIAL and b.get('controllerPath')==str(CONTROLLER) and b.get('controllerSha256')==CONTROLLER_SHA and b.get('draftWritesAuthorized') is False,'BINDING')
    require(c.get('ownedMedia')==[] and not any(c.get(k) for k in ['draft','expectNewForm','newFormEntryIntent','pendingAction','pendingPicker','gallerySelection','galleryUploadIntent','ownedAlbum']),'NOT_READ_ONLY_RUN')
    intent=c.get('auditIntents',{}).get('tabs',{})
    require(set(c.get('auditIntents',{}))=={'tabs'} and intent.get('jobId')==JOB and intent.get('owner')==OWNER and intent.get('commandFinished') is False,'ORIGINAL_INTENT_CHANGED')
    policy_base(c.get('materialPolicy'))
    require(hashlib.sha256(read(ROOT/'profiles.tsv')).hexdigest()==PROFILE_SHA,'PROFILE_CHANGED')
    hashes=source_hashes()
    ps=subprocess.check_output(['/bin/ps','-axo','pid=,ppid=,pgid=,command='],text=True,timeout=10)
    jobs={path.name:load(path) for path in ROOT.glob('job-*.json')}
    verify_jobs(jobs,ps)
    require(read(LOCK/'owner').decode().strip()==OWNER,'LOCAL_OWNER_CHANGED')
    require(read(LOCK/'standalone_review_required').decode().strip()==OWNER,'REVIEW_FENCE_MISSING')
    return c,hashes,hashlib.sha256(ps.encode()).hexdigest()


def brain(method='GET'):
    body=None if method=='GET' else json.dumps({'device_name':SERIAL,'locked_by':OWNER}).encode()
    url=BRAIN+('/release' if method=='POST' else '')
    req=Request(url,data=body,method=method,headers={'Content-Type':'application/json','Connection':'close'})
    with urlopen(req,timeout=10) as response:
        require(response.status==200 and response.geturl()==url,'BRAIN_HTTP')
        raw=response.read(1_000_001);require(len(raw)<=1_000_000,'BRAIN_OVERSIZED')
    result=json.loads(raw);require(result.get('success') is True,'BRAIN_FAILURE')
    if method=='GET':
        rows=[x for x in result.get('locks',[]) if x.get('device_name')==SERIAL]
        require(len(rows)==1,'BRAIN_RECORD');return rows[0]
    return result


def step(ledger,name,operation):
    require(not any(x['name']==name or not x.get('finished') for x in ledger['steps']),'NO_REPLAY_OR_PENDING_STEP')
    row={'name':name,'intentAt':time.time(),'finished':False};ledger['steps'].append(row);store(ROOT/'r21c-reconcile-ledger.json',ledger)
    try:result=operation()
    except Exception as error:
        row.update(error=str(error),outcomeUnknown=True);store(ROOT/'r21c-reconcile-ledger.json',ledger);raise
    row.update(finished=True,finishedAt=time.time(),result=result);store(ROOT/'r21c-reconcile-ledger.json',ledger);return result


def controller(command):
    require(command in {'lock-status','lock-refresh','lock-release-exact'},'FORBIDDEN_COMMAND')
    require(source_hashes()==load(ROOT/'r21c-reconcile-fence.json')['sourceHashes'],'SOURCE_DRIFT')
    if command!='lock-status':
        require(read(LOCK/'owner').decode().strip()==OWNER,'EXACT_CONTROLLER_OWNER_CHANGED')
        require(read(LOCK/'standalone_review_required').decode().strip()==OWNER,'REVIEW_FENCE_MISSING')
    args=[] if command=='lock-status' else [OWNER]
    env={'PATH':'/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin','HOME':'/Users/jinnuoshengyuan','USER':'jinnuoshengyuan','LOGNAME':'jinnuoshengyuan','TMPDIR':'/private/tmp/','LC_ALL':'C','LANG':'C','PYTHONNOUSERSITE':'1','PYTHONSAFEPATH':'1','PYTHONDONTWRITEBYTECODE':'1','DOUYIN_PYTHON_BIN':'/opt/homebrew/bin/python3','DOUYIN_PHONE_TMP_ROOT':'/private/tmp/openclaw-phone','DOUYIN_PHONE_REGISTRY':str(ROOT/'profiles.tsv'),'DOUYIN_BYPASS_REPORT':'off'}
    started=time.time()
    if command=='lock-release-exact': require(not release_receipt_path().exists() and not release_receipt_path().is_symlink(),'RELEASE_RECEIPT_ALREADY_EXISTS')
    result=subprocess.run(['/bin/zsh','-f',str(CONTROLLER),'--profile',PROFILE,command,*args],env=env,capture_output=True,text=True,timeout=30)
    require(result.returncode==0,'CONTROLLER_FAILED:'+result.stderr[-300:])
    result_data={'exitCode':result.returncode,'stdout':result.stdout,'stderr':result.stderr}
    if command=='lock-release-exact': result_data['nativeReceipt']=verify_release_receipt(result.stdout,started)
    if command=='lock-refresh':
        require(read(LOCK/'owner').decode().strip()==OWNER and read(LOCK/'standalone_review_required').decode().strip()==OWNER,'REFRESH_NATIVE_OWNER')
        acquired=int(read(LOCK/'acquired_at').decode().strip())
        require(started-2<=acquired<=time.time()+2,'REFRESH_NATIVE_TIME')
        result_data['nativeReadback']={'owner':OWNER,'acquiredAt':acquired,'markerOwner':OWNER}
    return result_data


def release_receipt_path():
    return Path('/private/tmp/openclaw-phone/evidence')/PROFILE/(OWNER+'-lock-release.json')


def verify_release_receipt(stdout,started):
    path=release_receipt_path();eid=OWNER+'-lock-release'
    require('lock_evidence_id=none' not in stdout and ('lock_evidence_id='+eid+' lock_evidence='+str(path)+' readback_state=free') in stdout,'RELEASE_RECEIPT_MISSING')
    raw=read(path);doc=json.loads(raw);event=doc.get('latest',{})
    require(doc.get('schema')=='lock_receipt_v1' and doc.get('run_id')==OWNER and doc.get('kind')=='release' and doc.get('evidence_id')==eid and doc.get('events') and doc['events'][-1]==event,'RELEASE_RECEIPT_SCOPE')
    require(event.get('command')=='lock-release-exact' and event.get('requested_owner')==OWNER and event.get('serial')==SERIAL and event.get('profile')==PROFILE and event.get('rc')==0 and event.get('result')=='ok','RELEASE_RECEIPT_RESULT')
    require(event.get('readback_command')=='lock-status' and event.get('readback_state')=='free' and event.get('readback_owner') is None and event.get('readback','').strip()=='lock=free' and event.get('receipt','').strip()=='lock=released owner='+OWNER,'RELEASE_RECEIPT_READBACK')
    require(started*1000-2000<=event.get('at_epoch_ms',0)<=(time.time()+2)*1000,'RELEASE_RECEIPT_TIME')
    require(not LOCK.exists() and not LOCK.is_symlink(),'RELEASE_RECEIPT_LOCK_DIRECTORY_REMAINS')
    return {'path':str(path),'sha256':hashlib.sha256(raw).hexdigest(),'receipt':doc,'nativeLockDirectoryAbsent':True}


def reconcile(action):
    require(action in {'fence','release'},'ACTION')
    require(ROOT.is_dir() and not ROOT.is_symlink(),'ROOT')
    with (ROOT/'operation.guard').open('a') as guard:
        fcntl.flock(guard,fcntl.LOCK_EX|fcntl.LOCK_NB)
        c,hashes,process_hash=verify()
        fp=ROOT/'r21c-reconcile-fence.json';jp=ROOT/'r21c-reconcile-ledger.json'
        if action=='fence':
            require(not fp.exists() and not jp.exists(),'FENCE_ALREADY_EXISTS')
            fence={'owner':OWNER,'runId':RUN,'jobId':JOB,'jobSha256':JOB_SHA,'fence':FENCE,'sourceHashes':hashes,'processCensusSha256':process_hash,'originalConfigSha256':hashlib.sha256(read(ROOT/'config.json')).hexdigest(),'at':time.time(),'originalSessionUnknownRetained':True}
            store(fp,fence)
            c['materialPolicy']={**policy_base(c['materialPolicy']),'recoveryFence':FENCE};store(ROOT/'config.json',c)
            require(load(ROOT/'config.json')['materialPolicy']=={**policy_base(c['materialPolicy']),'recoveryFence':FENCE},'FENCE_READBACK')
            ledger={'owner':OWNER,'runId':RUN,'fence':FENCE,'steps':[],'originalSessionUnknownRetained':True};store(jp,ledger)
            return {'status':'fenced-no-release','fence':fence,'noDeviceAccess':True}
        fence=load(fp);ledger=load(jp)
        require(digest(fence)==FENCE_DOC_SHA and fence.get('fence')==FENCE and fence.get('runId')==RUN and fence.get('jobId')==JOB and fence.get('owner')==OWNER and fence.get('jobSha256')==JOB_SHA and fence.get('sourceHashes')==hashes and ledger.get('owner')==OWNER and ledger.get('runId')==RUN and ledger.get('fence')==FENCE and c['materialPolicy']=={**policy_base(c['materialPolicy']),'recoveryFence':FENCE},'FENCE_IDENTITY')
        require(not ledger['steps'],'NO_RELEASE_REPLAY')
        central=step(ledger,'brain-before',lambda:brain());require(central.get('locked_by')==OWNER,'CENTRAL_OWNER_CHANGED')
        status=step(ledger,'controller-before',lambda:controller('lock-status'));require(('owner='+OWNER+' ') in status['stdout'],'CONTROLLER_OWNER_CHANGED')
        age=time.time()-int(read(LOCK/'acquired_at').decode().strip())
        if age+1100>=1800:
            step(ledger,'controller-refresh',lambda:controller('lock-refresh'))
            status=step(ledger,'controller-refresh-readback',lambda:controller('lock-status'));require(('owner='+OWNER+' ') in status['stdout'],'REFRESH_OWNER_CHANGED')
        step(ledger,'controller-release',lambda:controller('lock-release-exact'))
        status=step(ledger,'controller-free',lambda:controller('lock-status'));require(status['stdout'].strip()=='lock=free','CONTROLLER_NOT_FREE')
        central=step(ledger,'brain-before-cas',lambda:brain());require(central.get('locked_by')==OWNER,'CENTRAL_CAS_OWNER_CHANGED')
        step(ledger,'brain-release-cas',lambda:brain('POST'))
        central=step(ledger,'brain-free',lambda:brain());require(central.get('locked_by') is None,'CENTRAL_NOT_FREE')
        receipt={'status':'reconciled-rejected-before-swipe','owner':OWNER,'runId':RUN,'fence':FENCE,'controllerFree':True,'brainFree':True,'originalSessionUnknownRetained':True,'originalAuditIntentCommandFinished':False,'noDeviceInputOrMediaCleanup':True,'phoneScratchArtifactsRetained':True,'at':time.time(),'ledgerSha256':hashlib.sha256(read(jp)).hexdigest()}
        store(ROOT/'r21c-reconciliation-result.json',receipt);return receipt


if __name__=='__main__':
    try:
        action=json.load(sys.stdin)['action'];require(action=='release','RELEASE_ONLY')
        print(json.dumps(reconcile(action),ensure_ascii=False))
    except Exception as error:print(json.dumps({'error':str(error),'originalSessionUnknownRetained':True}));sys.exit(1)

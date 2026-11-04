#!/usr/bin/env python3
"""新102精确维护CLI；plan只读，apply仅有限cleanup和本人目录归档。"""
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import socket
import stat
import subprocess
import sys
import time
from urllib.request import Request,urlopen

import sys
sys.dont_write_bytecode=True

HERE=Path(__file__).resolve().parent

def load(name):
    spec=importlib.util.spec_from_file_location(name.replace('-','_'),HERE/name)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
m=load('collection-review-maintenance.py')
phone_module=load('collection-review-maintenance-phone.py')
gate=load('maintenance-reopen-gate.py')
window=load('maintenance-install-window.py')
service=load('deployment-service.py')
need=m.need

def token(home):
    path=home/'.credentials/cecelia-internal.env';st=path.lstat()
    need(stat.S_IMODE(st.st_mode)==0o600,'TOKEN_MODE')
    found=re.fullmatch(r'CECELIA_INTERNAL_TOKEN=([^\r\n]{1,4096})\n?',m.read(path).decode())
    need(found,'TOKEN_FILE');return found[1]
def brain(home,path):
    need(re.fullmatch(r'/api/brain/(?:tasks/[a-f0-9-]{36}|device-locks|releases/[a-f0-9-]{36}(?:/gate|/observations/[a-f0-9-]{36})?)',path),'BRAIN_PATH')
    request=Request('http://100.79.41.61:5221'+path,headers={'Authorization':'Bearer '+token(home)})
    with urlopen(request,timeout=10) as r:
        need(r.status==200,'BRAIN_HTTP');return json.loads(r.read(8*1024*1024))
def task(home,proof=None):
    t=brain(home,'/api/brain/tasks/'+m.TASK['id'])
    if proof is not None and proof.get('version')==2:
        need(m.ms(proof['task_lease_epoch']['heartbeat_lease_until'])>now_ms(),'CURRENT_TASK_LEASE_EXPIRED')
        return resumed_task(t,proof['current_maintenance_claim'])
    return m.verify_task(t.get('task',t))
# 历史原件逐byte保留；它们证明存在断档，不能作为连续租约或OS停止证明。
HISTORY_SHA256={
    'history-last.json':'8fc4f4c3d7e9034f0f15164083ad377ff971456aa8f950ce3f5f97f2653a7b4f',
    'history-first-null.json':'4f2dc723b9166a0f015f0254f498d7680de09f8addaa8b4de98fac473b5737e1',
}
GAP_FILES={'history-last.json','history-first-null.json','old-task.json','maintenance-task.json',
           'locks-before.json','acquire-request.json','acquire-ack.json','locks-after.json','locks-confirm.json'}
LEASE_KEYS=('device_name','locked_by','locked_at','expires_at')
RESUME_FILES={'maintenance-blocked.json','maintenance-claim-request.json','maintenance-claim-ack.json',
              'maintenance-resume-request.json','maintenance-resume-ack.json','maintenance-task-confirm.json',
              'maintenance-heartbeat-request.json','maintenance-heartbeat-ack.json'}
BLOCKED_SHA256='565f77f3b6ee1311a3470b1d8ece0c04c381dbd16cce0b1e2a740c32bee1d223'
RESUME_CLAIMER='headed-102-maintenance-resume'
STALE_REASON='headed session stale: no initiative_runs row past grace — 降级 blocked（可恢复），非 failed'

def task_document(value):
    need(isinstance(value,dict),'TASK_RECORD');result=value.get('task',value)
    need(isinstance(result,dict),'TASK_RECORD');return result

def resumed_task(value,expected):
    current=task_document(value);payload=current.get('payload')
    need(isinstance(payload,dict) and m.sha(m.canonical(payload))==expected['payload_sha256']
         and all(current.get(k)==expected[k] for k in
                 ['id','status','claimed_by','claimed_at','executor_kind','project_id']),'CURRENT_TASK_CLAIM')
    return dict(expected)

def resume_authority(documents,files):
    need(files['maintenance-blocked.json']==BLOCKED_SHA256,'BLOCKED_TASK_BYTES')
    blocked=task_document(documents['maintenance-blocked.json']);payload=blocked.get('payload')
    need(blocked.get('id')==m.TASK['id'] and blocked.get('project_id')==m.TASK['project_id']
         and blocked.get('status')=='blocked' and blocked.get('claimed_by') is None and blocked.get('claimed_at') is None
         and blocked.get('blocked_at')=='2026-11-04T06:35:29.529Z'
         and blocked.get('updated_at')=='2026-11-04T06:35:29.529Z'
         and blocked.get('error_message')==STALE_REASON,'BLOCKED_TASK_STATE')
    need(isinstance(payload,dict) and payload.get('headed_manual')=='true'
         and payload.get('failed_run_id')==m.SCOPE['run_id'] and payload.get('source_commit')==m.SCOPE['source_commit']
         and payload.get('scope')=={'line':'yuesheng','send':0,'profile':m.SCOPE['profile'],
              'device_serial':m.SCOPE['serial'],'no_raw_sql_write':True,'no_shared_adb_restart':True,
              'keep_original_failed_result':True,'do_not_reuse_original101_maintenance':True},'BLOCKED_TASK_SCOPE')
    need(documents['maintenance-claim-request.json']=={'claimer':RESUME_CLAIMER,'executor_kind':'headed-session',
              'lease_seconds':14400},'NEW_CLAIM_REQUEST')
    ack=documents['maintenance-claim-ack.json'];claimed_at=ack.get('claimed_at');lease_until=ack.get('lease_until')
    need(ack.get('id')==m.TASK['id'] and ack.get('claimed_by')==RESUME_CLAIMER
         and ack.get('executor_kind')=='headed-session' and type(ack.get('lease_seconds')) is int
         and ack['lease_seconds']==14400 and ack.get('on_lease_expire')=='auto'
         and isinstance(claimed_at,str) and isinstance(lease_until,str)
         and m.ms(blocked['updated_at'])<m.ms(claimed_at)<=now_ms()
         and 14400000<=m.ms(lease_until)-m.ms(claimed_at)<=14460000,'NEW_CLAIM_ACK')
    current={'id':m.TASK['id'],'status':'in_progress','claimed_by':RESUME_CLAIMER,'claimed_at':claimed_at,
             'executor_kind':'headed-session','project_id':m.TASK['project_id'],
             'payload_sha256':m.sha(m.canonical(payload))}
    need(documents['maintenance-resume-request.json']=={'status':'in_progress'},'RESUME_REQUEST')
    resumed=documents['maintenance-resume-ack.json']
    need(resumed.get('success') is True and resumed.get('task_id')==m.TASK['id']
         and resumed.get('status')=='in_progress' and resumed.get('completed_at') is None
         and isinstance(resumed.get('updated_at'),str) and m.ms(resumed['updated_at'])>=m.ms(claimed_at),'RESUME_ACK')
    for name in ['maintenance-task.json','maintenance-task-confirm.json']:
        resumed_task(documents[name],current)
    need(documents['maintenance-heartbeat-request.json']=={'claimer':RESUME_CLAIMER,'lease_seconds':14400},'HEARTBEAT_REQUEST')
    heartbeat=documents['maintenance-heartbeat-ack.json'];expiry=heartbeat.get('lease_until')
    need(heartbeat.get('ok') is True and type(heartbeat.get('lease_seconds')) is int and heartbeat['lease_seconds']==14400
         and type(heartbeat.get('heartbeat_count')) is int and heartbeat['heartbeat_count']>=1 and isinstance(expiry,str)
         and m.ms(expiry)>=m.ms(lease_until) and m.ms(expiry)>now_ms(),'HEARTBEAT_ACK')
    return {'current_maintenance_claim':current,
            'task_lease_epoch':{'task_id':m.TASK['id'],'claimer':RESUME_CLAIMER,'claimed_at':claimed_at,
              'lease_seconds':14400,'initial_lease_until':lease_until,
              'heartbeat_lease_until':expiry,'heartbeat_count':heartbeat['heartbeat_count']},
            'blocked_task_sha256':files['maintenance-blocked.json']}

def current_claim_fields(authorization):
    if authorization.get('acquisition_gap',{}).get('version')!=2:return {}
    return {k:authorization[k] for k in ['current_maintenance_claim','task_lease_epoch','blocked_task_sha256']}


def now_ms():return int(time.time()*1000)
def old_task(value):
    need(isinstance(value,dict),'OLD_TASK_RECORD');t=value.get('task',value)
    need(isinstance(t,dict) and isinstance(t.get('result'),dict),'OLD_TASK_RECORD')
    expired=t['result'].get('lease_expired',{});need(isinstance(expired,dict),'OLD_TASK_RECORD')
    need(t.get('id')==m.SCOPE['task_id'] and t.get('status')=='failed'
         and t.get('completed_at')=='2026-11-04T05:25:41.289Z' and t.get('claimed_by') is None
         and all(expired.get(k)==v for k,v in {
             'at':'2026-11-04T05:25:41.286Z','source':'claim','claimer':'interactive-leadgen-validation-75f3',
             'lease_until':'2026-11-04T05:25:21.939Z','heartbeat_count':0}.items()),'OLD_TASK_TERMINAL')
    return {'id':m.SCOPE['task_id'],'status':'failed','completed_at':t['completed_at'],
            'lease_expired':{k:expired[k] for k in ['at','source','claimer','lease_until','heartbeat_count']}}

def lock_rows(value):
    rows=value.get('locks');need(isinstance(rows,list) and rows,'GAP_LOCKS')
    result={}
    for row in rows:
        need(isinstance(row,dict) and isinstance(row.get('device_name'),str)
             and row['device_name'] not in result,'GAP_LOCK_SET')
        result[row['device_name']]=row
    need(m.SCOPE['serial'] in result,'GAP_TARGET_MISSING');return result

def gap_evidence(path):
    need(path is not None,'GAP_EVIDENCE_REQUIRED');path=Path(path)
    need(path.is_absolute() and not path.is_symlink(),'GAP_EVIDENCE_PATH')
    directory=path.parent;st=directory.lstat()
    need(stat.S_ISDIR(st.st_mode) and st.st_uid==os.geteuid() and stat.S_IMODE(st.st_mode)==0o700,'GAP_DIRECTORY')
    need(stat.S_IMODE(path.lstat().st_mode)==0o600,'GAP_MANIFEST_MODE')
    raw=m.read(path);value=json.loads(raw)
    need(isinstance(value,dict),'GAP_MANIFEST')
    need(raw==m.canonical(value) and type(value.get('version')) is int and value['version'] in [1,2]
         and value.get('kind')=='collection-review-new-isolation-after-gap-v'+str(value['version'])
         and value.get('scope')==m.SCOPE and value.get('maintenance')==m.TASK
         and value.get('continuous_central_isolation_proven') is False,'GAP_MANIFEST')
    files=value.get('files');required=GAP_FILES|(RESUME_FILES if value['version']==2 else set())
    need(isinstance(files,dict) and set(files)==required,'GAP_FILES')
    documents={}
    for name,digest in files.items():
        need(isinstance(digest,str) and re.fullmatch('[a-f0-9]{64}',digest),'GAP_DIGEST')
        record=directory/name;need(stat.S_IMODE(record.lstat().st_mode)==0o600,'GAP_RECORD_MODE')
        body=m.read(record);need(m.sha(body)==digest,'GAP_RECORD_BYTES');documents[name]=json.loads(body)
        need(isinstance(documents[name],dict),'GAP_RECORD_TYPE')
    need(all(files[name]==digest for name,digest in HISTORY_SHA256.items()),'GAP_HISTORY_BYTES')
    last=documents['history-last.json']['independent_readback']['lock']
    need(last.get('device_name')==m.SCOPE['serial'] and last.get('locked_by')==m.SCOPE['task_id']
         and last.get('expires_at')=='2026-11-04T05:17:26.274Z','GAP_LAST_LEASE')
    first=documents['history-first-null.json'];free=lock_rows(first['locks'])[m.SCOPE['serial']]
    need(all(free.get(k) is None for k in ['locked_by','locked_at','expires_at'])
         and first['health']['timestamp']=='2026-11-04T06:32:47.413Z','GAP_FIRST_NULL')
    terminal=old_task(first['old102']);need(old_task(documents['old-task.json'])==terminal,'GAP_OLD_TASK')
    authority={}
    if value['version']==2:authority=resume_authority(documents,files)
    else:
        maintenance=documents['maintenance-task.json'];m.verify_task(maintenance.get('task',maintenance))
    request=documents['acquire-request.json']
    need(set(request)=={'device_name','locked_by','ttl_minutes'} and request['device_name']==m.SCOPE['serial']
         and request['locked_by']==m.TASK['id'] and type(request['ttl_minutes']) is int
         and 1<=request['ttl_minutes']<=240,'GAP_ACQUIRE_REQUEST')
    ack=documents['acquire-ack.json'];need(ack.get('acquired') is True and isinstance(ack.get('lock'),dict),'GAP_ACQUIRE_ACK')
    lease={k:ack['lock'].get(k) for k in LEASE_KEYS}
    need(lease['device_name']==m.SCOPE['serial'] and lease['locked_by']==m.TASK['id']
         and isinstance(lease['locked_at'],str) and isinstance(lease['expires_at'],str)
         and m.ms('2026-11-04T06:32:48Z')<m.ms(lease['locked_at'])<=now_ms()
         and m.ms(lease['expires_at'])-m.ms(lease['locked_at'])==request['ttl_minutes']*60000,'GAP_ACQUIRE_LEASE')
    if value['version']==2:
        need(m.ms(lease['locked_at'])>=m.ms(authority['current_maintenance_claim']['claimed_at']),'DEVICE_LEASE_BEFORE_NEW_CLAIM')
    before=lock_rows(documents['locks-before.json']);target=before[m.SCOPE['serial']]
    need(all(target.get(k) is None for k in ['locked_by','locked_at','expires_at']),'GAP_BEFORE_NOT_FREE')
    others={k:v for k,v in before.items() if k!=m.SCOPE['serial']}
    for name in ['locks-after.json','locks-confirm.json']:
        after=lock_rows(documents[name]);target=after[m.SCOPE['serial']]
        need({k:target.get(k) for k in LEASE_KEYS}==lease and target.get('expired') is False,'GAP_ACQUIRE_READBACK')
        need({k:v for k,v in after.items() if k!=m.SCOPE['serial']}==others,'GAP_OTHER_DEVICE_DRIFT')
    return {'version':value['version'],'kind':value['kind'],'original_scope':dict(m.SCOPE),'maintenance':dict(m.TASK),**authority,
            'continuous_central_isolation_proven':False,'old_task':terminal,
            'last_known_old_expires_at':last['expires_at'],'first_null_observed_at':'2026-11-04T06:32:48Z',
            'first_null_record_health_timestamp':first['health']['timestamp'],
            'maintenance_lease':lease,'manifest_path':str(path),'manifest_sha256':m.sha(raw),'files':files}

def central(home,proof):
    records=brain(home,'/api/brain/device-locks')['locks'];rows=lock_rows({'locks':records});live=rows[m.SCOPE['serial']]
    lease=proof['maintenance_lease']
    need(all(live.get(k)==lease[k] for k in ['device_name','locked_by','locked_at'])
         and live.get('locked_by')==m.TASK['id'] and live.get('expired') is False
         and isinstance(live.get('expires_at'),str)
         and m.ms(live['expires_at'])>=m.ms(lease['expires_at']) and m.ms(live['expires_at'])>now_ms(),'CENTRAL_MAINTENANCE_OWNER')
    # 同一acquire epoch的任务heartbeat可延长expires；不重写原始租约或伪造连续性。
    return dict(lease)
def quiet():
    state=service.service_state();cron=subprocess.run(['/usr/bin/crontab','-l'],capture_output=True,text=True,timeout=10,check=True).stdout
    processes=subprocess.run(['/bin/ps','-axo','pid=,command='],capture_output=True,text=True,timeout=10,check=True).stdout
    need(not re.search(r'(?:leadgen-workflow[.]mjs|process-queued-video[.]sh|wf-agent-handoff[.]py|native-audio-evidence|scrcpy|screenrecord)',processes),'PHONE_WORKER_ACTIVE')
    window.verify_automatic_quiescence(cron,{m.SCOPE['serial'],'ANGYVB4227006983','ANGYVB4402004137'},recovery_disabled=state['disabled'],recovery_loaded=state['loaded'],process_table=processes)
    need(not any('harvest-cron.sh' in x and x.strip() and not x.lstrip().startswith('#') for x in cron.splitlines()),'ACTIVE_SCHEDULE')
    return {'cron_sha256':m.sha(cron.encode()),'recovery_disabled':state['disabled'],'recovery_loaded':state['loaded']}
def quiet_recorders(original):
    frozen=json.loads(m.read(original/'run-definition.json'));root=Path(frozen['collection_phone_scope']['evidence_identity']['canonical_root'])
    # 逐个复核原冻结物理目录与唯一alias；不新增或跟随别的别名。
    for entry in frozen['collection_phone_scope']['evidence_identity']['entries']:
        p=Path(entry['path']);st=p.lstat()
        need([st.st_dev,st.st_ino,st.st_uid,st.st_mode]==[entry[k] for k in ['dev','ino','uid','mode']],'EVIDENCE_IDENTITY')
        need((stat.S_ISLNK(st.st_mode) and os.readlink(p)==entry['target']) if entry['type']=='alias' else stat.S_ISDIR(st.st_mode),'EVIDENCE_ALIAS')
    for p in root.glob('*.rec.pid'):
        need(not p.is_symlink() and stat.S_ISREG(p.lstat().st_mode),'RECORDER_FILE')
        raw=m.read(p).decode().strip();need(re.fullmatch(r'[1-9][0-9]{0,9}',raw) and int(raw)>1,'RECORDER_PID')
        try:os.kill(int(raw),0)
        except ProcessLookupError:continue
        raise ValueError('COLLECTION_REVIEW_RECORDER_ACTIVE')


def candidate(home, sha, release_id):
    """验证现有候选；保留原run namespace，不使用旧空namespace reopen合同。"""
    need(re.fullmatch(r'[a-f0-9]{40}', sha or '') and sha != m.SCOPE['source_commit']
         and re.fullmatch(r'[a-f0-9-]{36}', release_id or ''), 'CANDIDATE_ID')
    base = home / '.local/share/zenithjoy/phone-candidates' / sha
    runtime = base / 'runtime'
    release = brain(home, '/api/brain/releases/' + release_id)['release']
    current = brain(home, '/api/brain/releases/' + release_id + '/gate')
    observation = brain(home, '/api/brain/releases/' + release_id + '/observations/' + str(current.get('current_observation_id')))['observation']
    environment = 'staging:' + sha
    payload = release.get('payload', {})
    need(release.get('id') == release_id and release.get('target') == 'xian-m4'
         and release.get('environment') == environment
         and release.get('manifest_sha256') == gate.digest({'environment': environment, 'target': 'xian-m4', 'payload': payload}), 'RELEASE')
    need(current.get('release_id') == release_id and current.get('manifest_sha256') == release['manifest_sha256']
         and current.get('deployed') is True and current.get('actual_matches') is True
         and current.get('current_status') == 'deployed' and current.get('gaps') == []
         and all(current.get('verification', {}).get(k) == 'verified' for k in
                 ('status', 'ci_status', 'definition_status', 'step_coverage_status')), 'GATE')
    need(observation.get('id') == current.get('current_observation_id')
         and observation.get('release_id') == release_id
         and observation.get('payload', {}).get('target') == 'xian-m4'
         and observation['payload'].get('environment') == environment
         and observation['payload'].get('components') == payload.get('components'), 'OBSERVATION')
    manifest = json.loads(m.read(runtime / 'deployment-manifest.json'))
    need(manifest.get('source_repo') == gate.REPO and manifest.get('source_commit') == sha
         and manifest.get('release_id') == release_id
         and manifest.get('observation_id') == observation['id']
         and manifest.get('environment') == environment and manifest.get('target') == 'xian-m4', 'MANIFEST')
    identity = json.loads(m.read(base / 'candidate-identity.json'))
    need(identity == {'source_commit': sha, 'release_id': release_id,
                      'manifest_sha256': release['manifest_sha256']}, 'CANDIDATE_IDENTITY')
    # observeDeployment persists the declaration plus release metadata; host
    # identity exists only in the measured observation, never in that file.
    measured_hostname = socket.gethostname()
    # Same xian-m4 mapping as runtime-host.mjs deploymentTarget().
    need(isinstance(measured_hostname, str) and 'm4-xian' in measured_hostname.lower().split('.')[0], 'MEASURED_HOST')
    seen, by_source, measured_files = set(), {}, []
    for row in manifest.get('files', []):
        name = row.get('deployed_path')
        need(isinstance(name, str) and not name.startswith('/') and name not in seen
             and all(part not in ('', '.', '..') for part in name.split('/')), 'MANIFEST_PATH')
        seen.add(name)
        actual_sha = m.sha(m.read(runtime / name))
        need(actual_sha == row.get('content_sha256'), 'CANDIDATE_BYTES')
        measured_files.append({**row, 'content_sha256': actual_sha})
        by_source[row['path']] = actual_sha
    observed = {'source_repo': manifest['source_repo'], 'source_commit': manifest['source_commit'],
                'files': measured_files, 'observed_hostname': measured_hostname}
    # Canonicalization sorts object keys only: the original file array order
    # is covered exactly as in collectDeployment/observeDeployment.
    need(observation['payload'].get('evidence_ref') == 'deployment-sha256:' + gate.digest(observed), 'OBSERVATION_DIGEST')
    need({'leadgen-run.sh', 'adb-managed-client.py', 'adb-existing-route.py'} <= seen, 'CANDIDATE_FILES')
    components = payload.get('components')
    need(isinstance(components, list) and components, 'COMPONENTS')
    for component in components:
        need(component.get('repo') == gate.REPO and component.get('revision') == sha
             and (component.get('kind') == 'repo' or component.get('kind') in ('code', 'skill')
                  and component.get('digest') == 'sha256:' + by_source.get(component.get('path'), '')), 'COMPONENT')
    return {'source_commit': sha, 'release_id': release_id,
            'observation_id': observation['id'], 'manifest_sha256': release['manifest_sha256']}


def admission(home,sha,release_id,gap_path=None):
    need(home.is_absolute() and home.resolve()==home and home.is_dir() and not home.is_symlink(),'HOME')
    gap=gap_evidence(gap_path)
    claim=task(home,gap) if gap['version']==2 else task(home)
    old_task(brain(home,'/api/brain/tasks/'+m.SCOPE['task_id']))
    barrier=quiet();lease=central(home,gap);installed=candidate(home,sha,release_id)
    original=home/'.local/share/zenithjoy/phone-candidate-runs'/m.SCOPE['source_commit']/'ledger'/m.SCOPE['run_id'].removesuffix('__a1')
    proof=m.verify_original(original);quiet_recorders(original);m.legacy_record(home)
    current=task(home,gap) if gap['version']==2 else task(home)
    need(current==claim and quiet()==barrier and central(home,gap)==lease
         and gap_evidence(gap_path)==gap,'ADMISSION_DRIFT')
    return {'version':1,'purpose':'retire_exact_collection_review_owner','scope':m.SCOPE,'maintenance':dict(m.TASK),'original':proof,'candidate':installed,'automatic_barrier':barrier,'central_lease':lease,'acquisition_gap':gap,
            **({k:gap[k] for k in ['current_maintenance_claim','task_lease_epoch','blocked_task_sha256']} if gap['version']==2 else {})},original

def private_directory(home):
    p=home/'.config/zenithjoy'/('collection-review-maintenance-'+m.TASK['id'])
    for ancestor in [p.parent,*p.parent.parents]:need(ancestor.is_dir() and not ancestor.is_symlink(),'JOURNAL_PARENT')
    need(p.parent.stat().st_uid==os.geteuid() and not p.parent.stat().st_mode&0o022,'JOURNAL_PARENT_OWNER');p.mkdir(mode=0o700,exist_ok=True)
    st=p.lstat();need(stat.S_ISDIR(st.st_mode) and st.st_uid==os.geteuid() and stat.S_IMODE(st.st_mode)==0o700,'JOURNAL_DIR');return p

SNAPSHOT='inventory-snapshot.json'
TOOL_FILES=('adb-existing-route.py','adb-host-service.py','adb-managed-client.py','collection-review-maintenance-contract.json','collection-review-maintenance-host.py','collection-review-maintenance-phone.py','collection-review-maintenance.py','deployment-maintenance.py','deployment-service.py','deployment-transaction.py','maintenance-install-window.py','maintenance-reopen-gate.py','maintenance-reopen-lock.py','maintenance-reopen-proof.py','phone-lock-root.py')

def tool_identity():
    # 安装目录中的source namespace与实际15文件字节同时绑定；业务candidate另存admission。
    namespaces=[p.name for p in m.HERE.parents if re.fullmatch(r'[0-9a-f]{40}',p.name)]
    need(len(namespaces)==1,'TOOL_SOURCE_NAMESPACE')
    return {'source_commit':namespaces[0],'directory':str(m.HERE),
            'files':{name:m.sha(m.read(m.HERE/name)) for name in TOOL_FILES}}

def snapshot_value(guards,authorization,identity):
    return {'version':1,'purpose':'preserve_unclassified_nontarget_422_only',
            'scope':m.SCOPE,'maintenance':m.TASK,'admission':authorization,
            'tool':identity,'contract_sha256':identity['files']['collection-review-maintenance-contract.json'],
            'owner_inode':guards.target_identity,'legacy_entries':guards.legacy_snapshot,
            'legacy_historical_diff':m.legacy_diff(guards.legacy_snapshot),
            'durable_historical_entries':m.CONTRACT['lock_state']['durable'],**current_claim_fields(authorization)}

def saved_snapshot(directory,authorization,identity):
    path=directory/SNAPSHOT
    if not os.path.lexists(path):
        # 旧意图/结果存在但快照缺失：禁止新盘点冒充原操作的baseline。
        need(not os.path.lexists(directory) or (directory.is_dir() and not directory.is_symlink() and not any(directory.iterdir())),'SNAPSHOT_MISSING_WITH_JOURNAL')
        return None,None
    st=directory.lstat();need(stat.S_ISDIR(st.st_mode) and st.st_uid==os.geteuid() and stat.S_IMODE(st.st_mode)==0o700,'JOURNAL_DIR')
    raw=m.read(path);value=json.loads(raw)
    need(isinstance(value,dict),'SAVED_SNAPSHOT_TYPE')
    need(raw==m.canonical(value) and value.get('version')==1 and value.get('scope')==m.SCOPE
         and value.get('maintenance')==m.TASK and value.get('admission')==authorization
         and value.get('tool')==identity,'SAVED_SNAPSHOT_BINDING')
    return value,raw

def execute(action,home,sha,release_id,gap_path=None):
    need(action in ['plan','apply'],'ACTION')
    def admit():return admission(home,sha,release_id,gap_path) if gap_path is not None else admission(home,sha,release_id)
    authorization,original=admit()
    directory=home/'.config/zenithjoy'/('collection-review-maintenance-'+m.TASK['id'])
    identity=tool_identity();saved_inventory,snapshot_raw=saved_snapshot(directory,authorization,identity)
    with m.OwnedGuards(home,legacy_snapshot=saved_inventory['legacy_entries'] if saved_inventory else None) as guards:
        # 同一guard内二次核准，不能用锁外快照跨越owner变化。
        need(admit()[0]==authorization,'LOCKED_ADMISSION_DRIFT')
        inventory=snapshot_value(guards,authorization,identity)
        if saved_inventory is not None:need(saved_inventory==inventory,'SAVED_SNAPSHOT_CONTENT')
        if not guards.verify():
            need(snapshot_raw is not None,'RETIRED_WITHOUT_SNAPSHOT')
            directory=home/'.config/zenithjoy'/('collection-review-maintenance-'+m.TASK['id'])
            completion=json.loads(m.read(directory/'completion.json')) if (directory/'completion.json').exists() else None
            # rename已提交但最终记录前崩溃：只读原先持久化证据，不重发输入或rename。
            saved=json.loads(m.read(directory/'pre-retirement.json'))
            need(saved.get('scope')==m.SCOPE and saved.get('maintenance')==m.TASK and saved.get('execution_stopped') is False
                 and saved.get('original_business_status')=='failed' and saved.get('admission_sha256')==m.sha(m.canonical(authorization))
                 and saved.get('inventory_snapshot_sha256')==m.sha(snapshot_raw),'PRE_RETIREMENT_SCOPE')
            need(all(saved.get(k)==v for k,v in current_claim_fields(authorization).items()),'PRE_RETIREMENT_CURRENT_CLAIM')
            need(saved.get('owner_inode')==guards.target_identity and saved.get('retirement')=={'source':m.SCOPE['serial']+'.lock','target':m.ARCHIVE,'before_sha256':m.sha(m.canonical(m.CONTRACT['lock_state']['durable'])),'after_sha256':m.sha(m.canonical(m.primitives.changed_inventory(m.CONTRACT['lock_state']['durable'],m.SCOPE['serial']+'.lock',m.ARCHIVE)))},'PRE_RETIREMENT_INODE_OR_CAS')
            desktop=saved['desktop'];need(desktop['home']['home'] is True and desktop['png_sha256']==m.sha(m.read(directory/'desktop.png'))
                 and desktop['xml_sha256']==m.sha(m.read(directory/'desktop.xml')),'PRE_RETIREMENT_EVIDENCE')
            need(desktop['leaves'] and all(e.get('code')==0 and e.get('boundary')=='darwin-sandbox-deny-process-fork-v1'
                 and type(e.get('pid')) is int and e['pid']>1 and e['intent_at']<=e['started_at']<=e['ended_at'] for e in desktop['leaves']),'PRE_RETIREMENT_LEAVES')
            final={**saved,'released':True,'archive':m.ARCHIVE,'owner':m.SCOPE['owner'],'serial':m.SCOPE['serial'],
                   'other_owners_unchanged':True,'central_lease_released':False,'old_run_modified':False,'production_promoted':False,'replayed_inputs':False}
            need(guards.verify() is False and admit()[0]==authorization
                 and m.read(directory/SNAPSHOT)==snapshot_raw and tool_identity()==identity,'RECONCILIATION_DRIFT')
            if completion is not None:need(completion==final,'COMPLETION_EVIDENCE_DRIFT')
            elif action=='apply':phone_module.atomic_new(directory/'completion.json',final)
            return final
        if action=='apply':
            directory=private_directory(home)
            if snapshot_raw is None:
                need(guards.verify(),'OWNER_NO_LONGER_ACTIVE')
                phone_module.atomic_new(directory/SNAPSHOT,inventory);snapshot_raw=m.canonical(inventory)
            need(m.read(directory/SNAPSHOT)==snapshot_raw,'SAVED_SNAPSHOT_DRIFT')
        phone=phone_module.Phone(home,original);state=phone.home_state()
        if action=='plan':
            need(guards.verify() and admit()[0]==authorization and tool_identity()==identity,'PLAN_DRIFT')
            return {**authorization,'inventory_snapshot':inventory,'home':state,'needs_new_cleanup':not state['home'],'central_lease_released':False,'execution_stopped':False}
        intent=directory/'admission.json'
        if intent.exists():need(m.read(intent)==m.canonical(authorization),'SAVED_ADMISSION_DRIFT')
        else:phone_module.atomic_new(intent,authorization)
        def revalidate():
            need(guards.verify(),'OWNER_NO_LONGER_ACTIVE');need(admit()[0]==authorization,'ADMISSION_DRIFT')
            need(m.read(directory/SNAPSHOT)==snapshot_raw and tool_identity()==identity,'SAVED_SNAPSHOT_DRIFT')
        if not state['home']:
            call=phone.command(['shell','dumpsys','telephony.registry']).decode()
            states=re.findall(r'(?m)^\s*mCallState=(\d+)\s*$',call)
            need(states and set(states)=={'0'},'PHONE_CALL_NOT_IDLE')
            state=phone.cleanup(directory,m.sha(m.canonical(authorization)),revalidate)
        elif (directory/'cleanup-intent.json').exists():
            # 既有未知写意图不能只凭HOME抹掉；成功记录必须存在且绑定同意图。
            result=json.loads(m.read(directory/'cleanup-result.json'))
            need(result.get('requests_returned') is True and result.get('intent_sha256')==m.sha(m.read(directory/'cleanup-intent.json')) and result.get('scope')==m.SCOPE,'CLEANUP_PRIOR_UNKNOWN')
        desktop=phone.capture_desktop(directory,state);revalidate()
        # 证据先持久化，再动精确owner；崩溃后可读回，不补造旧结果。
        evidence={'scope':m.SCOPE,'maintenance':m.TASK,'desktop':desktop,'admission_sha256':m.sha(m.canonical(authorization)),'execution_stopped':False,'original_business_status':'failed',
                  **current_claim_fields(authorization),'inventory_snapshot_sha256':m.sha(snapshot_raw),'owner_inode':guards.target_identity,'retirement':{'source':m.SCOPE['serial']+'.lock','target':m.ARCHIVE,
                    'before_sha256':m.sha(m.canonical(m.CONTRACT['lock_state']['durable'])),
                    'after_sha256':m.sha(m.canonical(m.primitives.changed_inventory(m.CONTRACT['lock_state']['durable'],m.SCOPE['serial']+'.lock',m.ARCHIVE)))}}
        pending=directory/'pre-retirement.json'
        if pending.exists():need(m.read(pending)==m.canonical(evidence),'PRE_RETIREMENT_DRIFT')
        else:phone_module.atomic_new(pending,evidence)
        retired=guards.retire(revalidate)
        final={**retired,**evidence,'old_run_modified':False,'production_promoted':False,'replayed_inputs':False}
        phone_module.atomic_new(directory/'completion.json',final);return final

if __name__=='__main__':
    try:
        need(len(sys.argv)==6 and sys.argv[4]=='--gap-evidence' and os.geteuid()!=0,'ARGUMENTS')
        home=Path(pwd.getpwuid(os.geteuid()).pw_dir).resolve()
        print(json.dumps(execute(sys.argv[1],home,sys.argv[2],sys.argv[3],Path(sys.argv[5])),sort_keys=True))
    except (OSError,ValueError,KeyError,subprocess.SubprocessError) as error:
        # 不输出argv、原生stderr、凭据或完整process table。
        print(type(error).__name__+': '+str(error)[:180] if isinstance(error,ValueError) else type(error).__name__,file=sys.stderr);sys.exit(1)

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
def task(home):
    t=brain(home,'/api/brain/tasks/'+m.TASK['id']);return m.verify_task(t.get('task',t))
def central(home):
    records=brain(home,'/api/brain/device-locks')['locks'];found=[x for x in records if x['device_name']==m.SCOPE['serial']]
    need(len(found)==1 and found[0]['locked_by']==m.SCOPE['task_id'] and found[0].get('expired') is False,'CENTRAL_OWNER')
    return {k:found[0][k] for k in ['device_name','locked_by','locked_at']}
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


def admission(home,sha,release_id):
    need(home.is_absolute() and home.resolve()==home and home.is_dir() and not home.is_symlink(),'HOME')
    claim=task(home);barrier=quiet();lease=central(home);installed=candidate(home,sha,release_id)
    original=home/'.local/share/zenithjoy/phone-candidate-runs'/m.SCOPE['source_commit']/'ledger'/m.SCOPE['run_id'].removesuffix('__a1')
    proof=m.verify_original(original);quiet_recorders(original);m.legacy_record(home)
    need(task(home)==claim and quiet()==barrier and central(home)==lease,'ADMISSION_DRIFT')
    return {'version':1,'purpose':'retire_exact_collection_review_owner','scope':m.SCOPE,'maintenance':claim,'original':proof,'candidate':installed,'automatic_barrier':barrier,'central_lease':lease},original

def private_directory(home):
    p=home/'.config/zenithjoy'/('collection-review-maintenance-'+m.TASK['id'])
    for ancestor in [p.parent,*p.parent.parents]:need(ancestor.is_dir() and not ancestor.is_symlink(),'JOURNAL_PARENT')
    need(p.parent.stat().st_uid==os.geteuid() and not p.parent.stat().st_mode&0o022,'JOURNAL_PARENT_OWNER');p.mkdir(mode=0o700,exist_ok=True)
    st=p.lstat();need(stat.S_ISDIR(st.st_mode) and st.st_uid==os.geteuid() and stat.S_IMODE(st.st_mode)==0o700,'JOURNAL_DIR');return p

def execute(action,home,sha,release_id):
    need(action in ['plan','apply'],'ACTION')
    authorization,original=admission(home,sha,release_id)
    with m.OwnedGuards(home) as guards:
        # 同一guard内二次核准，不能用锁外快照跨越owner变化。
        need(admission(home,sha,release_id)[0]==authorization,'LOCKED_ADMISSION_DRIFT')
        if not guards.verify():
            directory=home/'.config/zenithjoy'/('collection-review-maintenance-'+m.TASK['id'])
            completion=json.loads(m.read(directory/'completion.json')) if (directory/'completion.json').exists() else None
            # rename已提交但最终记录前崩溃：只读原先持久化证据，不重发输入或rename。
            saved=json.loads(m.read(directory/'pre-retirement.json'))
            need(saved.get('scope')==m.SCOPE and saved.get('maintenance')==m.TASK and saved.get('execution_stopped') is False
                 and saved.get('original_business_status')=='failed' and saved.get('admission_sha256')==m.sha(m.canonical(authorization)),'PRE_RETIREMENT_SCOPE')
            need(saved.get('owner_inode')==guards.target_identity and saved.get('retirement')=={'source':m.SCOPE['serial']+'.lock','target':m.ARCHIVE,'before_sha256':m.sha(m.canonical(m.CONTRACT['lock_state']['durable'])),'after_sha256':m.sha(m.canonical(m.primitives.changed_inventory(m.CONTRACT['lock_state']['durable'],m.SCOPE['serial']+'.lock',m.ARCHIVE)))},'PRE_RETIREMENT_INODE_OR_CAS')
            desktop=saved['desktop'];need(desktop['home']['home'] is True and desktop['png_sha256']==m.sha(m.read(directory/'desktop.png'))
                 and desktop['xml_sha256']==m.sha(m.read(directory/'desktop.xml')),'PRE_RETIREMENT_EVIDENCE')
            need(desktop['leaves'] and all(e.get('code')==0 and e.get('boundary')=='darwin-sandbox-deny-process-fork-v1'
                 and type(e.get('pid')) is int and e['pid']>1 and e['intent_at']<=e['started_at']<=e['ended_at'] for e in desktop['leaves']),'PRE_RETIREMENT_LEAVES')
            final={**saved,'released':True,'archive':m.ARCHIVE,'owner':m.SCOPE['owner'],'serial':m.SCOPE['serial'],
                   'other_owners_unchanged':True,'central_lease_released':False,'old_run_modified':False,'production_promoted':False,'replayed_inputs':False}
            need(guards.verify() is False and admission(home,sha,release_id)[0]==authorization,'RECONCILIATION_DRIFT')
            if completion is not None:need(completion==final,'COMPLETION_EVIDENCE_DRIFT')
            elif action=='apply':phone_module.atomic_new(directory/'completion.json',final)
            return final
        phone=phone_module.Phone(home,original);state=phone.home_state()
        if action=='plan':return {**authorization,'home':state,'needs_new_cleanup':not state['home'],'central_lease_released':False,'execution_stopped':False}
        directory=private_directory(home)
        intent=directory/'admission.json'
        if intent.exists():need(m.read(intent)==m.canonical(authorization),'SAVED_ADMISSION_DRIFT')
        else:phone_module.atomic_new(intent,authorization)
        def revalidate():
            need(guards.verify(),'OWNER_NO_LONGER_ACTIVE');need(admission(home,sha,release_id)[0]==authorization,'ADMISSION_DRIFT')
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
                  'owner_inode':guards.target_identity,'retirement':{'source':m.SCOPE['serial']+'.lock','target':m.ARCHIVE,
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
        need(len(sys.argv)==4 and os.geteuid()!=0,'ARGUMENTS')
        home=Path(pwd.getpwuid(os.geteuid()).pw_dir).resolve()
        print(json.dumps(execute(sys.argv[1],home,sys.argv[2],sys.argv[3]),sort_keys=True))
    except (OSError,ValueError,KeyError,subprocess.SubprocessError) as error:
        # 不输出argv、原生stderr、凭据或完整process table。
        print(type(error).__name__+': '+str(error)[:180] if isinstance(error,ValueError) else type(error).__name__,file=sys.stderr);sys.exit(1)

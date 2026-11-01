import re
import os
import subprocess
import time
from pathlib import Path


def ime_proven_hidden(manager,windows):
    blocks=[b for b in re.split(r'(?=^  Window #)',windows,flags=re.M) if re.match(r'^  Window #\d+ Window\{\S+ u0 InputMethod\}:',b)]
    return len(re.findall(r'^  mInputShown=false$',manager,re.M))==1 and len(blocks)==1 and 'mHasSurface=false' in blocks[0] and re.search(r'^\s+isVisible=false\s*$',blocks[0],re.M) is not None


def bootstrap_back(config,request):
    if config.get('draft') or config.get('newFormEntryIntent') or config.get('bootstrapBackIntent') or config.get('ownedMedia'): raise ValueError('BOOTSTRAP_UNSAFE_STATE')
    held(config);call_idle(config);approval(config,request)
    job=request['jobId'];package=current_package(config,job)
    screen,tree=fresh_xml(config,job)
    if package!='com.xunmeng.merchant' or context_role(package,config['lastForegroundRaw'],screen)!='list' or any(n.get('class')=='android.widget.EditText' and n.get('focused')=='true' for n in screen.nodes): raise ValueError('BOOTSTRAP_LIST_UNVERIFIED')
    final_window_guard(config,job,tree['sha256'])
    config['bootstrapBackIntent']={'jobId':job,'before':tree['path'],'at':time.time(),'commandFinished':False}
    store(Path(config['remoteRoot'])/'config.json',config)
    control_ok(config,'back',[],job+'-bootstrap-back',native_tap=True)
    config['bootstrapBackIntent']['commandFinished']=True
    store(Path(config['remoteRoot'])/'config.json',config)
    for attempt in range(2):
        if attempt:time.sleep(1.5)
        package=current_package(config,job+'-home-'+str(attempt));home,proof=fresh_xml(config,job+'-home-'+str(attempt))
        facts=home.facts()
        if facts['storeName'] is not None and facts['storeName']!=config['binding']['storeName']: raise ValueError('WRONG_STORE')
        if context_role(package,config['lastForegroundRaw'],home)=='home' and facts['storeName']==config['binding']['storeName']:
            config['storeProof']={'name':facts['storeName'],'owner':config['owner'],'runId':config['runId'],'at':time.time(),'evidence':proof['path']}
            remember_context(config,'home',config['lastForegroundRaw'],proof['path'])
            store(Path(config['remoteRoot'])/'config.json',config)
            return {'ok':True,'status':'bootstrap-home-verified','storeProof':config['storeProof'],'evidence':[tree['path'],proof['path']]}
    raise ValueError('BOOTSTRAP_DESTINATION_UNVERIFIED')


def resolve_known_back(config,request,screen,before):
    draft=config.get('draft') or {};previous=draft.get('backIntent') or {}
    if not draft.get('owned') or draft.get('owner')!=config['owner'] or not previous.get('commandFinished') or draft.get('resolvedBack') or config.get('pendingAction') or not screen.form() or any(screen.field(k)['value']!=v for k,v in draft.get('values',{}).items()): raise ValueError('KNOWN_BACK_RESOLUTION_UNVERIFIED')
    job_path=Path(config['remoteRoot'])/('job-'+previous['jobId']+'-back.json')
    job=json.loads(job_path.read_text())
    if job.get('owner')!=config['owner'] or job.get('command')!='back' or job.get('status')!='finished' or job.get('exitCode')!=0 or job.get('remoteUnknown') is not False: raise ValueError('BACK_TERMINATION_UNCONFIRMED')
    processes=subprocess.run(['ps','-axo','pid=,ppid='],capture_output=True,text=True,check=True,timeout=5).stdout
    if any(job['pid'] in tuple(map(int,line.split())) for line in processes.splitlines() if line.strip()): raise ValueError('BACK_PROCESS_STILL_EXISTS')
    manager=adb(config,['shell','dumpsys','input_method']).stdout.decode()
    windows=adb(config,['shell','dumpsys','window','windows']).stdout.decode()
    if not ime_proven_hidden(manager,windows): raise ValueError('NATIVE_IME_HIDDEN_UNCONFIRMED')
    final_window_guard(config,request['jobId'],before['sha256'])
    evidence=Path('/private/tmp/openclaw-phone/evidence')/config['profile']/('native-'+request['jobId']+'-back-resolution.json')
    proof={'priorIntent':previous,'priorJob':job,'priorJobSha256':sha(job_path.read_bytes()),'processAndChildrenAbsent':True,'inputMethodRaw':manager,'windowsRaw':windows,'currentTree':before['path'],'at':time.time(),'doesNotProvePreviousBackCause':True}
    with evidence.open('x') as stream:
        json.dump(proof,stream,ensure_ascii=False);stream.flush();os.fsync(stream.fileno())
    draft['resolvedBack']={'intent':previous,'proof':str(evidence),'sha256':sha(evidence.read_bytes())}
    draft.pop('backIntent')
    store(Path(config['remoteRoot'])/'config.json',config)
    return {'ok':True,'status':'known-back-complete-and-ime-currently-hidden','noDeviceEffect':True,'evidence':[before['path'],str(evidence)]}

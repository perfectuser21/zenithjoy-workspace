import re
import os
import subprocess
import time
from pathlib import Path


def ime_proven_hidden(manager,windows):
    blocks=[b for b in re.split(r'(?=^  Window #)',windows,flags=re.M) if re.match(r'^  Window #\d+ Window\{\S+ u0 InputMethod\}:',b)]
    return len(re.findall(r'^  mInputShown=false$',manager,re.M))==1 and len(blocks)==1 and 'mHasSurface=false' in blocks[0] and re.search(r'^\s+isVisible=false\s*$',blocks[0],re.M) is not None


def preparation_list_identity(screen, approved):
    screen.agree_list_entry(approved)
    if any(n.get('class')=='android.widget.EditText' and n.get('focused')=='true' or 'dialog' in n.get('class','').lower() or re.search(r'(?:dialog|popup|alert)',n.get('resource-id',''),re.I) for n in screen.tree.iter('node')): raise ValueError('PREPARATION_BOOTSTRAP_MODAL_OR_INPUT')
    if any(n.get('text') in {'确定','确认','取消','允许','直接退出','保存并退出'} for n in screen.tree.iter('node')): raise ValueError('PREPARATION_BOOTSTRAP_MODAL_OR_INPUT')


def preparation_bootstrap_guard(config,request,screen,before):
    # A single hardware back has no coordinate target. This exception is never used by tap or field/image actions.
    held(config)
    if adb(config,['shell','getprop','ro.serialno']).stdout.decode().strip()!=config['binding']['serial']: raise ValueError('HARDWARE_SERIAL_MISMATCH')
    approved=read_evidence(config,config['lastFrame']['evidence'][1])
    if approved['sha256']!=config['lastFrame']['xmlSha256']: raise ValueError('PREPARATION_BOOTSTRAP_APPROVAL_CHANGED')
    original=Screen(base64.b64decode(approved['bytesBase64'],validate=True).decode(),config['binding']['width'],config['binding']['height'])
    for view in (original,screen): preparation_list_identity(view,original)
    expected=config['lastFrame']['windowRaw']
    if not re.search(r'\bu\d+ com\.xunmeng\.merchant/com\.xunmeng\.merchant\.goods_management\.GoodsManagementActivity\}',expected): raise ValueError('PREPARATION_BOOTSTRAP_WRONG_ACTIVITY')
    if current_package(config,request['jobId']+'-preparation-final')!='com.xunmeng.merchant' or config['lastForegroundRaw']!=expected: raise ValueError('PREPARATION_BOOTSTRAP_WINDOW_CHANGED')
    current,tree=fresh_xml(config,request['jobId']+'-preparation-final')
    preparation_list_identity(current,original)
    held(config)
    if current_package(config,request['jobId']+'-preparation-last-focus')!='com.xunmeng.merchant' or config['lastForegroundRaw']!=expected: raise ValueError('PREPARATION_BOOTSTRAP_WINDOW_CHANGED')
    return {'approvedTree':config['lastFrame']['evidence'][1],'evidence':[before['path'],tree['path']],'onlyHardwareBack':True,'noCoordinateExemption':True}


def bootstrap_back(config,request):
    if request.get('preparationOnly') is True and config['binding'].get('materialPreparationAuthorized') is not True: raise ValueError('MATERIAL_PREPARATION_NOT_AUTHORIZED')
    if request.get('preparationOnly') is True and (config.get('storeProof') or config.get('closedContext')): raise ValueError('BOOTSTRAP_UNSAFE_STATE')
    if config.get('draft') or config.get('newFormEntryIntent') or config.get('bootstrapBackIntent') or config.get('ownedMedia'): raise ValueError('BOOTSTRAP_UNSAFE_STATE')
    held(config);call_idle(config);approval(config,request)
    job=request['jobId'];package=current_package(config,job)
    screen,tree=fresh_xml(config,job)
    if package!='com.xunmeng.merchant' or context_role(package,config['lastForegroundRaw'],screen)!='list' or any(n.get('class')=='android.widget.EditText' and n.get('focused')=='true' for n in screen.nodes): raise ValueError('BOOTSTRAP_LIST_UNVERIFIED')
    preparation_guard=preparation_bootstrap_guard(config,request,screen,tree) if request.get('preparationOnly') is True else None
    if preparation_guard is None: final_window_guard(config,job,tree['sha256'])
    config['bootstrapBackIntent']={'jobId':job,'before':tree['path'],'at':time.time(),'commandFinished':False,'preparationGuard':preparation_guard}
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
            if request.get('preparationOnly') is True:
                return {'ok':True,'status':'bootstrap-preparation-home','businessContextCreated':False,'evidence':[tree['path'],proof['path']]}
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

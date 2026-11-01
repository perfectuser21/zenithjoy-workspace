# Only the R19 tab strip and R18 native more-info button are admitted.
import re
import base64
import hashlib
import time
from pathlib import Path


def audit_clear(screen):
    for n in screen.tree.iter('node'):
        if n.get('class')=='android.widget.EditText' and n.get('focused')=='true' or re.search(r'dialog|popup|alert',n.get('class','')+' '+n.get('resource-id',''),re.I) or n.get('text') in {'确定','确认','取消','允许','直接退出','保存并退出'}:
            raise ValueError('AUDIT_MODAL_OR_INPUT')


def audit_ancestor(screen,node):
    if node.tag=='node' and (node.get('package')!=PACKAGE or node.get('enabled')!='true' or node.get('visible-to-user')=='false' or not screen.bounds(node)):
        raise ValueError('AUDIT_ANCESTOR_UNSAFE')


def audit_overlap(screen, rect, allowed, prefix):
    for n in screen.tree.iter('node'):
        box=screen.bounds(n)
        if n in allowed or not box: continue
        if max(box[0],rect[0])<min(box[2],rect[2]) and max(box[1],rect[1])<min(box[3],rect[3]) and (n.get('clickable')=='true' or n.get('text') in FORBIDDEN):
            raise ValueError(prefix+'_OVERLAP')


def audit_tab_plan(screen):
    audit_clear(screen)
    if screen.form() or len(screen.labels('商品管理'))!=1 or not {'在售中','发布中','草稿箱'}<=set(screen.facts()['counts']): raise ValueError('AUDIT_LIST_UNVERIFIED')
    bars=[n for n in screen.nodes if n.get('resource-id')=='tabWrapId']
    if len(bars)!=1: raise ValueError('AUDIT_TAB_CONTAINER_UNVERIFIED')
    bar=bars[0];box=screen.bounds(bar)
    if not box or bar.get('scrollable')!='true' or bar.get('enabled')!='true': raise ValueError('AUDIT_TAB_GEOMETRY_UNVERIFIED')
    children=list(bar);tabs=[n for n in children if n.get('class')=='android.view.View']
    expected=['在售中','已下架','已售罄','发布中','已驳回','草稿箱']
    if len(children)!=8 or children[:6]!=tabs or any(n.get('class')!='android.widget.TextView' or n.get('text','') or list(n) for n in children[6:]): raise ValueError('AUDIT_TAB_STRUCTURE_UNVERIFIED')
    if any(n.get('package')!=PACKAGE or n.get('enabled')!='true' or n.get('visible-to-user')=='false' or n.get('content-desc','') or n.get('clickable')!='false' for n in bar.iter('node')): raise ValueError('AUDIT_TAB_STRUCTURE_UNVERIFIED')
    if len(tabs)!=6: raise ValueError('AUDIT_TAB_STRUCTURE_UNVERIFIED')
    for tab,name in zip(tabs,expected):
        labels=list(tab)
        if len(labels)!=1 or labels[0].get('class')!='android.widget.TextView' or not re.fullmatch(re.escape(name)+r'\(\d+\)',labels[0].get('text','')): raise ValueError('AUDIT_TAB_STRUCTURE_UNVERIFIED')
    draft=list(tabs[-1])[0]
    if screen.bounds(draft) is not None: raise ValueError('AUDIT_SCROLL_REQUIRES_HIDDEN_DRAFT')
    if draft.get('bounds')!='[0,0][0,0]': raise ValueError('AUDIT_HIDDEN_DRAFT_UNVERIFIED')
    allowed=set(bar.iter('node'));parent=bar;clip=box[:]
    while parent in screen.parents:
        parent=screen.parents[parent]
        audit_ancestor(screen,parent)
        if parent.get('clickable')=='true': raise ValueError('AUDIT_TAB_ANCESTOR_INTERCEPTS')
        allowed.add(parent)
        outer=screen.bounds(parent)
        if outer: clip=[max(clip[0],outer[0]),max(clip[1],outer[1]),min(clip[2],outer[2]),min(clip[3],outer[3])]
    # Native labels must be wholly inside their tab and the actual ancestor clipping region.
    anchors=[]
    for tab,name in zip(tabs,expected):
        label=list(tab)[0];lb=screen.bounds(label);tb=screen.bounds(tab)
        if not lb or not tb: continue
        if not audit_contains(tb,lb): raise ValueError('AUDIT_TAB_LABEL_OUTSIDE_PARENT')
        if clip[0]<lb[0]<lb[2]<clip[2] and clip[1]<=lb[1]<lb[3]<=clip[3]:
            anchors.append({'label':name,'labelBounds':lb,'parentBounds':tb})
    if len(anchors)<2 or anchors[0]['label']!='在售中' or anchors[-1]['label']!='发布中': raise ValueError('AUDIT_TAB_COMPLETE_ANCHORS_REQUIRED')
    left,right=anchors[0]['labelBounds'],anchors[-1]['labelBounds']
    if any(a['labelBounds'][1:4:2]!=left[1:4:2] for a in anchors) or any(a['labelBounds'][2]>=b['labelBounds'][0] for a,b in zip(anchors,anchors[1:])): raise ValueError('AUDIT_TAB_BAND_UNVERIFIED')
    start=[(right[0]+right[2])//2,(right[1]+right[3])//2]
    end=[(left[0]+left[2])//2,(left[1]+left[3])//2]
    band=[end[0],left[1],start[0]+1,left[3]]
    if start[0]<=end[0] or not audit_contains(clip,band): raise ValueError('AUDIT_TAB_PATH_UNVERIFIED')
    audit_overlap(screen,band,allowed,'AUDIT_TAB')
    return {'status':'draft-tab-hidden','tabBounds':box,'visibleClip':clip,'safeBand':band,'anchors':anchors,'draftBounds':None,'from':start,'to':end,'durationMs':350}


def audit_contains(outer,inner):
    return bool(outer and inner and outer[0]<=inner[0]<inner[2]<=outer[2] and outer[1]<=inner[1]<inner[3]<=outer[3])



def audit_draft_plan(screen):
    if not any(re.fullmatch(r'草稿箱\(\d+\)',n.get('text','')) and screen.bounds(n) for n in screen.nodes): raise ValueError('AUDIT_DRAFT_TAB_NOT_VISIBLE')
    # No visible native fixture has been collected/reviewed. Never infer a tap from hidden text.
    raise ValueError('AUDIT_DRAFT_VISIBLE_FIXTURE_REQUIRED')


def audit_more_plan(screen):
    audit_clear(screen)
    labels=screen.labels('填写更多信息')
    if not screen.form() or len(labels)!=1: raise ValueError('AUDIT_MORE_LABEL_UNVERIFIED')
    label=labels[0];parent=screen.parents.get(label);children=list(parent) if parent is not None else []
    expected=[('android.widget.TextView','填写更多信息','false'),('android.widget.Image','','false'),('android.widget.Button','','true')]
    if parent is None or parent.get('class')!='android.view.View' or parent.get('clickable')!='false' or [(n.get('class'),n.get('text',''),n.get('clickable')) for n in children]!=expected or any(list(n) for n in children): raise ValueError('AUDIT_MORE_STRUCTURE_UNVERIFIED')
    button=children[2];box=screen.bounds(button);label_box=screen.bounds(label);image_box=screen.bounds(children[1]);parent_box=screen.bounds(parent)
    if not audit_contains(parent_box,box) or not audit_contains(box,label_box) or not audit_contains(box,image_box) or label_box[2]>=image_box[0] or max(label_box[1],image_box[1])>=min(label_box[3],image_box[3]) or any(n.get('package')!=PACKAGE or n.get('enabled')!='true' or n.get('visible-to-user')=='false' or n.get('content-desc','') for n in [parent,*children]): raise ValueError('AUDIT_MORE_BUTTON_UNVERIFIED')
    allowed=set(children);allowed.add(parent)
    while parent in screen.parents:
        parent=screen.parents[parent]
        audit_ancestor(screen,parent)
        if parent.get('clickable')=='true': raise ValueError('AUDIT_MORE_ANCESTOR_INTERCEPTS')
        allowed.add(parent)
    if any(screen.bounds(n) and not audit_contains(screen.bounds(n),box) for n in allowed if n not in children): raise ValueError('AUDIT_MORE_CLIPPED_BUTTON')
    audit_overlap(screen,box,allowed,'AUDIT_MORE')
    return {'label':'填写更多信息','bounds':box,'labelBounds':screen.bounds(label),'clickable':True}


def audit_once(config,key):
    if config.get('auditIntents',{}).get(key): raise ValueError('AUDIT_ACTION_ALREADY_ATTEMPTED')


def audit_navigation(config,request,screen,before,comparison):
    key={'audit-tabs':'tabs','audit-more':'more','audit-draft-tab':'draft-tab'}[request['action']]
    audit_once(config,key)
    if config.get('pendingAction') or config.get('pendingPicker'): raise ValueError('AUDIT_PENDING_ACTION')
    if key in {'tabs','draft-tab'}:
        if any(config.get(k) for k in ['draft','newFormEntryIntent','expectNewForm']): raise ValueError('AUDIT_LIST_ONLY')
        if not re.search(r'\bu\d+ com\.xunmeng\.merchant/com\.xunmeng\.merchant\.goods_management\.GoodsManagementActivity\}',config['lastForegroundRaw']): raise ValueError('AUDIT_LIST_WINDOW_UNVERIFIED')
        point=audit_tab_plan(screen) if key=='tabs' else audit_draft_plan(screen)
    else:
        draft=config.get('draft') or {}
        if draft.get('backIntent') or draft.get('discardIntent') or draft.get('exitedVerified') or not config.get('newFormEntryIntent'): raise ValueError('AUDIT_OWNED_UNSUBMITTED_FORM_REQUIRED')
        owned,owned_proof=current_owned_form(config,request['jobId'])
        if owned_proof['sha256']!=before['sha256']: raise ValueError('AUDIT_OWNED_FORM_CHANGED')
        point=audit_more_plan(screen)
    source,source_tree=audit_tab_source(config) if key=='tabs' else (screen,before)
    if key=='tabs':
        audit_agree_tabs(screen,source)
        final_window_guard(config,request['jobId'],source_tree['sha256'],audit_tabs=source)
    else: final_window_guard(config,request['jobId'],before['sha256'])
    intent={'jobId':request['jobId'],'owner':config['owner'],'window':config['lastForegroundRaw'],'before':source_tree['path'],'observedBefore':before['path'],'sourceTreeSha256':source_tree['sha256'],'approvedFrame':{k:config['lastFrame'][k] for k in ['xmlSha256','screenSha256','windowRaw']},'point':point,'commandFinished':False,'at':time.time()}
    config.setdefault('auditIntents',{})[key]=intent
    store(Path(config['remoteRoot'])/'config.json',config)
    if key=='tabs':
        args=[str(n) for n in point['from']+point['to']+[point['durationMs']]]
        control_ok(config,'audit-tabs-swipe',args,request['jobId']+'-audit',native_tap=True)
    else:
        box=point['bounds']
        control_ok(config,'tap',[str((box[0]+box[2])//2),str((box[1]+box[3])//2)],request['jobId']+'-audit',native_tap=True)
    intent.update(commandFinished=True,finishedAt=time.time())
    store(Path(config['remoteRoot'])/'config.json',config)
    # Capture only after confirmed termination; this does not assert the destination's success.
    observed=observe(config,{**request,'jobId':request['jobId']+'-readback'})
    return {'ok':True,'status':'command-finished-readback-for-review','candidate':point,'visualComparison':comparison,'destinationVerified':False,'observedFrame':observed,'evidence':[before['path']]}


def audit_swipe_args(config,args,job_id):
    intent=config.get('auditIntents',{}).get('tabs') or {}
    point=intent.get('point') or {}
    expected=[str(n) for n in point.get('from',[])+point.get('to',[])+[point.get('durationMs')]]
    if intent.get('owner')!=config['owner'] or intent.get('jobId','')+'-audit'!=job_id or intent.get('commandFinished') is not False or args!=expected or intent.get('window')!=config.get('lastForegroundRaw'): raise ValueError('AUDIT_SWIPE_INTENT_UNVERIFIED')
    frame={k:config.get('lastFrame',{}).get(k) for k in ['xmlSha256','screenSha256','windowRaw']}
    if frame!=intent.get('approvedFrame') or frame['xmlSha256']!=intent.get('sourceTreeSha256') or frame['windowRaw']!=intent.get('window'): raise ValueError('AUDIT_SWIPE_FRAME_CHANGED')
    proof=read_evidence(config,intent['before'])
    raw=base64.b64decode(proof['bytesBase64'],validate=True)
    if hashlib.sha256(raw).hexdigest()!=intent['sourceTreeSha256'] or proof['sha256']!=intent['sourceTreeSha256']: raise ValueError('AUDIT_SWIPE_SOURCE_CHANGED')
    source=Screen(raw.decode(),config['binding']['width'],config['binding']['height'])
    if audit_tab_plan(source)!=point: raise ValueError('AUDIT_SWIPE_PLAN_CHANGED')
    final_window_guard(config,job_id+'-source-bound',intent['sourceTreeSha256'],audit_tabs=source)


def audit_tab_signature(screen):
    plan=audit_tab_plan(screen)
    bar=next(n for n in screen.nodes if n.get('resource-id')=='tabWrapId')
    ancestors=[];node=bar
    while node in screen.parents:
        node=screen.parents[node]
        ancestors.append({'tag':node.tag,'attributes':dict(node.attrib)})
    import xml.etree.ElementTree as ET
    return {'plan':plan,'subtreeSha256':hashlib.sha256(ET.tostring(bar,encoding='utf-8')).hexdigest(),'ancestors':ancestors}


def audit_agree_tabs(current,approved):
    # Both complete trees are checked for modal/focus/foreign or unknown path coverage.
    left,right=audit_tab_signature(current),audit_tab_signature(approved)
    if left!=right: raise ValueError('AUDIT_TAB_APPROVAL_CHANGED')
    return left


def audit_tab_source(config):
    frame=config['lastFrame'];proof=read_evidence(config,frame['evidence'][1])
    raw=base64.b64decode(proof['bytesBase64'],validate=True)
    if proof['sha256']!=frame['xmlSha256'] or hashlib.sha256(raw).hexdigest()!=frame['xmlSha256']: raise ValueError('AUDIT_TAB_APPROVED_SOURCE_CHANGED')
    return Screen(raw.decode(),config['binding']['width'],config['binding']['height']),proof


def audit_tab_pixels(config,current_png,screen,job_id):
    approved,tree=audit_tab_source(config)
    signature=audit_agree_tabs(screen,approved)
    approved_png=read_evidence(config,config['lastFrame']['evidence'][0])
    raw=base64.b64decode(approved_png['bytesBase64'],validate=True)
    now=base64.b64decode(current_png['bytesBase64'],validate=True)
    if hashlib.sha256(raw).hexdigest()!=config['lastFrame']['screenSha256'] or approved_png['sha256']!=config['lastFrame']['screenSha256']: raise ValueError('AUDIT_TAB_APPROVED_PIXELS_CHANGED')
    box=signature['plan']['visibleClip'];size=[screen.width,screen.height]
    expected=png_crop_sha(raw,box,expected_size=size)
    if png_crop_sha(now,box,expected_size=size)!=expected: raise ValueError('AUDIT_TAB_TARGET_PIXELS_CHANGED')
    return {'mode':'audit-tabs-native-visible-clip','bounds':box,'sha256':expected,'signature':signature,'approvedTree':tree['path'],'currentImage':current_png['path'],'outsideTargetPixelsNotCompared':True,'destinationVerified':False}


def audit_final_tab_proof(config,job_id,screen,approved):
    approval(config,{'approvedScreenSha256':config['lastFrame']['screenSha256']})
    require_store(config)
    if adb(config,['shell','getprop','ro.serialno']).stdout.decode().strip()!=config['binding']['serial']: raise ValueError('HARDWARE_SERIAL_MISMATCH')
    audit_agree_tabs(screen,approved)
    eid='native-'+job_id+'-final-tab-pixels'
    control_ok(config,'snapshot-evidence',[eid],job_id+'-final-tab-image')
    png=read_evidence(config,'/private/tmp/openclaw-phone/evidence/'+config['profile']+'/'+eid+'.png')
    return audit_tab_pixels(config,png,screen,job_id)

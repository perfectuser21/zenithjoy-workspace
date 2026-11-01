# Only the R19 tab strip and R18 native more-info button are admitted.
import re
import time
from pathlib import Path


def audit_clear(screen):
    for n in screen.tree.iter('node'):
        if n.get('class')=='android.widget.EditText' and n.get('focused')=='true' or re.search(r'dialog|popup|alert',n.get('class','')+' '+n.get('resource-id',''),re.I) or n.get('text') in {'确定','确认','取消','允许','直接退出','保存并退出'}:
            raise ValueError('AUDIT_MODAL_OR_INPUT')


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
    if screen.width!=1200 or screen.height!=2664 or box!=[0,267,1200,450] or bar.get('scrollable')!='true' or bar.get('enabled')!='true': raise ValueError('AUDIT_TAB_GEOMETRY_UNVERIFIED')
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
    # The path lies in the visible tab label band, above the product cards.
    path=[120,320,1080,341]
    allowed=set(bar.iter('node'));parent=bar
    while parent in screen.parents:
        parent=screen.parents[parent]
        if parent.get('clickable')=='true': raise ValueError('AUDIT_TAB_ANCESTOR_INTERCEPTS')
        allowed.add(parent)
    audit_overlap(screen,path,allowed,'AUDIT_TAB')
    return {'status':'draft-tab-hidden','tabBounds':box,'draftBounds':None,'from':[1080,330],'to':[120,330],'durationMs':350}


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
    if screen.width!=1200 or screen.height!=2664 or screen.bounds(label)!=[432,1717,704,1776] or parent.get('clickable')!='false' or screen.bounds(parent)!=[49,1681,1149,1816] or [(n.get('class'),n.get('text',''),n.get('clickable')) for n in children]!=expected: raise ValueError('AUDIT_MORE_STRUCTURE_UNVERIFIED')
    button=children[2];box=screen.bounds(button)
    if box!=[52,1685,1146,1812] or screen.bounds(children[1])!=[713,1721,769,1776] or any(n.get('package')!=PACKAGE or n.get('enabled')!='true' or n.get('visible-to-user')=='false' or n.get('content-desc','') for n in [parent,*children]): raise ValueError('AUDIT_MORE_BUTTON_UNVERIFIED')
    allowed=set(children);allowed.add(parent)
    while parent in screen.parents:
        parent=screen.parents[parent]
        if parent.get('clickable')=='true': raise ValueError('AUDIT_MORE_ANCESTOR_INTERCEPTS')
        allowed.add(parent)
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
    final_window_guard(config,request['jobId'],before['sha256'])
    intent={'jobId':request['jobId'],'owner':config['owner'],'window':config['lastForegroundRaw'],'before':before['path'],'point':point,'commandFinished':False,'at':time.time()}
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
    if intent.get('owner')!=config['owner'] or intent.get('jobId','')+'-audit'!=job_id or intent.get('commandFinished') is not False or args!=expected or args!=['1080','330','120','330','350'] or intent.get('window')!=config.get('lastForegroundRaw'): raise ValueError('AUDIT_SWIPE_INTENT_UNVERIFIED')

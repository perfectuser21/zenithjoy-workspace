import time
import re
from pathlib import Path


def context_role(package,window,screen):
    def activity(name): return re.search(r'\bu\d+ '+re.escape(package+'/'+name)+r'\}',window)
    facts=screen.facts()
    if package=='com.xunmeng.merchant':
        if activity(package+'.ui.MainFrameTabActivity') and facts['storeName']: return 'home'
        if activity(package+'.goods_management.GoodsManagementActivity') and len(screen.labels('商品管理'))==1 and {'在售中','发布中'}<=set(facts['counts']): return 'list'
        if activity(package+'.ui.NewPageActivity'):
            try: screen.discard(); return 'discard'
            except ValueError: pass
            if all(screen.labels(x) for x in ['拍照','从手机相册选择','图片空间','取消']): return 'source'
            if facts['form']: return 'form'
        if activity(package+'.media.MultiGraphSelectorNewActivity') and screen.labels('预览'): return 'gallery'
    nodes=list(screen.tree.iter('node'))
    if package=='com.android.permissioncontroller' and activity(package+'.permission.ui.GrantPermissionsActivity') and any('拼多多商家版' in n.get('text','') and '照片和视频' in n.get('text','') for n in nodes if n.get('package')==package): return 'permission'
    if package=='com.android.providers.media.module' and activity('com.android.providers.media.photopicker.PhotoPickerUserSelectActivity') and any(n.get('resource-id')==package+':id/privacy_text' and n.get('text')=='此应用仅可访问已选择的图片和视频' for n in nodes): return 'picker'
    return 'unknown'


def save_context(config):
    store(Path(config['remoteRoot'])/'config.json',config)


def invalidate_context(config,reason):
    context=config.get('closedContext')
    if context:
        context['invalidated']=True;context['invalidReason']=reason
        save_context(config)


def remember_context(config,role,window,evidence,now=None):
    now=time.time() if now is None else now
    context=config.get('closedContext')
    proof=config.get('storeProof',{})
    identity={'owner':config['owner'],'runId':config.get('runId'),'root':config['remoteRoot']}
    if role=='home' and not config.get('newFormEntryIntent') and proof.get('name')==config['binding']['storeName'] and proof.get('owner')==identity['owner'] and proof.get('runId')==identity['runId']:
        if not context or context.get('invalidated'):
            context={**identity,'startedAt':now,'role':role,'window':window,'invalidated':False,'events':[]}
            config['closedContext']=context
    if not context: return None
    if any(context.get(k)!=v for k,v in identity.items()) or not identity['runId']:
        invalidate_context(config,'SESSION_CONTEXT_IDENTITY_CHANGED');return context
    pending=context.get('transition')
    same=role==context['role'] and window==context['window']
    expected=pending and role in pending['roles']
    if role=='unknown' or (not same and not expected):
        invalidate_context(config,'SESSION_CONTEXT_PAGE_OR_WINDOW_CHANGED');return context
    if context.get('invalidated'): return context
    if expected:
        context.pop('transition',None)
    context.update(role=role,window=window)
    context['events'].append({'role':role,'window':window,'evidence':evidence,'at':now})
    if len(context['events'])>200:
        invalidate_context(config,'SESSION_CONTEXT_EVENT_BUDGET_EXHAUSTED');return context
    save_context(config)
    return context


def require_session_context(config,role,window,evidence,now=None):
    now=time.time() if now is None else now
    limit=config['binding'].get('draftContextMaxSeconds',900)
    if type(limit) is not int or not 120<=limit<=1800 or (limit>900 and config['binding'].get('draftWritesAuthorized') is not True): raise ValueError('SESSION_CONTEXT_POLICY_UNAUTHORIZED')
    context=remember_context(config,role,window,evidence,now)
    if not context or context.get('invalidated'): raise ValueError('SESSION_CONTEXT_UNVERIFIED')
    if not 0<=now-context['startedAt']<limit:
        invalidate_context(config,'SESSION_CONTEXT_EXPIRED');raise ValueError('SESSION_CONTEXT_EXPIRED')
    if context.get('transition'): raise ValueError('SESSION_CONTEXT_TRANSITION_AWAITING_READBACK')
    return limit


def expect_context_transition(config,roles,job_id):
    context=config.get('closedContext')
    if not context or context.get('invalidated') or context.get('transition'): raise ValueError('SESSION_CONTEXT_TRANSITION_UNVERIFIED')
    if not roles or not set(roles)<={'home','list','form','source','gallery','permission','picker','discard'}: raise ValueError('SESSION_CONTEXT_TRANSITION_FORBIDDEN')
    context['transition']={'roles':roles,'jobId':job_id,'at':time.time()}
    save_context(config)

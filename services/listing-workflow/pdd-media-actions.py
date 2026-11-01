# A separate immutable bundle: no public generic tap or all-photos permission.
from datetime import datetime
from zoneinfo import ZoneInfo


def picker_current(config, request):
    held(config); call_idle(config); approval(config, request)
    package = current_package(config, request['jobId'])
    activities={MERCHANT:MERCHANT+'.media.MultiGraphSelectorNewActivity',SYSTEM_PICKER:'com.android.providers.media.photopicker.PhotoPickerUserSelectActivity',PERMISSION:PERMISSION+'.permission.ui.GrantPermissionsActivity'}
    if package not in activities or not re.search(r'\bu\d+ '+re.escape(package+'/'+activities.get(package,''))+r'\}',config['lastForegroundRaw']): raise ValueError('WRONG_PICKER_FOREGROUND')
    if config['lastForegroundRaw'] != config['lastFrame'].get('windowRaw'): raise ValueError('APPROVED_WINDOW_CHANGED')
    _, tree = fresh_xml(config, request['jobId'])
    if tree['sha256'] != config['lastFrame']['xmlSha256']: raise ValueError('APPROVED_UI_CHANGED')
    eid = 'native-' + request['jobId'] + '-picker-check'
    control_ok(config, 'snapshot-evidence', [eid], request['jobId']+'-picker-image')
    png = read_evidence(config, '/private/tmp/openclaw-phone/evidence/'+config['profile']+'/'+eid+'.png')
    current=Screen(base64.b64decode(tree['bytesBase64']).decode(),config['binding']['width'],config['binding']['height'])
    role=context_role(package,config['lastForegroundRaw'],current)
    if request['action']=='gallery-back':
        if not config.get('draft',{}).get('owned') or config.get('storeProof',{}).get('owner')!=config['owner'] or role!='gallery': raise ValueError('GALLERY_CLEANUP_CONTEXT_UNPROVEN')
        remember_context(config,role,config['lastForegroundRaw'],tree['path'])
    else:
        require_session_context(config,role,config['lastForegroundRaw'],tree['path'])
        require_store(config)
    picker=PickerTree(base64.b64decode(tree['bytesBase64']).decode(), config['binding']['width'], config['binding']['height'])
    if png['sha256'] != config['lastFrame']['screenSha256']: app_pixel_comparison(config,png,picker,request['jobId'])
    return package,picker,tree,png


def selected_identity(items):
    return sorted([{k:v for k,v in x.items() if k != 'mediaId'} for x in items], key=lambda x:(x['caption'],x['bounds']))


def picker_selected(config, picker, png):
    result = picker.selected()
    raw = base64.b64decode(png['bytesBase64'])
    for item in result: item['cropSha256'] = png_crop_sha(raw, item['bounds'], expected_size=[config['binding']['width'], config['binding']['height']])
    return result


def owned_caption(config, media_id):
    items = [x for x in config['ownedMedia'] if x.get('mediaId') == media_id and x.get('phoneVerified')]
    if len(items) != 1: raise ValueError('OWNED_PHOTO_ID_REQUIRED')
    item = items[0]
    if media_identity(config, item) != media_id or adb(config, ['shell','sha256sum',item['phonePath']]).stdout.decode().split()[0] != item['sha256']: raise ValueError('OWNED_PHOTO_CHANGED')
    timezone = adb(config,['shell','getprop','persist.sys.timezone']).stdout.decode().strip()
    if timezone != 'Asia/Shanghai': raise ValueError('PICKER_TIMEZONE_UNVERIFIED')
    raw = adb(config,['shell','content','query','--uri','content://media/external/images/media/'+media_id,'--projection','_id:datetaken']).stdout.decode()
    matches = re.findall(r'_id=(\d+), datetaken=(\d+)',raw)
    if len(matches) != 1 or matches[0][0] != media_id: raise ValueError('PHOTO_TIME_UNVERIFIED')
    second = int(matches[0][1])//1000
    unique = adb(config,['shell','content','query','--uri','content://media/external/images/media','--projection','_id','--where','datetaken >= '+str(second*1000)+' AND datetaken < '+str(second*1000+1000)]).stdout.decode()
    if re.findall(r'_id=(\d+)',unique) != [media_id]: raise ValueError('PHOTO_SECOND_NOT_UNIQUE')
    at = datetime.fromtimestamp(second,ZoneInfo(timezone))
    hour = at.hour%12 or 12
    return '拍摄于 '+str(at.year)+'年'+str(at.month)+'月'+str(at.day)+'日 '+('上午' if at.hour<12 else '下午')+str(hour)+at.strftime(':%M:%S')+'的照片'


def picker_action(config, request):
    if not config.get('draft',{}).get('owned') or config.get('pendingAction') or config.get('pendingPicker'): raise ValueError('OWNED_DRAFT_AND_RESOLVED_PICKER_REQUIRED')
    package, picker, tree, png = picker_current(config, request)
    action = request['action']
    if action == 'picker-more':
        if package != MERCHANT: raise ValueError('WRONG_PICKER_FOREGROUND')
        point = picker.gallery_control('添加更多可访问照片')
    elif action == 'picker-permission':
        if package != PERMISSION: raise ValueError('WRONG_PICKER_FOREGROUND')
        point = picker.permission_more()
    elif action == 'picker-select':
        if package != SYSTEM_PICKER: raise ValueError('WRONG_PICKER_FOREGROUND')
        media_id = request.get('mediaId')
        caption = owned_caption(config,media_id); point = picker.photo(caption)
        if point['selected']: raise ValueError('OWNED_PHOTO_ALREADY_SELECTED')
        selected = picker_selected(config,picker,png)
        grant = config.get('limitedGrant')
        if grant is None:
            picker.confirm(len(selected))
            grant = {'baseline':selected,'added':[],'targetIds':[x['mediaId'] for x in config['ownedMedia']]}
            config['limitedGrant'] = grant
        expected = grant['baseline'] + grant['added']
        if selected_identity(selected) != selected_identity(expected): raise ValueError('EXISTING_SELECTION_CHANGED')
        point['mediaId'] = media_id
    elif action == 'picker-confirm':
        if package != SYSTEM_PICKER: raise ValueError('WRONG_PICKER_FOREGROUND')
        grant = config.get('limitedGrant') or {}
        if sorted(x.get('mediaId') for x in grant.get('added',[])) != sorted(grant.get('targetIds',[])) or not grant.get('targetIds'): raise ValueError('EXACT_OWNED_GRANT_REQUIRED')
        if selected_identity(picker_selected(config,picker,png)) != selected_identity(grant['baseline']+grant['added']): raise ValueError('EXISTING_SELECTION_CHANGED')
        point = picker.confirm(len(grant['baseline'])+len(grant['added']))
        if grant.get('confirmIntent'): raise ValueError('GRANT_CONFIRM_REQUIRES_READBACK')
        grant['confirmIntent'] = {'jobId':request['jobId'],'at':time.time()}
    else: raise ValueError('FORBIDDEN_PICKER_ACTION')
    final_window_guard(config,request['jobId'],tree['sha256'],package=package)
    transitions={'picker-more':['permission','picker'],'picker-permission':['picker'],'picker-confirm':['gallery']}
    if action in transitions: expect_context_transition(config,transitions[action],request['jobId'])
    config['pendingPicker'] = {'action':action,'jobId':request['jobId'],'point':point,'before':[tree['path'],png['path']]}
    store(Path(config['remoteRoot'])/'config.json',config)
    box = point['bounds']
    control_ok(config,'tap',[str((box[0]+box[2])//2),str((box[1]+box[3])//2)],request['jobId']+'-picker-tap',native_tap=True)
    if action == 'picker-select':
        result = observe(config,dict(request,jobId=request['jobId']+'-after'))
        if result['package'] != SYSTEM_PICKER: raise ValueError('PICKER_SELECTION_DESTINATION_UNVERIFIED')
        after = PickerTree(base64.b64decode(result['tree']['bytesBase64']).decode(),config['binding']['width'],config['binding']['height'])
        after.confirm(len(grant['baseline'])+len(grant['added'])+1)
        now = picker_selected(config,after,result['picture']); added = after.photo(caption)
        old = grant['baseline']+grant['added']
        if not added['selected'] or selected_identity([x for x in now if x['caption'] != caption]) != selected_identity(old): raise ValueError('PICKER_SELECTION_READBACK_MISMATCH')
        match = [x for x in now if x['caption'] == caption]
        if len(match) != 1: raise ValueError('PICKER_SELECTION_READBACK_MISMATCH')
        grant['added'].append(dict(match[0],mediaId=media_id))
        # Comparison strips our metadata absent from the native selected list.
    config['pendingPicker'] = None
    store(Path(config['remoteRoot'])/'config.json',config)
    return {'ok':True,'action':action,'limitedGrant':config.get('limitedGrant'),'evidence':[tree['path'],png['path']]}

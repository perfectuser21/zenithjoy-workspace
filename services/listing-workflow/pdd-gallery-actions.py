# Owned-album selection. Visual bindings are trusted agent approvals, not CV identity proof.
def owned_album_inventory(config):
    album = config.get('phoneAlbum') or {}
    if not album.get('verified') or album.get('owner') != config['owner']: raise ValueError('VERIFIED_OWNED_ALBUM_REQUIRED')
    expected = [x['mediaId'] for x in config['ownedMedia']]
    rows = adb(config,['shell','content','query','--uri','content://media/external/images/media','--projection','_id','--where',"relative_path='"+album['relativePath']+"'"]).stdout.decode()
    if sorted(re.findall(r'_id=(\d+)',rows)) != sorted(expected): raise ValueError('ALBUM_MEMBERSHIP_CONFLICT')
    files = adb(config,['shell','ls','-A','--',album['path']]).stdout.decode().splitlines()
    if sorted(files) != sorted(x['name'] for x in config['ownedMedia']): raise ValueError('ALBUM_FILES_CONFLICT')
    phone_readback(config)
    return album


def gallery_candidates(config, picker, png):
    album = owned_album_inventory(config)
    images = picker.gallery_images(album['name'])
    if len(images) != len(config['ownedMedia']): raise ValueError('OWNED_GALLERY_IMAGE_COUNT_UNVERIFIED')
    raw = base64.b64decode(png['bytesBase64'])
    for image in images:
        image['contentSha256'] = png_crop_sha(raw,image['bounds'],[image['checkbox']],expected_size=[config['binding']['width'],config['binding']['height']])
        image['imageSize'] = [image['bounds'][2]-image['bounds'][0],image['bounds'][3]-image['bounds'][1]]
        image['imageSha256'] = png_crop_sha(raw,image['bounds'],expected_size=[config['binding']['width'],config['binding']['height']])
    return images


def verify_gallery_selection(selection, images):
    if sorted(x['selectedNumber'] for x in images if x['selectedNumber'] is not None) != list(range(1,len(selection)+1)): raise ValueError('GALLERY_PRIOR_IMAGE_ORDER_CHANGED')
    for item in selection:
        matches = [x for x in images if x.get('contentSha256') == item.get('contentSha256') and x.get('imageSize') == item.get('imageSize')]
        if len(matches) != 1 or not item.get('contentSha256') or matches[0]['selectedNumber'] != item['selectedNumber']: raise ValueError('GALLERY_PRIOR_IMAGE_ORDER_CHANGED')


def gallery_menu_is_open(picker, album):
    parents={child:parent for parent in picker.root.iter() for child in parent}
    rows=[]
    for node in picker.nodes:
        row=parents.get(node);container=parents.get(row)
        if node.get('package')==MERCHANT and node.get('text')==album['name'] and row is not None and container is not None and row.get('class')=='android.widget.RelativeLayout' and container.get('class')=='androidx.recyclerview.widget.RecyclerView' and picker.eligible(node) and picker.eligible(row): rows.append(row)
    if len(rows)>1: raise ValueError('GALLERY_CLEANUP_MENU_AMBIGUOUS')
    return len(rows)==1


def gallery_back_hardware(config,request,picker,tree,png):
    if config.get('pendingPicker') or config.get('galleryUploadIntent'): raise ValueError('UNRESOLVED_GALLERY_BACK_REQUIRES_READBACK')
    history=config.setdefault('galleryBackCleanup',[])
    if len(history)>=2 or (history and history[-1].get('outcome')!='menu-closed'): raise ValueError('GALLERY_BACK_ALREADY_ATTEMPTED')
    album=owned_album_inventory(config);menu=gallery_menu_is_open(picker,album)
    if history and menu: raise ValueError('GALLERY_MENU_REOPENED_DURING_CLEANUP')
    window=config['lastForegroundRaw']
    final_window_guard(config,request['jobId'],tree['sha256'])
    intent={'action':'gallery-back','jobId':request['jobId'],'before':[tree['path'],png['path']],'approvalRelation':png.get('approvalRelation'),'menuWasOpen':menu,'commandFinished':False}
    config['pendingPicker']=intent
    store(Path(config['remoteRoot'])/'config.json',config)
    expect_context_transition(config,['form','source'],request['jobId'],cleanup=True)
    receipt=control_ok(config,'back',[],request['jobId']+'-gallery-hardware-back',native_tap=True)
    intent.update(commandFinished=True,receipt=receipt)
    store(Path(config['remoteRoot'])/'config.json',config)
    after=observe(config,dict(request,jobId=request['jobId']+'-back-after'))
    if after['package']!=MERCHANT: raise ValueError('GALLERY_BACK_DESTINATION_UNVERIFIED')
    if after['facts']['form']:
        view=Screen(base64.b64decode(after['tree']['bytesBase64']).decode(),config['binding']['width'],config['binding']['height'])
        values={'title':'','groupPrice':'','inventory':'1',**config['draft']['values']}
        if after['foregroundRaw']!=config['draft']['formWindow'] or any(view.field(k)['value']!=v for k,v in values.items()) or not view.empty_carousel(): raise ValueError('GALLERY_BACK_OWNED_FORM_UNVERIFIED')
        outcome='owned-form';config['gallerySelection']=[]
    elif menu and not history and after['foregroundRaw']==window:
        now=PickerTree(base64.b64decode(after['tree']['bytesBase64']).decode(),config['binding']['width'],config['binding']['height'])
        if gallery_menu_is_open(now,album) or len(now.gallery_images(album['name']))!=len(config['ownedMedia']): raise ValueError('GALLERY_BACK_MENU_CLOSE_UNVERIFIED')
        outcome='menu-closed'
    else: raise ValueError('GALLERY_BACK_DESTINATION_UNVERIFIED')
    history.append({**intent,'outcome':outcome,'after':[after['tree']['path'],after['picture']['path']]})
    config['pendingPicker']=None
    store(Path(config['remoteRoot'])/'config.json',config)
    return {'ok':True,'action':'gallery-back','status':'owned-form-returned' if outcome=='owned-form' else 'gallery-menu-closed','outcome':outcome,'observedFrame':after,'hardwareBackOnly':True,'pddUploadVerified':False}


def gallery_action(config,request):
    action = request['action']
    if not config.get('draft',{}).get('owned') or config.get('pendingAction'): raise ValueError('OWNED_DRAFT_REQUIRED')
    if config.get('pendingPicker') and action != 'gallery-back': raise ValueError('UNRESOLVED_PICKER_ACTION')
    package,picker,tree,png = picker_current(config,request)
    if package != MERCHANT or 'MultiGraphSelectorNewActivity' not in config['lastForegroundRaw']: raise ValueError('WRONG_MERCHANT_GALLERY')
    if action=='gallery-back': return gallery_back_hardware(config,request,picker,tree,png)
    relation=png.get('approvalRelation') or {}
    if action == 'gallery-state':
        return {'approvalRelation':relation,'ok':True,'status':'visual-binding-candidates','images':gallery_candidates(config,picker,png),'sourceMedia':[{'mediaId':x['mediaId'],'name':x['name'],'sourceSha256':x['sha256']} for x in config['ownedMedia']],'evidence':[tree['path'],png['path']],'requiresTrustedVisualBinding':True}
    if action == 'gallery-menu': point = picker.gallery_control('全部图片')
    elif action == 'gallery-album':
        album = owned_album_inventory(config)
        point = picker.gallery_control(album['name'], expected_count=len(config['ownedMedia']))
    elif action == 'gallery-refresh':
        owned_album_inventory(config)
        point = picker.gallery_control('返回')
    elif action == 'gallery-select':
        images = gallery_candidates(config,picker,png)
        binding = request.get('visualBinding') or {}
        media = [x for x in config['ownedMedia'] if x['mediaId'] == binding.get('mediaId') and x['sha256'] == binding.get('sourceSha256')]
        matches = [x for x in images if x['imageSha256'] == binding.get('imageSha256')]
        selection = config.setdefault('gallerySelection',[])
        if len(media) != 1 or len(matches) != 1 or not (binding.get('approvedScreenSha256')==request.get('approvedScreenSha256')==config.get('lastFrame',{}).get('screenSha256')==relation.get('approvedScreenSha256') and relation.get('observedScreenSha256')==png['sha256'] and relation.get('approvedTreeSha256')==config.get('lastFrame',{}).get('xmlSha256') and relation.get('observedTreeSha256')==tree['sha256'] and relation.get('windowRaw')==config.get('lastFrame',{}).get('windowRaw') and relation.get('pixelComparison',{}).get('mode') in {'exact-screen-sha256','entire-app-except-native-system-status-bar'}) or media[0]['mediaId'] in [x['mediaId'] for x in selection]: raise ValueError('EXACT_TRUSTED_VISUAL_BINDING_REQUIRED')
        if matches[0]['selectedNumber'] is not None: raise ValueError('GALLERY_IMAGE_ALREADY_SELECTED')
        verify_gallery_selection(selection,images)
        point = {'bounds':matches[0]['checkbox']}
    elif action == 'gallery-upload':
        images = gallery_candidates(config,picker,png)
        selection = config.get('gallerySelection',[])
        verify_gallery_selection(selection,images)
        if [x['mediaId'] for x in selection] != [x['mediaId'] for x in config['ownedMedia']] or sorted(x['selectedNumber'] for x in images if x['selectedNumber'] is not None) != list(range(1,len(selection)+1)) or not selection: raise ValueError('EXACT_ORDERED_OWNED_SELECTION_REQUIRED')
        if config.get('galleryUploadIntent'): raise ValueError('GALLERY_UPLOAD_REQUIRES_READBACK')
        config['galleryUploadIntent'] = {'jobId':request['jobId'],'orderedMedia':selection,'at':time.time()}
        point = picker.gallery_upload(len(selection))
    else: raise ValueError('FORBIDDEN_GALLERY_ACTION')
    final_window_guard(config,request['jobId'],tree['sha256'],package=package)
    if action == 'gallery-refresh': begin_gallery_refresh(config,request['jobId'])
    if action in {'gallery-upload','gallery-back','gallery-refresh'}: expect_context_transition(config,['form','source'] if action=='gallery-back' else ['form'],request['jobId'],cleanup=action=='gallery-back')
    config['pendingPicker'] = {'action':action,'jobId':request['jobId'],'before':[tree['path'],png['path']],'approvalRelation':relation}
    store(Path(config['remoteRoot'])/'config.json',config)
    box=point['bounds']
    control_ok(config,'tap',[str((box[0]+box[2])//2),str((box[1]+box[3])//2)],request['jobId']+'-gallery-tap',native_tap=True)
    if action == 'gallery-select':
        result=observe(config,dict(request,jobId=request['jobId']+'-selected'))
        if result['package'] != MERCHANT or 'MultiGraphSelectorNewActivity' not in config['lastForegroundRaw']: raise ValueError('GALLERY_SELECTION_DESTINATION_UNVERIFIED')
        after=PickerTree(base64.b64decode(result['tree']['bytesBase64']).decode(),config['binding']['width'],config['binding']['height'])
        current=gallery_candidates(config,after,result['picture'])
        exact=[x for x in current if x['contentSha256']==matches[0]['contentSha256'] and x['imageSize']==matches[0]['imageSize'] and x['selectedNumber']==len(selection)+1]
        if len(exact)!=1 or sorted(x['selectedNumber'] for x in current if x['selectedNumber'] is not None)!=list(range(1,len(selection)+2)): raise ValueError('GALLERY_SELECTION_NATIVE_ORDER_UNVERIFIED')
        if len(exact)==1: verify_gallery_selection(selection,[x for x in current if x is not exact[0]])
        selection.append({'mediaId':media[0]['mediaId'],'sourceSha256':media[0]['sha256'],'visualBinding':binding,'approvalRelation':relation,'selectedNumber':len(selection)+1,'contentSha256':exact[0]['contentSha256'],'imageSize':exact[0]['imageSize']})
    config['pendingPicker']=None
    store(Path(config['remoteRoot'])/'config.json',config)
    return {'ok':True,'approvalRelation':relation,'action':action,'status':'command-finished-awaiting-observation','gallerySelection':config.get('gallerySelection'),'evidence':[tree['path'],png['path']],'pddUploadVerified':False,**({'observedFrame':result} if action=='gallery-select' else {})}

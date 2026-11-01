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


def gallery_action(config,request):
    action = request['action']
    if not config.get('draft',{}).get('owned') or config.get('pendingAction'): raise ValueError('OWNED_DRAFT_REQUIRED')
    if config.get('pendingPicker') and action != 'gallery-back': raise ValueError('UNRESOLVED_PICKER_ACTION')
    package,picker,tree,png = picker_current(config,request)
    if package != MERCHANT or 'MultiGraphSelectorNewActivity' not in config['lastForegroundRaw']: raise ValueError('WRONG_MERCHANT_GALLERY')
    if action == 'gallery-state':
        return {'ok':True,'status':'visual-binding-candidates','images':gallery_candidates(config,picker,png),'sourceMedia':[{'mediaId':x['mediaId'],'name':x['name'],'sourceSha256':x['sha256']} for x in config['ownedMedia']],'evidence':[tree['path'],png['path']],'requiresTrustedVisualBinding':True}
    if action == 'gallery-menu': point = picker.gallery_control('全部图片')
    elif action == 'gallery-album':
        album = owned_album_inventory(config)
        point = picker.gallery_control(album['name'])
    elif action == 'gallery-back': point = picker.gallery_control('返回')
    elif action == 'gallery-select':
        images = gallery_candidates(config,picker,png)
        binding = request.get('visualBinding') or {}
        media = [x for x in config['ownedMedia'] if x['mediaId'] == binding.get('mediaId') and x['sha256'] == binding.get('sourceSha256')]
        matches = [x for x in images if x['imageSha256'] == binding.get('imageSha256')]
        selection = config.setdefault('gallerySelection',[])
        if len(media) != 1 or len(matches) != 1 or binding.get('approvedScreenSha256') != png['sha256'] or media[0]['mediaId'] in [x['mediaId'] for x in selection]: raise ValueError('EXACT_TRUSTED_VISUAL_BINDING_REQUIRED')
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
    config['pendingPicker'] = {'action':action,'jobId':request['jobId'],'before':[tree['path'],png['path']]}
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
        selection.append({'mediaId':media[0]['mediaId'],'sourceSha256':media[0]['sha256'],'visualBinding':binding,'selectedNumber':len(selection)+1,'contentSha256':exact[0]['contentSha256'],'imageSize':exact[0]['imageSize']})
    if action == 'gallery-back':
        config['abandonedPickerAction']=config.get('pendingPicker')
        config['gallerySelection']=[]
    config['pendingPicker']=None
    store(Path(config['remoteRoot'])/'config.json',config)
    return {'ok':True,'action':action,'status':'command-finished-awaiting-observation','gallerySelection':config.get('gallerySelection'),'evidence':[tree['path'],png['path']],'pddUploadVerified':False}

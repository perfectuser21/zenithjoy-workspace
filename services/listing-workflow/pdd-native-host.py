# Bundled into the immutable per-run host namespace; no generic shell/tap RPC.

def control_ok(config, command, args, job_id, native_tap=False):
    result = execute_controller(config, command, args, job_id, native_tap=native_tap)
    if result.get('error'):
        error = ValueError(result['error'])
        error.remoteUnknown = result.get('remoteUnknown', False)
        raise error
    if re.search(r'accepted fresh|\b137\b|ERROR:', result.get('stderr', '')):
        error = ValueError('UI_PRODUCER_UNTRUSTED'); error.remoteUnknown = True
        raise error
    return result


def current_package(config, job_id):
    result = control_ok(config, 'foreground', [], job_id + '-foreground')['stdout']
    config['lastForegroundRaw'] = result
    matches = re.findall(r'\bu\d+\s+([A-Za-z0-9_.]+)/', result)
    if len(matches) != 1:
        raise ValueError('FOREGROUND_UNCONFIRMED')
    return matches[0]


def call_idle(config):
    raw = adb(config, ['shell', 'dumpsys', 'telephony.registry']).stdout.decode(errors='replace')
    config['lastCallStatesRaw'] = '\n'.join(line.strip() for line in raw.splitlines() if re.search(r'\bmCallState\s*=', line))
    states = re.findall(r'\bmCallState\s*=\s*(\d+)', raw)
    if not states or any(x != '0' for x in states):
        raise ValueError('CALL_STATE_UNSAFE')


def fresh_xml(config, job_id):
    eid = 'native-' + job_id
    result = control_ok(config, 'ui-evidence', [eid], job_id + '-xml')
    expected = '/private/tmp/openclaw-phone/evidence/' + config['profile'] + '/' + eid + '.xml'
    if expected not in result['stdout'].splitlines():
        raise ValueError('UI_EVIDENCE_PATH_UNCONFIRMED')
    raw = base64.b64decode(read_evidence(config, expected)['bytesBase64'])
    screen = Screen(raw.decode(), config['binding']['width'], config['binding']['height'])
    return screen, {'path': expected, 'sha256': sha(raw), 'bytesBase64': base64.b64encode(raw).decode()}


def require_store(config):
    proof = config.get('storeProof', {})
    if proof.get('name') != config['binding']['storeName'] or proof.get('owner') != config['owner'] or not 0 <= time.time() - proof.get('at', 0) < 900:
        raise ValueError('STORE_PROOF_UNVERIFIED_OR_EXPIRED')


def approval(config, request):
    frame = config.get('lastFrame', {})
    if frame.get('screenSha256') != request.get('approvedScreenSha256') or not frame.get('screenSha256') or not 0 <= time.time() - frame.get('at', 0) < 120:
        raise ValueError('FRESH_VISUAL_APPROVAL_REQUIRED')


def context(config, job_id, cleanup=False):
    held(config)
    call_idle(config)
    if current_package(config, job_id) != 'com.xunmeng.merchant':
        raise ValueError('WRONG_FOREGROUND')
    if not cleanup: require_store(config)
    elif config.get('storeProof', {}).get('owner') != config['owner']: raise ValueError('STORE_CLEANUP_CONTEXT_UNPROVEN')


def native_status_bar(config, job_id):
    raw=adb(config,['shell','dumpsys','window','windows']).stdout
    path=Path('/private/tmp/openclaw-phone/evidence')/config['profile']/('native-'+job_id+'-windows.txt')
    with path.open('xb') as stream:
        stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    try: parsed=parse_status_bar(raw.decode(errors='strict'),config['binding']); error=None
    except (ValueError,UnicodeError) as cause: parsed=None; error=str(cause)
    return {'native':parsed,'error':error,'path':str(path),'sha256':sha(raw),'at':time.time()}


def app_pixel_comparison(config,current_png,screen,job_id):
    current_bar=native_status_bar(config,job_id+'-os-proof')
    approved_bar=config['lastFrame'].get('statusBarProof') or {}
    packages={'com.xunmeng.merchant','com.android.permissioncontroller','com.android.providers.media.module'}
    regions=[screen.bounds(n) for n in screen.nodes if n.get('package') in packages and screen.bounds(n) and (n.get('class') in {'android.widget.EditText','android.widget.Button','android.widget.ImageView'} or n.get('clickable')=='true' or n.get('text') in {'保存草稿','保存并退出','提交并上架'} or re.fullmatch(r'[0-9]+',n.get('text','')))]
    mask=protected_status_mask(current_bar.get('native'),approved_bar.get('native'),regions)
    approved_png=read_evidence(config,config['lastFrame']['evidence'][0])
    bounds=[0,0,config['binding']['width'],config['binding']['height']]
    before=png_crop_sha(base64.b64decode(approved_png['bytesBase64']),bounds,[mask],expected_size=bounds[2:])
    now=png_crop_sha(base64.b64decode(current_png['bytesBase64']),bounds,[mask],expected_size=bounds[2:])
    if before!=now: raise ValueError('APPROVED_APP_PIXELS_CHANGED')
    return {'mode':'entire-app-except-native-system-status-bar','statusBarMask':mask,'statusBarProof':{'approved':approved_bar,'current':current_bar},'sha256':now,'evidence':current_png['path'],'transparentOverlayAbsenceProven':False}


def observe(config, request):
    call_idle(config)
    actual_serial = adb(config, ['shell', 'getprop', 'ro.serialno']).stdout.decode().strip()
    if actual_serial != config['binding']['serial']:
        raise ValueError('HARDWARE_SERIAL_MISMATCH')
    package = current_package(config, request['jobId'])
    eid = 'native-' + request['jobId']
    picture = control_ok(config, 'snapshot-evidence', [eid], request['jobId'] + '-picture')
    expected = '/private/tmp/openclaw-phone/evidence/' + config['profile'] + '/' + eid + '.png'
    if expected not in picture['stdout'].splitlines():
        raise ValueError('SCREEN_PATH_UNCONFIRMED')
    png = read_evidence(config, expected)
    header = base64.b64decode(png['bytesBase64'])
    if header[:8] != b'\x89PNG\r\n\x1a\n' or int.from_bytes(header[16:20], 'big') != config['binding']['width'] or int.from_bytes(header[20:24], 'big') != config['binding']['height']: raise ValueError('SCREEN_DIMENSION_MISMATCH')
    screen, tree = fresh_xml(config, request['jobId'])
    facts = screen.facts()
    if facts['storeName'] is not None:
        if facts['storeName'] != config['binding']['storeName']:
            raise ValueError('WRONG_STORE')
        config['storeProof'] = {'name': facts['storeName'], 'owner': config['owner'], 'at': time.time(), 'evidence': tree['path']}
    config['lastFrame'] = {'screenSha256': png['sha256'], 'xmlSha256': tree['sha256'], 'at': time.time(), 'package': package, 'windowRaw': config['lastForegroundRaw'], 'evidence': [expected, tree['path']]}
    status_bar = native_status_bar(config,request['jobId']) if package in {'com.xunmeng.merchant','com.android.permissioncontroller','com.android.providers.media.module'} else None
    if status_bar: config['lastFrame']['statusBarProof'] = status_bar
    if config.get('expectNewForm') and not config.get('draft') and config.get('emptyFormBackIntent',{}).get('commandFinished') and 'GoodsManagementActivity' in config['lastForegroundRaw'] and len(screen.labels('商品管理'))==1 and config.get('baselineCounts',{}).get('草稿箱') is not None and facts['counts'].get('草稿箱')==config['baselineCounts']['草稿箱']:
        config['emptyFormExitedVerified']=True
        config['internalAutoSaveUnknown']=True
    draft = config.get('draft', {})
    if draft.get('owned') and draft.get('discardIntent', {}).get('commandFinished') and not facts['form'] and 'GoodsManagementActivity' in config['lastForegroundRaw'] and len(screen.labels('商品管理')) == 1 and facts['counts'].get('草稿箱') is not None:
        before = config.get('baselineCounts', {}).get('草稿箱')
        if before is not None and facts['counts']['草稿箱'] == before:
            draft['exitedVerified'] = True
            draft['visibleDraftCountUnchanged'] = True
            draft['internalAutoSaveUnknown'] = True
        elif before is not None:
            draft['autoSavedPossible'] = True
    store(Path(config['remoteRoot']) / 'config.json', config)
    return {'ok': True, 'package': package, 'hardwareSerialRaw': actual_serial, 'foregroundRaw': config['lastForegroundRaw'], 'callStatesRaw': config['lastCallStatesRaw'], 'picture': png, 'tree': tree, 'statusBarRaw': read_evidence(config,status_bar['path']) if status_bar else None, 'facts': facts, 'storeProof': config.get('storeProof'), 'draft': config.get('draft'), 'frame': config['lastFrame']}


def final_window_guard(config, job_id, xml_sha, package='com.xunmeng.merchant', list_entry=None):
    held(config)
    if current_package(config,job_id+'-final-window') != package or config.get('lastForegroundRaw') != config.get('lastFrame',{}).get('windowRaw'): raise ValueError('FINAL_WINDOW_CHANGED')
    final, proof=fresh_xml(config,job_id+'-final-tree')
    if proof['sha256'] != xml_sha:
        if list_entry is None: raise ValueError('FINAL_UI_CHANGED')
        final.agree_list_entry(list_entry)
    held(config)
    if current_package(config,job_id+'-final-focus') != package or config.get('lastForegroundRaw') != config.get('lastFrame',{}).get('windowRaw'): raise ValueError('FINAL_WINDOW_CHANGED')
    return final, proof


def navigation_destination(config, label, job_id):
    for attempt in range(2):
        if attempt: time.sleep(1.5)
        destination, evidence = fresh_xml(config, job_id + '-destination-' + str(attempt))
        ready = (bool(destination.labels('商品管理')) and bool(destination.facts()['counts'])) if label == '商品管理' else destination.form()
        if ready: return destination, evidence
    raise ValueError('NAVIGATION_DESTINATION_UNVERIFIED' if label == '商品管理' else 'NEW_FORM_DESTINATION_UNVERIFIED')


def native_action(config, request):
    action, job_id = request['action'], request['jobId']
    if action == 'observe':
        return observe(config, request)
    if action == 'launch':
        call_idle(config)
        adb(config, ['shell', 'monkey', '-p', 'com.xunmeng.merchant', '-c', 'android.intent.category.LAUNCHER', '1'])
        return {'ok': True}
    context(config, job_id, cleanup=(action in {'back', 'discard-draft'}))
    if action == 'back':
        screen, before = fresh_xml(config, job_id)
        facts = screen.facts()
        empty = facts['form'] and not config.get('draft') and config.get('expectNewForm') and not config['ownedMedia'] and screen.field('title')['value']=='' and screen.field('groupPrice')['value']=='' and screen.field('inventory')['value']=='1'
        if not empty and not (facts['form'] and config.get('draft', {}).get('owned')) and not facts['counts'] and not facts['storeName']:
            raise ValueError('UNOWNED_FORM_BACK_REFUSED')
        final_window_guard(config,job_id,before['sha256'])
        if facts['form']:
            intent = {'jobId': job_id, 'before': {k:v for k,v in before.items() if k != 'bytesBase64'}, 'commandFinished':False}
            if empty: config['emptyFormBackIntent']=intent
            else: config['draft']['backIntent']=intent
            store(Path(config['remoteRoot']) / 'config.json', config)
        result = control_ok(config, 'back', [], job_id + '-back', native_tap=True)
        if empty:
            config['emptyFormBackIntent']['commandFinished']=True
            store(Path(config['remoteRoot']) / 'config.json', config)
        return {'ok': True, 'evidence': [before['path']]}
    if action == 'organize-media':
        if not config.get('draft', {}).get('owned') or config.get('pendingAction'): raise ValueError('OWNED_DRAFT_AND_RESOLVED_ACTION_REQUIRED')
        return organize_owned_album(config)
    if action == 'push-owned-media':
        if not config.get('draft', {}).get('owned') or config.get('pendingAction'): raise ValueError('OWNED_DRAFT_AND_RESOLVED_ACTION_REQUIRED')
        matches = [x for x in config['ownedMedia'] if x['name'] == request.get('name')]
        if len(matches) != 1 or matches[0].get('phonePlanned'): raise ValueError('OWNED_UNPUSHED_MEDIA_REQUIRED')
        item = matches[0]
        control_ok(config, 'media-push', [item['path'], '--name', item['name']], job_id + '-push', native_tap=True)
        return phone_readback(config)
    approval(config, request)
    screen, before = fresh_xml(config, job_id)
    list_entry = action == 'navigate' and request.get('label') == '发布商品'
    if list_entry:
        approved_tree = read_evidence(config, config['lastFrame']['evidence'][1])
        approved_screen = Screen(base64.b64decode(approved_tree['bytesBase64']).decode(), config['binding']['width'], config['binding']['height'])
        entry_point = screen.agree_list_entry(approved_screen)
    elif before['sha256'] != config['lastFrame']['xmlSha256']: raise ValueError('APPROVED_UI_CHANGED')
    if config['lastFrame'].get('windowRaw') != config.get('lastForegroundRaw'): raise ValueError('APPROVED_WINDOW_CHANGED')
    eid = 'native-' + job_id + '-approved'
    control_ok(config, 'snapshot-evidence', [eid], job_id + '-approved-image')
    current_png = read_evidence(config, '/private/tmp/openclaw-phone/evidence/' + config['profile'] + '/' + eid + '.png')
    comparison = {'mode': 'full-png-sha256', 'evidence': current_png['path']}
    if list_entry:
        approved_png = read_evidence(config, config['lastFrame']['evidence'][0])
        size = [config['binding']['width'], config['binding']['height']]
        bounds = entry_point['bounds']
        expected_digest = png_crop_sha(base64.b64decode(approved_png['bytesBase64']), bounds, expected_size=size)
        if expected_digest != png_crop_sha(base64.b64decode(current_png['bytesBase64']), bounds, expected_size=size): raise ValueError('APPROVED_LIST_ENTRY_PIXELS_CHANGED')
        comparison = {'mode': 'reversible-list-entry-target-only', 'bounds': bounds, 'sha256': expected_digest, 'evidence': current_png['path'], 'outsideTargetOverlayNotProvenAbsent': True}
    elif current_png['sha256'] != config['lastFrame']['screenSha256']:
        if action != 'navigate' or request.get('label') != '商品管理':
            comparison=app_pixel_comparison(config,current_png,screen,job_id)
        else:
            target = screen.navigate('商品管理', [])
            mask = screen.homepage_animation_mask(target)
            approved_png = read_evidence(config, config['lastFrame']['evidence'][0])
            bounds = [0, 0, config['binding']['width'], config['binding']['height']]
            current_bar = native_status_bar(config,job_id+'-current')
            approved_bar = config['lastFrame'].get('statusBarProof') or {}
            status_mask = agree_status_bar(current_bar['native'],approved_bar.get('native'),target['bounds'],mask)
            expected_digest = png_crop_sha(base64.b64decode(approved_png['bytesBase64']), bounds, [mask,status_mask], expected_size=bounds[2:])
            actual_digest = png_crop_sha(base64.b64decode(current_png['bytesBase64']), bounds, [mask,status_mask], expected_size=bounds[2:])
            if expected_digest != actual_digest: raise ValueError('APPROVED_SCREEN_CHANGED_OUTSIDE_ANIMATION')
            comparison = {'mode': 'homepage-except-native-status-bar-and-unique-marketing-icon', 'mask': mask, 'statusBarMask':status_mask, 'statusBarProof':{'approved':approved_bar,'current':current_bar}, 'sha256': actual_digest, 'evidence': current_png['path'],'transparentOverlayAbsenceProven':False}
    if action == 'discard-draft':
        draft = config.get('draft', {})
        if not draft.get('owned') or draft.get('owner') != config['owner'] or not draft.get('backIntent') or draft.get('discardIntent'): raise ValueError('OWNED_DISCARD_NOT_AUTHORIZED')
        point = screen.discard()
        final_window_guard(config,job_id,before['sha256'])
        draft['discardIntent'] = {'jobId': job_id, 'before': before['path'], 'commandFinished': False}
        store(Path(config['remoteRoot']) / 'config.json', config)
        box = point['bounds']
        control_ok(config, 'tap', [str((box[0]+box[2])//2),str((box[1]+box[3])//2)], job_id+'-discard', native_tap=True)
        draft['discardIntent']['commandFinished'] = True
        store(Path(config['remoteRoot']) / 'config.json', config)
        return {'ok': True, 'status': 'discard-command-finished-awaiting-observation', 'evidence': [before['path']]}
    if action == 'approve-draft':
        if not config.get('expectNewForm') or not screen.form() or screen.field('title')['value'] or screen.field('groupPrice')['value'] or screen.field('inventory')['value'] != '1':
            raise ValueError('NEW_EMPTY_FORM_UNVERIFIED')
        config['draft'] = {'owned': True, 'owner': config['owner'], 'baseline': {k:v for k,v in before.items() if k != 'bytesBase64'}, 'values': {}, 'exitedVerified': False}
        store(Path(config['remoteRoot']) / 'config.json', config)
        return {'ok': True, 'draft': config['draft']}
    if action == 'navigate':
        label = request['label']
        if label in {'上传图片', '从手机相册选择', '图片空间', '取消'} and not config.get('draft', {}).get('owned'):
            raise ValueError('OWNED_DRAFT_REQUIRED')
        point = screen.navigate(label, [x['name'] for x in config['ownedMedia'] if x.get('phoneVerified')])
        if label == '商品管理': screen.homepage_animation_mask(point)
        if label == '发布商品':
            config['baselineCounts'] = screen.facts()['counts']
            config['expectNewForm'] = True
        store(Path(config['remoteRoot']) / 'config.json', config)
        final_window_guard(config,job_id,before['sha256'],list_entry=screen if list_entry else None)
        rect = point['bounds']
        control_ok(config, 'tap', [str((rect[0] + rect[2]) // 2), str((rect[1] + rect[3]) // 2)], job_id + '-tap', native_tap=True)
        if label in {'商品管理', '发布商品'}:
            destination, destination_evidence = navigation_destination(config, label, job_id)
        return {'ok': True, 'label': label, 'candidate': point, 'visualComparison': comparison, 'evidence': [before['path']] + ([destination_evidence['path']] if label in {'商品管理','发布商品'} else [])}
    if action == 'set-field':
        if not config.get('draft', {}).get('owned') or config.get('pendingAction'):
            raise ValueError('OWNED_DRAFT_AND_RESOLVED_ACTION_REQUIRED')
        field, value = request['field'], request['value']
        if field not in {'title', 'groupPrice', 'inventory'} or not isinstance(value, str):
            raise ValueError('FORBIDDEN_FIELD')
        if (field == 'title' and (not value.strip() or sum(2 if ord(x) > 127 else 1 for x in value) > 60 or any(ord(x) < 32 for x in value))) or (field == 'inventory' and not re.fullmatch(r'\d{1,7}', value)) or (field == 'groupPrice' and (not re.fullmatch(r'(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?', value) or float(value) <= 0)):
            raise ValueError('INVALID_FIELD_VALUE')
        candidate = screen.field(field)
        final_window_guard(config,job_id,before['sha256'])
        config['pendingAction'] = {'field': field, 'value': value, 'before': {k:v for k,v in before.items() if k != 'bytesBase64'}, 'jobId': job_id}
        store(Path(config['remoteRoot']) / 'config.json', config)
        rect = candidate['bounds']
        control_ok(config, 'tap', [str((rect[0] + rect[2]) // 2), str((rect[1] + rect[3]) // 2)], job_id + '-focus', native_tap=True)
        focused, focus_evidence = fresh_xml(config, job_id + '-focused')
        if not focused.field(field)['focused']:
            raise ValueError('EXPECTED_NATIVE_FIELD_NOT_FOCUSED')
        final_focus,_=final_window_guard(config,job_id+'-typing',focus_evidence['sha256'])
        if not final_focus.field(field)['focused']: raise ValueError('EXPECTED_NATIVE_FIELD_NOT_FOCUSED')
        typed = control_ok(config, 'text-input', [value], job_id + '-typed', native_tap=True)
        if 'text_input=ok' not in typed['stdout']:
            raise ValueError('NATIVE_INPUT_ACK_UNCONFIRMED')
        after, after_evidence = fresh_xml(config, job_id + '-after')
        actual = after.field(field)['value']
        if actual != value:
            raise ValueError('NATIVE_READBACK_MISMATCH')
        config['draft']['values'][field] = actual
        config['pendingAction'] = None
        store(Path(config['remoteRoot']) / 'config.json', config)
        return {'ok': True, 'field': field, 'value': actual, 'evidence': [before['path'], focus_evidence['path'], after_evidence['path']], 'controller': typed}
    raise ValueError('FORBIDDEN_NATIVE_ACTION')

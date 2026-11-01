# Bundled into the immutable per-run host namespace; no generic shell/tap RPC.

def control_ok(config, command, args, job_id, native_tap=False):
    result = execute_controller(config, command, args, job_id, native_tap=native_tap)
    if result.get('error'):
        error = ValueError(result['error'])
        error.remoteUnknown = result.get('remoteUnknown', False)
        raise error
    if re.search(r'accepted fresh|\b137\b|ERROR:', result.get('stderr', '')):
        raise ValueError('UI_PRODUCER_UNTRUSTED')
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
    config['lastFrame'] = {'screenSha256': png['sha256'], 'xmlSha256': tree['sha256'], 'at': time.time(), 'package': package, 'evidence': [expected, tree['path']]}
    draft = config.get('draft', {})
    if draft.get('owned') and not facts['form'] and facts['counts'].get('草稿箱') is not None:
        before = config.get('baselineCounts', {}).get('草稿箱')
        if before is not None and facts['counts']['草稿箱'] == before:
            draft['exitedVerified'] = True
            draft['visibleDraftCountUnchanged'] = True
            draft['internalAutoSaveUnknown'] = True
        elif before is not None:
            draft['autoSavedPossible'] = True
    store(Path(config['remoteRoot']) / 'config.json', config)
    return {'ok': True, 'package': package, 'hardwareSerialRaw': actual_serial, 'foregroundRaw': config['lastForegroundRaw'], 'callStatesRaw': config['lastCallStatesRaw'], 'picture': png, 'tree': tree, 'facts': facts, 'storeProof': config.get('storeProof'), 'draft': config.get('draft'), 'frame': config['lastFrame']}


def native_action(config, request):
    action, job_id = request['action'], request['jobId']
    if action == 'observe':
        return observe(config, request)
    if action == 'launch':
        call_idle(config)
        adb(config, ['shell', 'monkey', '-p', 'com.xunmeng.merchant', '-c', 'android.intent.category.LAUNCHER', '1'])
        return {'ok': True}
    context(config, job_id, cleanup=(action == 'back'))
    if action == 'back':
        screen, before = fresh_xml(config, job_id)
        facts = screen.facts()
        if not (facts['form'] and config.get('draft', {}).get('owned')) and not facts['counts'] and not facts['storeName']:
            raise ValueError('UNOWNED_FORM_BACK_REFUSED')
        result = control_ok(config, 'back', [], job_id + '-back', native_tap=True)
        return {'ok': True, 'evidence': [before['path']]}
    if action == 'push-owned-media':
        if not config.get('draft', {}).get('owned') or config.get('pendingAction'): raise ValueError('OWNED_DRAFT_AND_RESOLVED_ACTION_REQUIRED')
        matches = [x for x in config['ownedMedia'] if x['name'] == request.get('name')]
        if len(matches) != 1 or matches[0].get('phonePlanned'): raise ValueError('OWNED_UNPUSHED_MEDIA_REQUIRED')
        item = matches[0]
        control_ok(config, 'media-push', [item['path'], '--name', item['name']], job_id + '-push', native_tap=True)
        return phone_readback(config)
    approval(config, request)
    eid = 'native-' + job_id + '-approved'
    control_ok(config, 'snapshot-evidence', [eid], job_id + '-approved-image')
    current_png = read_evidence(config, '/private/tmp/openclaw-phone/evidence/' + config['profile'] + '/' + eid + '.png')
    if current_png['sha256'] != config['lastFrame']['screenSha256']: raise ValueError('APPROVED_SCREEN_CHANGED')
    screen, before = fresh_xml(config, job_id)
    if before['sha256'] != config['lastFrame']['xmlSha256']: raise ValueError('APPROVED_UI_CHANGED')
    if action == 'approve-draft':
        if not config.get('expectNewForm') or not screen.form() or screen.field('title')['value'] or screen.field('groupPrice')['value'] or screen.field('inventory')['value'] != '1':
            raise ValueError('NEW_EMPTY_FORM_UNVERIFIED')
        config['draft'] = {'owned': True, 'owner': config['owner'], 'baseline': before, 'values': {}, 'exitedVerified': False}
        store(Path(config['remoteRoot']) / 'config.json', config)
        return {'ok': True, 'draft': config['draft']}
    if action == 'navigate':
        label = request['label']
        if label in {'上传图片', '从手机相册选择', '图片空间', '取消'} and not config.get('draft', {}).get('owned'):
            raise ValueError('OWNED_DRAFT_REQUIRED')
        point = screen.navigate(label, [x['name'] for x in config['ownedMedia'] if x.get('phoneVerified')])
        if label == '发布商品':
            config['baselineCounts'] = screen.facts()['counts']
            config['expectNewForm'] = True
        store(Path(config['remoteRoot']) / 'config.json', config)
        rect = point['bounds']
        control_ok(config, 'tap', [str((rect[0] + rect[2]) // 2), str((rect[1] + rect[3]) // 2)], job_id + '-tap', native_tap=True)
        return {'ok': True, 'label': label, 'candidate': point, 'evidence': [before['path']]}
    if action == 'set-field':
        if not config.get('draft', {}).get('owned') or config.get('pendingAction'):
            raise ValueError('OWNED_DRAFT_AND_RESOLVED_ACTION_REQUIRED')
        field, value = request['field'], request['value']
        if field not in {'title', 'groupPrice', 'inventory'} or not isinstance(value, str):
            raise ValueError('FORBIDDEN_FIELD')
        if (field == 'title' and (not value.strip() or len(value) > 60 or any(ord(x) < 32 for x in value))) or (field == 'inventory' and not re.fullmatch(r'\d{1,7}', value)) or (field == 'groupPrice' and (not re.fullmatch(r'(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?', value) or float(value) <= 0)):
            raise ValueError('INVALID_FIELD_VALUE')
        candidate = screen.field(field)
        config['pendingAction'] = {'field': field, 'value': value, 'before': before, 'jobId': job_id}
        store(Path(config['remoteRoot']) / 'config.json', config)
        rect = candidate['bounds']
        control_ok(config, 'tap', [str((rect[0] + rect[2]) // 2), str((rect[1] + rect[3]) // 2)], job_id + '-focus', native_tap=True)
        focused, focus_evidence = fresh_xml(config, job_id + '-focused')
        if not focused.field(field)['focused']:
            raise ValueError('EXPECTED_NATIVE_FIELD_NOT_FOCUSED')
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

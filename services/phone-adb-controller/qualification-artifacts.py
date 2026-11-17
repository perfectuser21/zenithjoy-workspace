"""Read-only qualification originals; migrated from the frozen r10 verifier."""
import array
import hashlib
import json
from pathlib import Path
import re
import sys
import wave
from urllib.parse import urlparse


def asset(spec):
    p = Path(spec['path'])
    if not p.is_absolute() or not p.is_file() or p.is_symlink():
        raise ValueError('ASSET_PATH_UNVERIFIED')
    if p.stat().st_size > 30 * 1024 * 1024:
        raise ValueError('ASSET_TOO_LARGE')
    raw = p.read_bytes()
    if hashlib.sha256(raw).hexdigest() != spec.get('sha256'):
        raise ValueError('ASSET_HASH_MISMATCH')
    return p, raw


def json_asset(spec):
    return json.loads(asset(spec)[1])


def fields(receipt):
    if receipt.get('exit_code') != 0:
        raise ValueError('NATIVE_OPERATION_NOT_SUCCESSFUL')
    return dict(re.findall(r'([A-Za-z_][A-Za-z_0-9]*)=([^\s]+)', receipt.get('stdout', '')))


def asr_classification(response):
    if not isinstance(response, dict):
        return 'unknown'
    body = response.get('body', {})
    if not isinstance(body, dict) or not isinstance(body.get('request_id'), str) or not body['request_id'].strip():
        return 'unknown'
    if response.get('http_status') == 400 and body.get('code') == 'CLIENT_ERROR' and body.get('message') == 'ASR_RESPONSE_HAVE_NO_WORDS':
        return 'no_speech'
    if response.get('http_status') != 200:
        return 'technical_error'
    if body.get('code') not in (None, '', 'Success', 'SUCCESS'):
        return 'technical_error'
    outer = body.get('output')
    if not isinstance(outer, dict):
        return 'unknown'
    for output in (outer, outer.get('output')):
        if not isinstance(output, dict):
            continue
        text = output.get('text')
        if isinstance(text, str) and text.strip():
            return 'transcribed'
        sentence = output.get('sentence')
        text = sentence.get('text') if isinstance(sentence, dict) else None
        if isinstance(text, str) and text.strip():
            return 'transcribed'
    return 'unknown'


def native_video_identity(spec):
    receipt=json_asset(spec['video_identity']);args=receipt.get('args',[])
    if len(args)!=2 or args[0]!='current-video-link' or not args[1].startswith(spec['expected_run']+'-'):
        raise ValueError('NATIVE_LINK_REQUEST_SCOPE')
    if receipt.get('exit_code')==0:
        # Parse emitted native identity fields, never a convenient URL substring.
        values={}
        for line in receipt.get('stdout','').splitlines():
            match=re.fullmatch(r'([A-Za-z_][A-Za-z_0-9]*)=(.*)',line)
            if not match:continue
            key,value=match.groups()
            if key in values:raise ValueError('NATIVE_LINK_DUPLICATE_FIELD')
            values[key]=value
        observed=values.get('video_id','')
        if (not re.fullmatch(r'\d{16,24}',observed)
            or values.get('content_id')!=observed or values.get('content_type')!='video'):
            raise ValueError('NATIVE_LINK_ID_FIELDS')
        resolved=urlparse(values.get('resolved_url',''))
        if resolved.scheme!='https' or resolved.netloc not in ('www.douyin.com','www.iesdouyin.com'):
            raise ValueError('NATIVE_LINK_RESOLVED_HOST')
        route=re.fullmatch(r'/(?:share/)?video/(\d{16,24})/?',resolved.path)
        if not route or route.group(1)!=observed:raise ValueError('NATIVE_LINK_RESOLVED_ID')
        if 'reopen_url' in values and values['reopen_url']!='snssdk1128://aweme/detail/'+observed:
            raise ValueError('NATIVE_LINK_REOPEN_ID')
        return observed==spec['video_id']
    raise ValueError('NATIVE_LINK_NOT_SUCCESSFUL')


def recording(spec):
    result = {'capture_or_valid_cache': 'unknown', 'asr_error_classification': 'unknown',
              'native_video_identity': 'unknown'}
    try:
        start_receipt = json_asset(spec['start'])
        stop_receipt = json_asset(spec['stop'])
        start = fields(start_receipt)
        stop = fields(stop_receipt)
        eid = spec['evidence_id']
        if not eid.startswith(spec['expected_run'] + '-'):
            raise ValueError('RECORDING_SCOPE_MISMATCH')
        args = start_receipt.get('args', [])
        if (len(args) != 4 or args[:2] != ['record-start', eid]
                or args[3] != spec['video_id'] or not isinstance(args[2], str)
                or not re.fullmatch(r'[1-9]\d{0,2}', args[2]) or int(args[2]) > 300
                or stop_receipt.get('args') != ['record-stop', eid]):
            raise ValueError('RECORDING_NATIVE_REQUEST_MISMATCH')
        # VID comes from the actual four-argument request and strict native
        # identity original. A filename alone cannot establish video identity.
        if not native_video_identity(spec):
            raise ValueError('NATIVE_VIDEO_IDENTITY_UNVERIFIED')
        if any(Path(r.get('path', '')).name != eid + '.rec.mkv' for r in [start, stop]):
            raise ValueError('RECORDING_FILE_IDENTITY_MISMATCH')
        sidecars = spec['sidecars']
        for receipt in [start, stop]:
            if receipt.get('capture_audio_mode') != 'playback_dup' or int(receipt.get('capture_audio_sdk', 0)) < 33:
                raise ValueError('CAPTURE_STRATEGY_UNSUPPORTED')
            if receipt.get('playback_proof_kind') != 'native_audio' or receipt.get('playback_package') != 'com.ss.android.ugc.aweme':
                raise ValueError('NATIVE_PACKAGE_UNVERIFIED')
            if receipt.get('native_audio_state') != 'started' or receipt.get('native_audio_foreign_started') != '0':
                raise ValueError('NATIVE_TRACK_STATE_UNVERIFIED')
            if receipt.get('capture_runtime_client_sha256') != spec['client_sha256'] or receipt.get('capture_runtime_server_sha256') != spec['server_sha256']:
                raise ValueError('CAPTURE_RUNTIME_MISMATCH')
            for key, name in receipt.items():
                if not key.endswith('_file'):
                    continue
                sha_key = key[:-5] + '_sha256'
                if key == 'capture_runtime_evidence_file':
                    sha_key = 'capture_runtime_evidence_sha256'
                if sha_key not in receipt:
                    continue
                p, raw = asset(sidecars[name])
                if p.name != name or hashlib.sha256(raw).hexdigest() != receipt[sha_key]:
                    raise ValueError('NATIVE_SIDECAR_MISMATCH')
            uid = receipt['native_audio_uid']
            owners = asset(sidecars[receipt['native_audio_uid_owners_file']])[1].decode().strip()
            if owners != 'package:com.ss.android.ugc.aweme uid:' + uid:
                raise ValueError('NATIVE_UID_AMBIGUOUS')
            audio = asset(sidecars[receipt['native_audio_evidence_file']])[1].decode()
            active = [line for line in audio.splitlines() if 'AudioPlaybackConfiguration ' in line and 'state:started' in line]
            if len(active) != 1 or 'u/pid:' + uid + '/' + receipt['native_audio_pid'] not in active[0] or 'mutedState:none' not in active[0]:
                raise ValueError('NATIVE_ACTIVE_TRACK_UNVERIFIED')
            foreground = asset(sidecars[receipt['playback_foreground_file']])[1].decode()
            if 'com.ss.android.ugc.aweme/' not in foreground:
                raise ValueError('NATIVE_FOREGROUND_UNVERIFIED')
        sdk = asset(sidecars[start['capture_audio_sdk_evidence_file']])[1].decode().strip()
        if sdk != start['capture_audio_sdk'] or sdk != stop['capture_audio_sdk']:
            raise ValueError('SDK_ORIGINAL_MISMATCH')
        if stop.get('audio_streams') != '1':
            raise ValueError('CAPTURE_AUDIO_TRACK_COUNT')
        runtime = json_asset(sidecars[start['capture_runtime_evidence_file']])
        if runtime.get('stage', {}).get('evidence_id') != eid:
            raise ValueError('CAPTURE_STAGE_EVIDENCE_MISMATCH')
        if runtime.get('stage', {}).get('serial') != spec['serial'] or runtime.get('stage', {}).get('owner') != spec['local_owner'] or runtime.get('stage', {}).get('execution_stop_unknown') is not False:
            raise ValueError('CAPTURE_STAGE_OWNER_UNVERIFIED')
        wav_path, wav_bytes = asset(spec['wav'])
        with wave.open(str(wav_path), 'rb') as w:
            if (w.getframerate(), w.getnchannels(), w.getsampwidth()) != (16000, 1, 2):
                raise ValueError('PCM_FORMAT_UNVERIFIED')
            seconds = w.getnframes() / w.getframerate()
            if not 0 < spec['required_seconds'] <= seconds <= 300:
                raise ValueError('AUDIO_COVERAGE_UNVERIFIED')
            samples = array.array('h', w.readframes(w.getnframes()))
        if not samples or max(abs(v) for v in samples) == 0:
            raise ValueError('DIGITAL_SILENCE')
        result.update(capture_or_valid_cache='passed', audio_seconds=seconds,
                      nonzero_pcm=True, audio_sha256=hashlib.sha256(wav_bytes).hexdigest())
        if spec.get('asr'):
            if spec.get('asr_audio_sha256') != result['audio_sha256']:
                raise ValueError('ASR_AUDIO_IDENTITY_MISMATCH')
            classification = asr_classification(json_asset(spec['asr']))
            result['asr_classification'] = classification
            result['asr_error_classification'] = 'passed' if classification != 'unknown' else 'unknown'
        # A filename or open-video input is never proof of the actual current VID.
        if spec.get('video_identity'):
            if native_video_identity(spec):result['native_video_identity']='passed'
    except (ValueError, KeyError, OSError, wave.Error) as e:
        result['reason'] = str(e)
    return result


def canonical_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                    separators=(',', ':')).encode()).hexdigest()


def assert_recovery_action(c, activity, kind, args):
    r = c.get('recovery', {})
    if r.get('mode') != 'qualification-readonly-v1':
        raise ValueError('QUALIFICATION_RECOVERY_MODE_REQUIRED')
    producer = r['producer']
    current = c['tasks']['102']
    original = json_asset(r['producer_manifest'])
    bound = original.get('identity', {})
    if (original.get('schema') != 'activity-evidence/v1' or bound.get('workflow') != '102'
            or producer.get('run_tag') != current['run_tag']
            or any(bound.get(k) != producer.get(k) for k in ['task_id', 'run_id', 'run_tag'])
            or any(producer.get(k) == current.get(k) for k in ['task_id', 'run_id'])):
        raise ValueError('QUALIFICATION_RECOVERY_PRODUCER_MISMATCH')
    if activity == 'qualification':
        if kind == 'proof' and len(args) == 1 and canonical_digest(json.loads(args[0])) == r['proof_sha256']:
            return
        if kind == 'business' and len(args) == 1 and json.loads(args[0]).get('op') == 'inspect_videos':
            return
        raise ValueError('QUALIFICATION_RECOVERY_READ_ONLY')
    run = current['run_tag']
    collection = r['collection']
    if (collection.get('video_id') not in c['verification']['102']['video_ids']
            or type(collection.get('person_index')) is not int
            or not 1 <= collection['person_index'] <= 9007199254740991):
        raise ValueError('QUALIFICATION_RECOVERY_COLLECTION_SCOPE')
    canonical = run + '-v' + collection['video_id'] + '-collection-'
    index = str(collection['person_index'])
    pattern = re.escape(canonical) + r'(?:person' + index + r'-t[123]|after-card' + index + r')'
    def admitted(value, file=False):
        if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_.-]+', value):
            return False
        if value in r.get('protected_basenames', []):
            return False
        suffix = r'(?:[-.][A-Za-z0-9_.-]+)?' if file else ''
        return (value.startswith(run + '-resume1-')
                or bool(re.fullmatch(pattern + suffix, value)))
    if kind == 'fetch-native':
        if len(args) != 1 or not admitted(args[0], True):
            raise ValueError('QUALIFICATION_RECOVERY_FETCH_SCOPE')
        target = Path(r['output_root']) / args[0]
        if target.exists() or target.is_symlink():
            raise ValueError('QUALIFICATION_RECOVERY_OUTPUT_EXISTS')
    if kind == 'phone':
        positions = {'account-current': 1, 'snapshot-evidence': 1, 'ui-evidence': 1,
                     'evidence-bundle': 1, 'search-video-tab': 1, 'search-time-layer': 2,
                     'search-video-cards': 1, 'tap-evidence': 3, 'current-video-link': 1,
                     'open-video': 2, 'record-start': 1, 'record-status': 1, 'record-stop': 1,
                     'record-extract-audio': 1, 'native-audio-evidence': 1, 'open-comments': 1,
                     'collect-comments': 1, 'commenter-identity': 4, 'back-to-results': 1,
                     'back-evidence': 1, 'swipe-evidence': 6}
        command = args[0] if args else ''
        if command in positions:
            at = positions[command]
            if len(args) <= at or not admitted(args[at]):
                raise ValueError('QUALIFICATION_RECOVERY_NATIVE_SCOPE')
            if command != 'record-status' and any(Path(c['native_root']).glob(args[at] + '*')):
                raise ValueError('QUALIFICATION_RECOVERY_NATIVE_EXISTS')


if __name__ == '__main__':
    try:
        request = json.load(sys.stdin)
        if request['kind'] == 'recording':
            result = recording(request['spec'])
        elif request['kind'] == 'recovery_guard':
            assert_recovery_action(request['context'], request['activity'], request['tool_kind'], request['args'])
            result = {'allowed': True}
        else:
            raise ValueError('QUALIFICATION_REQUEST_KIND')
        print(json.dumps(result))
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(json.dumps({'error': str(error)}))
        sys.exit(2)

"""Strict SDK34 card controls and replayable, same-recipient link evidence."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import subprocess
import time
import xml.etree.ElementTree as E

PKG = 'com.ss.android.ugc.aweme'
def need(value):
    if not value:
        raise ValueError('PROFILE_CARD_LINK_UNVERIFIED')
def nodes(raw):
    need(not re.search(r'<!DOCTYPE|<!ENTITY', raw, re.I))
    root = E.fromstring(raw)
    ns = list(root.iter('node'))
    need(root.tag == 'hierarchy' and ns and all(n.get('package') == PKG for n in ns))
    return root, ns
def bounds(n):
    m = re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', n.get('bounds', ''))
    need(m)
    b = tuple(map(int, m.groups()))
    need(0 <= b[0] < b[2] <= 720 and 0 <= b[1] < b[3] <= 1280)
    return b
def center(n):
    b = bounds(n)
    return f'{(b[0]+b[2])//2} {(b[1]+b[3])//2}'
def profile(raw, uid, nick, menu=False):
    _, ns = nodes(raw)
    ids = {n.get('text', '')[4:] for n in ns if n.get('text', '').startswith('抖音号：')}
    if menu:
        ids.update(n.get('text', '')[5:] for n in ns if n.get('resource-id') == PKG+':id/xm=' and n.get('text', '').startswith('抖音号: '))
    need(ids == {uid} and any(n.get('text') == nick for n in ns))
def panel(raw):
    spec = importlib.util.spec_from_file_location('comment_compose', Path(__file__).with_name('comment-compose-rows.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    value = module.compose_panel(raw)
    need(value)
    return value
def select(mode, raw, uid, nick, body):
    root, ns = nodes(raw)
    if mode == 'profile':
        profile(raw, uid, nick)
        return 'verified'
    if mode == 'comment':
        rows = [r for r in panel(raw)['rows'] if not r['author'] and r['nickname'] == nick and hashlib.sha256(r['body'].encode()).hexdigest() == body]
        need(len(rows) == 1)
        return rows[0]['x']+' '+rows[0]['y']
    if mode == 'more':
        profile(raw, uid, nick)
        selected = [n for n in ns if n.get('content-desc') == '更多' and n.get('clickable') == 'true' and n.get('enabled') == 'true']
    elif mode == 'share':
        profile(raw, uid, nick, menu=True)
        labels = [n for n in ns if n.get('text') == '分享名片']
        need(len(labels) == 1)
        parents = {n:p for p in root.iter() for n in p}
        n = labels[0]
        while n is not None and n.get('clickable') != 'true':
            n = parents.get(n)
        need(n is not None and n.get('enabled') == 'true')
        selected = [n]
    elif mode == 'copy':
        need(sum(n.get('text') == '分享给' for n in ns) == 1)
        selected = [n for n in ns if n.get('content-desc') == '复制链接' and n.get('text', '') in ('', '复制链接') and n.get('clickable') == 'true' and n.get('enabled') == 'true']
    elif mode in ('field', 'link'):
        selected = [n for n in ns if n.get('resource-id') == PKG+':id/et_search_kw']
        need(len(selected) == 1)
        n = selected[0]
        need(n.get('class') == 'android.widget.EditText' and n.get('enabled') == 'true' and n.get('clickable') == 'true' and n.get('password') == 'false')
        bounds(n)
        if mode == 'link':
            need(n.get('focused') == 'true')
            urls = re.findall(r'https?://[^\s]+', n.get('text', ''))
            need(len(urls) == 1 and re.fullmatch(r'https://v\.douyin\.com/[A-Za-z0-9_-]+/', urls[0]))
            return urls[0]
    else:
        raise ValueError('PROFILE_CARD_MODE')
    need(len(selected) == 1)
    return center(selected[0])
def verify(proof, expected):
    scope = proof['scope']; raw = proof['raw']
    need(proof.get('schema') == 'native-profile-card-link/v1' and scope.get('sdk') == 34)
    for k in ('video_id', 'douyin_id', 'nickname', 'comment_body_sha256', 'profile'):
        need(scope.get(k) == expected[k])
    need(scope['evidence_id'].startswith(expected['run']+'-resume1-'))
    for key, text in raw.items():
        need(hashlib.sha256(text.encode()).hexdigest() == proof['sha256'].get(key))
    uid, nick, body = scope['douyin_id'], scope['nickname'], scope['comment_body_sha256']
    select('comment', raw['comments'], uid, nick, body)
    select('more', raw['profile'], uid, nick, body)
    select('share', raw['more'], uid, nick, body)
    select('copy', raw['share'], uid, nick, body)
    select('field', raw['scratch_before'], uid, nick, body)
    url = select('link', raw['scratch_pasted'], uid, nick, body)
    need(url == proof['profile_url'] and proof.get('reopen_url') == url)
    action = proof['reopen_action']
    need(action['exit_code'] == 0 and action['url'] == url and action['package'] == PKG)
    need(action['argv'][1:] == ['-s', action['serial'], 'shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', url, '-p', PKG])
    need(not re.search(r'Error|Exception|unable to resolve|unable to start', action['stdout']+'\n'+action['stderr'], re.I))
    need(proof['observed_ctime_ns']['reopened'] >= action['ended_ns'])
    profile(raw['reopened'], uid, nick)
    select('comment', raw['returned'], uid, nick, body)
    link = proof['video_identity']
    fields = dict(re.findall(r'^([A-Za-z_][A-Za-z_0-9]*)=(.*)$', link.get('stdout', ''), re.M))
    need(link.get('exit_code') == 0 and link.get('args') == ['current-video-link', scope['evidence_id']+'-verify-video'])
    need(fields.get('video_id') == scope['video_id'] and fields.get('content_id') == scope['video_id'] and fields.get('content_type') == 'video' and fields.get('resolved_url') == 'https://www.douyin.com/video/'+scope['video_id'])
    return {'profile_url':url}
def main():
    mode = sys.argv[1]
    if mode == 'verify':
        request = json.load(sys.stdin)
        print(json.dumps(verify(request['proof'], request['expected'])))
        return
    source, uid, encoded, body = sys.argv[2:6]
    nick = base64.b64decode(encoded, validate=True).decode()
    if mode == 'reopen':
        eid, adb, serial, url = sys.argv[6:10]
        need(re.fullmatch(r'https://v\.douyin\.com/[A-Za-z0-9_-]+/', url))
        argv = [adb, '-s', serial, 'shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', url, '-p', PKG]
        started = time.time_ns()
        result = subprocess.run(argv, capture_output=True, text=True, timeout=30)
        receipt = {'argv':argv,'serial':serial,'url':url,'package':PKG,'started_ns':started,'ended_ns':time.time_ns(),'exit_code':result.returncode,'stdout':result.stdout,'stderr':result.stderr}
        with (Path(source)/(eid+'-reopen-action.json')).open('x') as f:
            json.dump(receipt, f)
        need(result.returncode == 0 and not re.search(r'Error|Exception|unable to resolve|unable to start', result.stdout+'\n'+result.stderr, re.I))
        return
    if mode != 'pack':
        print(select(mode, Path(source).read_text(), uid, nick, body))
        return
    eid, vid, profile_name, controller = sys.argv[6:10]
    root = Path(source)
    suffixes = {'comments':'comments','profile':'profile','more':'more','share':'share','scratch_before':'scratch-before','scratch_pasted':'scratch-pasted','reopened':'reopened','returned':'restored-comments'}
    raw = {k:(root/(eid+'-'+s+'.xml')).read_text() for k,s in suffixes.items()}
    stdout = (root/(eid+'-video-identity.txt')).read_text()
    url = select('link', raw['scratch_pasted'], uid, nick, body)
    proof = {'schema':'native-profile-card-link/v1','scope':{'evidence_id':eid,'video_id':vid,'douyin_id':uid,'nickname':nick,'comment_body_sha256':body,'profile':profile_name,'sdk':34},'raw':raw,'sha256':{k:hashlib.sha256(v.encode()).hexdigest() for k,v in raw.items()},'profile_url':url,'reopen_url':url,'reopen_action':json.loads((root/(eid+'-reopen-action.json')).read_text()),'observed_ctime_ns':{k:(root/(eid+'-'+v+'.xml')).stat().st_ctime_ns for k,v in suffixes.items()},'helper_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'controller_sha256':hashlib.sha256(Path(controller).read_bytes()).hexdigest(),'video_identity':{'exit_code':0,'args':['current-video-link',eid+'-verify-video'],'stdout':stdout}}
    verify(proof, {**proof['scope'], 'run':eid.split('-resume1-', 1)[0]})
    target = root/(eid+'-profile-link-proof.json')
    with target.open('x') as f:
        json.dump(proof, f, ensure_ascii=False)
    print('profile_url='+url+'\nprofile_link_evidence='+str(target)+'\nprofile_link_evidence_sha256='+hashlib.sha256(target.read_bytes()).hexdigest())
if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('PROFILE_CARD_LINK_UNVERIFIED', file=sys.stderr)
        sys.exit(2)

#!/usr/bin/env python3
"""公众号图文发布（官方 API）：素材上传→草稿→freepublish（发布到主页，不推送粉丝）"""
import json
import mimetypes
import os
import sys
import time
import urllib.request
import uuid

API = 'https://api.weixin.qq.com/cgi-bin'


def _get(url):
    with urllib.request.urlopen(url, timeout=20) as r:
        return json.load(r)


def _post_json(url, payload):
    req = urllib.request.Request(
        url, json.dumps(payload, ensure_ascii=False).encode(),
        {'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def _post_file(url, path, field='media'):
    boundary = uuid.uuid4().hex
    fn = os.path.basename(path)
    data = open(path, 'rb').read()
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; filename="{fn}"\r\n'
            f'Content-Type: {mimetypes.guess_type(fn)[0] or "image/jpeg"}\r\n\r\n').encode() + data + f'\r\n--{boundary}--\r\n'.encode()
    req = urllib.request.Request(url, body, {'Content-Type': f'multipart/form-data; boundary={boundary}'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def get_access_token(appid, secret):
    tk = _get(f'{API}/token?grant_type=client_credential&appid={appid}&secret={secret}')
    assert 'access_token' in tk, f'token失败: {tk}'
    return tk['access_token']


def upload_cover(token, cover_path):
    m = _post_file(f'{API}/material/add_material?access_token={token}&type=image', cover_path)
    assert 'media_id' in m, f'封面素材上传失败: {m}'
    return m['media_id']


def build_draft(token, title, author, digest, content, thumb_media_id):
    d = _post_json(f'{API}/draft/add?access_token={token}', {
        'articles': [{
            'title': title, 'author': author, 'digest': digest, 'content': content,
            'thumb_media_id': thumb_media_id, 'need_open_comment': 0, 'only_fans_can_comment': 0,
        }]
    })
    assert 'media_id' in d, f'草稿失败: {d}'
    return d['media_id']


def freepublish(token, draft_media_id):
    """发布到主页，不群发推送。"""
    p = _post_json(f'{API}/freepublish/submit?access_token={token}', {'media_id': draft_media_id})
    assert p.get('errcode') == 0, f'发布提交失败: {p}'
    return p['publish_id']


def poll_freepublish_status(token, publish_id, attempts=12, interval=5, sleep_fn=time.sleep):
    for _ in range(attempts):
        sleep_fn(interval)
        st = _post_json(f'{API}/freepublish/get?access_token={token}', {'publish_id': publish_id})
        if st.get('publish_status') == 0:
            return st
        if st.get('publish_status') in (2, 3, 4, 5):
            return st
    return None


def publish(cover_path, title, body, appid=None, secret=None, author='ZenithJoy'):
    """完整发布流程：token → 封面素材 → 草稿 → freepublish。返回 {'publish_id': ...}。"""
    appid = appid or os.environ['WECHAT_APPID']
    secret = secret or os.environ['WECHAT_APPSECRET']

    token = get_access_token(appid, secret)
    thumb = upload_cover(token, cover_path)
    content = f'<p>{body}</p>'
    draft_media_id = build_draft(token, title, author, body[:54], content, thumb)
    publish_id = freepublish(token, draft_media_id)
    return {'publish_id': publish_id}


if __name__ == '__main__':
    COVER = sys.argv[1]
    TITLE = sys.argv[2]
    BODY = sys.argv[3]

    print('[1/4] 上传素材 + 建草稿 + 发布...')
    result = publish(COVER, TITLE, BODY)
    print('[发布已提交] publish_id:', result['publish_id'])

    token = get_access_token(os.environ['WECHAT_APPID'], os.environ['WECHAT_APPSECRET'])
    st = poll_freepublish_status(token, result['publish_id'])
    if st and st.get('publish_status') == 0:
        url = st.get('article_detail', {}).get('item', [{}])[0].get('article_url', '')
        print('PUBLISH_OK', url)
        sys.exit(0)
    print('PUBLISH_FAILED_OR_TIMEOUT', json.dumps(st, ensure_ascii=False)[:300] if st else '')
    sys.exit(1)

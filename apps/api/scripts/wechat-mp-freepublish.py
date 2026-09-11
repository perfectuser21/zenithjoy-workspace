#!/usr/bin/env python3
"""公众号图文发布（官方 API）：素材上传→草稿→群发（message/mass/sendall）。

真机验证结论（2026-09-11）：单独调用 freepublish/submit 只会生成一条可访问链接，
不会让内容出现在账号主页的"全部消息"历史里；且用过的草稿再拿去群发会报
`40007 invalid media_id`（两者不能接力用同一份草稿）。要让内容真正被看见（进主页
历史 + 推送粉丝），必须走 message/mass/sendall——这才是唯一正确路径。

订阅号群发配额 = 1次/天（自然日0点重置），服务号 = 4次/自然月，认证与否不改变
这个配额；调用方需自行节流，不要假设可以无限次调用。
"""
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


def mass_send(token, draft_media_id, send_ignore_reprint=1):
    """群发已建好的草稿——这是唯一能让内容进主页历史+推送粉丝的动作。返回 msg_id。"""
    ms = _post_json(f'{API}/message/mass/sendall?access_token={token}', {
        'filter': {'is_to_all': True},
        'mpnews': {'media_id': draft_media_id},
        'msgtype': 'mpnews',
        'send_ignore_reprint': send_ignore_reprint,
    })
    assert ms.get('errcode') in (0, None), f'群发提交失败: {ms}'
    return ms['msg_id']


def poll_mass_send_status(token, msg_id, attempts=12, interval=5, sleep_fn=time.sleep):
    """轮询群发结果，返回最终 msg_status（SEND_SUCCESS / SENDING / ...）。"""
    status = None
    for _ in range(attempts):
        sleep_fn(interval)
        g = _post_json(f'{API}/message/mass/get?access_token={token}', {'msg_id': msg_id})
        status = g.get('msg_status')
        if status == 'SEND_SUCCESS' or (status and 'FAIL' in status.upper()):
            break
    return status


def publish(cover_path, title, body, appid=None, secret=None, author='ZenithJoy'):
    """完整发布流程：token → 封面素材 → 草稿 → 群发。返回 {'msg_id': ...}。"""
    appid = appid or os.environ['WECHAT_APPID']
    secret = secret or os.environ['WECHAT_APPSECRET']

    token = get_access_token(appid, secret)
    thumb = upload_cover(token, cover_path)
    content = f'<p>{body}</p>'
    draft_media_id = build_draft(token, title, author, body[:54], content, thumb)
    msg_id = mass_send(token, draft_media_id)
    return {'msg_id': msg_id}


if __name__ == '__main__':
    COVER = sys.argv[1]
    TITLE = sys.argv[2]
    BODY = sys.argv[3]

    print('[1/3] 上传素材 + 建草稿...')
    result = publish(COVER, TITLE, BODY)
    print('[2/3] 群发已提交 msg_id:', result['msg_id'])

    print('[3/3] 轮询群发结果...')
    token = get_access_token(os.environ['WECHAT_APPID'], os.environ['WECHAT_APPSECRET'])
    final_status = poll_mass_send_status(token, result['msg_id'])
    if final_status == 'SEND_SUCCESS':
        print('MASS_SEND_OK')
        sys.exit(0)
    print('MASS_SEND_STATUS', final_status)
    sys.exit(0 if final_status else 1)

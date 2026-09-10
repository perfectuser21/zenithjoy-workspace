#!/usr/bin/env python3
"""公众号图文发布（官方 API）：素材上传→草稿→freepublish（发布到主页，不推送粉丝）"""
import json, os, sys, time, urllib.request, urllib.parse, mimetypes, uuid

APPID=os.environ['WECHAT_APPID']; SECRET=os.environ['WECHAT_APPSECRET']
COVER=sys.argv[1]; TITLE=sys.argv[2]; BODY=sys.argv[3]

def get(url):
    with urllib.request.urlopen(url, timeout=20) as r: return json.load(r)
def post_json(url, payload):
    req=urllib.request.Request(url, json.dumps(payload,ensure_ascii=False).encode(), {'Content-Type':'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r: return json.load(r)
def post_file(url, path, field='media'):
    boundary=uuid.uuid4().hex
    fn=os.path.basename(path); data=open(path,'rb').read()
    body=(f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; filename="{fn}"\r\n'
          f'Content-Type: {mimetypes.guess_type(fn)[0] or "image/jpeg"}\r\n\r\n').encode()+data+f'\r\n--{boundary}--\r\n'.encode()
    req=urllib.request.Request(url, body, {'Content-Type': f'multipart/form-data; boundary={boundary}'})
    with urllib.request.urlopen(req, timeout=60) as r: return json.load(r)

tk=get(f'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid={APPID}&secret={SECRET}')
assert 'access_token' in tk, f'token失败: {tk}'
T=tk['access_token']; print('[1/4] token ok')

# 永久图片素材（封面 thumb_media_id）
m=post_file(f'https://api.weixin.qq.com/cgi-bin/material/add_material?access_token={T}&type=image', COVER)
assert 'media_id' in m, f'素材上传失败: {m}'
thumb=m['media_id']; img_url=m.get('url',''); print('[2/4] 封面素材 ok', thumb[:20])

# 草稿（正文嵌图 + 文案）
content=f'<p>{BODY}</p>' + (f'<p><img src="{img_url}"/></p>' if img_url else '')
d=post_json(f'https://api.weixin.qq.com/cgi-bin/draft/add?access_token={T}', {
  'articles':[{'title':TITLE,'author':'ZenithJoy','digest':BODY[:54],'content':content,
               'thumb_media_id':thumb,'need_open_comment':0,'only_fans_can_comment':0}]})
assert 'media_id' in d, f'草稿失败: {d}'
draft=d['media_id']; print('[3/4] 草稿 ok', draft[:20])

# freepublish（发布到主页，不群发推送）
p=post_json(f'https://api.weixin.qq.com/cgi-bin/freepublish/submit?access_token={T}', {'media_id':draft})
assert p.get('errcode')==0, f'发布提交失败: {p}'
pub_id=p['publish_id']; print('[4/4] 发布已提交 publish_id:', pub_id)

# 轮询发布结果
for i in range(12):
    time.sleep(5)
    st=post_json(f'https://api.weixin.qq.com/cgi-bin/freepublish/get?access_token={T}', {'publish_id':pub_id})
    s=st.get('publish_status')
    if s==0:
        url=st.get('article_detail',{}).get('item',[{}])[0].get('article_url','')
        print('PUBLISH_OK', url); sys.exit(0)
    if s in (2,3,4,5):
        print('PUBLISH_FAILED', json.dumps(st,ensure_ascii=False)[:300]); sys.exit(1)
    print(f'  等待审核/发布中 status={s}')
print('PUBLISH_TIMEOUT_STILL_PROCESSING（发布已提交，稍后可查）'); sys.exit(0)

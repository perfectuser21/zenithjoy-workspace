"""Frozen native panel/recipient/count predicates, in one nofork local leaf.
The original Python bodies execute unchanged; this helper has no network/ADB.
"""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import sys
import xml.etree.ElementTree as E

sys.dont_write_bytecode = True

def pinned(path, digest):
    path = Path(path)
    if not path.is_absolute() or path.resolve() != path:
        raise ValueError('SOURCE_PATH')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        a = os.fstat(fd)
        if not stat.S_ISREG(a.st_mode) or a.st_mode & 0o022:
            raise ValueError('SOURCE_MODE')
        content = os.read(fd, a.st_size + 1)
        z = os.fstat(fd)
        s = path.lstat()
        if len(content) != a.st_size or any(getattr(a, k) != getattr(z, k) or getattr(a, k) != getattr(s, k) for k in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')) or hashlib.sha256(content).hexdigest() != digest:
            raise ValueError('SOURCE_SHA')
        return content.decode()
    finally:
        os.close(fd)

def run(body, payload):
    before = sys.stdin
    output = io.StringIO()
    try:
        sys.stdin = io.StringIO(json.dumps(payload))
        with contextlib.redirect_stdout(output):
            exec(compile(body, 'frozen-native-comment-body.py', 'exec'), {'__name__': 'native_comment_predicate'})
    finally:
        sys.stdin = before
    return json.loads(output.getvalue())

def function(source, name):
    match = re.search(r'^' + re.escape(name) + r'\(\) ?\{\n(.*?)^\}', source, re.M | re.S)
    if not match:
        raise ValueError('ORIGINAL_FUNCTION')
    return match.group(1)

def main():
    controller = pinned(sys.argv[1], sys.argv[2])
    recipient = pinned(sys.argv[3], sys.argv[4])
    count = pinned(sys.argv[5], sys.argv[6])
    request = json.load(sys.stdin)
    operation = request['operation']
    keys = {'panel': {'operation', 'xml'}, 'button': {'operation', 'xml'}, 'detail': {'operation', 'xml'}, 'profile': {'operation', 'xml', 'nickname'}, 'recipient': {'operation', 'profile', 'returned', 'nickname', 'douyinId', 'commentBody'}, 'comment-icon': {'operation'}}
    if operation not in keys or set(request) != keys[operation] or any(not isinstance(v, str) or '\0' in v for v in request.values()) or any(len(request[k].encode()) > 4 * 1024 * 1024 for k in ('xml', 'profile', 'returned') if k in request):
        raise ValueError('INPUT')
    panel = re.search(r'const nativePanelPython=String.raw`(.*?)`;', recipient, re.S)
    proof = re.search(r'const recipientNativePython=nativePanelPython\+String.raw`(.*?)`;', recipient, re.S)
    rows = re.search(r'function parseNativeCommentXml\(xml\)\{.*?nativePanelPython\+String.raw`(.*?)`', recipient, re.S)
    if not all((panel, proof, rows)):
        raise ValueError('ORIGINAL_BODY')
    if operation == 'panel':
        value = run(panel.group(1) + rows.group(1), {'xml': request['xml']})
    elif operation == 'recipient':
        value = run(panel.group(1) + proof.group(1), {k: request[k] for k in ('profile', 'returned', 'nickname', 'douyinId', 'commentBody')})
    elif operation == 'button':
        namespace = {'__name__': 'native_comment_count'}
        exec(compile(count, 'frozen-comment-count-evidence.py', 'exec'), namespace)
        label = namespace['label'](request['xml'])
        nodes = list(E.fromstring(request['xml']).iter('node'))
        button = next(n for n in nodes if n.get('clickable') == 'true' and n.get('content-desc', '').startswith('评论'))
        bounds = tuple(map(int, re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', button.get('bounds')).groups()))
        value = {'zero': label is None, 'count': label, 'center': [(bounds[0] + bounds[2]) // 2, (bounds[1] + bounds[3]) // 2]}
    elif operation == 'profile':
        namespace = {'__name__': 'native_profile'}
        exec(compile(panel.group(1), 'frozen-native-panel.py', 'exec'), namespace)
        nodes = namespace['native_nodes'](request['xml'])
        expected = request['nickname']
        matches = [n for n in nodes if n.get('text') == expected and n.get('content-desc') == expected + '，复制名字和修改备注']
        literal = any(n.get('text') == expected for n in nodes)
        ids = [n.get('text')[4:] for n in nodes if n.get('text', '').startswith('抖音号：')]
        if len(ids) > 1 or not literal or ids and len(matches) != 1:
            raise ValueError('PROFILE_IDENTITY')
        organization = any('组织认证' in n.get('text', '') or '企业认证' in n.get('text', '') or '组织认证' in n.get('content-desc', '') or '企业认证' in n.get('content-desc', '') for n in nodes)
        value = {'nickname': expected, 'douyin_id': ids[0] if ids else '', 'account_type': 'personal' if ids else 'organization' if organization else 'id_not_visible', 'profile_ip': next((n.get('text')[3:] for n in nodes if n.get('text', '').startswith('IP：')), '')}
    elif operation == 'detail':
        body = function(controller, '_is_video_detail_xml')
        negative = re.search(r"grep -qE '([^']+)'", body)
        positive = re.search(r"grep -oE '([^']+)'", body)
        if not negative or not positive:
            raise ValueError('ORIGINAL_BODY')
        row = re.search(positive.group(1), request['xml'])
        value = {'accepted': bool(not re.search(negative.group(1), request['xml']) and row and 'clickable="true"' in row.group())}
    elif operation == 'comment-icon':
        prompt = re.search(r'^COMMENT_ICON_DESC="([^"\n]+)"$', controller, re.M)
        if not prompt:
            raise ValueError('ORIGINAL_PROMPT')
        value = {'prompt': prompt.group(1)}
    else:
        raise ValueError('OPERATION')
    print(json.dumps(value, ensure_ascii=False))

if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('NATIVE_COMMENT_PREDICATE_REJECTED', file=sys.stderr)
        sys.exit(2)

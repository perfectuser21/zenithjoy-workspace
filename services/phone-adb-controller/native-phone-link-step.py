"""Fixed local link predicates. Execute the frozen controller's original parsers.

This helper has no ADB, network, clipboard, process, account, or lease authority.
The parent pins this file and supplies the frozen controller paths and digests.
"""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET


def pinned(path, digest):
    raw = Path(path).read_bytes()
    if hashlib.sha256(raw).hexdigest() != digest:
        raise ValueError('SOURCE')
    return raw.decode('utf8')


def function(source, name):
    found = re.findall(r'^' + re.escape(name) + r'\(\) \{\n(.*?)^\}', source, re.M | re.S)
    if len(found) != 1:
        raise ValueError('SSOT')
    return found[0]


def original(source, name, tag, argv, stdin=''):
    body = function(source, name)
    found = re.findall(r"<<'" + tag + r"'\n(.*?)\n" + tag + r'(?:\n|$)', body, re.S)
    if len(found) != 1:
        raise ValueError('SSOT')
    out = io.StringIO()
    old_argv, old_stdin = sys.argv, sys.stdin
    code = 0
    try:
        sys.argv = [name, *argv]
        sys.stdin = io.StringIO(stdin)
        with contextlib.redirect_stdout(out):
            try:
                exec(compile(found[0] + '\n', 'frozen-controller:' + name, 'exec'), {'__name__': '__main__'})
            except SystemExit as error:
                code = error.code or 0
    finally:
        sys.argv, sys.stdin = old_argv, old_stdin
    if code not in (0, 1, 2):
        raise ValueError('RESULT')
    return code, out.getvalue().strip()


def main(q):
    source = pinned(q['controller'], q['controller_sha256'])
    operation = q['operation']
    xml = q.get('xml', '')
    if not isinstance(xml, str) or len(xml.encode('utf8')) > 4 * 1024 * 1024 or re.search(r'<!DOCTYPE|<!ENTITY', xml, re.I):
        raise ValueError('XML')
    width, height = int(q.get('width', 0)), int(q.get('height', 0))
    def center(node):
        m = re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', node.get('bounds', ''))
        if not m:
            raise ValueError('BOUNDS')
        x1, y1, x2, y2 = map(int, m.groups())
        if not 0 <= x1 < x2 <= width or not 0 <= y1 < y2 <= height:
            raise ValueError('BOUNDS')
        return [(x1 + x2) // 2, (y1 + y2) // 2]
    if operation == 'detail':
        # These are the controller's actual two grep expressions, not a second
        # set of UI business rules. Only the local regex transport changes.
        body = function(source, '_is_video_detail_xml')
        negative = re.search(r"grep -qE '([^']+)'", body)
        positive = re.search(r"grep -oE '([^']+)'", body)
        if not negative or not positive:
            raise ValueError('SSOT')
        row = re.search(positive.group(1), xml)
        if re.search(negative.group(1), xml) or not row or 'clickable="true"' not in row.group():
            return {'accepted': False}
        return {'accepted': True, 'center': center(ET.fromstring(row.group()[:-1].rstrip('/ ') + '/>'))}
    if operation in ('fresh-share', 'copy-guide'):
        name, tag = ('_is_fresh_share_detail_xml', 'PYSHARE') if operation == 'fresh-share' else ('_is_copy_success_guide_xml', 'PYGUIDE')
        code, _ = original(source, name, tag, [io.StringIO(xml), 'com.ss.android.ugc.aweme'])
        return {'accepted': code == 0}
    if operation == 'field':
        nodes = [n for n in ET.fromstring(xml).iter('node') if n.get('resource-id') == 'com.ss.android.ugc.aweme:id/et_search_kw']
        if len(nodes) != 1:
            return {'accepted': False, 'absent': not nodes}
        node = nodes[0]
        if q.get('strict'):
            code, _ = original(source, 'nonce_sdk31_field', 'PY', [io.StringIO(xml), q.get('expected', ''), str(width), str(height)])
            if code:
                return {'accepted': False}
        elif node.get('clickable') != 'true':
            return {'accepted': False}
        return {'accepted': True, 'center': center(node), 'text': node.get('text', ''), 'hint': node.get('hint', '')}
    if operation == 'share-target':
        code, value = original(source, 'share_panel_link_target', 'PYSHARETARGET', [io.StringIO(xml), str(width), str(height)])
        return {'accepted': code == 0, **({'center': [int(x) for x in value.split()]} if code == 0 else {})}
    if operation == 'extract-link':
        code, value = original(source, 'extract_copied_share_link', 'PY', [q['text']])
        return {'accepted': code == 0, **(dict(line.split('=', 1) for line in value.splitlines()) if code == 0 else {})}
    if operation == 'widget':
        code = pinned(q['widget_script'], q['widget_sha256'])
        namespace = {'__name__': 'native_widget_parser'}
        exec(compile(code, 'frozen-clipboard-widget-cancel.py', 'exec'), namespace)
        return {'accepted': True, 'center': list(namespace['cancel_center'](io.StringIO(xml), q['foreground'], width, height))}
    if operation == 'metrics-descriptions':
        metrics = pinned(q['metrics_script'], q['metrics_sha256'])
        parsers = re.findall(r'const parser=`(.*?)`;', metrics, re.S)
        if len(parsers) != 1:
            raise ValueError('SSOT')
        old_stdin = sys.stdin
        out = io.StringIO()
        try:
            sys.stdin = io.StringIO(xml)
            with contextlib.redirect_stdout(out):
                exec(compile(parsers[0], 'frozen-discovery-metrics-parser', 'exec'), {'__name__': '__main__'})
        finally:
            sys.stdin = old_stdin
        return json.loads(out.getvalue())
    raise ValueError('OPERATION')


if __name__ == '__main__':
    try:
        raw = sys.stdin.buffer.read(5 * 1024 * 1024 + 1)
        if len(raw) > 5 * 1024 * 1024:
            raise ValueError('INPUT')
        print(json.dumps(main(json.loads(raw)), ensure_ascii=False))
    except Exception:
        print('NATIVE_LINK_LOCAL_REJECTED', file=sys.stderr)
        sys.exit(2)

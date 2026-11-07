"""Finite read-only detail predicates from the frozen controller/count SSOT."""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import xml.etree.ElementTree as ET

sys.dont_write_bytecode = True
PACKAGE = 'com.ss.android.ugc.aweme'

def pinned(path, digest):
    p = Path(path)
    if not p.is_absolute() or p.resolve() != p:
        raise ValueError('SOURCE_PATH')
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        a = os.fstat(fd)
        data = os.read(fd, a.st_size + 1)
        z = os.fstat(fd)
        if not stat.S_ISREG(a.st_mode) or a.st_mode & 0o022 or a.st_uid not in (0, os.getuid()) or len(data) != a.st_size or any(getattr(a, k) != getattr(z, k) for k in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')) or hashlib.sha256(data).hexdigest() != digest:
            raise ValueError('SOURCE')
        return data.decode('utf8')
    finally:
        os.close(fd)

def original(source, marker, argv):
    matches = re.findall(r"<<'" + marker + r"'[^\n]*\n(.*?)\n" + marker + r'(?:\n|$)', source, re.S)
    if len(matches) != 1:
        raise ValueError('SSOT')
    previous, output, code = sys.argv, io.StringIO(), 0
    try:
        sys.argv = ['frozen-detail-predicate', *argv]
        with contextlib.redirect_stdout(output):
            try:
                exec(compile(matches[0] + '\n', 'frozen-controller:' + marker, 'exec'), {'__name__': '__main__'})
            except SystemExit as error:
                code = error.code or 0
    finally:
        sys.argv = previous
    return code == 0

def main():
    if len(sys.argv) != 5:
        raise ValueError('ARGS')
    controller, count_source = pinned(sys.argv[1], sys.argv[2]), pinned(sys.argv[3], sys.argv[4])
    q = json.load(sys.stdin)
    if set(q) != {'operation', 'args'} or not isinstance(q['args'], list) or any(not isinstance(a, str) or '\0' in a for a in q['args']):
        raise ValueError('INPUT')
    op, args = q['operation'], q['args']
    if op == 'foreground-detail' and len(args) == 1:
        return {'accepted': original(controller, 'PYCARDFOCUS', [args[0], PACKAGE])}
    if op == 'speed-prompt' and not args:
        body = re.findall(r'^set_playback_speed\(\) \{\n(.*?)^\}', controller, re.S | re.M)
        matches = re.findall(r'locate_element "([^"\n]+)"', body[0]) if len(body) == 1 else []
        if len(matches) != 1 or '$spd' not in matches[0]:
            raise ValueError('SSOT')
        return {'prompt': matches[0].replace('$spd', '3.0')}
    if op == 'comment-count' and len(args) == 1:
        namespace = {'__name__': 'frozen_comment_count', '__file__': sys.argv[3]}
        exec(compile(count_source, sys.argv[3], 'exec'), namespace)
        try:
            value = namespace['label'](args[0])
            return {'status': 'zero' if value is None else 'positive', 'label': '0' if value is None else value}
        except (ValueError, ET.ParseError):
            return {'status': 'unknown', 'label': 'unknown'}
    if op == 'gate-dismiss' and len(args) == 3:
        xml, width, height = args[0], int(args[1]), int(args[2])
        rows = re.findall(r'^FG_DISMISS_LABELS=\(([^\n]+)\)$', controller, re.M)
        labels = re.findall(r'"([^"]+)"', rows[0]) if len(rows) == 1 else []
        if not labels:
            raise ValueError('SSOT')
        for label in labels:
            row = re.search(r'<node[^>]+text="' + re.escape(label) + r'[^"]*"[^>]*clickable="true"[^>]*>', xml)
            if not row:
                continue
            match = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', row[0])
            if not match:
                continue
            x1, y1, x2, y2 = map(int, match.groups())
            if 0 <= x1 < x2 <= width and 0 <= y1 < y2 <= height:
                return {'center': [(x1+x2)//2, (y1+y2)//2]}
        return {'center': None}
    if op == 'card-copy-overlay' and len(args) == 1:
        with tempfile.TemporaryDirectory(prefix='native-detail-overlay-') as root:
            path = Path(root) / 'ui.xml'
            path.write_text(args[0], encoding='utf8')
            path.chmod(0o600)
            return {'accepted': original(controller, 'PYDOUYIN', [str(path), PACKAGE]) and original(controller, 'PYCARDOVERLAY', [str(path), PACKAGE])}
    raise ValueError('OPERATION')

if __name__ == '__main__':
    try:
        print(json.dumps(main(), ensure_ascii=False))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)

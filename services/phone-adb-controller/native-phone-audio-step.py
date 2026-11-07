"""Read-only original audio predicates. No ADB, subprocess or capture authority."""
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

sys.dont_write_bytecode = True
PACKAGE = 'com.ss.android.ugc.aweme'

def source_bytes(path, digest):
    p = Path(path)
    if not p.is_absolute() or p.resolve() != p:
        raise ValueError('SOURCE_PATH')
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        a = os.fstat(fd)
        data = os.read(fd, a.st_size + 1)
        z = os.fstat(fd)
        if not stat.S_ISREG(a.st_mode) or a.st_mode & 0o022 or a.st_uid not in (0, os.getuid()) or len(data) != a.st_size or any(getattr(a, k) != getattr(z, k) for k in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')) or hashlib.sha256(data).hexdigest() != digest:
            raise ValueError('SOURCE')
        return data.decode('utf8')
    finally:
        os.close(fd)

def body(source, name, marker):
    found = re.findall(r'^' + re.escape(name) + r'\(\) \{\n(.*?)^\}', source, re.M | re.S)
    if len(found) != 1:
        raise ValueError('SSOT_FUNCTION')
    expression = r"<<'" + marker + r"'\n(.*?)\n" + marker + r'(?:\n|$)' if marker else r'''\| "\$PYTHON_BIN" -c '\n(.*?)'\n'''
    matches = re.findall(expression, found[0], re.S)
    if len(matches) != 1:
        raise ValueError('SSOT_BODY')
    return matches[0] + '\n'

def execute(code, argv, stdin=''):
    previous = sys.argv, sys.stdin
    output = io.StringIO()
    status = 0
    try:
        sys.argv, sys.stdin = ['frozen-audio-predicate', *argv], io.StringIO(stdin)
        with contextlib.redirect_stdout(output):
            try:
                exec(compile(code, 'frozen-controller-audio', 'exec'), {'__name__': '__main__'})
            except SystemExit as error:
                status = error.code or 0
    finally:
        sys.argv, sys.stdin = previous
    return status, output.getvalue().strip()

def main():
    if len(sys.argv) != 3:
        raise ValueError('ARGS')
    source = source_bytes(sys.argv[1], sys.argv[2])
    request = json.loads(sys.stdin.read(5 * 1024 * 1024))
    if set(request) != {'operation', 'args'} or not isinstance(request['args'], list) or any(not isinstance(a, str) or '\0' in a for a in request['args']):
        raise ValueError('INPUT')
    op, args = request['operation'], request['args']
    if op == 'foreground' and len(args) == 1:
        status, _ = execute(body(source, 'record_detail_foreground', 'PYRECORDDETAIL'), [args[0], PACKAGE])
        return {'accepted': status == 0}
    with tempfile.TemporaryDirectory(prefix='native-audio-predicate-') as root:
        def write(name, data):
            p = Path(root) / name
            p.write_text(data, encoding='utf8')
            p.chmod(0o600)
            return str(p)
        if op == 'uid' and len(args) == 1:
            status, uid = execute(body(source, 'record_native_audio', 'PYUID'), [write('package-uid.txt', args[0]), PACKAGE])
            if status != 0:
                raise ValueError('UID_PARSER')
            return {'uid': uid}
        if op == 'session' and len(args) == 2:
            exact, _ = execute(body(source, '_foreground_is_exact_douyin', 'PYFOCUS'), [args[1], PACKAGE])
            if exact != 0:
                return {'state': 'unknown'}
            status, state = execute(body(source, 'record_playback_state', None), [], args[0])
            if status != 0:
                raise ValueError('SESSION_PARSER')
            return {'state': state}
        if op == 'native' and len(args) == 5:
            audio, owners, uid, foreground, sdk = args
            if uid and (not uid.isdigit() or int(uid) < 1):
                raise ValueError('UID')
            destination = str(Path(root) / 'native-audio.json')
            status, fields = execute(body(source, 'record_native_audio', 'PYNATIVE'), [write('audio.txt', audio), write('uid-owners.txt', owners), uid, PACKAGE, destination, write('foreground.txt', foreground), sdk])
            if status != 0:
                raise ValueError('NATIVE_PARSER')
            raw = Path(destination).read_text()
            return {'fields': fields, 'evidence': json.loads(raw), 'evidence_json': raw}
    raise ValueError('OPERATION')

if __name__ == '__main__':
    try:
        print(json.dumps(main(), ensure_ascii=False))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)

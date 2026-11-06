"""Execute the frozen controller's XML predicates unchanged, without a subprocess.
Source pinning is additional defence; production authority belongs to the Code caller.
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
import tempfile

sys.dont_write_bytecode = True

def pinned(path, digest):
    p = Path(path)
    if not p.is_absolute() or p.resolve() != p:
        raise ValueError('SOURCE_PATH')
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_mode & 0o022:
            raise ValueError('SOURCE_MODE')
        content = os.read(fd, before.st_size + 1)
        after = os.fstat(fd)
        if len(content) != before.st_size or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) or hashlib.sha256(content).hexdigest() != digest:
            raise ValueError('SOURCE_SHA')
        return content.decode('utf-8')
    finally:
        os.close(fd)

def main():
    source = pinned(sys.argv[1], sys.argv[2])
    request = json.load(sys.stdin)
    if request.get('package') != 'com.ss.android.ugc.aweme':
        raise ValueError('PACKAGE')
    table = {'complete': ('_is_complete_douyin_xml', 'PYDOUYIN'), 'fresh-share': ('_is_fresh_share_detail_xml', 'PYSHARE'), 'foreground': ('_foreground_is_exact_douyin', 'PYFOCUS')}
    function, marker = table[request['operation']]
    prefix = source[source.index('\n' + function + '() {\n') + 1:]
    match = re.search("<<'" + marker + "'\n(.*?)\n" + marker + r'\n\}', prefix, re.S)
    if not match or '\n}\n' in prefix[:match.start()]:
        raise ValueError('ORIGINAL_BODY')
    body = match.group(1) + '\n'
    with tempfile.TemporaryDirectory(prefix='native-ui-predicate-') as directory:
        path = Path(directory) / 'ui.xml'
        path.write_text(request.get('xml', ''), encoding='utf-8')
        os.chmod(path, 0o600)
        argument = request['foreground'] if request['operation'] == 'foreground' else str(path)
        previous = sys.argv
        code = 0
        try:
            sys.argv = [str(path), argument, request['package']]
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                try:
                    exec(compile(body, sys.argv[0], 'exec'), {'__name__': '__main__'})
                except SystemExit as error:
                    code = error.code or 0
        finally:
            sys.argv = previous
    print(json.dumps({'accepted': code == 0}))

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)

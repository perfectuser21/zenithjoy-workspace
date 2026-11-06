"""Finite local search predicates. Original image predicates execute unchanged."""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import sys
import importlib.abc
import importlib.machinery
import importlib.util

sys.dont_write_bytecode = True


def need(value, reason):
    if not value:
        raise ValueError(reason)


def pinned(path, expected):
    path = Path(path)
    need(path.is_absolute() and path.resolve() == path, 'SOURCE_PATH')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and not before.st_mode & 0o022, 'SOURCE_MODE')
        content = os.read(fd, before.st_size + 1)
        after = os.fstat(fd)
        need(len(content) == before.st_size and (before.st_ino, before.st_dev, before.st_size, before.st_mtime_ns) ==
             (after.st_ino, after.st_dev, after.st_size, after.st_mtime_ns), 'SOURCE_CHANGED')
        need(hashlib.sha256(content).hexdigest() == expected, 'SOURCE_SHA')
        return content
    finally:
        os.close(fd)


def pillow(spec_path, spec_sha):
    spec = json.loads(pinned(spec_path, spec_sha))
    need(set(spec) == {'root', 'files'}, 'PIL_SPEC')
    root = Path(spec['root'])
    need(root.is_absolute() and root.resolve() == root and root.name == 'PIL', 'PIL_ROOT')
    expected = spec['files']
    need(isinstance(expected, list) and expected and len({v['path'] for v in expected}) == len(expected), 'PIL_FILES')
    actual = []
    for path in sorted(root.rglob('*')):
        need(not path.is_symlink(), 'PIL_SYMLINK')
        if path.is_dir():
            need(not path.stat().st_mode & 0o022, 'PIL_DIRECTORY')
        else:
            actual.append(path.relative_to(root).as_posix())
    need(sorted(actual) == sorted(v['path'] for v in expected), 'PIL_INVENTORY')
    for row in expected:
        path = row['path']
        need(not path.startswith('/') and all(p not in ('', '.', '..') for p in path.split('/')), 'PIL_PATH')
        pinned(root / path, row['sha256'])
    # Never add the package parent: adjacent unreviewed packages and .pth files
    # must stay invisible. The finder resolves only the already verified PIL tree.
    class PillowFinder(importlib.abc.MetaPathFinder):
        def find_spec(self, fullname, path=None, target=None):
            if fullname != 'PIL' and not fullname.startswith('PIL.'):
                return None
            relative = fullname.split('.')[1:]
            base = root.joinpath(*relative)
            package = base / '__init__.py'
            if package.is_file():
                return importlib.util.spec_from_file_location(fullname, package, submodule_search_locations=[str(base)])
            for suffix in importlib.machinery.all_suffixes():
                candidate = Path(str(base) + suffix)
                if candidate.is_file():
                    return importlib.util.spec_from_file_location(fullname, candidate)
            raise ModuleNotFoundError(fullname)
    sys.meta_path.insert(0, PillowFinder())
    import PIL
    need(Path(PIL.__file__).resolve() == root / '__init__.py', 'PIL_LOADED_SOURCE')


def original_body(source, function):
    start = source.index('\n' + function + '() {\n') + 1
    prefix = source[start:]
    match = re.search(r"<<'PY'\n(.*?)\nPY\n\}", prefix, re.S)
    need(match is not None, 'ORIGINAL_BODY')
    # A matching next function cannot supply the selected function's body.
    need('\n}\n' not in prefix[:match.start()], 'ORIGINAL_FUNCTION')
    return match.group(1) + '\n'


def execute(body, argv, filename):
    output, errors, code = io.StringIO(), io.StringIO(), 0
    old = sys.argv
    sys.argv = [filename, *argv]
    try:
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            try:
                exec(compile(body, filename, 'exec'), {'__name__': '__main__', '__file__': filename})
            except SystemExit as result:
                if result.code not in (None, 0):
                    code = result.code if isinstance(result.code, int) else 1
                    if not isinstance(result.code, int):
                        errors.write(str(result.code))
    finally:
        sys.argv = old
    return {'code': code, 'stdout': output.getvalue(), 'stderr': errors.getvalue()}


def read_xml(path):
    p = Path(path)
    need(p.is_file() and not p.is_symlink() and p.stat().st_size <= 4 * 1024 * 1024, 'XML_FILE')
    text = p.read_text()
    need('<!DOCTYPE' not in text.upper() and '<!ENTITY' not in text.upper(), 'XML_ENTITY')
    return text


def nodes(text, expression):
    return re.findall(expression, text)


def main():
    need(len(sys.argv) == 6, 'ARGS')
    controller, digest, tab_sha, pil_spec, pil_sha = sys.argv[1:]
    source = pinned(controller, digest).decode()
    payload = json.loads(sys.stdin.read(1024 * 1024))
    need(set(payload) == {'operation', 'args'} and isinstance(payload['args'], list) and
         all(isinstance(a, str) and '\x00' not in a for a in payload['args']), 'INPUT')
    op, args = payload['operation'], payload['args']
    if op == 'filter-index':
        need(len(args) == 2, 'INPUT')
        rows = re.findall(r'^    ([a-z_]+):([a-z_]+)\) print -- "([0-9]+) ([0-9]+)" ;;$', source, re.M)
        found = [(r, c) for k, v, r, c in rows if (k, v) == tuple(args)]
        need(len(found) == 1, 'FILTER_OPTION')
        return {'code': 0, 'stdout': ' '.join(found[0]), 'stderr': ''}
    if op == 'filter-ready':
        need(not args, 'INPUT')
        pillow(pil_spec, pil_sha)
        from PIL import Image, ImageStat
        for name in ['locate_filter_option', 'verify_filter_visual', 'locate_filter_action_button']:
            original_body(source, name)
        return {'code': 0, 'stdout': '', 'stderr': ''}
    if op in ('filter-option', 'filter-verify', 'filter-action'):
        pillow(pil_spec, pil_sha)
        name = {'filter-option': 'locate_filter_option', 'filter-verify': 'verify_filter_visual', 'filter-action': 'locate_filter_action_button'}[op]
        need(len(args) == {'filter-option': 3, 'filter-verify': 7, 'filter-action': 1}[op], 'INPUT')
        return execute(original_body(source, name), args, controller + ':' + name)
    if op == 'tab':
        need(len(args) == 2, 'INPUT')
        path = Path(controller).parent / 'search-video-tab.py'
        return execute(pinned(path, tab_sha).decode(), args, str(path))
    if op == 'results-focus':
        need(len(args) == 1, 'INPUT')
        matches = re.findall(r'^SEARCH_RESULT_ACTIVITY="([^"]+)"$', source, re.M)
        need(len(matches) == 1, 'ORIGINAL_ACTIVITY')
        return {'code': int('com.ss.android.ugc.aweme' not in args[0] or matches[0] not in args[0]), 'stdout': '', 'stderr': ''}
    if op == 'controls':
        need(len(args) == 1, 'INPUT')
        text = read_xml(args[0]); output = []
        for key, pattern in [('vtab', r'<node[^>]*text="视频"[^>]*bounds="\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]"'), ('fbtn', r'<node[^>]*content-desc="筛选[^"]*"[^>]*bounds="\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]"')]:
            found = nodes(text, pattern)
            if not found: return {'code': 1, 'stdout': '', 'stderr': 'controls missing'}
            x1, y1, x2, y2 = map(int, found[0])
            if x2 <= x1 or y2 <= y1: return {'code': 1, 'stdout': '', 'stderr': 'controls bounds'}
            output.append(key + '=' + str((x1+x2)//2) + ' ' + str((y1+y2)//2))
        return {'code': 0, 'stdout': '\n'.join(output) + '\n', 'stderr': ''}
    if op == 'keyword':
        need(len(args) == 2, 'INPUT')
        text = read_xml(args[1]); found = re.findall(r'<node[^>]+resource-id="com\.ss\.android\.ugc\.aweme:id/et_search_kw"[^>]*>', text)
        if not found: return {'code': 2, 'stdout': '', 'stderr': 'query missing'}
        m = re.search(r' text="([^"]*)"', found[0]); actual = m.group(1) if m else ''
        for a, b in [('&amp;', '&'), ('&#47;', '/'), ('&quot;', '"'), ('&apos;', "'"), ('&lt;', '<'), ('&gt;', '>')]: actual = actual.replace(a, b)
        return {'code': int(actual != args[0]), 'stdout': '', 'stderr': ''}
    if op == 'cards':
        need(len(args) == 1, 'INPUT'); text = read_xml(args[0])
        texts = [(int(a), int(b), int(c), int(d), value) for value, a, b, c, d in nodes(text, r'<node[^>]*text="([^"]+)"[^>]*bounds="\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]"')]
        likes = [tuple(map(int, row)) for row in nodes(text, r'<node[^>]*content-desc="[^"]*喜欢[^"]*"[^>]*bounds="\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]"')]
        durations = [(a,b,c,d,v) for a,b,c,d,v in texts if re.fullmatch(r'[0-9]{1,2}:[0-9]{2}', v)]
        output = []
        for x1,y1,x2,y2,title in texts:
            if len(title) < 8 or not any(ly1 >= y2 and ly1-y2 <= 80 and lx1 >= x1 and lx2 <= x2 for lx1,ly1,lx2,ly2 in likes): continue
            duration = next((v for dx1,dy1,dx2,dy2,v in durations if y1 >= dy2 and y1-dy2 <= 100 and dx1 >= x1 and dx2 <= x2), '')
            author, left = '', 999999
            for ax1,ay1,ax2,ay2,value in texts:
                if ay1 >= y2 and ay1-y2 <= 60 and ax1 >= x1 and ax2 <= x2 and ax1 < left and not re.fullmatch(r'([0-9.]+(万|w|亿)?|.*(天前|小时前|分钟前)|刚刚)', value): author,left = value,ax1
            output.append('\t'.join([str((x1+x2)//2),str((y1+y2)//2),duration,title,author]))
        return {'code': 0, 'stdout': '\n'.join(output) + ('\n' if output else ''), 'stderr': ''}
    raise ValueError('OPERATION')


try:
    print(json.dumps(main(), ensure_ascii=False))
except Exception as error:
    print('NATIVE_PHONE_SEARCH_LOCAL_' + str(error), file=sys.stderr)
    sys.exit(2)

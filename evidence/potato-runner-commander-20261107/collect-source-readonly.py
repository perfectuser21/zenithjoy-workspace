"""Audit immutable ROM bytes through ADB sync; never execute a phone command."""
import hashlib
import json
import pathlib
import socket
import PIL

SERIAL = 'ANGYVB4311010223'

def exact(sock, length):
    result = b''
    while len(result) < length:
        chunk = sock.recv(length - len(result))
        if not chunk:
            raise RuntimeError('early EOF')
        result += chunk
    return result

def service(sock, name):
    value = name.encode()
    sock.sendall(('%04x' % len(value)).encode() + value)
    if exact(sock, 4) != b'OKAY':
        raise RuntimeError('ADB service rejected')

def read(path):
    with socket.create_connection(('127.0.0.1', 5037), timeout=15) as sock:
        service(sock, 'host:transport:' + SERIAL)
        service(sock, 'sync:')
        value = path.encode()
        sock.sendall(b'RECV' + len(value).to_bytes(4, 'little') + value)
        data = b''
        while True:
            kind = exact(sock, 4)
            length = int.from_bytes(exact(sock, 4), 'little')
            if kind == b'DONE':
                break
            if kind != b'DATA' or len(data) + length > 64_000_000:
                raise RuntimeError('sync read refused: ' + path)
            data += exact(sock, length)
        sock.sendall(b'QUIT\0\0\0\0')
        sock.shutdown(socket.SHUT_WR)
        if sock.recv(1) != b'':
            raise RuntimeError('no EOF')
        return {'path': path, 'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data), **({'script': data.decode()} if data.startswith(b'#!') else {})}

paths = ['/system/bin/' + name for name in ['am', 'app_process', 'app_process32', 'app_process64', 'cmd', 'dumpsys', 'getprop', 'ime', 'input', 'monkey', 'screencap', 'settings', 'sh', 'toybox', 'uiautomator', 'wm']]
paths += ['/system/framework/' + name for name in ['android.test.runner.jar', 'monkey.jar', 'uiautomator.jar']]
observed = [read(path) for path in paths]
if observed != [read(path) for path in paths]:
    raise RuntimeError('independent ROM reads disagree')
root = pathlib.Path(PIL.__file__).resolve().parent
pillow = {'root': str(root), 'files': [{'path': str(p.relative_to(root)), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(root.rglob('*')) if p.is_file() and '__pycache__' not in p.parts and p.suffix != '.pyc']}
print(json.dumps({'host': 'xian-m4', 'serial': SERIAL, 'profile': 'xiaolongxia', 'sdk': 35, 'size': '1200x2664', 'reads': 2, 'ui_actions': 0, 'source_channel': 'ADB sync RECV/DONE/QUIT/EOF; read-only ROM source audit', 'program_files': observed, 'pillow': pillow}))

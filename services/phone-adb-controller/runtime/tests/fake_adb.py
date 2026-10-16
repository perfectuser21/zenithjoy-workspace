#!/usr/bin/env python3
"""仅测试边界：执行真实sh，但把远端路径映射本地并保持其stdin未EOF。"""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

root = Path(os.environ['FAKE_ADB_REMOTE_ROOT'])
args = sys.argv[1:]
if args == ['version']:
    print('Android Debug Bridge version 1.0.41')
    raise SystemExit(0)
with open(os.environ['FAKE_ADB_LOG'], 'a') as log:
    log.write(json.dumps(args) + '\n')
assert args[:6] == ['-H', '127.0.0.1', '-P', '5041', '-s', '47.100.213.173:10001'], args
assert args[6:8] == ['shell', '-T'], args
script = args[8].replace('/data/local/tmp/', str(root) + '/')
mode = os.environ.get('FAKE_ADB_MODE')
if 'head -c' in script and mode == 'hang-upload':
    time.sleep(30)
if 'ln ' in script and mode == 'deny-hardlink':
    sys.stderr.write('ln: Permission denied\n')
    raise SystemExit(1)
if 'head -c' in script and mode == 'canonical-race':
    (root / 'scrcpy-server.jar').write_bytes(b'foreign-canonical-race')
if 'head -c' in script and mode == 'canonical-symlink-race':
    protected = root / 'protected-server'
    protected.write_bytes(b'foreign-protected')
    (root / 'scrcpy-server.jar').symlink_to(protected)
if 'ln ' in script and mode == 'publish-race':
    (root / 'scrcpy-server.jar').write_bytes(b'foreign-race')
toybox = root / 'toybox'
toybox.write_text('''#!/usr/bin/env python3
import sys,hashlib
from pathlib import Path
a=sys.argv[1:]
if a[:2]==['head','-c']:
 data=sys.stdin.buffer.read(int(a[2]))
 if __import__('os').environ.get('FAKE_ADB_MODE')=='corrupt':data=b'corrupt'
 sys.stdout.buffer.write(data)
elif a[0]=='sha256sum':
 p=Path(a[-1]);print(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+str(p))
elif a[:2]==['wc','-c']:print(len(sys.stdin.buffer.read()))
else:raise SystemExit(91)
''')
toybox.chmod(0o755)
env = dict(os.environ, PATH=str(root) + ':' + os.environ['PATH'])
child = subprocess.Popen(['/bin/sh', '-c', script], stdin=subprocess.PIPE,
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
data = sys.stdin.buffer.read()
if data:
    child.stdin.write(data)
    child.stdin.flush()
# Deliberately keep child.stdin open. A cat receiver cannot complete here.
code = child.wait(timeout=10)
out, err = child.stdout.read(), child.stderr.read()
# Translate only the path text in checksum replies, like real remote stdout.
sys.stdout.buffer.write(out.replace(str(root).encode() + b'/', b'/data/local/tmp/'))
sys.stderr.buffer.write(err)
raise SystemExit(code)

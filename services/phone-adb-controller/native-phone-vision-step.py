"""Fixed no-network image leaf: execute the original encoder without resizing."""
import ast
import base64
import hashlib
import json
import os
from pathlib import Path
import stat
import struct
import sys
sys.dont_write_bytecode = True


def need(value, reason):
    if not value:
        raise ValueError(reason)


def pinned(path, digest, limit=8*1024*1024):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and not before.st_mode & 0o022 and before.st_size <= limit, 'SOURCE_MODE')
        raw = os.read(fd, before.st_size+1)
        after = os.fstat(fd)
        need(len(raw) == before.st_size and (before.st_ino, before.st_dev, before.st_size, before.st_mtime_ns) ==
             (after.st_ino, after.st_dev, after.st_size, after.st_mtime_ns), 'SOURCE_CHANGED')
        need(hashlib.sha256(raw).hexdigest() == digest, 'SOURCE_SHA')
        return raw
    finally:
        os.close(fd)


def main():
    need(len(sys.argv) == 7, 'ARGS')
    locate, locate_sha, search, search_sha, pil_path, pil_sha = sys.argv[1:]
    q = json.loads(sys.stdin.read(65536))
    need(set(q) == {'operation','path','sha256'} and q['operation'] == 'encode', 'INPUT')
    # Reuse exactly the reviewed complete PIL inventory loader, without running
    # the search CLI or placing any adjacent site-packages on sys.path.
    tree = ast.parse(pinned(search, search_sha))
    functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in ('pinned','pillow','need')]
    need(len(functions) == 3, 'PIL_LOADER_SOURCE')
    namespace = {'json':json,'Path':Path,'os':os,'stat':stat,'hashlib':hashlib,'sys':sys}
    import importlib.abc
    import importlib.machinery
    import importlib.util
    namespace['importlib'] = importlib
    exec(compile(ast.Module(body=functions,type_ignores=[]),search,'exec'),namespace)
    namespace['pillow'](pil_path,pil_sha)
    original = ast.parse(pinned(locate,locate_sha))
    selected=[]
    for n in original.body:
        if isinstance(n,ast.FunctionDef) and n.name == 'encode_shot': selected.append(n)
        if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in ('MAX_UPLOAD_BYTES','JPEG_QUALITY') for t in n.targets): selected.append(n)
    need(len(selected) == 3,'ENCODER_SOURCE')
    encoder={'base64':base64}
    exec(compile(ast.Module(body=selected,type_ignores=[]),locate,'exec'),encoder)
    path=Path(q['path']);need(path.is_absolute() and path.resolve()==path,'PATH')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        st=os.fstat(fd);current=path.lstat()
        need(stat.S_ISREG(st.st_mode) and st.st_uid==os.getuid() and st.st_nlink==1 and not st.st_mode&0o077 and st.st_size<=12*1024*1024 and (st.st_dev,st.st_ino)==(current.st_dev,current.st_ino),'IMAGE_MODE')
        raw=os.read(fd,st.st_size+1)
        need(len(raw)==st.st_size and hashlib.sha256(raw).hexdigest()==q['sha256'] and raw[:8]==b'\x89PNG\r\n\x1a\n' and len(raw)>=33,'IMAGE_BYTES')
        width,height=struct.unpack('>II',raw[16:24]);need(width>0 and height>0,'IMAGE_DIMENSIONS')
        os.lseek(fd,0,0)
        encoded,mime=encoder['encode_shot']('/dev/fd/'+str(fd))
        end=os.fstat(fd);need((st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns)==(end.st_dev,end.st_ino,end.st_size,end.st_mtime_ns),'IMAGE_CHANGED')
        return {'image_b64':encoded,'mime':mime,'width':width,'height':height}
    finally:
        os.close(fd)


try:
    print(json.dumps(main()))
except Exception as e:
    print('NATIVE_PHONE_VISION_IMAGE_'+str(e),file=sys.stderr)
    sys.exit(2)

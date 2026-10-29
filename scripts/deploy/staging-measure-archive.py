"""Count exported archive and all uncompressed blob bytes without extracting them."""
import gzip
import json
import os
import sys
import tarfile

archive = sys.argv[1]
unpacked = 0
measured = 0
with tarfile.open(archive, mode='r:') as tar:
    for member in tar:
        if not member.isfile():
            continue
        if member.name.endswith('/layer.tar'):
            unpacked += member.size
            measured += 1
            continue
        if not member.name.startswith('blobs/sha256/'):
            continue
        measured += 1
        source = tar.extractfile(member)
        magic = source.read(4)
        source.seek(0)
        if magic[:2] == b'\x1f\x8b':
            with gzip.GzipFile(fileobj=source) as stream:
                while chunk := stream.read(1024 * 1024):
                    unpacked += len(chunk)
        elif magic == b'\x28\xb5\x2f\xfd':
            raise RuntimeError('zstd layer unsupported; refuse to estimate')
        else:
            unpacked += member.size
if measured == 0 or unpacked == 0:
    raise RuntimeError('no image layers found; refuse to estimate')
print(json.dumps({'archive': os.path.getsize(archive), 'unpacked': unpacked}))

"""Read docker-save archive from stdin and emit verified config/layer identity.

Both OCI blobs and classic Docker config .json names are supported. Stream all
large entries without storing them. Never trust an archive filename as a digest.
"""
import hashlib
import json
import re
import sys
import tarfile

LIMIT = 4 * 1024 * 1024
wanted = sys.argv[1]
manifest = None
candidates = {}
with tarfile.open(fileobj=sys.stdin.buffer, mode='r|*') as tar:
    for member in tar:
        if not member.isfile() or member.size > LIMIT:
            continue
        if member.name != 'manifest.json' and not (member.name.startswith('blobs/sha256/') or member.name.endswith('.json')):
            continue
        data = tar.extractfile(member).read(LIMIT + 1)
        try:
            value = json.loads(data)
        except (UnicodeDecodeError, ValueError):
            continue
        if member.name == 'manifest.json':
            manifest = value
        elif isinstance(value, dict) and 'rootfs' in value and 'architecture' in value:
            candidates[member.name] = (data, value)
if not isinstance(manifest, list) or len(manifest) != 1 or wanted not in (manifest[0].get('RepoTags') or []):
    raise ValueError('unexpected archive manifest or image tag')
config_name = manifest[0].get('Config')
if config_name not in candidates:
    raise ValueError('image config not found')
raw, config = candidates[config_name]
digest = hashlib.sha256(raw).hexdigest()
name = config_name.rsplit('/', 1)[-1].removesuffix('.json')
if name != digest:
    raise ValueError('config digest mismatch')
layers = config.get('rootfs', {}).get('diff_ids')
if not isinstance(layers, list) or not layers or len(layers) > 1024 or any(not isinstance(x, str) or not re.fullmatch(r'sha256:[0-9a-f]{64}', x) for x in layers):
    raise ValueError('invalid image layer identities')
layers_hash = hashlib.sha256(json.dumps(layers, separators=(',', ':')).encode()).hexdigest()
print(json.dumps({'config': 'sha256:' + digest, 'layers': layers, 'layers_hash': layers_hash}, separators=(',', ':')))

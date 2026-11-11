"""Fixed release capabilities; executed inside each private Comfy container."""
import json
import urllib.request

NODES = [
    'ZenithJoyUploadImage', 'ZenithJoyImage2', 'ZenithJoyLoadAsset',
    'ZenithJoyChooseAsset', 'ZenithJoyWan', 'ZenithJoyWanRemake',
    'ZenithJoyVideoProject', 'ZenithJoyVideoSegment', 'ZenithJoySegmentRemake',
    'ZenithJoyApproveSegment', 'ZenithJoyAssembleVideo',
]
TEMPLATES = [
    'image2-select-wan.json', 'upload-image-wan.json',
    'video-remake-wan.json', 'short-video-wan.json',
]


def read(path):
    with urllib.request.urlopen('http://127.0.0.1:8188' + path, timeout=5) as response:
        if response.status != 200:
            raise RuntimeError('Canvas capability HTTP check failed: ' + path)
        return json.load(response)


info = read('/object_info')
if not isinstance(info, dict) or any(not isinstance(info.get(node), dict) for node in NODES):
    raise RuntimeError('Canvas required nodes unavailable')
for template in TEMPLATES:
    graph = read('/extensions/zenithjoy/' + template)
    if not isinstance(graph, dict) or not isinstance(graph.get('nodes'), list) or not isinstance(graph.get('links'), list):
        raise RuntimeError('Canvas workflow template invalid: ' + template)
print(json.dumps({'verified': True, 'nodes': NODES, 'templates': TEMPLATES}))

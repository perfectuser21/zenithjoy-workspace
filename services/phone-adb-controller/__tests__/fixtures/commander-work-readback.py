"""隔离外部服务fixture：读取fake发布器写入的作品文件，不执行发布。"""
import json
from pathlib import Path
import sys

path = Path(sys.argv[1])
if not path.exists():
    print(json.dumps({'status': 'none', 'receipt': {'checked_source': str(path), 'work_count': 0}}))
else:
    work = json.loads(path.read_text())
    assert work['privacy'] == 'private' and work['work_id']
    result = {'status': 'committed', 'receipt': {'work_id': work['work_id'], 'privacy': work['privacy'], 'checked_source': str(path)}}
    if len(sys.argv) > 2:
        result['activity_facts'] = [{'reference_id': sys.argv[2], 'outcome': 'pass' if work.get('business_valid', True) else 'fail', 'observed': {'value': 1 if work.get('business_valid', True) else 0}}]
    print(json.dumps(result))

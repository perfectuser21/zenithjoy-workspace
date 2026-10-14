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
    print(json.dumps({'status': 'committed', 'receipt': {'work_id': work['work_id'], 'privacy': work['privacy'], 'checked_source': str(path)}}))

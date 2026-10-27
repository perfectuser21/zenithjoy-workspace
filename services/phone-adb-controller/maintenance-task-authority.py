#!/usr/bin/env python3
"""维护专用实时任务证据；不是完整Task，不用于通用锁回收。"""
import base64
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import shlex
import subprocess
import sys

PURPOSE = 'adb-host-maintenance-tasks-v1'
FIELDS = ('id', 'status', 'task_type', 'claimed_by', 'claimed_at', 'payload')
LIMITS = (200, 400, 800, 1600, 3200, 6400, 12800)
MAX_BYTES = 64 * 1024 * 1024


def source(limit):
    return {'host': 'mmv', 'path': '/api/brain/tasks', 'status': 'in_progress', 'limit': limit}


def validate_rows(tasks, *, projected=False):
    if not isinstance(tasks, list):
        raise ValueError('maintenance authority is not a task list')
    ids = set()
    for row in tasks:
        if (not isinstance(row, dict) or not set(FIELDS).issubset(row)
                or (projected and set(row) != set(FIELDS))
                or not isinstance(row['id'], str) or not row['id']
                or row['status'] != 'in_progress'
                or not isinstance(row['task_type'], str)
                or not (row['claimed_by'] is None or isinstance(row['claimed_by'], str))
                or not (row['claimed_at'] is None or isinstance(row['claimed_at'], str))
                or not (row['payload'] is None or isinstance(row['payload'], dict))):
            raise ValueError('invalid maintenance task row')
        if row['id'] in ids:
            raise ValueError('duplicate maintenance task id')
        ids.add(row['id'])
    return tasks


def validate_document(doc, limit):
    if (type(limit) is not int or limit not in LIMITS or not isinstance(doc, dict)
            or set(doc) != {'schema_version', 'purpose', 'source', 'row_count', 'tasks'}
            or type(doc['schema_version']) is not int or doc['schema_version'] != 1
            or doc['purpose'] != PURPOSE or doc['source'] != source(limit)
            or not isinstance(doc['source'], dict)
            or type(doc['source'].get('limit')) is not int
            or type(doc['row_count']) is not int
            or not isinstance(doc['tasks'], list)
            or doc['row_count'] != len(doc['tasks']) or not 0 <= doc['row_count'] <= limit):
        raise ValueError('invalid maintenance authority purpose/source/count')
    return validate_rows(doc['tasks'], projected=True)


def remote_read(query, limit):
    # 先验证完整API响应，再保所有行、原顺序和原payload；绝不按设备过滤。
    if type(limit) is not int or limit not in LIMITS or query != (
            'http://localhost:5221/api/brain/tasks?status=in_progress&limit=' + str(limit)):
        raise ValueError('invalid maintenance authority query')
    response = subprocess.run(['curl', '--fail', '--silent', '--show-error',
                               '--connect-timeout', '3', '--max-time', '8', query],
                              check=True, capture_output=True)
    raw = response.stdout
    if len(raw) > MAX_BYTES:
        raise ValueError('maintenance task response too large')
    tasks = validate_rows(json.loads(raw))
    if len(tasks) > limit:
        raise ValueError('maintenance task response exceeds page')
    doc = {'schema_version': 1, 'purpose': PURPOSE, 'source': source(limit),
           'row_count': len(tasks), 'tasks': [{key: row[key] for key in FIELDS} for row in tasks]}
    encoded = json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode()
    if len(encoded) > MAX_BYTES:
        raise ValueError('maintenance task projection too large')
    print(json.dumps({'version': 1, 'encoding': 'gzip-base64', 'size': len(encoded),
                      'sha256': hashlib.sha256(encoded).hexdigest(),
                      'data': base64.b64encode(gzip.compress(encoded, mtime=0)).decode('ascii')},
                     separators=(',', ':')))


def task_list():
    here = Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location('maintenance_full_transport', here / 'phone-lock-helper.py')
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    # 内联的是manifest核验的本模块真字节；不依赖MMV另一个可漂移副本。
    program = Path(__file__).read_text() + '\nremote_read(sys.argv[1], int(sys.argv[2]))\n'
    for limit in LIMITS:
        query = 'http://localhost:5221/api/brain/tasks?status=in_progress&limit=' + str(limit)
        command = 'python3 -c ' + shlex.quote(program) + ' ' + shlex.quote(query) + ' ' + str(limit)
        response = subprocess.run(['/usr/bin/ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5',
                                   'mmv', command], check=True, capture_output=True, text=True, timeout=15)
        tasks = validate_document(helper.decode_task_transport(response.stdout), limit)
        if len(tasks) < limit:
            return tasks
    raise ValueError('maintenance task list remains truncated')

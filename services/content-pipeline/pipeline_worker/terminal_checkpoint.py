"""只保存终态重放材料；恢复绝不重新执行内容阶段。"""
from __future__ import annotations
import json
import os
from pathlib import Path
from uuid import UUID, uuid4

from .brain_tasks import CoordinationUnknown


def checkpoint_path(task_id, directory=None):
    UUID(str(task_id))
    base = Path(directory) if directory else Path(os.environ.get('XDG_STATE_HOME', str(Path.home() / '.local/state'))) / 'zenithjoy/content-worker'
    return base / (str(task_id) + '.json')


def save_checkpoint(path, record):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_suffix('.' + uuid4().hex + '.tmp')
    try:
        with temp.open('x', encoding='utf-8') as stream:
            os.chmod(temp, 0o600)
            json.dump(record, stream, ensure_ascii=False, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temp.unlink(missing_ok=True)


def load_checkpoint(path, pipeline):
    try:
        record = json.loads(path.read_text('utf-8'))
        identity = record['identity']
        if (record['pipeline_id'] != pipeline['id']
                or identity['brain_task_id'] != pipeline['cecelia_task_id']
                or record['status'] not in ('completed', 'failed')
                or not all(isinstance(identity.get(k), str) and identity[k] for k in ('claimer', 'claim_epoch'))):
            raise ValueError('checkpoint identity mismatch')
        return record
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise CoordinationUnknown('终态恢复材料无效，禁止重执行业务') from error


def settle_checkpoint(brain, client, path, record):
    """Brain 幂等回执成功后，本地才能进入终态；任何未知都保留原始请求。"""
    identity = record['identity']
    brain.finish(identity, record['status'], record['result'])
    if record['status'] == 'completed':
        client.stage_complete(record['pipeline_id'], record['stage'],
            output=record['output'], is_final=True, identity=identity, brain_result=record['result'])
    else:
        client.fail_pipeline(record['pipeline_id'], record['error'], stage=record.get('stage'),
            identity=identity, brain_result=record['result'])
    path.unlink(missing_ok=True)
    return record['status'] == 'completed'

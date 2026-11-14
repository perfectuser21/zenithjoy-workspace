"""有界轮转候选页；终态恢复独立于候选排序，旧占位单不饿死新任务。"""
from __future__ import annotations
import hashlib
import json
import logging
import os
from pathlib import Path

from .terminal_checkpoint import load_checkpoint, save_checkpoint, settle_checkpoint
from .brain_tasks import BrainTaskClient

logger = logging.getLogger('pipeline-worker.polling')


def state_directory(client, brain=None):
    root = Path(os.environ.get('XDG_STATE_HOME', str(Path.home() / '.local/state'))) / 'zenithjoy/content-worker'
    key = str(getattr(client, 'base_url', '')) + '\n' + str(getattr(brain, 'base_url', os.environ.get('BRAIN_URL', 'http://localhost:5221')))
    return root / hashlib.sha256(key.encode()).hexdigest()[:20]


def poll_page(client, *, limit=50):
    path = state_directory(client) / 'poll-cursor.json'
    try:
        offset = json.loads(path.read_text('utf-8')).get('offset', 0)
        if not isinstance(offset, int) or not 0 <= offset <= 1_000_000:
            offset = 0
    except (OSError, ValueError, TypeError):
        offset = 0
    page = client.list_running_pipeline_page(limit=limit, offset=offset)
    items = page['items']
    next_offset = page.get('next_offset')
    if next_offset is None or not isinstance(next_offset, int) or not 0 <= next_offset <= 1_000_000 or not items:
        next_offset = 0
    save_checkpoint(path, {'offset': next_offset})
    return items


def recover_terminals(client, *, brain_client=None, directory=None, limit=50):
    """先恢复本人已持久化回执，即使对应run不在running队列也可重放。"""
    brain = brain_client or BrainTaskClient()
    root = Path(directory) if directory is not None else state_directory(client, brain)
    recovered = 0
    try:
        for path in sorted(root.glob('*.json'))[:limit + 1]:
            if path.name == 'poll-cursor.json':
                continue
            try:
                raw = json.loads(path.read_text('utf-8'))
                pipeline = {'id': raw['pipeline_id'], 'cecelia_task_id': raw['identity']['brain_task_id']}
                if path.stem != pipeline['cecelia_task_id']:
                    continue
                record = load_checkpoint(path, pipeline)
                settle_checkpoint(brain, client, path, record)
                recovered += 1
            except Exception as error:
                logger.warning('终态回执未确认，保留 %s：%s', path.name, error)
        return recovered
    finally:
        if brain_client is None:
            brain.close()

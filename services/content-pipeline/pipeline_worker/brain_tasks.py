"""Brain 公共工作单协议；不调用任何内容专属 API。"""
from __future__ import annotations

import os
import threading
import time
from datetime import datetime
from typing import Any
from uuid import UUID

import httpx


class CoordinationUnknown(RuntimeError):
    """无法证明租约或回执；停止业务，等待可确认的恢复。"""


class BrainTaskClient:
    def __init__(self, base_url=None, *, client=None):
        self.base_url = (base_url or os.environ.get('BRAIN_URL', 'http://localhost:5221')).rstrip('/')
        self._owns_client = client is None
        self._http = client or httpx.Client(timeout=5.0)

    def close(self):
        if self._owns_client:
            self._http.close()

    def _post(self, task_id, action, body):
        try:
            UUID(str(task_id))
            response = self._http.post(f'{self.base_url}/api/brain/tasks/{task_id}/{action}', json=body)
            response.raise_for_status()
            result = response.json()
            if not isinstance(result, dict):
                raise ValueError('invalid Brain response')
            return result
        except (httpx.HTTPError, ValueError, TypeError) as error:
            raise CoordinationUnknown(f'Brain {action} 未确认') from error

    def claim(self, task_id, claimer, lease_seconds):
        result = self._post(task_id, 'claim', {
            'claimer': claimer, 'executor_kind': 'external-worker', 'start': True,
            'lease_seconds': lease_seconds, 'on_lease_expire': 'fail',
        })
        if (result.get('id') != task_id or result.get('claimed_by') != claimer
                or result.get('status') != 'in_progress' or not result.get('lease_until')
                or not isinstance(result.get('claim_epoch'), str) or not result['claim_epoch']):
            raise CoordinationUnknown('Brain claim 身份或租约回执不完整')
        return {'brain_task_id': task_id, 'claimer': claimer, 'claim_epoch': result['claim_epoch']}

    def heartbeat(self, identity, lease_seconds):
        result = self._post(identity['brain_task_id'], 'heartbeat', {
            'claimer': identity['claimer'], 'claim_epoch': identity['claim_epoch'],
            'lease_seconds': lease_seconds,
        })
        if result.get('ok') is not True or not result.get('lease_until'):
            raise CoordinationUnknown('Brain heartbeat 未确认')
        return result

    def finish(self, identity, status, result):
        receipt = self._post(identity['brain_task_id'], 'lease/finish', {
            'claimer': identity['claimer'], 'claim_epoch': identity['claim_epoch'],
            'status': status, 'result': result,
        })
        if (receipt.get('ok') is not True or receipt.get('task_id') != identity['brain_task_id']
                or receipt.get('status') != status):
            raise CoordinationUnknown('Brain finish 身份或状态未确认')
        return receipt


class LeaseHeartbeat:
    """后台持续续约；任何一次未知都停止后续副作用，不自动复活旧 epoch。"""
    def __init__(self, brain, identity, *, seconds=300, interval=30):
        self.brain = brain
        self.identity = identity
        self.seconds = seconds
        self.interval = interval
        self._stop = threading.Event()
        self._error = None
        self._thread = None
        self._deadline = None
        self._wall_deadline = None
        self._lock = threading.RLock()

    def start(self):
        self.check(refresh=True)
        self._thread = threading.Thread(target=self._loop, name='content-brain-lease', daemon=True)
        self._thread.start()

    def _loop(self):
        while not self._stop.wait(self.interval):
            try:
                self.check(refresh=True)
            except Exception as error:
                self._error = error
                self._stop.set()
                return

    def check(self, *, refresh=False):
        with self._lock:
            if self._deadline is not None and (time.monotonic() >= self._deadline
                    or time.time() >= self._wall_deadline):
                self._error = CoordinationUnknown('Brain 已确认租约期限已过')
            if self._error is not None:
                raise CoordinationUnknown('Brain 租约已失去确认，禁止继续执行') from self._error
            if self._deadline is None and not refresh:
                raise CoordinationUnknown('Brain 租约尚未确认')
            if refresh:
                started = time.monotonic()
                wall_started = time.time()
                try:
                    response = self.brain.heartbeat(self.identity, self.seconds)
                    expiry = datetime.fromisoformat(response['lease_until'].replace('Z', '+00:00'))
                    if expiry.tzinfo is None:
                        raise ValueError('lease_until must include timezone')
                    # 请求开始时计算上界，网络等待不能增加租约；保留一秒余量。
                    duration = min(self.seconds, expiry.timestamp() - wall_started) - 1
                    deadline = started + duration
                    wall_deadline = wall_started + duration
                    if time.monotonic() >= deadline or time.time() >= wall_deadline:
                        raise CoordinationUnknown('Brain 续约回复已过期')
                    self._deadline = deadline
                    self._wall_deadline = wall_deadline
                except Exception as error:
                    self._error = error
                    raise CoordinationUnknown('Brain 租约未确认') from error

    def stop(self):
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=6)
            if self._thread.is_alive():
                raise CoordinationUnknown('Brain 续约请求未结束')

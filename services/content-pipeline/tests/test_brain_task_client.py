"""Brain 工作单 wire 合同；HTTP 全部由 MockTransport 拦截。"""
import json
import sys
from pathlib import Path
import httpx
import pytest
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pipeline_worker.brain_tasks import BrainTaskClient, CoordinationUnknown

TASK='12b816a0-a42a-4adf-a190-f1a0cf9600a9'
EPOCH='2026-11-14 04:00:00.123456+00'
IDENTITY={'brain_task_id':TASK,'claimer':'worker-unique','claim_epoch':EPOCH}


def test_claim_heartbeat_finish_preserve_exact_server_epoch():
    calls=[]
    def handler(req):
        body=json.loads(req.content); calls.append((req.url.path,body))
        if req.url.path.endswith('/claim'):
            return httpx.Response(200,json={'id':TASK,'claimed_by':'worker-unique','claim_epoch':EPOCH,'status':'in_progress','lease_until':'later'})
        if req.url.path.endswith('/heartbeat'):
            return httpx.Response(200,json={'ok':True,'lease_until':'later'})
        return httpx.Response(200,json={'ok':True,'task_id':TASK,'status':'completed','replayed':False})
    client=BrainTaskClient('http://brain.test',client=httpx.Client(transport=httpx.MockTransport(handler)))
    identity=client.claim(TASK,'worker-unique',300)
    assert identity==IDENTITY
    client.heartbeat(identity,300)
    client.finish(identity,'completed',{'pipeline_id':'p1','output_manifest':{}})
    assert calls[0][1]=={'claimer':'worker-unique','executor_kind':'external-worker','start':True,'lease_seconds':300,'on_lease_expire':'fail'}
    assert calls[1][1]['claim_epoch']==EPOCH
    assert calls[2][1]['claim_epoch']==EPOCH
    assert calls[2][1]['result']=={'pipeline_id':'p1','output_manifest':{}}
    assert all('/pipelines' not in path and '/can-run' not in path for path,_ in calls)


@pytest.mark.parametrize('status,body',[(409,{'error':'lease_lost'}),(503,{'error':'unknown'}),(200,{'ok':True}),(200,[])])
def test_unconfirmed_heartbeat_cannot_authorize_execution(status,body):
    client=BrainTaskClient('http://brain.test',client=httpx.Client(transport=httpx.MockTransport(lambda req:httpx.Response(status,json=body))))
    with pytest.raises(CoordinationUnknown):client.heartbeat(IDENTITY,300)


def test_claim_missing_precise_epoch_is_unknown():
    response={'id':TASK,'claimed_by':'worker-unique','claimed_at':'2026-11-14T04:00:00.123Z','status':'in_progress','lease_until':'later'}
    client=BrainTaskClient('http://brain.test',client=httpx.Client(transport=httpx.MockTransport(lambda req:httpx.Response(200,json=response))))
    with pytest.raises(CoordinationUnknown):client.claim(TASK,'worker-unique',300)


def test_finish_other_task_or_status_is_not_a_receipt():
    client=BrainTaskClient('http://brain.test',client=httpx.Client(transport=httpx.MockTransport(lambda req:httpx.Response(200,json={'ok':True,'task_id':TASK,'status':'failed'}))))
    with pytest.raises(CoordinationUnknown):client.finish(IDENTITY,'completed',{})


def test_paused_heartbeat_thread_cannot_authorize_after_deadline(monkeypatch):
    from pipeline_worker import brain_tasks
    clock = {'mono': 10.0, 'wall': 1000.0}
    monkeypatch.setattr(brain_tasks.time, 'monotonic', lambda: clock['mono'])
    monkeypatch.setattr(brain_tasks.time, 'time', lambda: clock['wall'])
    class Brain:
        calls = 0
        def heartbeat(self, identity, seconds):
            self.calls += 1
            return {'ok': True, 'lease_until': '1970-01-01T00:21:40+00:00'}
    brain = Brain()
    lease = brain_tasks.LeaseHeartbeat(brain, IDENTITY)
    lease.check(refresh=True)
    clock.update(mono=311.0, wall=1301.0)
    with pytest.raises(CoordinationUnknown):
        lease.check()  # 模拟线程完全没有调度，不能只依赖后台_error
    with pytest.raises(CoordinationUnknown):
        lease.check(refresh=True)
    assert brain.calls == 1


def test_network_wait_does_not_extend_confirmed_lease(monkeypatch):
    from pipeline_worker import brain_tasks
    clock = {'mono': 10.0, 'wall': 1000.0}
    monkeypatch.setattr(brain_tasks.time, 'monotonic', lambda: clock['mono'])
    monkeypatch.setattr(brain_tasks.time, 'time', lambda: clock['wall'])
    class Brain:
        def heartbeat(self, identity, seconds):
            clock.update(mono=290.0, wall=1280.0)
            return {'ok': True, 'lease_until': '1970-01-01T00:21:40+00:00'}
    lease = brain_tasks.LeaseHeartbeat(Brain(), IDENTITY)
    lease.check(refresh=True)
    clock.update(mono=311.0, wall=1301.0)
    with pytest.raises(CoordinationUnknown):
        lease.check()


def test_sleep_with_frozen_monotonic_still_expires_wall_deadline(monkeypatch):
    from pipeline_worker import brain_tasks
    clock = {'mono': 10.0, 'wall': 1000.0}
    monkeypatch.setattr(brain_tasks.time, 'monotonic', lambda: clock['mono'])
    monkeypatch.setattr(brain_tasks.time, 'time', lambda: clock['wall'])
    class Brain:
        calls = 0
        def heartbeat(self, identity, seconds):
            self.calls += 1
            return {'ok': True, 'lease_until': '1970-01-01T00:21:40+00:00'}
    brain = Brain()
    lease = brain_tasks.LeaseHeartbeat(brain, IDENTITY)
    lease.check(refresh=True)
    clock['wall'] = 1301.0  # 系统睡眠时monotonic可能未推进
    with pytest.raises(CoordinationUnknown):
        lease.check()
    with pytest.raises(CoordinationUnknown):
        lease.check(refresh=True)
    assert brain.calls == 1

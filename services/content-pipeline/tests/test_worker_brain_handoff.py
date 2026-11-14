"""隔离业务 smoke：有 Brain 租约才执行，终态先入 Brain，再更新 ZJ。"""
from datetime import datetime, timedelta, timezone
import json
import sys
import threading
import time
from pathlib import Path
from unittest.mock import Mock, patch

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pipeline_worker import worker

TASK = '12b816a0-a42a-4adf-a190-f1a0cf9600a9'
EPOCH = '2026-11-14 04:00:00.123456+00'


class Brain:
    def __init__(self, events):
        self.events = events
        self.fail_claim = False
        self.fail_finish = False
        self.heartbeat_error = None

    def claim(self, task_id, claimer, lease_seconds):
        self.events.append('brain-claim')
        if self.fail_claim:
            raise RuntimeError('Brain unavailable')
        return {'brain_task_id': task_id, 'claimer': claimer, 'claim_epoch': EPOCH}

    def heartbeat(self, identity, lease_seconds):
        self.events.append('heartbeat')
        if self.heartbeat_error:
            raise self.heartbeat_error
        return {'ok': True, 'lease_until': (datetime.now(timezone.utc) + timedelta(seconds=lease_seconds)).isoformat()}

    def finish(self, identity, status, result):
        self.events.append(('brain-finish', status, result))
        if self.fail_finish:
            raise RuntimeError('ambiguous finish response')
        return {'ok': True, 'task_id': identity['brain_task_id'], 'status': status}


class Local:
    def __init__(self, events):
        self.events = events
        self.fail_final = False

    def claim_pipeline(self, pid, identity):
        self.events.append('local-claim')
        return {}

    def stage_complete(self, pid, stage, **kwargs):
        self.events.append(('local-stage', stage, kwargs))
        if kwargs.get('is_final') and self.fail_final:
            raise RuntimeError('local final unavailable')
        return {}

    def fail_pipeline(self, pid, error, **kwargs):
        self.events.append(('local-fail', error, kwargs))
        return {}


def pipeline(**kwargs):
    return {'id': 'p1', 'keyword': 'demo', 'cecelia_task_id': TASK, **kwargs}


def stages(events, *, failing=False):
    def first(_):
        events.append('execute-research')
        return {'success': not failing, **({'error': 'bad content'} if failing else {})}
    def last(_):
        events.append('execute-export')
        return {'success': True}
    return [('research', None, first), ('export', None, last)]


def run(tmp_path, events, brain=None, local=None, p=None):
    with patch.object(worker, 'STAGES', stages(events)), patch.object(worker, 'can_run', return_value={'approved': True}):
        return worker.process_pipeline(local or Local(events), p or pipeline(), dry_run=False,
            brain_client=brain or Brain(events), checkpoint_dir=tmp_path, heartbeat_interval=0.02)


def test_missing_task_never_executes_or_claims(tmp_path):
    events = []
    assert run(tmp_path, events, p={'id': 'p1', 'keyword': 'demo'}) is False
    assert events == []


def test_claim_failure_does_not_run_or_fail_business(tmp_path):
    events = []; brain = Brain(events); brain.fail_claim = True
    assert run(tmp_path, events, brain) is False
    assert events == ['brain-claim']


def test_success_claims_before_effect_and_finishes_brain_before_local(tmp_path):
    events = []; brain = Brain(events)
    assert run(tmp_path, events, brain) is True
    assert events.index('brain-claim') < events.index('local-claim') < events.index('execute-research')
    final = [e for e in events if isinstance(e, tuple) and e[0] == 'local-stage' and e[2].get('is_final')][0]
    receipt = [e for e in events if isinstance(e, tuple) and e[0] == 'brain-finish'][0]
    assert events.index(receipt) < events.index(final)
    assert final[2]['identity']['claim_epoch'] == EPOCH
    assert final[2]['brain_result'] == receipt[2]
    assert not list(tmp_path.glob('*.json'))


def test_ambiguous_brain_finish_retries_receipt_without_reexecuting(tmp_path):
    events = []; brain = Brain(events); brain.fail_finish = True
    assert run(tmp_path, events, brain) is False
    assert not any(isinstance(e,tuple) and e[0]=='local-stage' and e[2].get('is_final') for e in events)
    assert len(list(tmp_path.glob('*.json'))) == 1
    count = events.count('execute-research'); brain.fail_finish = False
    assert run(tmp_path, events, brain) is True
    assert events.count('execute-research') == count
    finishes = [e[2] for e in events if isinstance(e,tuple) and e[0]=='brain-finish']
    assert finishes[0] == finishes[1]


def test_local_final_error_replays_identical_terminal_without_business(tmp_path):
    events = []; brain = Brain(events); local = Local(events); local.fail_final = True
    assert run(tmp_path, events, brain, local) is False
    assert len(list(tmp_path.glob('*.json'))) == 1
    count = events.count('execute-export'); local.fail_final = False
    assert run(tmp_path, events, brain, local) is True
    assert events.count('execute-export') == count
    assert not list(tmp_path.glob('*.json'))


def test_existing_claim_without_terminal_checkpoint_never_reexecutes(tmp_path):
    events = []
    bound = {'brain_task_id': TASK, 'claimer': 'previous', 'claim_epoch': EPOCH}
    assert run(tmp_path, events, p=pipeline(output_manifest={'brain_claim': bound})) is False
    assert events == []


def test_heartbeat_loss_during_long_stage_stops_following_effects(tmp_path):
    events = []; brain = Brain(events); lost = threading.Event()
    original_heartbeat = brain.heartbeat
    def observed_heartbeat(identity, seconds):
        try:
            return original_heartbeat(identity, seconds)
        except Exception:
            lost.set()
            raise
    brain.heartbeat = observed_heartbeat
    def long_stage(_):
        events.append('execute-long')
        brain.heartbeat_error = RuntimeError('lease lost')
        assert lost.wait(2), '后台续约必须在业务阻塞期间继续执行'
        return {'success': True}
    defs = [('research', None, long_stage), ('export', None, lambda _: events.append('illegal') or {'success': True})]
    with patch.object(worker,'STAGES',defs):
        assert worker.process_pipeline(Local(events),pipeline(),False,brain_client=brain,
            checkpoint_dir=tmp_path,heartbeat_interval=0.01) is False
    assert 'illegal' not in events
    assert not any(isinstance(e,tuple) and e[0] in ('local-fail','brain-finish','local-stage') for e in events)


def test_business_failure_receipt_precedes_local_failure(tmp_path):
    events=[];brain=Brain(events)
    with patch.object(worker,'STAGES',stages(events,failing=True)):
        assert worker.process_pipeline(Local(events),pipeline(),False,brain_client=brain,
            checkpoint_dir=tmp_path,heartbeat_interval=0.02) is False
    receipt = next(e for e in events if isinstance(e,tuple) and e[0]=='brain-finish')
    failure = next(e for e in events if isinstance(e,tuple) and e[0]=='local-fail')
    assert receipt[1] == 'failed'
    assert events.index(receipt) < events.index(failure)
    assert receipt[2] == failure[2]['brain_result']


def test_stage_final_empty_manifest_is_preserved_over_real_http_body(tmp_path):
    import httpx
    from lib.http_client import ZenithJoyClient
    events=[];bodies=[]
    def handler(req):
        body=json.loads(req.content);bodies.append((req.url.path,body))
        return httpx.Response(200,json={'success':True,'data':{}})
    http=httpx.Client(base_url='http://local.test',transport=httpx.MockTransport(handler))
    local=ZenithJoyClient('http://local.test',client=http)
    assert run(tmp_path,events,Brain(events),local)
    final=next(body for path,body in bodies if path.endswith('/stage-complete') and body.get('is_final'))
    assert final['output']=={}
    assert final['brain_result']=={'pipeline_id':'p1','output_manifest':{}}
    assert final['claim_epoch']==EPOCH


def test_terminal_recovery_does_not_depend_on_running_queue(tmp_path):
    from pipeline_worker.polling import recover_terminals
    events=[];brain=Brain(events);brain.fail_finish=True
    assert run(tmp_path,events,brain) is False
    count=events.count('execute-research')
    brain.fail_finish=False
    assert recover_terminals(Local(events),brain_client=brain,directory=tmp_path)==1
    assert events.count('execute-research')==count
    assert not list(tmp_path.glob('*.json'))


def test_candidate_pages_rotate_between_worker_invocations(tmp_path,monkeypatch):
    from pipeline_worker.polling import poll_page
    monkeypatch.setenv('XDG_STATE_HOME',str(tmp_path))
    offsets=[]
    class Client:
        base_url='http://local.test'
        def list_running_pipeline_page(self,limit,offset):
            offsets.append(offset)
            if offset==0:return {'items':[{'id':'old-claimed'}],'next_offset':1}
            return {'items':[{'id':'new-pending'}],'next_offset':None}
    assert poll_page(Client(),limit=1)[0]['id']=='old-claimed'
    assert poll_page(Client(),limit=1)[0]['id']=='new-pending'
    assert poll_page(Client(),limit=1)[0]['id']=='old-claimed'
    assert offsets==[0,1,0]


def test_real_six_fake_executors_complete_owned_artifacts_and_lease_receipt(tmp_path, monkeypatch):
    """执行真实六阶段函数和文件写入，仅HTTP对端隔离；不替换STAGES/executor。"""
    import httpx
    from lib.http_client import ZenithJoyClient
    from pipeline_worker.brain_tasks import BrainTaskClient

    monkeypatch.setenv('E2E_FAKE_EXECUTORS', 'true')
    monkeypatch.setenv('CONTENT_OUTPUT_DIR', str(tmp_path / 'artifacts'))
    events = []
    identity = {}
    terminal = {}
    output_dir = tmp_path / 'artifacts/runs/p1'

    def handler(request):
        body = json.loads(request.content)
        path = request.url.path
        events.append((path, body))
        expiry = (datetime.now(timezone.utc) + timedelta(seconds=300)).isoformat()
        if path.endswith('/claim') and '/brain/' in path:
            identity.update(brain_task_id=TASK, claimer=body['claimer'], claim_epoch=EPOCH)
            assert body['start'] is True and body['on_lease_expire'] == 'fail'
            return httpx.Response(200, json={'id': TASK, 'claimed_by': body['claimer'],
                'claim_epoch': EPOCH, 'status': 'in_progress', 'lease_until': expiry})
        if path.endswith('/heartbeat'):
            assert body['claimer'] == identity['claimer'] and body['claim_epoch'] == EPOCH
            return httpx.Response(200, json={'ok': True, 'lease_until': expiry})
        if path.endswith('/lease/finish'):
            assert body['status'] == 'completed', body
            assert (output_dir / 'manifest.json').is_file()
            terminal.update(body)
            return httpx.Response(200, json={'ok': True, 'task_id': TASK, 'status': 'completed'})
        assert all(body.get(k) == value for k, value in identity.items())
        if path.endswith('/stage-complete'):
            if body.get('is_final'):
                assert terminal and body['brain_result'] == terminal['result']
            else:
                assert not terminal
        else:
            assert path == '/api/pipelines/p1/claim', path
        return httpx.Response(200, json={'success': True, 'data': {}})

    transport = httpx.MockTransport(handler)
    with httpx.Client(base_url='http://zj.invalid', transport=transport) as http:
        brain = BrainTaskClient('http://brain.invalid', client=http)
        local = ZenithJoyClient('http://zj.invalid', client=http)
        # Fake业务不得调用任何模型/Notebook/图片/NAS外部服务。
        with patch.object(worker, 'can_run', return_value={'approved': True}), \
                patch('urllib.request.urlopen', side_effect=AssertionError('fake executor external HTTP')), \
                patch('subprocess.run', side_effect=AssertionError('fake executor external process')):
            assert worker.process_pipeline(local, pipeline(output_dir=str(output_dir)), dry_run=False,
                brain_client=brain, checkpoint_dir=tmp_path / 'receipts') is True
    stages = [body['stage'] for path, body in events if path.endswith('/stage-complete')]
    assert stages == ['research', 'copywriting', 'copy_review', 'generate', 'image_review', 'export']
    assert json.loads((output_dir / 'findings.json').read_text())['fake'] is True
    assert '(fake copywriting output for e2e CI)' in (output_dir / 'content.md').read_text()
    manifest = json.loads((output_dir / 'manifest.json').read_text())
    assert manifest['pipeline_id'] == 'p1' and manifest['fake'] is True
    result = terminal['result']
    assert result['pipeline_id'] == 'p1' and result['output_manifest']['pipeline_id'] == 'p1'
    assert result['output_manifest']['output_dir'] == str(output_dir)
    assert not list((tmp_path / 'receipts').glob('*.json'))

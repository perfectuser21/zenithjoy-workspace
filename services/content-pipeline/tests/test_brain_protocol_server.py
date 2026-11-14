"""The isolated CI consumer fixture must enforce the same identity boundaries.

This validates the fixture itself, not the production Brain implementation.
"""
import copy
import io
import importlib.util
import json
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location('brain_protocol_server', Path(__file__).parent / 'helpers' / 'brain_protocol_server.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
# Only this loopback fixture client: allow the bounded Node digest plus 2s HTTP margin.
HTTP_REQUEST_TIMEOUT_SECONDS = fixture.DIGEST_TIMEOUT_SECONDS + 2


@pytest.fixture
def brain():
    state = fixture.ProtocolState()
    server = fixture.make_server(state)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    def post(path, body):
        request = urllib.request.Request(f'http://127.0.0.1:{server.server_port}' + path,
            data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=HTTP_REQUEST_TIMEOUT_SECONDS) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            with error:
                return error.code, json.load(error)
    yield state, post
    server.shutdown()
    server.server_close()
    thread.join(timeout=2)


def claim(post):
    code, task = post('/api/brain/tasks', {'task_type': 'content-pipeline', 'mutation_intent': 'read_only',
        'source_id': 'zenithjoy:pipeline:11111111-1111-4111-8111-111111111111',
        'title': 'Content Pipeline 11111111-1111-4111-8111-111111111111: test',
        'payload': {'business_owner': 'zenithjoy', 'zenithjoy_pipeline_run_id': '11111111-1111-4111-8111-111111111111'}})
    assert code == 201
    code, owned = post(f"/api/brain/tasks/{task['id']}/claim", {'claimer': 'worker-one',
        'executor_kind': 'external-worker', 'start': True, 'lease_seconds': 300, 'on_lease_expire': 'fail'})
    assert code == 200
    return task['id'], {'claimer': 'worker-one', 'claim_epoch': owned['claim_epoch']}


def test_fixture_requires_registered_task_and_valid_finite_lease(brain):
    state, post = brain
    assert post('/api/brain/tasks', {'task_type': 'dev'})[0] == 400
    task_id, identity = claim(post)
    assert post(f'/api/brain/tasks/{task_id}/claim', {**identity, 'start': True,
        'executor_kind': 'external-worker', 'lease_seconds': 300, 'on_lease_expire': 'fail'})[0] == 409
    assert [x['action'] for x in state.events] == ['register', 'claim']


def test_fixture_rejects_old_owner_epoch_and_expired_lease(brain):
    state, post = brain
    task_id, identity = claim(post)
    path = f'/api/brain/tasks/{task_id}/heartbeat'
    assert post(path, {**identity, 'claimer': 'other'})[0] == 409
    assert post(path, {**identity, 'claim_epoch': '2020-01-01T00:00:00.000001+00:00'})[0] == 409
    assert post(path, identity)[0] == 200
    state.tasks[task_id]['lease_deadline'] = 0
    assert post(path, identity)[0] == 409
    assert post(f'/api/brain/tasks/{task_id}/lease/finish', {**identity, 'status': 'completed', 'result': {}})[0] == 409


def test_fixture_terminal_receipt_replay_is_exact_and_cannot_revive_lease(brain):
    state, post = brain
    task_id, identity = claim(post)
    body = {**identity, 'status': 'completed', 'result': {'pipeline_id': 'local', 'stages': 6}}
    path = f'/api/brain/tasks/{task_id}/lease/finish'
    code, receipt = post(path, body)
    assert code == 200 and receipt['replayed'] is False
    assert receipt['receipt']['result_sha256'] == fixture.digest(body['result'])
    assert post(path, body)[1]['replayed'] is True
    assert post(path, {**body, 'result': {'pipeline_id': 'changed'}})[0] == 409
    assert post(path, {**body, 'claim_epoch': 'old'})[0] == 409
    assert post(f'/api/brain/tasks/{task_id}/heartbeat', identity)[0] == 409
    assert state.tasks[task_id]['status'] == 'completed'
    assert [x['action'] for x in state.events] == ['register', 'claim', 'finish', 'finish-replay']


@pytest.mark.parametrize('invalid', ['owner', 'epoch', 'expired'])
def test_invalid_terminal_lease_is_fenced_before_digest(brain, monkeypatch, invalid):
    state, post = brain
    task_id, identity = claim(post)
    body = {**identity, 'status': 'completed', 'result': {'pipeline_id': 'local'}}
    if invalid == 'owner':
        body['claimer'] = 'old-worker'
    elif invalid == 'epoch':
        body['claim_epoch'] = 'old-epoch'
    else:
        state.tasks[task_id]['lease_deadline'] = 0
    before_task, before_events = copy.deepcopy(state.tasks[task_id]), copy.deepcopy(state.events)
    def forbidden_digest(_):
        pytest.fail('invalid terminal lease must not launch Node digest')
    monkeypatch.setattr(fixture, 'digest', forbidden_digest)
    code, response = state.request('POST', f'/api/brain/tasks/{task_id}/lease/finish', body)
    assert code == 409 and response['error'] == 'lease_lost'
    assert state.tasks[task_id] == before_task
    assert state.events == before_events
    assert 'result' not in state.tasks[task_id]


@pytest.mark.parametrize('field,value', [('claimer', 'other'), ('claim_epoch', 'old'), ('status', 'failed')])
def test_terminal_replay_identity_is_fenced_before_digest(brain, monkeypatch, field, value):
    state, post = brain
    task_id, identity = claim(post)
    body = {**identity, 'status': 'completed', 'result': {'pipeline_id': 'local'}}
    path = f'/api/brain/tasks/{task_id}/lease/finish'
    assert state.request('POST', path, body)[0] == 200
    before_task, before_events = copy.deepcopy(state.tasks[task_id]), copy.deepcopy(state.events)
    def forbidden_digest(_):
        pytest.fail('conflicting receipt identity must not launch Node digest')
    monkeypatch.setattr(fixture, 'digest', forbidden_digest)
    code, response = state.request('POST', path, {**body, field: value})
    assert code == 409 and response['error'] == 'lease_receipt_conflict'
    assert state.tasks[task_id] == before_task
    assert state.events == before_events


def test_http_error_response_is_closed(brain, monkeypatch):
    _, post = brain
    stream = io.BytesIO(b'{"error":"lease_lost"}')
    error = urllib.error.HTTPError('http://127.0.0.1', 409, 'conflict', {}, stream)
    def rejected(*args, **kwargs):
        raise error
    monkeypatch.setattr(urllib.request, 'urlopen', rejected)
    assert post('/api/brain/tasks/invalid/heartbeat', {}) == (409, {'error': 'lease_lost'})
    assert stream.closed


def test_valid_finish_waits_for_digest_within_server_budget(brain, monkeypatch):
    state, post = brain
    assert fixture.DIGEST_TIMEOUT_SECONDS == 5
    assert HTTP_REQUEST_TIMEOUT_SECONDS == fixture.DIGEST_TIMEOUT_SECONDS + 2
    task_id, identity = claim(post)
    real_digest = fixture.digest
    result = {'pipeline_id': 'local', 'output_manifest': {'ratio': 1.25, '😀': 'unicode'}}
    expected_digest = real_digest(result)
    def slow_valid_digest(value):
        # Exceed the former 2s HTTP budget without exceeding Node's 5s budget.
        time.sleep(2.1)
        return real_digest(value)
    monkeypatch.setattr(fixture, 'digest', slow_valid_digest)
    code, response = post(f'/api/brain/tasks/{task_id}/lease/finish',
        {**identity, 'status': 'completed', 'result': result})
    assert code == 200 and response['receipt']['result_sha256'] == expected_digest
    assert state.tasks[task_id]['status'] == 'completed'
    assert [event['action'] for event in state.events] == ['register', 'claim', 'finish']

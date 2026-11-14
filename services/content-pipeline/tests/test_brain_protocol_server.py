"""The isolated CI consumer fixture must enforce the same identity boundaries.

This validates the fixture itself, not the production Brain implementation.
"""
import importlib.util
import json
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location('brain_protocol_server', Path(__file__).parent / 'helpers' / 'brain_protocol_server.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


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
            with urllib.request.urlopen(request, timeout=2) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
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

#!/usr/bin/env python3
"""原生 infra 巡查的共享真实性验证库；不启动 Agent 或手机。"""
import hashlib
import json
import os
import pathlib
import re
import tempfile

STATE = pathlib.Path.home() / '.local/share/phone-account-patrol'
API = 'http://localhost:5221/api/brain/'
PHONE_SOURCE_REVISION = '4f899cab6425341646e27c5fca20979b8ac42be7'
MAINTENANCE_WORKFLOW_ID = 'e4d2030f-129f-4668-95dd-4a6d880493a8'
EXPECTED_SHA256 = {
    'runner.py': '26c5e6dc065b42f8298e485aca2492f25eb83b8a9650409ca3dc33b51798b9ce',
    'collector.py': '501dd4af5358676473201ecbf8c3712db682e9a17128d52e3565021a3cb521f3',
    'dispatch.py': 'ea60ff9e538aa77f991d5f234d47cb392a2613ead560c0963d5949d53a1694de',
    'preflight.py': 'a2874821f56add3ab2e80e5ded7510d2df0b4f2bbf09b87fc63a755b59918ce0',
    'publish.mjs': '528daa587ceba84348723fbf24a7169645462a71a1378407910ed0d2b5daf6bf',
    'ocr.swift': '89431efae1526a56b9e5164cee7293f4ea877f6d4ca61f1b76b05f48d3291005',
    'SKILL.md': 'ee99dc331f8aec05c1071260dcfb06197c4add7d74b5160ea3084b5b8b5e6dde',
    'mirror.mjs': 'a628a9406528a24de126a9cafdc63c17a9f9f8e0d82d1b2dd41a94a3efc8ebb0',
}
UUID = r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}'


def uuid(value):
    if not isinstance(value, str) or not re.fullmatch(UUID, value):
        raise ValueError('任务或流程身份不是完整 UUID')
    return value


def save(state, name, value):
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary_name = tempfile.mkstemp(prefix=name + '.', suffix='.tmp', dir=str(state))
    temporary = pathlib.Path(temporary_name)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(value, stream, ensure_ascii=False, indent=2)
        target = state / name
        temporary.replace(target)
        return target
    finally:
        if temporary.exists():
            temporary.unlink()


def load_deployment(state):
    pointer = json.loads((state / 'deployment-current.json').read_text())
    expected = state / 'releases' / PHONE_SOURCE_REVISION
    release = pathlib.Path(pointer.get('release', ''))
    if pointer.get('source_revision') != PHONE_SOURCE_REVISION or release != expected or release.is_symlink():
        raise ValueError('部署指针没有指向已验收的冻结手机代码')
    for key in ['single_workflow_id', 'batch_workflow_id', 'project_id', 'schedule_id']:
        uuid(pointer.get(key))
    manifest = json.loads((release / 'deployment.json').read_text())
    if pointer.get('sha256') != EXPECTED_SHA256 or manifest.get('sha256') != EXPECTED_SHA256:
        raise ValueError('部署文件清单不是已验收版本')
    for key in ['source_revision', 'single_workflow_id', 'batch_workflow_id', 'project_id', 'schedule_id']:
        if manifest.get(key) != pointer[key]:
            raise ValueError('部署指针与冻结 manifest 不一致')
    for name, digest in EXPECTED_SHA256.items():
        path = release / name
        if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError('冻结代码指纹不一致：' + name)
    return pointer


def read_task(call, task_id):
    value = call('tasks/' + uuid(task_id))
    if isinstance(value, dict) and isinstance(value.get('task'), dict):
        value = value['task']
    if not isinstance(value, dict) or value.get('id') != task_id:
        raise ValueError('中央任务读回身份不一致')
    return value


def verify_children(receipt, task_id, deployment, call, *, current_phones=True):
    if not isinstance(receipt, dict) or receipt.get('task_id') != task_id or receipt.get('source_revision') != PHONE_SOURCE_REVISION:
        raise ValueError('批次回执身份或版本不一致')
    if receipt.get('status') != 'queued' or not isinstance(receipt.get('children'), list) or not receipt['children']:
        raise ValueError('批次缺少真实非空派发回执')
    seen_ids, seen_serials, children = set(), set(), []
    for child in receipt['children']:
        if not isinstance(child, dict):
            raise ValueError('子任务回执非法')
        child_id = uuid(child.get('task_id'))
        serial = child.get('serial')
        if not isinstance(serial, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', serial):
            raise ValueError('手机标识非法')
        if child_id == task_id or child_id in seen_ids or serial in seen_serials:
            raise ValueError('手机或子任务重复')
        seen_ids.add(child_id)
        seen_serials.add(serial)
        task = read_task(call, child_id)
        payload = task.get('payload') or {}
        if (task.get('parent_task_id') != task_id or task.get('task_type') != 'script_run'
                or task.get('project_id') != deployment['project_id']
                or not re.fullmatch(UUID, payload.get('routing_receipt_id') or '')
                or payload.get('workflow_id') != deployment['single_workflow_id']
                or payload.get('source_revision') != PHONE_SOURCE_REVISION or payload.get('phone_serial') != serial):
            raise ValueError('中央子任务与冻结巡查合同不一致')
        children.append(task)
    if current_phones:
        enabled = [p['serial'] for p in call('phone-registry')['phones'] if p.get('enabled')]
        if len(enabled) != len(set(enabled)) or seen_serials != set(enabled):
            raise ValueError('派发手机集合与当前启用清单不一致')
    return children

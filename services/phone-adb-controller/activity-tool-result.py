"""Typed local admission rejection; never infer dispatch state from error text."""
import json
import time


class PreDispatchRejected(ValueError):
    """Only explicitly trusted pure local admission checks may create this."""
    def __init__(self):
        super().__init__('LOCK_WRITE_SCOPE')
        self.code = 'LOCK_WRITE_SCOPE'
        self.details = {'expected_fields': ['device_name', 'locked_by']}


def scope_rejection(code):
    """Called explicitly only by trusted pure parameter validators."""
    error = PreDispatchRejected()
    error.code = code
    error.args = (code,)
    error.details = {'tool_hint': '按冻结工具参数合同修正；原错误action只读回，修正需新action名。'}
    return error


def resource_rejection(central, local, *, central_owner, local_owner):
    """Only complete successful read-only observations can reach this branch."""
    error = scope_rejection('RESOURCE_AUTHORITY')
    error.details = {
        'read_only_resource_observation': True,
        'next_actions': (['brain device-locks/acquire', 'phone lock-acquire-new'] if central['locked_by'] is None and local['lock'] == 'free' else ['phone lock-acquire-new'] if central['locked_by'] == central_owner and local['lock'] == 'free' else ['stop_without_reclaim']),
        'required': {'central_locked_by': central_owner, 'local_owner': local_owner},
        'observed': {
            'central': {k: central.get(k) for k in ['device_name', 'locked_by', 'expires_at', 'lease_version']},
            'local': {k: local[k] for k in ['lock', 'owner', 'stale', 'reclaimable', 'reason'] if k in local}},
        'tool_hint': 'company_config会建立本run快照，必须先取得本人中央与本地双锁；Task/冻结company-before资料由宿主提供。若锁属他人或preserved，停止，不抢锁。'}
    return error


def central_owner_rejection(central, *, required_owner):
    error = scope_rejection('CENTRAL_OWNER_REQUIRED')
    error.details = {
        'read_only_central_observation': True,
        'required': {'central_locked_by': required_owner},
        'observed': {'central': {k: central.get(k) for k in ['device_name', 'locked_by', 'expires_at', 'lease_version']}},
        'next_actions': ['brain device-locks/acquire'] if central['locked_by'] is None else ['stop_without_reclaim'],
        'tool_hint': '先取得本人中央锁，再请求本地锁；他人锁不抢占，未执行phone lock-acquire。'}
    return error


def lease_cas_rejection(version):
    error = scope_rejection('LEASE_CAS_REQUIRED')
    error.details = {'read_only_central_observation': True,
                     'observed_lease_version': version,
                     'expected_fields': ['device_name', 'locked_by', 'expected_lease_version'],
                     'next_actions': ['brain GET device-locks'],
                     'tool_hint': '先fresh读取本人中央锁版本，再用新action名和精确expected_lease_version释放；未调用release API。'}
    return error


def read_business_input(args, *, activity, allowed_operations):
    """Parse once and reject only pure argument/op errors before any dispatch."""
    allowed = sorted(allowed_operations)
    try:
        value = json.loads(args[0]) if len(args) == 1 else None
    except (ValueError, TypeError):
        value = None
    code = ('BUSINESS_INPUT_INVALID' if not isinstance(value, dict)
            or not isinstance(value.get('op'), str) or not value['op']
            else 'BUSINESS_ACTIVITY_SCOPE' if value['op'] not in allowed else None)
    if code:
        error = PreDispatchRejected()
        error.code = code
        error.details = {'activity': activity, 'allowed_operations': allowed,
                         'tool_hint': 'Task身份由宿主task_authority每次自动核验；无business task_read。preflight从brain args=[device-locks]开始，business仅使用allowed_operations。'}
        raise error
    return value


def emit_pre_dispatch_rejection(error, *, action, binding, started_at, persist):
    if type(error) is not PreDispatchRejected:
        raise error
    result = {'exit_code': 2, 'error': error.code, 'data': {
        'phase': 'pre_dispatch', 'dispatched': False, 'external_effect': 'none',
        **error.details, 'correction_requires_new_action_name': True}}
    receipt = {'binding': binding, 'state': 'terminal', 'started_at': started_at,
               'result': result, 'ended_at': time.time()}
    # A failed receipt write must never be reported as a terminal receipt.
    persist(action, receipt)
    print(json.dumps(receipt, ensure_ascii=False))
    return 2


def admit_tool_request(c, activity, kind, args):
    """Only syntax/scope checks: no files, credentials, resource calls or dispatch."""
    known = {'phone', 'business', 'brain', 'proof', 'fetch-native', 'metrics', 'qualify',
             'native-readback', 'collection-readback', 'collection-evidence',
             'outreach', 'outreach-phone', 'outreach-proof'}
    def reject(code):
        error = scope_rejection(code)
        if code == 'QUALIFICATION_RECOVERY_READ_ONLY':
            error.details['tool_hint'] = 'qualify是转写/模型执行，不是只读验收命令；恢复资格仅用proof发布冻结qualification_evidence，随后交提案，由宿主checker验收并传动态qualification_receipt。'
        elif code == 'TOOL_KIND':
            error.details['allowed_kinds'] = sorted(known)
        raise error
    if kind not in known:
        reject('TOOL_KIND')
    if not isinstance(args, list) or any(not isinstance(x, str) for x in args):
        reject('TOOL_ARGS')
    stage = c['assigned_workflow']
    prepared = {}
    def object_arg():
        try:
            value = json.loads(args[0]) if len(args) == 1 else None
        except (ValueError, TypeError):
            value = None
        if not isinstance(value, dict):
            reject('TOOL_JSON_OBJECT_REQUIRED')
        return value
    if kind == 'brain':
        if len(args) not in (1, 2):
            reject('BRAIN_INPUT_SCOPE')
        body = None
        if len(args) == 2:
            try:
                body = json.loads(args[1])
            except (ValueError, TypeError):
                reject('BRAIN_INPUT_SCOPE')
            if not isinstance(body, dict):
                reject('BRAIN_INPUT_SCOPE')
            allowed = ((activity == 'preflight' and args[0] == 'device-locks/acquire')
                       or (activity == 'cleanup' and args[0] == 'device-locks/release'))
            if not allowed or body.get('device_name') != c['serial'] or body.get('locked_by') != c['central_owner']:
                raise PreDispatchRejected()
        elif args[0] != 'device-locks':
            reject('BRAIN_READ_SCOPE')
        prepared['brain'] = (args[0], body)
    elif kind == 'proof':
        if activity not in ('collect_videos', 'qualification'):
            reject('PROOF_ACTIVITY_SCOPE')
        value = object_arg()
        expected = 'filter_evidence' if activity == 'collect_videos' else 'qualification_evidence'
        if set(value) != {expected}:
            reject('PROOF_FIELDS')
        prepared['proof'] = value
    elif kind == 'qualify':
        if c.get('recovery', {}).get('mode') == 'qualification-readonly-v1':
            reject('QUALIFICATION_RECOVERY_READ_ONLY')
        if activity != 'qualification' or len(args) != 2 or args[0] not in c['verification'].get('102', {}).get('video_ids', []):
            reject('QUALIFICATION_SCOPE')
    elif kind == 'metrics':
        if activity != 'collect_videos' or len(args) != 1:
            reject('METRICS_ACTIVITY_SCOPE')
        prepared['metrics'] = object_arg()
    elif kind == 'fetch-native':
        import re
        run = c['tasks'][stage]['run_tag']
        if len(args) != 1 or not (re.fullmatch(re.escape(run)+r'-[A-Za-z0-9_.-]+', args[0])
                or (stage == '104' and args[0] == c['local_owner']+'-outward-ledger.jsonl')):
            reject('NATIVE_FILE_SCOPE')
    elif kind == 'native-readback':
        if args:
            reject('NATIVE_READBACK_TAKES_NO_ARGS')
    elif kind == 'collection-readback':
        if stage != '102' or activity != 'collection' or args:
            reject('COLLECTION_READBACK_SCOPE')
    elif kind == 'collection-evidence':
        if stage != '102' or activity != 'collection' or len(args) != 1:
            reject('COLLECTION_EVIDENCE_SCOPE')
        prepared['collection-evidence'] = object_arg()
    elif kind.startswith('outreach') and stage != '104':
        reject('OUTREACH_WORKFLOW_SCOPE')
    return prepared

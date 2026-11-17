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
        'next_actions': ['brain device-locks/acquire', 'phone lock-acquire-new'] if central['locked_by'] is None and local['lock'] == 'free' else ['stop_without_reclaim'],
        'required': {'central_locked_by': central_owner, 'local_owner': local_owner},
        'observed': {
            'central': {k: central.get(k) for k in ['device_name', 'locked_by', 'expires_at', 'lease_version']},
            'local': {k: local[k] for k in ['lock', 'owner', 'stale', 'reclaimable', 'reason'] if k in local}},
        'tool_hint': 'company_config会建立本run快照，必须先取得本人中央与本地双锁；Task/冻结company-before资料由宿主提供。若锁属他人或preserved，停止，不抢锁。'}
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

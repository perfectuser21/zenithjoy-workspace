"""Typed local admission rejection; never infer dispatch state from error text."""
import json
import time


class PreDispatchRejected(ValueError):
    """Only explicitly trusted pure local admission checks may create this."""
    def __init__(self):
        super().__init__('LOCK_WRITE_SCOPE')
        self.code = 'LOCK_WRITE_SCOPE'
        self.details = {'expected_fields': ['device_name', 'locked_by']}


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

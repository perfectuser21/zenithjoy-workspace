"""Typed local admission rejection; never infer dispatch state from error text."""
import json
import time


class PreDispatchRejected(ValueError):
    """Only the trusted adapter's pure local lock-write admission may create this."""
    def __init__(self):
        super().__init__('LOCK_WRITE_SCOPE')


def emit_pre_dispatch_rejection(error, *, action, binding, started_at, persist):
    if type(error) is not PreDispatchRejected:
        raise error
    result = {'exit_code': 2, 'error': 'LOCK_WRITE_SCOPE', 'data': {
        'phase': 'pre_dispatch', 'dispatched': False, 'external_effect': 'none',
        'expected_fields': ['device_name', 'locked_by'],
        'correction_requires_new_action_name': True}}
    receipt = {'binding': binding, 'state': 'terminal', 'started_at': started_at,
               'result': result, 'ended_at': time.time()}
    # A failed receipt write must never be reported as a terminal receipt.
    persist(action, receipt)
    print(json.dumps(receipt, ensure_ascii=False))
    return 2

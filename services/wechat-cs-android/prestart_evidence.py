"""只读核验启动前Gateway重启证据；不能把断线或timeout当成终态。"""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import stat


def private_bytes(path):
    path = Path(path)
    if (not path.is_absolute() or path.is_symlink() or not path.is_file()
            or stat.S_IMODE(path.stat().st_mode) != 0o600):
        raise ValueError('prestart_proof_requires_private_regular_absolute_file')
    raw = path.read_bytes()
    return raw, hashlib.sha256(raw).hexdigest()


def timestamp_ms(value):
    return int(datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000)


def restart_evidence(path, run_id, user_ms, snapshot_ms):
    raw, sha = private_bytes(path)
    records = []
    for line in raw.decode('utf-8').splitlines():
        entry = json.loads(line)
        meta = entry.get('_meta', {})
        subsystem = json.loads(entry.get('0', '{}')).get('subsystem') if entry.get('0', '').startswith('{') else None
        records.append(dict(ms=timestamp_ms(meta['date']), host=entry.get('hostname'),
                            subsystem=subsystem, message=entry.get('message', entry.get('1'))))
    accepts = [(i, x) for i, x in enumerate(records)
               if x['subsystem'] == 'gateway/ws' and isinstance(x['message'], str)
               and re.search(r' res ✓ agent \d+ms runId=' + re.escape(run_id) + r'(?:\s|$)', x['message'])]
    if len(accepts) != 1:
        raise ValueError('original_run_acceptance_not_unique')
    index, accepted = accepts[0]
    host = accepted['host']
    if not host or not user_ms <= accepted['ms'] <= user_ms + 5000:
        raise ValueError('user_run_timestamp_not_bound_to_acceptance')
    before = [x for x in records[:index] if x['subsystem'] == 'gateway'
              and x['host'] == host and isinstance(x['message'], str)
              and x['message'].startswith('native runtime: ')]
    after = records[index+1:]
    stops = [x for x in after if x['subsystem'] == 'gateway'
             and x['message'] == 'received SIGTERM; shutting down']
    if not before or not stops:
        raise ValueError('gateway_restart_evidence_missing')
    stop = stops[0]
    if stop['host'] != host or not 0 <= stop['ms'] - accepted['ms'] <= 10000:
        raise ValueError('gateway_restart_not_immediately_after_acceptance')
    runtime = next((x for x in after if x['subsystem'] == 'gateway'
                    and isinstance(x['message'], str) and x['message'].startswith('native runtime: ')
                    and stop['ms'] < x['ms'] <= snapshot_ms), None)
    old = json.loads(before[-1]['message'].removeprefix('native runtime: '))['pid']
    new = json.loads(runtime['message'].removeprefix('native runtime: '))['pid'] if runtime else None
    if (not runtime or runtime['host'] != host or type(old) is not int
            or type(new) is not int or min(old, new) <= 0 or old == new):
        raise ValueError('gateway_restart_new_pid_not_proven')
    listening = [x for x in after if x['host'] == host and x['subsystem'] == 'gateway'
                 and isinstance(x['message'], str) and x['message'].startswith('http server listening')
                 and stop['ms'] < x['ms'] <= snapshot_ms]
    ready = [x for x in after if x['host'] == host and x['subsystem'] == 'gateway'
             and x['message'] == 'gateway ready' and runtime['ms'] <= x['ms'] <= snapshot_ms]
    if not listening or not ready or listening[0]['ms'] > ready[0]['ms']:
        raise ValueError('restarted_gateway_not_confirmed_ready')
    return sha, dict(old_pid=old, new_pid=new, hostname=host,
                     accepted_at_ms=accepted['ms'], stopped_at_ms=stop['ms'],
                     ready_at_ms=ready[0]['ms'])


def prestart_evidence(proof, session_id, session_key):
    run_id = proof.get('run_id', '')
    if (proof.get('recovery_mode') != 'gateway_restart_before_execution'
            or not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', run_id)):
        raise ValueError('invalid_prestart_recovery_mode_or_run')
    raw, terminal_sha = private_bytes(proof['terminal_state_receipt'])
    history = json.loads(raw)
    raw, abort_sha = private_bytes(proof['abort_receipt'])
    abort = json.loads(raw)
    info, pending = history.get('sessionInfo', {}), history.get('pendingInputs', {})
    snapshot = info.get('snapshotAt')
    if type(snapshot) is not int or not -30000 <= datetime.now(timezone.utc).timestamp()*1000-snapshot <= 300000:
        raise ValueError('prestart_history_snapshot_not_recent')
    if (history.get('sessionKey') != session_key or history.get('sessionId') != session_id
            or info.get('key') != session_key or info.get('sessionId') != session_id
            or info.get('hasActiveRun') is not False or info.get('activeRunIds') != []
            or pending.get('items') != [] or type(pending.get('total')) is not int or pending['total'] != 0
            or type(pending.get('queuedCount')) is not int or pending['queuedCount'] != 0
            or history.get('hasMore') is not False or type(history.get('totalMessages')) is not int
            or history['totalMessages'] != 1 or not isinstance(history.get('messages'), list)
            or len(history['messages']) != 1 or history.get('inFlight', False) is not False
            or abort.get('ok') is not True or abort.get('status') != 'no-active-run'
            or 'abortedRunId' not in abort or abort['abortedRunId'] is not None):
        raise ValueError('prestart_session_not_confirmed_complete_and_idle')
    message = history['messages'][0]
    if (message.get('role') != 'user' or message.get('idempotencyKey') != run_id + ':user'
            or type(message.get('timestamp')) is not int or not message.get('content')
            or message.get('tool_calls') or message.get('toolCalls')):
        raise ValueError('original_run_user_only_transcript_required')
    log_sha, restart = restart_evidence(proof['gateway_log_receipt'], run_id,
                                       message['timestamp'], snapshot)
    return dict(terminal_sha256=terminal_sha, abort_sha256=abort_sha,
                gateway_log_sha256=log_sha, restart=restart,
                gateway_log_receipt=proof['gateway_log_receipt'])

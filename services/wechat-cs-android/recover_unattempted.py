"""操作者显式恢复已终态且从未尝试回复的事件；不重领、不执行、不发消息。"""
import argparse
from contextlib import ExitStack
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import uuid

from bridge import State, single_instance


def artifact(path):
    path = Path(path)
    if not path.is_absolute() or path.is_symlink() or not path.is_file():
        raise ValueError('missing_regular_absolute_proof_artifact')
    raw = path.read_bytes()
    return json.loads(raw), hashlib.sha256(raw).hexdigest()


def terminal_evidence(state_path, event_id, proof_path, event_session_receipt=None):
    proof, proof_sha = artifact(Path(proof_path).resolve())
    if (proof.get('schema_version') not in (1, 2) or proof.get('event_id') != event_id
            or proof.get('watcher_stopped') is not True):
        raise ValueError('invalid_terminal_proof')
    binding_path = (Path(event_session_receipt) if event_session_receipt else
                    state_path.parent / event_id / 'gateway-session.json')
    binding, binding_sha = artifact(binding_path.resolve())
    session_id = binding.get('session_id')
    if (binding.get('event_id') != event_id or not isinstance(session_id, str)
            or not session_id):
        raise ValueError('event_session_binding_missing')
    session_key = 'agent:zenithjoy-moments:explicit:' + session_id
    if proof.get('session_key') != session_key:
        raise ValueError('proof_session_mismatch')
    if proof['schema_version'] == 2:
        from prestart_evidence import prestart_evidence, private_bytes
        private_bytes(proof_path)
        private_bytes(binding_path)
        details = prestart_evidence(proof, session_id, session_key)
        return dict(proof_sha256=proof_sha, binding_sha256=binding_sha,
                    session_key=session_key, proof=proof,
                    event_session_receipt=str(binding_path), **details)
    terminal, terminal_sha = artifact(proof['terminal_state_receipt'])
    abort, abort_sha = artifact(proof['abort_receipt'])
    try:
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(
            terminal['at'].replace('Z', '+00:00'))).total_seconds()
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError('terminal_snapshot_has_no_valid_timestamp') from exc
    if not -30 <= age <= 300:
        raise ValueError('terminal_snapshot_not_recent')
    info = terminal.get('session_info', {})
    pending = terminal.get('pending_inputs', {})
    run_ids = abort.get('runIds')
    if (terminal.get('session_key') != session_key or info.get('key') != session_key
            or info.get('sessionId') != session_id
            or terminal.get('in_flight') is not False
            or pending.get('items') != [] or type(pending.get('total')) is not int
            or pending['total'] != 0 or type(pending.get('queuedCount')) is not int
            or pending['queuedCount'] != 0
            or info.get('hasActiveRun') is not False or info.get('activeRunIds') != []
            or info.get('status') != 'killed' or info.get('abortedLastRun') is not True
            or type(info.get('endedAt')) is not int or info['endedAt'] <= 0
            or abort.get('ok') is not True or abort.get('aborted') is not True
            or not isinstance(run_ids, list) or not run_ids
            or info.get('lastRunId') not in run_ids):
        raise ValueError('gateway_session_not_confirmed_aborted_and_idle')
    return dict(proof_sha256=proof_sha, terminal_sha256=terminal_sha,
                abort_sha256=abort_sha, binding_sha256=binding_sha,
                session_key=session_key, proof=proof,
                terminal_state_receipt=proof['terminal_state_receipt'],
                abort_receipt=proof['abort_receipt'])


def recover(state_path, event_id, proof_path, reason, event_session_receipt=None):
    state_path = Path(state_path).resolve()
    if not state_path.is_file() or not re.fullmatch(r'[0-9a-f]{64}', event_id):
        raise ValueError('missing_existing_state_or_invalid_event')
    if not isinstance(reason, str) or not reason.strip():
        raise ValueError('explicit_operator_reason_required')
    # Watcher can store evidence separately from backend_state. Hold both roots.
    watcher_roots = {state_path.parent}
    if event_session_receipt:
        binding_path = Path(event_session_receipt)
        if (not binding_path.is_absolute() or binding_path.name != 'gateway-session.json'
                or binding_path.parent.name != event_id):
            raise ValueError('invalid_explicit_event_session_receipt')
        watcher_roots.add(binding_path.parent.parent)
    with ExitStack() as guards:
        for root in sorted(watcher_roots):
            guards.enter_context(single_instance(root / 'watcher.lock'))
        guards.enter_context(single_instance(state_path.parent / (event_id + '.operation.guard')))
        evidence = terminal_evidence(state_path, event_id, proof_path, event_session_receipt)
        state = State(state_path)
        try:
            state.db.executescript('''
              CREATE TABLE IF NOT EXISTS recovery_audit (
                id TEXT PRIMARY KEY, event_id TEXT NOT NULL, reason TEXT NOT NULL,
                actor TEXT NOT NULL, at TEXT NOT NULL,
                proof_sha256 TEXT NOT NULL UNIQUE, terminal_sha256 TEXT NOT NULL,
                abort_sha256 TEXT NOT NULL, binding_sha256 TEXT NOT NULL,
                audit_json TEXT NOT NULL);
              CREATE TRIGGER IF NOT EXISTS recovery_audit_no_update
                BEFORE UPDATE ON recovery_audit BEGIN
                SELECT RAISE(ABORT,'recovery_audit_is_immutable'); END;
              CREATE TRIGGER IF NOT EXISTS recovery_audit_no_delete
                BEFORE DELETE ON recovery_audit BEGIN
                SELECT RAISE(ABORT,'recovery_audit_is_immutable'); END;
            ''')
            state.db.execute('BEGIN IMMEDIATE')
            row = state.event(event_id)
            actions = state.db.execute('SELECT count(*) FROM actions WHERE event_id=?',
                                       (event_id,)).fetchone()[0]
            contexts = state.db.execute('SELECT count(*) FROM contexts WHERE event_id=?',
                                        (event_id,)).fetchone()[0]
            if (row['status'] != 'claimed' or row['draft_json'] is not None
                    or row['context_hash'] is not None or row['contact_key'] is not None
                    or row['evidence_json'] is not None or actions != 0 or contexts != 0):
                raise ValueError('event_has_reply_or_send_attempt_cannot_recover')
            other = state.db.execute("SELECT count(*) FROM events WHERE id<>? AND status NOT IN ('baseline','delivered')",
                                     (event_id,)).fetchone()[0]
            if other:
                raise ValueError('other_unresolved_event_prevents_global_recovery')
            paused = state.db.execute("SELECT value FROM meta WHERE key='paused_unknown'").fetchone()
            if paused is None:
                raise ValueError('bridge_not_paused')
            recovery_id = str(uuid.uuid4())
            at = datetime.now(timezone.utc).isoformat()
            audit = dict(recovery_id=recovery_id, event_id=event_id, reason=reason,
                         actor='explicit_operator_uid:' + str(os.getuid()), at=at,
                         previous_pause_reason=paused['value'], previous_event=row,
                         action_count=actions, context_count=contexts, evidence=evidence)
            try:
                state.db.execute('INSERT INTO recovery_audit VALUES (?,?,?,?,?,?,?,?,?,?)',
                    (recovery_id, event_id, reason, audit['actor'], at,
                     evidence['proof_sha256'], evidence['terminal_sha256'],
                     evidence['abort_sha256'], evidence['binding_sha256'],
                     json.dumps(audit, ensure_ascii=False, sort_keys=True)))
            except sqlite3.IntegrityError as exc:
                raise ValueError('terminal_proof_already_consumed') from exc
            state.db.execute("DELETE FROM meta WHERE key='paused_unknown'")
            state.db.commit()
            return dict(recovered=True, recovery_id=recovery_id, event_id=event_id,
                        event_status='claimed', event_reclaimed=False,
                        terminal_sha256=evidence['terminal_sha256'])
        except BaseException:
            state.db.rollback()
            raise
        finally:
            state.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', required=True)
    parser.add_argument('--event-id', required=True)
    parser.add_argument('--terminal-proof', required=True)
    parser.add_argument('--reason', required=True)
    parser.add_argument('--event-session-receipt')
    args = parser.parse_args()
    os.umask(0o077)
    try:
        print(json.dumps(recover(args.state, args.event_id, args.terminal_proof, args.reason,
                                 args.event_session_receipt)))
        return 0
    except Exception as exc:
        print(json.dumps({'recovered': False, 'error_type': type(exc).__name__,
                          'reason': str(exc) if isinstance(exc, ValueError) else 'recovery_refused'}))
        return 2


if __name__ == '__main__':
    sys.exit(main())

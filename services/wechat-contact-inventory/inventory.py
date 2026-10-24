"""Private staging inbox: observations, human classification and collection eligibility.

This module never calls WeChat, CRM, messaging, or a model API. Its eligibility
result is an input gate, not evidence that messages were collected or sent.
"""
import csv
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import struct
import tempfile
import uuid
import xml.etree.ElementTree as ET

VERSION = '1.0.0'
CLASSIFICATIONS = {'pending', 'customer', 'internal', 'private', 'excluded'}
REVIEW_COLUMNS = [
    'schema_version', 'snapshot_id', 'account_key', 'batch_run_id', 'record_id',
    'revision', 'kind', 'display_name', 'stable_id', 'identity_verified',
    'requires_identity_confirmation', 'classification', 'customer_refs',
    'project_refs', 'collect_enabled', 'auto_reply_enabled', 'evidence_ids',
]
EDITABLE = {'classification', 'customer_refs', 'project_refs', 'collect_enabled'}
ROW_KEYS = set(REVIEW_COLUMNS) - {'schema_version', 'snapshot_id', 'account_key', 'batch_run_id'}
SCHEMA = '''
CREATE TABLE IF NOT EXISTS accounts (
 account_key TEXT PRIMARY KEY, account_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scans (
 account_key TEXT NOT NULL, run_id TEXT NOT NULL, digest TEXT NOT NULL,
 payload_json TEXT NOT NULL, observed_at TEXT NOT NULL,
 PRIMARY KEY(account_key,run_id)
);
CREATE TABLE IF NOT EXISTS contacts (
 record_id TEXT PRIMARY KEY, account_key TEXT NOT NULL, kind TEXT NOT NULL,
 display_name TEXT NOT NULL, stable_id TEXT, identity_verified INTEGER NOT NULL,
 classification TEXT NOT NULL DEFAULT 'pending', customer_refs TEXT NOT NULL DEFAULT '[]',
 project_refs TEXT NOT NULL DEFAULT '[]', collect_enabled INTEGER NOT NULL DEFAULT 0,
 auto_reply_enabled INTEGER NOT NULL DEFAULT 0 CHECK(auto_reply_enabled=0),
 revision INTEGER NOT NULL DEFAULT 1, first_run_id TEXT NOT NULL,
 last_run_id TEXT NOT NULL, last_observed_at TEXT NOT NULL, evidence_ids TEXT NOT NULL,
 UNIQUE(account_key,kind,stable_id)
);
CREATE TABLE IF NOT EXISTS review_snapshots (
 snapshot_id TEXT PRIMARY KEY, account_key TEXT NOT NULL, batch_run_id TEXT NOT NULL,
 rows_json TEXT NOT NULL, consumed_hash TEXT, actor TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS review_audit (
 audit_id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL, record_id TEXT NOT NULL,
 actor TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);
'''


class Refused(ValueError):
    pass


def require(condition, code):
    if not condition:
        raise Refused(code)


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def text(value, code):
    require(isinstance(value, str) and 0 < len(value.strip()) <= 500, code)
    return value.strip()


def identifier(value, code):
    normalized = text(value, code)
    require(value == normalized, 'identifier_edge_whitespace_refused')
    return normalized


def timestamp(value):
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        require(parsed.tzinfo is not None, 'timestamp_timezone_required')
        return parsed.astimezone(timezone.utc).isoformat()
    except (AttributeError, TypeError, ValueError):
        raise Refused('invalid_timestamp')


def string_list(value, code, nonempty=False):
    require(isinstance(value, list), code)
    normalized = [text(v, code) for v in value]
    require(len(set(normalized)) == len(normalized), code)
    require(not nonempty or len(normalized) > 0, code)
    return normalized


def private_path(path):
    path = Path(path).absolute()
    require(not path.is_symlink(), 'private_path_symlink_refused')
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    return path


def write_private(path, payload):
    path = private_path(path)
    fd, tmp = tempfile.mkstemp(prefix='.contact-inventory-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='') as handle:
            if path.suffix.lower() == '.csv':
                writer = csv.DictWriter(handle, fieldnames=REVIEW_COLUMNS)
                writer.writeheader()
                for row in payload['records']:
                    result = {k: payload[k] for k in ('schema_version', 'snapshot_id', 'account_key', 'batch_run_id')}
                    result.update(row)
                    for key, value in list(result.items()):
                        if isinstance(value, (list, dict)):
                            result[key] = canonical(value)
                        elif isinstance(value, bool):
                            result[key] = 'true' if value else 'false'
                        elif value is None:
                            result[key] = ''
                        elif isinstance(value, str) and (value.startswith("'") or value.lstrip().startswith(('=', '+', '-', '@'))):
                            result[key] = "'" + value
                    writer.writerow(result)
            else:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
                handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
        os.chmod(path, 0o600)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def connect(path):
    path = private_path(path)
    conn = sqlite3.connect(str(path), timeout=10, isolation_level=None)
    os.chmod(path, 0o600)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def evidence_map(payload):
    rows = payload.get('evidence')
    require(isinstance(rows, list) and rows, 'evidence_required')
    evidence = {}
    for row in rows:
        require(isinstance(row, dict), 'invalid_evidence')
        eid = identifier(row.get('evidence_id'), 'evidence_id_required')
        require(eid not in evidence, 'duplicate_evidence_id')
        require(row.get('run_id') == payload['run_id'], 'evidence_run_mismatch')
        require(row.get('kind') in ('screenshot', 'ui_tree'), 'invalid_evidence_kind')
        path = Path(row.get('path', ''))
        require(path.is_absolute() and path.is_file() and not path.is_symlink(), 'evidence_file_required')
        require(path.stat().st_size <= 32 * 1024 * 1024, 'evidence_file_too_large')
        raw = path.read_bytes()
        require(hashlib.sha256(raw).hexdigest() == row.get('sha256'), 'evidence_hash_mismatch')
        if row['kind'] == 'screenshot':
            require(raw.startswith(b'\x89PNG\r\n\x1a\n') and len(raw) > 24 and raw[12:16] == b'IHDR', 'evidence_png_required')
            width, height = struct.unpack('>II', raw[16:24])
            require(width > 0 and height > 0, 'invalid_png_dimensions')
        else:
            try:
                tree = ET.fromstring(raw)
            except ET.ParseError:
                raise Refused('invalid_ui_tree')
            require(tree.tag == 'hierarchy' and len(list(tree.iter('node'))) > 0, 'empty_ui_tree')
        evidence[eid] = row
    return evidence


def references(ids, evidence, code, screenshot=False):
    raw_ids = ids
    ids = string_list(ids, code, nonempty=True)
    require(raw_ids == ids, 'identifier_edge_whitespace_refused')
    require(set(ids) <= set(evidence), code)
    require(not screenshot or any(evidence[eid]['kind'] == 'screenshot' for eid in ids), code)
    return ids


def validate_scan(payload):
    require(isinstance(payload, dict), 'scan_object_required')
    require(payload.get('schema_version') == VERSION, 'unsupported_schema_version')
    run_id = identifier(payload.get('run_id'), 'run_id_required')
    observed_at = timestamp(payload.get('observed_at'))
    account = payload.get('account')
    require(isinstance(account, dict) and set(account) == {'tenant_id', 'wechat_account_id', 'device_serial'}, 'invalid_account_namespace')
    account = {k: identifier(v, 'invalid_account_namespace') for k, v in account.items()}
    preflight = payload.get('preflight') or {}
    require(preflight.get('status') == 'ready' and preflight.get('login_status') == 'verified', 'login_not_verified')
    require(preflight.get('call_state') == 'idle', 'call_not_idle')
    require(payload.get('account_verified') is True, 'account_not_verified')
    coverage = payload.get('coverage')
    require(isinstance(coverage, dict) and coverage.get('scope') == 'visible_excerpt' and coverage.get('complete') is False, 'unsupported_coverage_claim')
    string_list(coverage.get('pages_observed'), 'pages_observed_required', nonempty=True)
    string_list(coverage.get('not_covered'), 'not_covered_required', nonempty=True)
    evidence = evidence_map(payload)
    references(payload.get('account_evidence_ids'), evidence, 'account_evidence_required', screenshot=True)
    observations = payload.get('observations')
    require(isinstance(observations, list), 'observations_required')
    require(observations or payload.get('empty_state_verified') is True, 'empty_inventory_not_verified')
    seen = set()
    for row in observations:
        require(isinstance(row, dict), 'invalid_observation')
        oid = identifier(row.get('observation_id'), 'observation_id_required')
        require(oid not in seen, 'duplicate_observation_id')
        seen.add(oid)
        require(row.get('kind') in ('person', 'group'), 'invalid_observation_kind')
        text(row.get('display_name'), 'display_name_required')
        references(row.get('evidence_ids'), evidence, 'observation_evidence_required', screenshot=True)
        require(isinstance(row.get('identity_verified'), bool), 'identity_verification_required')
        if row['identity_verified']:
            identifier(row.get('stable_id'), 'stable_identity_required')
            references(row.get('identity_evidence_ids'), evidence, 'identity_evidence_required', screenshot=True)
        else:
            require(row.get('stable_id') is None, 'unverified_stable_identity_refused')
            require(row.get('identity_evidence_ids') in (None, []), 'unverified_identity_evidence_refused')
    return account, run_id, observed_at


def record_dict(row):
    return {
        'record_id': row['record_id'], 'revision': row['revision'], 'kind': row['kind'],
        'display_name': row['display_name'], 'stable_id': row['stable_id'],
        'identity_verified': bool(row['identity_verified']),
        'requires_identity_confirmation': not bool(row['identity_verified']),
        'classification': row['classification'], 'customer_refs': json.loads(row['customer_refs']),
        'project_refs': json.loads(row['project_refs']), 'collect_enabled': bool(row['collect_enabled']),
        'auto_reply_enabled': False, 'evidence_ids': json.loads(row['evidence_ids']),
    }


def ingest(conn, payload):
    account, run_id, observed_at = validate_scan(payload)
    namespace = {key: account[key] for key in ('tenant_id', 'wechat_account_id')}
    account_key = 'acc_' + digest(namespace)
    scan_digest = digest(payload)
    conn.execute('BEGIN IMMEDIATE')
    try:
        existing = conn.execute('SELECT digest FROM scans WHERE account_key=? AND run_id=?', (account_key, run_id)).fetchone()
        if existing:
            require(existing['digest'] == scan_digest, 'run_payload_conflict')
            conn.execute('COMMIT')
            return {'schema_version': VERSION, 'account_key': account_key, 'run_id': run_id, 'created': 0, 'updated': 0, 'replayed': True}
        conn.execute('INSERT INTO accounts VALUES (?,?) ON CONFLICT(account_key) DO UPDATE SET account_json=excluded.account_json', (account_key, canonical(account)))
        created = updated = 0
        updated_ids = set()
        for observation in payload['observations']:
            stable = observation.get('stable_id') if observation['identity_verified'] else None
            identity = ['stable', observation['kind'], stable] if stable else ['provisional', run_id, observation['observation_id']]
            rid = str(uuid.uuid5(uuid.NAMESPACE_URL, canonical([account_key, identity])))
            old = conn.execute('SELECT * FROM contacts WHERE record_id=?', (rid,)).fetchone()
            evidence_ids = canonical([{'run_id': run_id, 'evidence_id': eid} for eid in observation['evidence_ids']])
            if old:
                if rid not in updated_ids and observed_at >= old['last_observed_at']:
                    conn.execute('UPDATE contacts SET display_name=?,last_run_id=?,last_observed_at=?,evidence_ids=?,revision=revision+1 WHERE record_id=?',
                                 (observation['display_name'].strip(), run_id, observed_at, evidence_ids, rid))
                    updated += 1
                    updated_ids.add(rid)
            else:
                conn.execute('''INSERT INTO contacts
                    (record_id,account_key,kind,display_name,stable_id,identity_verified,first_run_id,last_run_id,last_observed_at,evidence_ids)
                    VALUES (?,?,?,?,?,?,?,?,?,?)''',
                    (rid, account_key, observation['kind'], observation['display_name'].strip(), stable,
                     int(observation['identity_verified']), run_id, run_id, observed_at, evidence_ids))
                created += 1
        conn.execute('INSERT INTO scans VALUES (?,?,?,?,?)', (account_key, run_id, scan_digest, canonical(payload), observed_at))
        conn.execute('COMMIT')
    except Exception:
        conn.execute('ROLLBACK')
        raise
    return {'schema_version': VERSION, 'account_key': account_key, 'run_id': run_id,
            'created': created, 'updated': updated, 'observed': len(payload['observations']),
            'replayed': False, 'coverage': payload['coverage'], 'production_crm_writes': 0}


def export_review(conn, account_key):
    account = conn.execute('SELECT account_json FROM accounts WHERE account_key=?', (account_key,)).fetchone()
    require(account is not None, 'account_not_found')
    conn.execute('BEGIN IMMEDIATE')
    try:
        scan = conn.execute('SELECT * FROM scans WHERE account_key=? ORDER BY observed_at DESC, rowid DESC LIMIT 1', (account_key,)).fetchone()
        rows = [record_dict(r) for r in conn.execute('SELECT * FROM contacts WHERE account_key=? ORDER BY rowid', (account_key,))]
        sid = str(uuid.uuid4())
        result = {'schema_version': VERSION, 'kind': 'contact_inventory_review', 'snapshot_id': sid,
                  'account_key': account_key, 'batch_run_id': scan['run_id'], 'account': json.loads(account['account_json']),
                  'coverage': json.loads(scan['payload_json'])['coverage'], 'records': rows}
        conn.execute('INSERT INTO review_snapshots VALUES (?,?,?,?,NULL,NULL,?)',
                     (sid, account_key, scan['run_id'], canonical(result), datetime.now(timezone.utc).isoformat()))
        conn.execute('COMMIT')
    except Exception:
        conn.execute('ROLLBACK')
        raise
    return result


def read_review(path):
    path = Path(path)
    if path.suffix.lower() != '.csv':
        return json.loads(path.read_text())
    with path.open(newline='', encoding='utf-8-sig') as handle:
        reader = csv.DictReader(handle)
        require(reader.fieldnames == REVIEW_COLUMNS, 'invalid_csv_columns')
        raw = [{key: (value[1:] if isinstance(value, str) and value.startswith("'") else value)
                for key, value in row.items()} for row in reader]
    require(raw, 'empty_csv_review')
    meta = {k: raw[0][k] for k in ('schema_version', 'snapshot_id', 'account_key', 'batch_run_id')}
    rows = []
    for row in raw:
        require(all(row.get(k) == value for k, value in meta.items()), 'mixed_csv_snapshot')
        item = {k: row[k] for k in ROW_KEYS}
        for key in ['identity_verified', 'requires_identity_confirmation', 'collect_enabled', 'auto_reply_enabled']:
            require(item[key] in ('true', 'false'), 'invalid_csv_boolean')
            item[key] = item[key] == 'true'
        try:
            item['revision'] = int(item['revision'])
            for key in ['customer_refs', 'project_refs', 'evidence_ids']:
                item[key] = json.loads(item[key])
        except (ValueError, TypeError):
            raise Refused('invalid_csv_value')
        item['stable_id'] = item['stable_id'] or None
        rows.append(item)
    return {**meta, 'kind': 'contact_inventory_review', 'records': rows}


def normalize_edit(row):
    require(row.get('classification') in CLASSIFICATIONS, 'invalid_classification')
    require(isinstance(row.get('collect_enabled'), bool), 'invalid_collection_flag')
    require(row.get('auto_reply_enabled') is False, 'auto_reply_enable_refused')
    customer_refs = string_list(row.get('customer_refs'), 'invalid_customer_refs')
    project_refs = string_list(row.get('project_refs'), 'invalid_project_refs')
    if row['classification'] == 'customer':
        require(customer_refs, 'customer_relation_required')
    if row['collect_enabled']:
        require(row['classification'] == 'customer' and customer_refs, 'collection_scope_not_customer')
        require(row.get('identity_verified') is True and row.get('stable_id'), 'stable_identity_not_verified')
    return {'classification': row['classification'], 'customer_refs': customer_refs,
            'project_refs': project_refs, 'collect_enabled': row['collect_enabled']}


def apply_review(conn, payload, actor):
    actor = text(actor, 'actor_required')
    require(isinstance(payload, dict) and payload.get('schema_version') == VERSION and payload.get('kind') == 'contact_inventory_review', 'invalid_review_schema')
    require(set(payload) <= {'schema_version', 'kind', 'snapshot_id', 'account_key', 'batch_run_id', 'account', 'coverage', 'records'}, 'unknown_review_fields')
    require(isinstance(payload.get('records'), list), 'review_records_required')
    edit_hash = digest({'actor': actor, 'review': payload})
    conn.execute('BEGIN IMMEDIATE')
    try:
        snapshot = conn.execute('SELECT * FROM review_snapshots WHERE snapshot_id=?', (payload.get('snapshot_id'),)).fetchone()
        require(snapshot is not None, 'snapshot_not_found')
        require(snapshot['account_key'] == payload.get('account_key') and snapshot['batch_run_id'] == payload.get('batch_run_id'), 'review_namespace_mismatch')
        if snapshot['consumed_hash']:
            require(snapshot['consumed_hash'] == edit_hash, 'snapshot_already_consumed')
            conn.execute('COMMIT')
            return {'snapshot_id': snapshot['snapshot_id'], 'updated': 0, 'replayed': True, 'production_crm_writes': 0}
        frozen = json.loads(snapshot['rows_json'])
        for key in ('account', 'coverage'):
            require(key not in payload or payload[key] == frozen[key], 'review_context_changed')
        original = {row['record_id']: row for row in frozen['records']}
        provided = payload['records']
        require(len(provided) == len(original) and {r.get('record_id') for r in provided if isinstance(r, dict)} == set(original), 'review_record_set_mismatch')
        changes = []
        for row in provided:
            require(isinstance(row, dict) and set(row) == ROW_KEYS, 'invalid_review_record_fields')
            require(type(row.get('revision')) is int and row['revision'] > 0, 'invalid_review_revision')
            require(type(row.get('identity_verified')) is bool and type(row.get('requires_identity_confirmation')) is bool, 'invalid_review_identity_flags')
            old = original[row['record_id']]
            for key in ROW_KEYS - EDITABLE:
                require(row[key] == old[key], 'review_readonly_field_changed')
            current_raw = conn.execute('SELECT * FROM contacts WHERE record_id=? AND account_key=?', (row['record_id'], snapshot['account_key'])).fetchone()
            require(current_raw is not None and current_raw['revision'] == row['revision'], 'review_revision_conflict')
            current = record_dict(current_raw)
            edit = normalize_edit(row)
            if any(current[k] != value for k, value in edit.items()):
                changes.append((current, edit))
        # Validate every row before writing any decision. The transaction also
        # prevents concurrent ingests/reviews from invalidating those revisions.
        now = datetime.now(timezone.utc).isoformat()
        for old, edit in changes:
            conn.execute('''UPDATE contacts SET classification=?,customer_refs=?,project_refs=?,collect_enabled=?,revision=revision+1
                WHERE record_id=?''', (edit['classification'], canonical(edit['customer_refs']), canonical(edit['project_refs']), int(edit['collect_enabled']), old['record_id']))
            conn.execute('INSERT INTO review_audit VALUES (?,?,?,?,?,?,?)',
                         (str(uuid.uuid4()), snapshot['snapshot_id'], old['record_id'], actor, canonical(old), canonical({**old, **edit, 'revision': old['revision'] + 1}), now))
        conn.execute('UPDATE review_snapshots SET consumed_hash=?,actor=? WHERE snapshot_id=?', (edit_hash, actor, snapshot['snapshot_id']))
        conn.execute('COMMIT')
    except Exception:
        conn.execute('ROLLBACK')
        raise
    return {'snapshot_id': snapshot['snapshot_id'], 'updated': len(changes), 'replayed': False, 'production_crm_writes': 0}


def eligible(conn, account_key):
    require(conn.execute('SELECT 1 FROM accounts WHERE account_key=?', (account_key,)).fetchone(), 'account_not_found')
    allowed, blocked = [], []
    for raw in conn.execute('SELECT * FROM contacts WHERE account_key=? ORDER BY rowid', (account_key,)):
        row = record_dict(raw)
        reasons = []
        if row['classification'] != 'customer':
            reasons.append('not_confirmed_customer')
        if not row['identity_verified'] or not row['stable_id']:
            reasons.append('stable_identity_not_verified')
        if not row['customer_refs']:
            reasons.append('customer_relation_missing')
        if not row['collect_enabled']:
            reasons.append('collection_not_enabled')
        if reasons:
            blocked.append({'record_id': row['record_id'], 'reasons': reasons})
        else:
            allowed.append(row)
    return {'schema_version': VERSION, 'account_key': account_key, 'eligible_count': len(allowed),
            'records': allowed, 'blocked': blocked, 'collection_actions': 0,
            'auto_reply_actions': 0, 'production_crm_writes': 0}

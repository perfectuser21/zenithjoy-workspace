"""云手机微信测试接待：只读通知、持久去重与 Gateway 调度。"""
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import time

SENDER = '苏小妖'
CS_WECHAT_ID = 'wxid_skpj8yqmblqc22'


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def private_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + '.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def parse_notification(key, raw):
    """Fail closed on aggregates/media/system notices; text remains untrusted data."""
    if 'pkg=com.tencent.mm' not in raw or not re.fullmatch(r'[\w|.:-]+', key):
        return None
    def field(name):
        match = re.search(r'^\s*android\.' + name + r'=String \((.*)\)\s*$', raw, re.M)
        return match.group(1).strip() if match else ''
    title, text = field('title'), field('text')
    if title != SENDER or not text:
        return None
    if re.search(r'android\.isGroupConversation=Boolean \(true\)', raw):
        return None
    if re.search(r'请求添加|添加你为朋友|验证消息|撤回了一条|微信支付|转账|红包|邀请你|加入了群聊', text):
        return None
    if re.match(r'[\[【（(]', text) or re.match(r'\d+条', text):
        return None
    stamp = re.search(r'^\s*when=(\d+)\s*$', raw, re.M)
    if not stamp:
        return None
    event = dict(notification_key=key, sender=title, text=text,
                 notification_when=stamp.group(1), cs_wechat_id=CS_WECHAT_ID)
    event['event_id'] = digest(event)
    return event


class State:
    def __init__(self, path):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
        os.close(fd)
        os.chmod(path, 0o600)
        self.db = sqlite3.connect(path, timeout=10)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
          CREATE TABLE IF NOT EXISTS contexts (hash TEXT PRIMARY KEY, event_id TEXT);
          CREATE TABLE IF NOT EXISTS actions (event_id TEXT, action TEXT, status TEXT,
            PRIMARY KEY(event_id,action));
          CREATE TABLE IF NOT EXISTS phone_evidence (path TEXT PRIMARY KEY, event_id TEXT,
            sha256 TEXT, receipt TEXT, serial TEXT, owner TEXT, operation TEXT);
          CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY, status TEXT NOT NULL, event_json TEXT NOT NULL,
            draft_json TEXT, context_hash TEXT, contact_key TEXT,
            evidence_json TEXT, updated_at REAL NOT NULL);
        ''')

    def close(self):
        if self.db is not None:
            self.db.close()
            self.db = None

    def baseline(self, events):
        with self.db:
            if self.db.execute("SELECT 1 FROM meta WHERE key='baseline'").fetchone():
                return
            for event in events:
                self.db.execute('INSERT OR IGNORE INTO events VALUES (?,?,?,NULL,NULL,NULL,NULL,?)',
                                (event['event_id'], 'baseline', json.dumps(event), time.time()))
            self.db.execute("INSERT INTO meta VALUES ('baseline','done')")

    def claim(self, event):
        with self.db:
            cursor = self.db.execute('INSERT OR IGNORE INTO events VALUES (?,?,?,NULL,NULL,NULL,NULL,?)',
                                    (event['event_id'], 'claimed', json.dumps(event), time.time()))
            return cursor.rowcount == 1

    def event(self, event_id):
        row = self.db.execute('SELECT * FROM events WHERE id=?', (event_id,)).fetchone()
        if row is None:
            raise ValueError('unknown_event')
        value = dict(row)
        for name in ('event_json', 'draft_json', 'evidence_json'):
            value[name] = json.loads(value[name]) if value[name] else None
        return value

    def transition(self, event_id, expected, status):
        with self.db:
            cursor = self.db.execute('UPDATE events SET status=?,updated_at=? WHERE id=? AND status=?',
                                     (status, time.time(), event_id, expected))
            if cursor.rowcount != 1:
                raise ValueError('event_already_attempted_or_wrong_state')

    def require_ready(self):
        if self.db.execute("SELECT 1 FROM meta WHERE key='paused_unknown'").fetchone():
            raise RuntimeError('gateway_outcome_unknown_bridge_paused')

    def pause(self, reason):
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO meta VALUES ('paused_unknown',?)", (reason,))

    def claim_draft(self, event_id, context):
        row = self.event(event_id)
        if (context.get('incoming_text') != row['event_json'].get('text')
                or context.get('latest_message_direction') != 'incoming'
                or not context.get('incoming_text')
                or context['incoming_text'] not in context.get('content', '')):
            raise ValueError('notification_does_not_match_latest_inbound')
        fingerprint = digest([CS_WECHAT_ID, context.get('contact_key'), context.get('content'),
                              context['incoming_text']])
        with self.db:
            if row['status'] != 'claimed':
                raise ValueError('draft_already_attempted')
            try:
                self.db.execute('INSERT INTO contexts VALUES (?,?)', (fingerprint, event_id))
            except sqlite3.IntegrityError as exc:
                raise ValueError('inbound_context_already_consumed') from exc
            self.db.execute("UPDATE events SET status='drafting',updated_at=? WHERE id=?", (time.time(), event_id))

    def action(self, event_id, action):
        row = self.db.execute('SELECT status FROM actions WHERE event_id=? AND action=?',
                              (event_id, action)).fetchone()
        return row['status'] if row else None

    def claim_action(self, event_id, action):
        with self.db:
            try:
                self.db.execute("INSERT INTO actions VALUES (?,?,'attempted')", (event_id, action))
            except sqlite3.IntegrityError as exc:
                raise ValueError('action_already_attempted_no_retry') from exc

    def complete_action(self, event_id, action):
        with self.db:
            self.db.execute("UPDATE actions SET status='completed' WHERE event_id=? AND action=?",
                            (event_id, action))

    def register_phone_evidence(self, event_id, record, phone):
        path = Path(record['after']['screenshot']).resolve()
        receipt = Path(record['receipt']).resolve()
        if (not path.is_relative_to(phone.evidence_dir.resolve())
                or not receipt.is_relative_to(phone.evidence_dir.resolve())
                or record.get('serial') != phone.serial or record.get('owner') != phone.owner
                or record.get('status') not in ('executed', 'requires_visual_readback')):
            raise ValueError('phone_evidence_wrong_origin')
        saved = json.loads(receipt.read_text())
        if (Path(saved.get('after', {}).get('screenshot', '')).resolve() != path
                or saved.get('serial') != phone.serial or saved.get('owner') != phone.owner):
            raise ValueError('phone_receipt_mismatch')
        with self.db:
            self.db.execute('INSERT INTO phone_evidence VALUES (?,?,?,?,?,?,?)',
                (str(path), event_id, hashlib.sha256(path.read_bytes()).hexdigest(),
                 str(receipt), phone.serial, phone.owner, record['operation']))

    def verify_phone_evidence(self, event_id, path):
        path = Path(path).resolve()
        row = self.db.execute('SELECT * FROM phone_evidence WHERE path=? AND event_id=?',
                              (str(path), event_id)).fetchone()
        if row is None or row['sha256'] != hashlib.sha256(path.read_bytes()).hexdigest():
            raise ValueError('untrusted_or_changed_phone_screenshot')
        receipt = json.loads(Path(row['receipt']).read_text())
        if (receipt.get('serial') != row['serial'] or receipt.get('owner') != row['owner']
                or Path(receipt.get('after', {}).get('screenshot', '')).resolve() != path):
            raise ValueError('phone_receipt_changed')
        return dict(row)

    def set_draft(self, event_id, draft, context=None):
        if not valid_draft(draft):
            raise ValueError('invalid_draft')
        with self.db:
            cursor = self.db.execute('''UPDATE events SET status='drafted',draft_json=?,
                context_hash=?,contact_key=?,updated_at=? WHERE id=? AND status IN ('claimed','drafting')''',
                (json.dumps(draft, ensure_ascii=False), digest(context) if context else None,
                 context.get('contact_key') if context else None, time.time(), event_id))
            if cursor.rowcount != 1:
                raise ValueError('draft_already_attempted')

    def claim_send(self, event_id):
        row = self.event(event_id)
        if not valid_draft(row['draft_json']):
            raise ValueError('no_valid_draft')
        self.transition(event_id, 'drafted', 'sending')

    def save_evidence(self, event_id, evidence):
        with self.db:
            self.db.execute('UPDATE events SET evidence_json=?,updated_at=? WHERE id=?',
                            (json.dumps(evidence, ensure_ascii=False), time.time(), event_id))


def valid_draft(draft):
    return bool(isinstance(draft, dict) and isinstance(draft.get('reply'), str)
                and draft['reply'].strip() and type(draft.get('message_id')) is int
                and draft['message_id'] > 0)


@contextlib.contextmanager
def single_instance(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RuntimeError('watcher_already_running') from exc
        yield
    finally:
        os.close(fd)

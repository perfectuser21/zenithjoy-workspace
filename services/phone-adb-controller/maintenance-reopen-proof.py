#!/usr/bin/env python3
"""Read-only proofs required before a reviewed phone may be reopened."""

import hashlib
import json
import math
import os
import re
import stat
from datetime import datetime, timezone
from pathlib import Path


MAX_RECEIPT_BYTES = 1024 * 1024
NATIVE_RECEIPT_COUNT = 6
_ID = re.compile(r'^[0-9a-fA-F-]{36}$')
_SERIAL = re.compile(r'^[A-Za-z0-9._:-]{4,80}$')
_PACKAGE = re.compile(r'^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$')


def _epoch(value):
    if not isinstance(value, str):
        raise ValueError('RECEIPT_TIME')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            raise ValueError('timestamp without zone')
        return parsed.astimezone(timezone.utc).timestamp()
    except (ValueError, OverflowError):
        raise ValueError('RECEIPT_TIME') from None


def _read_receipt(path):
    try:
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_size <= 0 or info.st_size > MAX_RECEIPT_BYTES:
            raise ValueError('RECEIPT_FILE')
        flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
        fd = os.open(path, flags)
        try:
            loaded = os.fstat(fd)
            if not stat.S_ISREG(loaded.st_mode) or loaded.st_ino != info.st_ino or loaded.st_size != info.st_size:
                raise ValueError('RECEIPT_FILE')
            raw = os.read(fd, MAX_RECEIPT_BYTES + 1)
            if len(raw) != loaded.st_size:
                raise ValueError('RECEIPT_FILE')
        finally:
            os.close(fd)
        return json.loads(raw), raw
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        raise ValueError('RECEIPT_FILE') from None


def verify_native_termination(receipt_root, expected, *, boot_seconds, process_table):
    """A later reboot and an empty old-run process census prove descendants ended.

    This does not rewrite an old receipt's `execution_stopped` field; it establishes
    a separate, later host-level fact from an independently observed boot epoch.
    """
    root = Path(receipt_root)
    if root.is_symlink() or not root.is_dir():
        raise ValueError('RECEIPT_FILE')
    paths = sorted(root.iterdir())
    if len(paths) != NATIVE_RECEIPT_COUNT or any(p.suffix != '.json' for p in paths):
        raise ValueError('RECEIPT_COUNT')
    if not isinstance(expected, dict) or any(not expected.get(k) for k in
        ('run_id', 'owner', 'source_commit', 'serial', 'task_id')):
        raise ValueError('RECEIPT_SCOPE')
    if not isinstance(process_table, str):
        raise ValueError('NATIVE_PROCESS_CENSUS')
    if any(token in process_table for token in
           (expected['run_id'], expected['owner'], 'phone-candidate-runs', 'leadgen-run.sh')):
        raise ValueError('NATIVE_PROCESS_STILL_PRESENT')
    seen = set()
    hashes = []
    latest = 0.0
    for path in paths:
        row, raw = _read_receipt(path)
        if not isinstance(row, dict) or any(row.get(k) != expected[k] for k in expected):
            raise ValueError('RECEIPT_SCOPE')
        op_id = row.get('operation_id')
        if not isinstance(op_id, str) or not _ID.fullmatch(op_id) or path.name != f'{op_id}.json' or op_id in seen:
            raise ValueError('RECEIPT_ID')
        seen.add(op_id)
        if row.get('execution_stopped') is not False or row.get('process_coverage') != 'observed_only':
            raise ValueError('RECEIPT_STATE')
        latest = max(latest, _epoch(row.get('created_at')), _epoch(row.get('ended_at')))
        processes = row.get('processes')
        if not isinstance(processes, list) or not processes or any(not isinstance(p, dict) for p in processes):
            raise ValueError('RECEIPT_PROCESS')
        identities = [row.get('start_identity')] + [p.get('start_identity') for p in processes]
        if not identities or any(not isinstance(v, str) or not re.fullmatch(r'\d+:\d+', v)
                                 for v in identities):
            raise ValueError('RECEIPT_PROCESS')
        latest = max(latest, *(int(v.split(':', 1)[0]) for v in identities))
        hashes.append((op_id, hashlib.sha256(raw).hexdigest()))
    try:
        boot = float(boot_seconds)
    except (TypeError, ValueError):
        raise ValueError('BOOT_NOT_AFTER_NATIVE') from None
    if not math.isfinite(boot) or boot <= latest:
        raise ValueError('BOOT_NOT_AFTER_NATIVE')
    digest = hashlib.sha256(json.dumps(hashes, separators=(',', ':'), ensure_ascii=True).encode()).hexdigest()
    return {'receipt_count': len(paths), 'run_id': expected['run_id'],
            'receipt_sha256': digest, 'boot_seconds': boot}


def verify_safe_desktop(serial, launcher_output, focus_output):
    """Compare read-only HOME resolution and both window focus indicators."""
    if not isinstance(serial, str) or not _SERIAL.fullmatch(serial):
        raise ValueError('DESKTOP_SERIAL')
    if not isinstance(launcher_output, str) or not isinstance(focus_output, str):
        raise ValueError('DESKTOP_EVIDENCE')
    launchers = re.findall(r'(?m)^\s*packageName=([^\s]+)\s*$', launcher_output)
    if len(launchers) != 1 or not _PACKAGE.fullmatch(launchers[0]):
        raise ValueError('DESKTOP_LAUNCHER')
    launcher = launchers[0]
    indicators = re.findall(r'(?m)^\s*m(?:CurrentFocus|FocusedApp)=([^\n]+)', focus_output)
    if not indicators or any(not re.search(r'\b' + re.escape(launcher) + r'/', line)
                             for line in indicators):
        raise ValueError('DESKTOP_FOCUS')
    return {'serial': serial, 'launcher': launcher, 'focus_indicators': len(indicators)}

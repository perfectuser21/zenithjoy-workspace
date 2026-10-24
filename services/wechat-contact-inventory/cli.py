#!/usr/bin/env python3
"""Local private intake staging; never opens WeChat or sends messages."""
import argparse
import json
import os
from pathlib import Path
import sys
import sqlite3

from inventory import Refused, apply_review, connect, eligible, export_review, ingest, read_review, write_private


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['ingest', 'export-review', 'apply-review', 'eligible'])
    parser.add_argument('--db', required=True, type=Path)
    parser.add_argument('--input', type=Path)
    parser.add_argument('--account-key')
    parser.add_argument('--actor')
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    conn = None
    try:
        if args.action in ('ingest', 'apply-review') and not args.input:
            raise Refused('input_required')
        if args.action in ('export-review', 'eligible') and not args.account_key:
            raise Refused('account_key_required')
        reserved = {args.db.resolve(), Path(str(args.db) + '-wal').resolve(),
                    Path(str(args.db) + '-shm').resolve(), Path(str(args.db) + '-journal').resolve()}
        if args.input:
            reserved.add(args.input.resolve())
        if args.out.resolve() in reserved:
            raise Refused('output_aliases_input_or_database')
        if args.out.suffix.lower() == '.csv' and args.action != 'export-review':
            raise Refused('csv_only_for_review_export')
        # Login and evidence checks happen before creating or touching the inbox.
        if args.action == 'ingest':
            from inventory import validate_scan
            payload = json.loads(args.input.read_text())
            validate_scan(payload)
            if args.out.resolve() in {Path(e['path']).resolve() for e in payload['evidence']}:
                raise Refused('output_aliases_source_evidence')
        conn = connect(args.db)
        if args.action == 'ingest':
            result = ingest(conn, payload)
        elif args.action == 'export-review':
            result = export_review(conn, args.account_key)
        elif args.action == 'apply-review':
            result = apply_review(conn, read_review(args.input), args.actor)
        else:
            result = eligible(conn, args.account_key)
        write_private(args.out, result)
        # Never print labels, accounts, observations, customer refs or messages.
        print(json.dumps({'status': 'ok', 'action': args.action, 'output': str(args.out),
                          **{k: result[k] for k in ('created', 'updated', 'eligible_count', 'replayed') if k in result}}, ensure_ascii=False))
        return 0
    except (Refused, ValueError, OSError, TypeError, sqlite3.Error) as exc:
        code = str(exc) if isinstance(exc, Refused) else type(exc).__name__
        print(json.dumps({'status': 'refused', 'action': args.action, 'reason': code}, ensure_ascii=False))
        return 2
    finally:
        if conn:
            conn.close()


if __name__ == '__main__':
    sys.exit(main())

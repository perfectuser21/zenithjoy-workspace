"""Isolated consumer-contract fixture, never a production Brain replacement.

Only loopback is bound. The fixed test protocol rejects unknown routes, old owners,
old epochs, released/expired leases and conflicting terminal replays. No external
request or database is performed; the real provider is tested in Cecelia's PG lane.
"""
from __future__ import annotations

import argparse
import json
import threading
import subprocess
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from uuid import UUID, uuid4


DIGEST_TIMEOUT_SECONDS = 5

def digest(value):
    # Same JavaScript JSON number and UTF-16 key ordering as the real provider.
    program = """const fs=require('node:fs'),crypto=require('node:crypto');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'
?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
process.stdout.write(crypto.createHash('sha256').update(JSON.stringify(canonical(JSON.parse(fs.readFileSync(0,'utf8'))))).digest('hex'));"""
    return subprocess.check_output(['node', '-e', program],
        input=json.dumps(value, ensure_ascii=False).encode(), timeout=DIGEST_TIMEOUT_SECONDS).decode()


class ProtocolState:
    def __init__(self, state_path=None):
        self.tasks = {}
        self.events = []
        self.dedupe = {}
        self.lock = threading.Lock()
        self.path = Path(state_path) if state_path else None

    def record(self, action, task_id):
        self.events.append({'action': action, 'task_id': task_id})
        if self.path:
            temp = self.path.with_suffix('.tmp')
            temp.write_text(json.dumps({'tasks': self.tasks, 'events': self.events},
                                       ensure_ascii=False))
            temp.replace(self.path)

    def request(self, method, path, body):
        with self.lock:
            if method == 'GET' and path == '/health':
                return 200, {'ok': True, 'fixture': True}
            if method == 'POST' and path == '/api/brain/can-run':
                # Resource hints are deliberately separate from task authority.
                if body.get('resource_type') not in ('notebooklm', 'llm', 'image-gen'):
                    return 400, {'error': 'invalid_resource'}
                return 200, {'approved': True, 'fixture': True}
            if method == 'POST' and path == '/api/brain/tasks':
                if body.get('task_type') != 'content-pipeline' or body.get('mutation_intent') != 'read_only':
                    return 400, {'error': 'invalid_task_contract'}
                if body.get('payload', {}).get('business_owner') != 'zenithjoy':
                    return 400, {'error': 'invalid_business_owner'}
                run_id = body.get('payload', {}).get('zenithjoy_pipeline_run_id')
                try:
                    UUID(str(run_id))
                except ValueError:
                    return 400, {'error': 'invalid_pipeline_identity'}
                key = body.get('source_id')
                if key != f'zenithjoy:pipeline:{run_id}' or not str(body.get('title', '')).startswith(f'Content Pipeline {run_id}: '):
                    return 400, {'error': 'missing_source_identity'}
                if key in self.dedupe:
                    return 200, self.tasks[self.dedupe[key]]
                task_id = str(uuid4())
                self.tasks[task_id] = {'id': task_id, 'status': 'queued', 'claimed_by': None,
                                       'task_type': 'content-pipeline', 'payload': body['payload']}
                self.dedupe[key] = task_id
                self.record('register', task_id)
                return 201, self.tasks[task_id]
            pieces = path.strip('/').split('/')
            if len(pieces) < 4 or pieces[:3] != ['api', 'brain', 'tasks']:
                return 404, {'error': 'unknown_fixture_route'}
            task_id = pieces[3]
            try:
                UUID(task_id)
            except ValueError:
                return 400, {'error': 'invalid_task_id'}
            task = self.tasks.get(task_id)
            if not task:
                return 404, {'error': 'task_not_found'}
            action = '/'.join(pieces[4:])
            if method == 'GET' and not action:
                return 200, task
            if method != 'POST':
                return 405, {'error': 'unsupported_method'}
            owner = body.get('claimer')
            if action == 'claim':
                seconds = body.get('lease_seconds')
                if not owner or body.get('executor_kind') != 'external-worker' or body.get('start') is not True:
                    return 400, {'error': 'invalid_claim_contract'}
                if type(seconds) is not int or not 30 <= seconds <= 14400 or body.get('on_lease_expire') != 'fail':
                    return 400, {'error': 'invalid_lease_contract'}
                if task['status'] != 'queued' or task['claimed_by']:
                    return 409, {'error': 'already_claimed'}
                epoch = datetime.now(timezone.utc).isoformat(timespec='microseconds')
                task.update(status='in_progress', claimed_by=owner, claim_epoch=epoch,
                            claimed_at=epoch, lease_until=datetime.fromtimestamp(time.time() + seconds, timezone.utc).isoformat(),
                            lease_deadline=time.time() + seconds, released=False)
                self.record('claim', task_id)
                return 200, task
            epoch = body.get('claim_epoch')
            if action == 'lease/finish':
                status, result = body.get('status'), body.get('result')
                if status not in ('completed', 'failed') or not isinstance(result, dict):
                    return 400, {'error': 'invalid_terminal_contract'}
                existing = task.get('result', {}).get('lease_receipt')
                if existing:
                    if any(existing.get(key) != value for key, value in
                           (('claimer', owner), ('claim_epoch', epoch), ('status', status))):
                        return 409, {'error': 'lease_receipt_conflict'}
                elif (task['status'] != 'in_progress' or task['claimed_by'] != owner
                        or task.get('claim_epoch') != epoch or task.get('released')
                        or task.get('lease_deadline', 0) <= time.time()):
                    return 409, {'error': 'lease_lost'}
                wanted = {'claimer': owner, 'claim_epoch': epoch, 'status': status, 'result_sha256': digest(result)}
                if existing:
                    if existing != wanted:
                        return 409, {'error': 'lease_receipt_conflict'}
                    self.record('finish-replay', task_id)
                    return 200, {'ok': True, 'task_id': task_id, 'status': status, 'replayed': True, 'receipt': existing}
            if (task['status'] != 'in_progress' or task['claimed_by'] != owner
                    or task.get('claim_epoch') != epoch or task.get('released')
                    or task.get('lease_deadline', 0) <= time.time()):
                return 409, {'error': 'lease_lost'}
            if action == 'heartbeat':
                seconds = body.get('lease_seconds', 300)
                if type(seconds) is not int or not 30 <= seconds <= 14400:
                    return 400, {'error': 'invalid_lease_contract'}
                task['lease_deadline'] = time.time() + seconds
                task['lease_until'] = datetime.fromtimestamp(task['lease_deadline'], timezone.utc).isoformat()
                self.record('heartbeat', task_id)
                return 200, {'ok': True, 'lease_until': task['lease_until'], 'lease_seconds': seconds}
            if action == 'lease/finish':
                task.update(status=status, released=True, claimed_by=None,
                            result={'external_execution': result, 'lease_receipt': wanted})
                self.record('finish', task_id)
                return 200, {'ok': True, 'task_id': task_id, 'status': status, 'replayed': False, 'receipt': wanted}
            return 404, {'error': 'unknown_fixture_route'}


def make_server(state, port=0):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            self.respond('GET', {})

        def do_POST(self):
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 65536:
                    raise ValueError('invalid body size')
                body = json.loads(self.rfile.read(size))
                if not isinstance(body, dict):
                    raise ValueError('object required')
            except (ValueError, json.JSONDecodeError):
                self.send_json(400, {'error': 'invalid_json'})
                return
            self.respond('POST', body)

        def respond(self, method, body):
            code, result = state.request(method, self.path, body)
            self.send_json(code, result)

        def send_json(self, code, value):
            raw = json.dumps(value, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

    return ThreadingHTTPServer(('127.0.0.1', port), Handler)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--ready-file', required=True)
    parser.add_argument('--state-file', required=True)
    args = parser.parse_args()
    state = ProtocolState(args.state_file)
    server = make_server(state)
    Path(args.ready_file).write_text(f'http://127.0.0.1:{server.server_port}')
    try:
        server.serve_forever()
    finally:
        server.server_close()

"""测试账号客服后端合同；不包含 ADB 操作或发送动作。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import urllib.parse
import urllib.request

from bridge import CS_WECHAT_ID, SENDER, State, digest, private_json, valid_draft

DEFAULT_CONFIG = '/Users/administrator/.credentials/cloud-wechat-cs-runtime.json'


def load_config(path):
    path = Path(path)
    if path.is_symlink() or path.stat().st_mode & 0o077:
        raise ValueError('runtime_config_requires_private_regular_file')
    config = json.loads(path.read_text())
    for name in ('api_base', 'tenant_id', 'agent_id', 'cs_wechat_id', 'machine_id'):
        if not isinstance(config.get(name), str) or not config[name].strip():
            raise ValueError('missing_binding_' + name)
    if config['cs_wechat_id'] != CS_WECHAT_ID:
        raise ValueError('wrong_test_account')
    url = urllib.parse.urlsplit(config['api_base'])
    if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password:
        raise ValueError('invalid_api_base')
    return config


def screenshot_hash(path):
    path = Path(path)
    if not path.is_absolute() or not path.is_file():
        raise ValueError('missing_visual_evidence')
    data = path.read_bytes()
    if not data.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('visual_evidence_not_png')
    return hashlib.sha256(data).hexdigest()


class Backend:
    def __init__(self, config, request=None):
        self.config = config
        self.request = request or self.http

    def http(self, method, path, data=None):
        body = json.dumps(data, ensure_ascii=False).encode() if data is not None else None
        headers = {'Content-Type': 'application/json'}
        if self.config.get('auth_token'):
            headers['Authorization'] = 'Bearer ' + self.config['auth_token']
        request = urllib.request.Request(self.config['api_base'].rstrip('/') + path,
                                         data=body, headers=headers, method=method)
        with urllib.request.urlopen(request, timeout=45) as response:
            return json.loads(response.read())

    def preflight(self):
        path = '/api/wechat/cs/agent-config?' + urllib.parse.urlencode(
            {'machine_id': self.config['machine_id']})
        config = self.request('GET', path)
        if (config.get('auto_agent_enabled') is not True
                or config.get('wechat_id') != self.config['cs_wechat_id']
                or SENDER not in config.get('whitelist', [])
                or (config.get('tenant_id') is not None
                    and config['tenant_id'] != self.config['tenant_id'])):
            raise ValueError('backend_config_not_ready')
        return {'ready': True, 'cs_wechat_id': self.config['cs_wechat_id']}

    def check_context(self, context):
        if (context.get('sender') != SENDER or context.get('conversation_header') != SENDER
                or context.get('visual_confirmed') is not True
                or context.get('cs_wechat_id') != self.config['cs_wechat_id']
                or not isinstance(context.get('contact_key'), str)
                or not context['contact_key'].strip()
                or not isinstance(context.get('content'), str)
                or not context['content'].strip()
                or context.get('is_group', False) is not False):
            raise ValueError('unverified_or_unauthorized_context')
        screenshot_hash(context.get('screenshot', ''))

    def draft(self, context):
        self.check_context(context)
        self.preflight()
        body = dict(sender=SENDER, wechat_id=context['contact_key'], content=context['content'],
                    mode='auto', is_group=False, tenant_id=self.config['tenant_id'],
                    agent_id=self.config['agent_id'], cs_wechat_id=self.config['cs_wechat_id'])
        response = self.request('POST', '/api/wechat/draft-generate', body)
        if response.get('status') != 'sent' or not valid_draft(response) or response.get('ok') is False:
            raise ValueError('draft_not_sendable')
        return {'reply': response['reply'], 'message_id': response['message_id']}

    def receipt(self, draft, evidence, status):
        self.check_context(evidence)
        if (status != 'sending' or not valid_draft(draft)
                or evidence.get('sent_once') is not True
                or evidence.get('sent_text') != draft['reply']):
            raise ValueError('delivery_not_visually_confirmed')
        response = self.request('POST', '/api/wechat/messages/' + str(draft['message_id']) + '/receipt',
                            dict(ok=True, agent_id=self.config['agent_id'],
                                 cs_wechat_id=self.config['cs_wechat_id']))
        if response.get('ok') is not True or response.get('updated') is not True:
            raise ValueError('receipt_not_updated')
        return response


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['preflight', 'draft', 'claim-send', 'receipt', 'status'])
    parser.add_argument('--config', default=DEFAULT_CONFIG)
    parser.add_argument('--state', required=True)
    parser.add_argument('--phone-config')
    parser.add_argument('--event-id')
    parser.add_argument('--context')
    parser.add_argument('--evidence')
    parser.add_argument('--out')
    args = parser.parse_args()
    os.umask(0o077)
    state = None
    try:
        backend = Backend(load_config(args.config))
        if args.phone_config:
            from watcher import check_brain_locks
            check_brain_locks(json.loads(Path(args.phone_config).read_text()), min_valid_seconds=30)
        if args.action == 'preflight':
            result = backend.preflight()
        else:
            if not args.phone_config:
                raise ValueError('missing_phone_lease_config')
            state = State(args.state)
            state.require_ready()
            row = state.event(args.event_id)
            if row['event_json'].get('sender') != SENDER:
                raise ValueError('unauthorized_event')
            if args.action == 'status':
                result = {'status': row['status'], 'event_id': args.event_id}
            elif args.action == 'draft':
                context = json.loads(Path(args.context).read_text())
                backend.check_context(context)
                state.verify_phone_evidence(args.event_id, context['screenshot'])
                state.claim_draft(args.event_id, context)
                draft = backend.draft(context)
                state.set_draft(args.event_id, draft, context)
                result = draft
            elif args.action == 'claim-send':
                evidence = json.loads(Path(args.evidence).read_text())
                backend.check_context(evidence)
                state.verify_phone_evidence(args.event_id, evidence['screenshot'])
                if state.action(args.event_id, 'input') != 'completed':
                    raise ValueError('input_attempt_unknown_or_missing')
                if (evidence.get('input_text') != row['draft_json']['reply']
                        or evidence.get('contact_key') != row['contact_key']):
                    raise ValueError('input_or_contact_mismatch')
                backend.preflight()
                state.save_evidence(args.event_id, {'before_send': evidence,
                    'screenshot_sha256': screenshot_hash(evidence['screenshot']),
                    'reply_sha256': digest(row['draft_json']['reply'])})
                state.claim_send(args.event_id)
                result = {'send_claimed': True, 'event_id': args.event_id}
            else:
                evidence = json.loads(Path(args.evidence).read_text())
                state.verify_phone_evidence(args.event_id, evidence['screenshot'])
                if state.action(args.event_id, 'send_click') != 'completed':
                    raise ValueError('send_click_not_confirmed')
                if screenshot_hash(evidence['screenshot']) == row['evidence_json']['screenshot_sha256']:
                    raise ValueError('before_after_screenshot_identical')
                if evidence.get('contact_key') != row['contact_key']:
                    raise ValueError('receipt_contact_mismatch')
                result = backend.receipt(row['draft_json'], evidence, row['status'])
                if result.get('ok') is not True:
                    raise ValueError('receipt_not_accepted')
                state.save_evidence(args.event_id, {'before_send': row['evidence_json'],
                    'after_send': evidence, 'screenshot_sha256': screenshot_hash(evidence['screenshot'])})
                state.transition(args.event_id, 'sending', 'delivered')
                result = {'delivered': True, 'message_id': row['draft_json']['message_id']}
        if args.out:
            private_json(args.out, result)
            print(json.dumps({'ok': True, 'output': args.out}))
        else:
            # Draft reply is untrusted data for the local executor, not a shell command.
            print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:
        # Do not expose URLs, response bodies or credential values through exceptions.
        print(json.dumps({'ready': False, 'error_type': type(exc).__name__,
                          'reason': str(exc) if isinstance(exc, ValueError) else 'dependency_failed'}))
        return 2
    finally:
        if state:
            state.close()


if __name__ == '__main__':
    sys.exit(main())

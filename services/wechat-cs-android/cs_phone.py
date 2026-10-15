"""单事件受限手机工具；输入与最终发送先持久claim，永不自动重试。"""
import argparse
import base64
import json
import os
import re
from pathlib import Path
import sys

from bridge import State, single_instance


def chat_focus(raw, require_empty=True):
    if re.findall(r'\bmInputShown\s*=\s*(true|false)', raw) != ['true']:
        raise ValueError('chat_input_not_shown')
    widget = r'com\.tencent\.mm\.ui\.widget\.MMEditText'
    views = re.findall(r'\bmServedView\s*=\s*' + widget + r'\{([^}\n]+)\}', raw)
    if len(views) != 2 or views[0] != views[1]:
        raise ValueError('chat_served_view_mismatch')
    tokens = views[0].split()
    if len(tokens) < 3 or len(tokens[2]) < 2 or tokens[2][1] != 'F':
        raise ValueError('chat_served_view_not_focused')
    connections = re.findall(r'\bmServedInputConnectionWrapper\s*=\s*([^\n]+)', raw)
    if len(connections) != 1:
        raise ValueError('chat_connection_unknown')
    connection = connections[0]
    if (not connection.startswith('IInputConnectionWrapper{')
            or re.findall(r'\bfinished=(true|false)', connection) != ['false']
            or re.findall(r'\bisActive\(\)=(true|false)', connection) != ['true']
            or not re.search(r'\bconnection=[A-Za-z_$][\w.$]*@[0-9a-fA-F]+', connection)):
        raise ValueError('chat_connection_inactive')
    editors = []
    lines = raw.splitlines()
    for index, line in enumerate(lines):
        match = re.match(r'^([ \t]*)mCurrentTextBoxAttribute:\s*$', line)
        if not match:
            continue
        indent = len(match[1].expandtabs())
        block = []
        for child in lines[index + 1:]:
            if not child.strip() or len(child) - len(child.lstrip()) <= indent:
                break
            block.append(child)
        editors.append('\n'.join(block))
    if len(editors) != 1:
        raise ValueError('current_chat_editor_unknown')
    editor = editors[0]
    types = re.findall(r'\binputType=(0x[0-9a-fA-F]+|[0-9]+)', editor)
    ids = re.findall(r'\bfieldId=(0x[0-9a-fA-F]+|[0-9]+)', editor)
    if (re.findall(r'\bpackageName=([\w.]+)', editor) != ['com.tencent.mm']
            or len(types) != 1 or int(types[0], 0) & 0xF != 1
            or len(ids) != 1 or int(ids[0], 0) <= 0
            or re.findall(r'\bIS_CHAT_EDITOR=(true|false)', editor) != ['true']
            or re.findall(r'\bwechat_scene=(\d+)', editor) != ['1']):
        raise ValueError('current_editor_not_chat')
    if require_empty and (re.findall(r'\binitialSelStart=(-?\d+)', editor) != ['0']
                          or re.findall(r'\binitialSelEnd=(-?\d+)', editor) != ['0']):
        raise ValueError('chat_input_not_initial_empty_selection')
    connection_id = re.search(r'\bconnection=([A-Za-z_$][\w.$]*@[0-9a-fA-F]+)', connection).group(1)
    return tokens[0], connection_id


def chat_phone(base_phone):
    class ChatPhone(base_phone):
        def require_oem_composer_focus(self):
            fg = self.foreground()
            if (fg['package'] != 'com.tencent.mm' or fg['activity'] not in (
                    'com.tencent.mm.ui.LauncherUI', '.ui.LauncherUI',
                    'com.tencent.mm.ui.chatting.ChattingUI', '.ui.chatting.ChattingUI')):
                raise ValueError('chat_not_foreground')
            return chat_focus(self.shell('dumpsys', 'input_method'),
                              require_empty=not getattr(self, '_after_input', False))

        def input_text(self, encoded):
            self._after_input = False
            before = self.require_oem_composer_focus()
            try:
                result = super().input_text(encoded)
                self._after_input = True
                if self.require_oem_composer_focus() != before:
                    raise ValueError('chat_connection_changed_after_input_no_retry')
                return result
            finally:
                self._after_input = False
    return ChatPhone


class Controller:
    def __init__(self, state, event_id, phone):
        self.state, self.event_id, self.phone = state, event_id, phone

    def execute(self, operation, values):
        if not re.fullmatch(r'[A-Za-z0-9_-]+', self.event_id):
            raise ValueError('invalid_event_id')
        with single_instance(self.state.path.parent / (self.event_id + '.operation.guard')):
            return self._execute(operation, values)

    def _execute(self, operation, values):
        self.state.require_ready()
        row = self.state.event(self.event_id)
        if row['event_json'].get('sender') != '苏小妖':
            raise ValueError('unauthorized_event')
        if operation in ('tap', 'swipe', 'open-wechat'):
            if self.state.action(self.event_id, 'input'):
                raise ValueError('navigation_locked_after_input_attempt')
            if row['status'] not in ('claimed', 'drafting', 'drafted'):
                raise ValueError('navigation_not_allowed')
            actual, args = operation, values
        elif operation == 'text-from-draft':
            if row['status'] != 'drafted' or not row['draft_json']:
                raise ValueError('draft_not_ready')
            self.state.claim_action(self.event_id, 'input')
            actual, args = 'text-b64', [base64.b64encode(row['draft_json']['reply'].encode()).decode()]
        elif operation == 'send':
            if row['status'] != 'sending' or self.state.action(self.event_id, 'input') != 'completed':
                raise ValueError('send_not_claimed_or_input_unknown')
            before = (row['evidence_json'] or {}).get('before_send', {})
            self.state.verify_phone_evidence(self.event_id, before.get('screenshot', ''))
            self.state.claim_action(self.event_id, 'send_click')
            actual, args = 'tap', values
        elif operation in ('screenshot', 'ui', 'back', 'foreground'):
            actual, args = operation, values
        else:
            raise ValueError('unsupported_cs_phone_operation')
        result = self.phone.execute(actual, args)
        self.state.register_phone_evidence(self.event_id, result, self.phone)
        if operation == 'text-from-draft':
            self.state.complete_action(self.event_id, 'input')
        elif operation == 'send':
            self.state.complete_action(self.event_id, 'send_click')
        return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--phone-config', required=True)
    parser.add_argument('--state', required=True)
    parser.add_argument('--event-id', required=True)
    parser.add_argument('operation', choices=['open-wechat', 'tap', 'swipe', 'back', 'screenshot',
                                            'ui', 'foreground', 'text-from-draft', 'send'])
    parser.add_argument('values', nargs='*', type=int)
    args = parser.parse_args()
    expected = {'tap': 2, 'send': 2, 'swipe': 5}.get(args.operation, 0)
    if len(args.values) != expected or any(value < 0 or value > 20000 for value in args.values):
        parser.error('operation_arguments_invalid')
    os.umask(0o077)
    state = State(args.state)
    try:
        config_path = Path(args.phone_config)
        if config_path.is_symlink() or config_path.stat().st_mode & 0o077:
            raise ValueError('phone_config_not_private')
        config = json.loads(config_path.read_text())
        from watcher import check_brain_locks, load_phone
        check_brain_locks(config, min_valid_seconds=30)
        config['evidence_root'] = str(Path(config['evidence_root']) / args.event_id)
        phone = load_phone(config)
        phone.__class__ = chat_phone(phone.__class__)
        result = Controller(state, args.event_id, phone).execute(args.operation, args.values)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({'ok': False, 'error_type': type(exc).__name__,
                          'reason': str(exc) if isinstance(exc, ValueError) else 'phone_action_failed_no_retry'}))
        return 2
    finally:
        state.close()


if __name__ == '__main__':
    sys.exit(main())

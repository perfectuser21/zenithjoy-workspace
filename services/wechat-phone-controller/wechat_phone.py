#!/usr/bin/env python3
"""微信专用手机控制器；只消费既有锁，保留锁，不获取或释放锁。

在连接手机的宿主运行。每次操作必须持有公共 serial.guard，并精确匹配
serial.lock/owner。所有 ADB 命令有界；不提供最终发布重试或通用 shell 入口。
"""
import argparse
import base64
import contextlib
import csv
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import uuid


class Refused(RuntimeError):
    pass


def bounded(argv, timeout):
    """超时终止整个 ADB 客户端进程组，并等待回收；不重试命令。"""
    proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            start_new_session=True)
    try:
        out, err = proc.communicate(timeout=timeout)
    except BaseException:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.communicate(timeout=2)
        raise
    if proc.returncode:
        raise Refused('adb_failed: ' + err.decode('utf-8', errors='replace')[:300])
    return out


def resolve_serial(serial, profile, registry):
    if not serial:
        if not profile:
            raise Refused('serial_or_profile_required')
        rows = []
        with open(registry, newline='', encoding='utf-8') as handle:
            columns = None
            for row in csv.reader(handle, delimiter='\t', quoting=csv.QUOTE_NONE):
                if not row:
                    continue
                if row[0] in ('profile', '#profile'):
                    columns = {name.lstrip('#'): i for i, name in enumerate(row)}
                    continue
                if row[0].startswith('#'):
                    continue
                pi, si = ((columns.get('profile', -1), columns.get('serial', -1))
                          if columns else (0, 1))
                if min(pi, si) >= 0 and max(pi, si) < len(row) and row[pi] == profile:
                    rows.append(row[si])
        if len(rows) != 1:
            raise Refused('profile_missing_or_ambiguous')
        serial = rows[0]
    if not re.fullmatch(r'[A-Za-z0-9_.:-]+', serial) or serial in ('.', '..'):
        raise Refused('invalid_serial')
    return serial


class Phone:
    def __init__(self, serial, owner, evidence_dir, lock_root, adb='adb', timeout=15):
        if not owner or '\n' in owner or '\r' in owner:
            raise Refused('invalid_owner')
        self.serial, self.owner = serial, owner
        self.evidence_dir, self.lock_root = Path(evidence_dir), Path(lock_root)
        self.adb, self.timeout = adb, timeout
        self.owner_path = self.lock_root / (serial + '.lock') / 'owner'
        self.guard_path = self.lock_root / (serial + '.guard')

    def require_owner(self):
        try:
            with open(self.owner_path, encoding='utf-8', newline='') as handle:
                actual = handle.read()
        except OSError as exc:
            raise Refused('lock_not_held') from exc
        if actual not in (self.owner, self.owner + '\n'):
            raise Refused('exact_owner_mismatch')

    @contextlib.contextmanager
    def guard(self):
        self.require_owner()
        # 不创建锁根或 owner；guard 和公共控制器使用同一 inode。
        fd = os.open(self.guard_path, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise Refused('serial_guard_busy') from exc
            self.require_owner()
            yield
            self.require_owner()
        finally:
            os.close(fd)

    def run(self, *args):
        self.require_owner()
        result = bounded([self.adb, '-s', self.serial, *args], self.timeout)
        self.require_owner()
        return result

    def shell(self, *args):
        return self.run('shell', *args).decode('utf-8', errors='strict').strip()

    def _default_display_focus(self, raw):
        """Accept only the default display beside proven idle 1x1 displays.

        Input/screencap operations address display 0. Never select another
        display merely because its focus is non-null. All new acceptance also
        requires the independently resumed activity and window/task/session.
        """
        def one(pattern, source):
            # Count field markers as well as valid values: a malformed competing
            # value is ambiguity, not permission to borrow a later valid field.
            fields = ('mTopFocusedDisplayId', 'mCurrentFocus', 'mFocusedApp',
                      'displayId', 'mOwnerUid', 'mSession', 'mDisplayId',
                      'rootTaskId', 'package', 'ty', 'mHasSurface',
                      'isOnScreen', 'isVisible', 'mPackageName',
                      'mPreferredTopFocusableRootTask', 'topResumedActivity',
                      'topDisplayFocusedRootTask')
            for name in fields:
                field_pattern = r'(?<![A-Za-z0-9_])' + name + '='
                if (re.search(field_pattern, pattern.replace(r'\b', ''))
                        and len(re.findall(r'\b' + name + r'\s*=', source)) != 1):
                    raise Refused('foreground_unknown')
            if 'DisplayFrames' in pattern and len(re.findall(r'^\s*DisplayFrames\b', source, re.M)) != 1:
                raise Refused('foreground_unknown')
            if 'isReadyForDisplay' in pattern and len(re.findall(r'\bisReadyForDisplay\(\)\s*=', source)) != 1:
                raise Refused('foreground_unknown')
            found = re.findall(pattern, source, re.M)
            if len(found) != 1:
                raise Refused('foreground_unknown')
            return found[0]

        if one(r'^\s*mTopFocusedDisplayId=(\d+)\s*$', raw) != '0':
            raise Refused('foreground_unknown')
        contents = one(r'^WINDOW MANAGER DISPLAY CONTENTS[^\n]*\n([\s\S]*?)(?=^WINDOW MANAGER|\Z)', raw)
        headers = list(re.finditer(r'^  Display: mDisplayId=(\d+) rootTasks=(\d+)\s*$', contents, re.M))
        if (len(headers) < 2 or len({h[1] for h in headers}) != len(headers)
                or len(re.findall(r'^\s*Display:', contents, re.M)) != len(headers)):
            raise Refused('foreground_unknown')
        selected = None
        for index, header in enumerate(headers):
            body = contents[header.end():headers[index + 1].start() if index + 1 < len(headers) else len(contents)]
            focus = one(r'^\s*mCurrentFocus=([^\n]+)$', body)
            app = one(r'^\s*mFocusedApp=([^\n]+)$', body)
            if one(r'^\s*displayId=(\d+)\s*$', body) != header[1]:
                raise Refused('foreground_unknown')
            width, height = one(r'^\s*DisplayFrames w=(\d+) h=(\d+) r=\d+\s*$', body)
            if header[1] == '0':
                if int(header[2]) < 1 or min(int(width), int(height)) <= 1:
                    raise Refused('foreground_unknown')
                selected = (body, focus, app)
            elif (header[2], width, height, focus, app) != ('0', '1', '1', 'null', 'null'):
                raise Refused('foreground_unknown')
        # No unscoped focus lines, duplicate display records or borrowed fields.
        for key in ('mCurrentFocus', 'mFocusedApp'):
            if len(re.findall(r'^\s*' + key + r'=', raw, re.M)) != len(headers):
                raise Refused('foreground_unknown')
        if selected is None:
            raise Refused('foreground_unknown')
        body, focus, app = selected
        token, user, title = one(r'^Window\{([0-9a-fA-F]+) u(\d+) ([^{}\n]+)\}$', focus)

        def activity(value):
            identity, activity_user, package, name, task = one(
                r'^ActivityRecord\{([0-9a-fA-F]+) u(\d+) ([A-Za-z0-9_.]+)/([^\s{}]+) t(\d+)\}$', value)
            return identity, activity_user, package, package + name if name.startswith('.') else name, task
        focused = activity(app)
        activities = self.shell('dumpsys', 'activity', 'activities')
        activity_task = None
        if re.search(r'^\s*topResumedActivity\s*=', activities, re.M):
            resumed = activity(one(r'^\s*topResumedActivity=([^\n]+)$', activities))
        else:
            # Android 12 reports mResumedActivity under a Display/RootTask,
            # followed by a separate Resumed summary. Do not borrow another
            # display's activity or trust the unscoped summary by itself.
            activity_displays = list(re.finditer(r'^Display #(\d+) \(activities from top to bottom\):\s*$', activities, re.M))
            if ({h[1] for h in activity_displays} != {h[1] for h in headers}
                    or len(activity_displays) != len(headers)
                    or len(re.findall(r'^Display #', activities, re.M)) != len(activity_displays)
                    or len(re.findall(r'^\s*mResumedActivity\s*:', activities, re.M)) != 1
                    or len(re.findall(r'^\s*Resumed\s*:', activities, re.M)) != 1):
                raise Refused('foreground_unknown')
            main = next(index for index, header in enumerate(activity_displays) if header[1] == '0')
            end = activity_displays[main + 1].start() if main + 1 < len(activity_displays) else len(activities)
            main_activities = activities[activity_displays[main].end():end]
            main_activities = re.split(r'^ActivityTaskSupervisor state:', main_activities, maxsplit=1, flags=re.M)[0]
            resumed = activity(one(r'^\s*mResumedActivity: ([^\n]+)$', main_activities))
            if activity(one(r'^\s*Resumed: ([^\n]+)$', main_activities)) != resumed:
                raise Refused('foreground_unknown')
            resume_offset = re.search(r'^\s*mResumedActivity:', main_activities, re.M).start()
            roots = list(re.finditer(r'^  RootTask #(\d+):[^\n]*$', main_activities, re.M))
            if len(roots) != len(re.findall(r'^\s*RootTask #', main_activities, re.M)):
                raise Refused('foreground_unknown')
            containing = [header for header in roots if header.start() < resume_offset]
            if not containing or containing[-1][1] != resumed[4]:
                raise Refused('foreground_unknown')
            if re.search(r'^\s*ResumedActivity\s*:', activities, re.M):
                if (len(re.findall(r'^\s*ResumedActivity\s*:', activities, re.M)) != 1
                        or activity(one(r'^\s*ResumedActivity: ([^\n]+)$', activities)) != resumed):
                    raise Refused('foreground_unknown')
            activity_task = one(
                r'^\s*topDisplayFocusedRootTask=Task\{[0-9a-fA-F]+ #(\d+) type=standard A=(\d+):([A-Za-z0-9_.]+) U=(\d+) visible=(true|false)\b[^\n]*\}', activities)
        if focused != resumed or focused[1:3] != (user, 'com.tencent.mm'):
            raise Refused('foreground_unknown')
        popup = re.fullmatch(r'PopupWindow:[0-9a-fA-F]+', title)
        component = re.fullmatch(r'com\.tencent\.mm/([^\s{}]+)', title)
        if popup:
            if focused[3] != 'com.tencent.mm.ui.LauncherUI':
                raise Refused('foreground_unknown')
        elif not component or focused[3] != ('com.tencent.mm' + component[1] if component[1].startswith('.') else component[1]):
            raise Refused('foreground_unknown')

        def section(pattern, key):
            matches = []
            lines = raw.splitlines()
            seen_tokens = 0
            for index, line in enumerate(lines):
                header = re.fullmatch(pattern, line)
                if not header:
                    continue
                seen_tokens += header[1] == key[0]
                if header.groups() != key:
                    continue
                indent = len(line) - len(line.lstrip())
                children = []
                for child in lines[index + 1:]:
                    if child.strip() and len(child) - len(child.lstrip()) <= indent:
                        break
                    children.append(child)
                matches.append('\n'.join(children))
            if len(matches) != 1 or seen_tokens != 1:
                raise Refused('foreground_unknown')
            return matches[0]
        window = section(r'\s*Window #\d+ Window\{([0-9a-fA-F]+) u(\d+) ([^{}\n]+)\}:', (token, user, title))
        uid = int(one(r'\bmOwnerUid=(\d+)\b', window))
        session = one(r'\bmSession=Session\{([0-9a-fA-F]+) (\d+):u(\d+)a(\d+)\}', window)
        if (uid < 10000 or uid // 100000 != int(user) or session[2] != user
                or int(session[3]) != uid % 100000):
            raise Refused('foreground_unknown')
        if (one(r'\bmDisplayId=(\d+)\b', window) != '0'
                or one(r'\brootTaskId=(\d+)\b', window) != focused[4]
                or one(r'\bpackage=([A-Za-z0-9_.]+)', window) != 'com.tencent.mm'
                or one(r'\bty=([A-Z_]+)', window) != ('APPLICATION_PANEL' if popup else 'BASE_APPLICATION')):
            raise Refused('foreground_unknown')
        for flag in (r'\bmHasSurface=(true|false)', r'\bisReadyForDisplay\(\)=(true|false)',
                     r'^\s*isOnScreen=(true|false)', r'^\s*isVisible=(true|false)'):
            if one(flag, window) != 'true':
                raise Refused('foreground_unknown')
        owner = section(r'\s*Session Session\{([0-9a-fA-F]+) (\d+):u(\d+)a(\d+)\}:', session)
        if one(r'\bmPackageName=([A-Za-z0-9_.]+)', owner) != 'com.tencent.mm':
            raise Refused('foreground_unknown')
        task, task_uid, task_package, task_user, visible = one(
            r'^\s*mPreferredTopFocusableRootTask=Task\{[0-9a-fA-F]+ #(\d+) type=standard A=(\d+):([A-Za-z0-9_.]+) U=(\d+) visible=(true|false)\b[^\n]*\}', body)
        if (task, task_uid, task_package, task_user, visible) != (focused[4], str(uid), 'com.tencent.mm', user, 'true'):
            raise Refused('foreground_unknown')
        if activity_task is not None and activity_task != (task, task_uid, task_package, task_user, visible):
            raise Refused('foreground_unknown')
        # Only remove the proven idle-display null entries. The popup validator
        # below still checks the parent, attachment and full ownership.
        return re.sub(r'^\s*m(?:CurrentFocus|FocusedApp)=null\n', '', raw, flags=re.M)

    def foreground(self):
        # Ordinary activities keep the exact package/component path. Popup focus
        # is accepted only with independent, section-bound ownership proofs.
        raw = self.shell('dumpsys', 'window')
        top_displays = re.findall(r'^\s*mTopFocusedDisplayId=(\d+)\s*$', raw, re.M)
        top_markers = re.findall(r'^\s*mTopFocusedDisplayId\s*=', raw, re.M)
        if top_markers and (len(top_markers) != 1 or top_displays != ['0']):
            raise Refused('foreground_unknown')
        validated_default_display = False
        if (len(re.findall(r'^\s*mCurrentFocus=', raw, re.M)) > 1
                or len(re.findall(r'^\s*Display:', raw, re.M)) > 1):
            raw = self._default_display_focus(raw)
            validated_default_display = True
        def one(pattern, source):
            found = re.findall(pattern, source, re.M)
            if len(found) != 1:
                raise Refused('foreground_unknown')
            return found[0]

        focus = one(r'^\s*mCurrentFocus=([^\n]+)$', raw)
        current = re.fullmatch(r'Window\{([0-9a-fA-F]+) u(\d+) ([^{}\n]+)\}', focus)
        if not current:
            raise Refused('foreground_unknown')
        token, user, title = current.groups()
        component = re.fullmatch(r'([A-Za-z0-9_.]+)/(\S+)', title)
        if component:
            return {'package': component[1], 'activity': component[2]}
        if not re.fullmatch(r'PopupWindow:[0-9a-fA-F]+', title):
            raise Refused('foreground_unknown')

        def sections(pattern):
            result = []
            lines = raw.splitlines()
            for index, line in enumerate(lines):
                header = re.fullmatch(pattern, line)
                if not header:
                    continue
                indent = len(line) - len(line.lstrip())
                body = []
                for child in lines[index + 1:]:
                    if child.strip() and len(child) - len(child.lstrip()) <= indent:
                        break
                    body.append(child)
                result.append((header.groups(), '\n'.join(body)))
            return result

        windows = sections(r'\s*Window #\d+ Window\{([0-9a-fA-F]+) u(\d+) ([^{}\n]+)\}:')
        def window(identity):
            found = [body for key, body in windows if key == identity]
            # A repeated token under another identity is also ambiguous.
            if len(found) != 1 or sum(key[0] == identity[0] for key, _ in windows) != 1:
                raise Refused('foreground_unknown')
            return found[0]

        popup = window((token, user, title))
        parent_key = one(r'\bmParentWindow=Window\{([0-9a-fA-F]+) u(\d+) ([^{}\n]+)\}', popup)
        parent_token, parent_user, parent_title = parent_key
        launcher = 'com.tencent.mm/com.tencent.mm.ui.LauncherUI'
        if parent_user != user or parent_token == token or parent_title not in (
                launcher, 'com.tencent.mm/.ui.LauncherUI'):
            raise Refused('foreground_unknown')
        parent = window(parent_key)

        def proof(body, kind):
            if one(r'\bty=([A-Z_]+)', body) != kind:
                raise Refused('foreground_unknown')
            if one(r'\bpackage=([A-Za-z0-9_.]+)', body) != 'com.tencent.mm':
                raise Refused('foreground_unknown')
            uid = int(one(r'\bmOwnerUid=(\d+)\b', body))
            session = one(r'\bmSession=Session\{([0-9a-fA-F]+) (\d+):u(\d+)a(\d+)\}', body)
            if uid < 10000 or uid // 100000 != int(user) or session[2] != user or int(session[3]) != uid % 100000:
                raise Refused('foreground_unknown')
            for flag in (r'\bmHasSurface=(true|false)', r'\bisReadyForDisplay\(\)=(true|false)',
                         r'^\s*isOnScreen=(true|false)', r'^\s*isVisible=(true|false)'):
                if one(flag, body) != 'true':
                    raise Refused('foreground_unknown')
            return (uid, session, one(r'\bmDisplayId=(\d+)\b', body),
                    one(r'\brootTaskId=(\d+)\b', body))

        ownership = proof(popup, 'APPLICATION_PANEL')
        if ownership != proof(parent, 'BASE_APPLICATION') or one(r'\bmLayoutAttached=(true|false)', popup) != 'true':
            raise Refused('foreground_unknown')
        sessions = sections(r'\s*Session Session\{([0-9a-fA-F]+) (\d+):u(\d+)a(\d+)\}:')
        matching = [body for key, body in sessions if key == ownership[1]]
        if len(matching) != 1 or sum(key[0] == ownership[1][0] for key, _ in sessions) != 1:
            raise Refused('foreground_unknown')
        if one(r'\bmPackageName=([A-Za-z0-9_.]+)', matching[0]) != 'com.tencent.mm':
            raise Refused('foreground_unknown')

        def activity(value):
            match = re.fullmatch(r'ActivityRecord\{([0-9a-fA-F]+) u(\d+) ([A-Za-z0-9_.]+)/([^\s{}]+) t(\d+)\}', value)
            if not match:
                raise Refused('foreground_unknown')
            identity, activity_user, package, name, task = match.groups()
            name = package + name if name.startswith('.') else name
            return identity, activity_user, package, name, task
        focused = activity(one(r'^\s*mFocusedApp=([^\n]+)$', raw))
        # The scoped multi-display validator already matched this exact focused
        # ActivityRecord against the independent resumed activity, including the
        # Android12 mResumed/Resumed/task proof. Keep every popup/parent proof
        # above; only avoid re-requiring the newer topResumedActivity field.
        top = focused if validated_default_display else activity(one(
            r'^\s*topResumedActivity=([^\n]+)$',
            self.shell('dumpsys', 'activity', 'activities')))
        expected = (user, 'com.tencent.mm', 'com.tencent.mm.ui.LauncherUI', ownership[3])
        if focused != top or focused[1:] != expected:
            raise Refused('foreground_unknown')
        return {'package': 'com.tencent.mm', 'activity': 'com.tencent.mm.ui.LauncherUI'}

    def require_safe_write(self, allow_other_app=False):
        states = re.findall(r'\bmCallState\s*=\s*(\d+)',
                            self.shell('dumpsys', 'telephony.registry'))
        if not states or any(state != '0' for state in states):
            raise Refused('call_not_idle_or_unknown')
        window = self.shell('dumpsys', 'window', 'policy')
        # Android OEM 使用不同列名。只接受至少一种显式 unlocked 且无冲突。
        locked = re.findall(r'\b(?:isStatusBarKeyguard|mShowingLockscreen|showing|'
                            r'mKeyguardShowing|mKeyguardLocked)\s*=\s*(true|false)', window)
        if not locked or 'true' in locked:
            raise Refused('device_locked_or_unknown')
        fg = self.foreground()
        if not allow_other_app and fg['package'] != 'com.tencent.mm':
            raise Refused('wechat_not_foreground')

    def snapshot(self, prefix):
        image = self.run('exec-out', 'screencap', '-p')
        if not image.startswith(b'\x89PNG\r\n\x1a\n'):
            raise Refused('screenshot_invalid')
        path = self.evidence_dir / (prefix + '.png')
        path.write_bytes(image)
        path.chmod(0o600)
        foreground = self.foreground()
        return {'screenshot': str(path), 'foreground': foreground}

    def require_oem_composer_focus(self):
        """UIA 空树时仅接受真实朋友圈编辑器的 IME 焦点，不接受聊天框。"""
        fg = self.foreground()
        if fg['package'] != 'com.tencent.mm' or fg['activity'] not in (
                'com.tencent.mm.plugin.sns.ui.SnsUploadUI', '.plugin.sns.ui.SnsUploadUI'):
            raise Refused('oem_not_sns_composer')
        raw = self.shell('dumpsys', 'input_method')
        shown = re.findall(r'\bmInputShown\s*=\s*(true|false)', raw)
        if shown != ['true']:
            raise Refused('oem_input_not_shown_or_unknown')
        widget = r'com\.tencent\.mm\.plugin\.sns\.ui\.widget\.SnsUpload(?:V2)?EditText'
        views = re.findall(r'\bmServedView\s*=\s*(' + widget + r')\{([^}\n]+)\}', raw)
        # dumpsys 包含 connection 的嵌套 mServedView；两处必须是同一实例。
        if len(views) != 2 or views[0] != views[1]:
            raise Refused('oem_served_composer_view_unconfirmed')
        tokens = views[0][1].split()
        if len(tokens) < 3 or len(tokens[2]) < 2 or tokens[2][1] != 'F':
            raise Refused('oem_served_view_not_focused')
        connections = re.findall(
            r'\bmServedInputConnection(Wrapper)?\s*=\s*([^\n]+)', raw)
        if len(connections) != 1:
            raise Refused('oem_connection_unknown')
        wrapper, connection = connections[0]
        connection_views = re.findall(
            r'\bmServedView\s*=\s*(' + widget + r')\{([^}\n]+)\}', connection)
        if connection_views != [views[0]]:
            raise Refused('oem_connection_view_unconfirmed')
        if wrapper:
            # Android 12 当前连接：不能借 mIInputContext 或历史连接的活跃标志。
            if not connection.startswith('IInputConnectionWrapper{'):
                raise Refused('oem_connection_unknown')
            if (re.findall(r'\bfinished\s*=\s*(true|false)', connection) != ['false'] or
                    re.findall(r'\bmParentInputMethodManager\.isActive\(\)\s*=\s*'
                               r'(true|false)', connection) != ['true']):
                raise Refused('oem_connection_inactive')
        else:
            if not connection.startswith('RemoteInputConnectionImpl{'):
                raise Refused('oem_connection_unknown')
            if re.findall(r'\bmDeactivateRequested\s*=\s*(true|false)', connection) != ['false']:
                raise Refused('oem_connection_inactive')
        if not re.search(r'\bconnection\s*=\s*(?:[A-Za-z_$][\w$]*\.)+'
                         r'[A-Za-z_$][\w$]*@[0-9a-fA-F]+(?=\s|})', connection):
            raise Refused('oem_connection_missing')
        # 当前 EditorInfo 专属缩进区；禁止跨段借历史/其他应用字段凑证据。
        editors = []
        lines = raw.splitlines()
        header = re.compile(r'^([ \t]*)(?:current EditorInfo\b|mCurAttribute\b|'
                            r'mCurrentTextBoxAttribute\b|mCurrentEditorInfo\b)')
        for index, line in enumerate(lines):
            match = header.match(line)
            if not match:
                continue
            block = [line]
            indent = len(match[1].expandtabs())
            for child in lines[index + 1:]:
                if not child.strip() or len(child.expandtabs()) - len(child.lstrip().expandtabs()) <= indent:
                    break
                block.append(child)
            editors.append('\n'.join(block))
        valid = []
        for editor in editors:
            packages = re.findall(r'\bpackageName\s*=\s*([A-Za-z0-9_.]+)', editor)
            types = re.findall(r'\binputType\s*=\s*(0x[0-9a-fA-F]+|[0-9]+)', editor)
            ids = re.findall(r'\bfieldId\s*=\s*(0x[0-9a-fA-F]+|[0-9]+)', editor)
            if packages == ['com.tencent.mm'] and len(types) == len(ids) == 1:
                input_type = int(types[0], 16 if types[0].startswith('0x') else 10)
                field_id = int(ids[0], 16 if ids[0].startswith('0x') else 10)
                if input_type & 0xF == 1 and field_id > 0:
                    valid.append(editor)
        if len(valid) != 1:
            raise Refused('oem_current_editorinfo_unknown')
        return views[0][0], tokens[0]

    def input_text(self, encoded):
        try:
            decoded = base64.b64decode(encoded, validate=True).decode('utf-8')
        except (ValueError, UnicodeError) as exc:
            raise Refused('invalid_base64_utf8') from exc
        if not decoded or len(decoded.encode('utf-8')) > 20000:
            raise Refused('text_empty_or_too_large')
        canonical = base64.b64encode(decoded.encode('utf-8')).decode('ascii')
        original = self.shell('settings', 'get', 'secure', 'default_input_method')
        if not re.fullmatch(r'[A-Za-z0-9_.]+/[A-Za-z0-9_.]+', original):
            raise Refused('original_ime_unknown')
        ime = 'com.android.adbkeyboard/.AdbIME'
        # 只在微信有一个可编辑且已聚焦输入框时输入，防广播进错字段。
        xml = self.ui_xml()
        import xml.etree.ElementTree as ET
        fields = [node for node in ET.fromstring(xml).iter('node')
                  if node.get('focused') == 'true'
                  and node.get('class', '').endswith('EditText')
                  and node.get('package') == 'com.tencent.mm']
        oem_fallback = not fields
        if len(fields) > 1:
            raise Refused('wechat_focused_edittext_ambiguous')
        if oem_fallback:
            # 仅整个 UIA 没有可编辑微信框时启用；存在未聚焦框不能借 OEM 绕过。
            if any(node.get('package') == 'com.tencent.mm' and
                   node.get('class', '').endswith('EditText')
                   for node in ET.fromstring(xml).iter('node')):
                raise Refused('wechat_focused_edittext_required')
            composer = self.require_oem_composer_focus()
        try:
            self.require_safe_write()
            self.shell('ime', 'enable', ime)
            self.require_safe_write()
            self.shell('ime', 'set', ime)
            if self.shell('settings', 'get', 'secure', 'default_input_method') != ime:
                raise Refused('adb_keyboard_switch_failed')
            self.require_safe_write()
            if oem_fallback:
                if self.require_oem_composer_focus() != composer:
                    raise Refused('oem_composer_changed_before_input')
            result = self.shell('am', 'broadcast', '-a', 'ADB_INPUT_B64', '--es', 'msg', canonical)
            if 'Broadcast completed' not in result:
                raise Refused('text_broadcast_unconfirmed')
            typed = self.ui_xml()
            matches = [node.get('text', '') for node in ET.fromstring(typed).iter('node')
                       if node.get('focused') == 'true'
                       and node.get('class', '').endswith('EditText')
                       and node.get('package') == 'com.tencent.mm']
            if oem_fallback and not matches:
                return {'utf8_bytes': len(decoded.encode('utf-8')), 'readback': False,
                        'text_verified': False, 'requires_visual_readback': True,
                        'sha256': hashlib.sha256(decoded.encode('utf-8')).hexdigest()}
            if len(matches) != 1 or not matches[0].endswith(decoded):
                raise Refused('text_readback_unconfirmed_no_retry')
            return {'utf8_bytes': len(decoded.encode('utf-8')), 'readback': True,
                    'text_verified': True, 'requires_visual_readback': False,
                    'sha256': hashlib.sha256(decoded.encode('utf-8')).hexdigest()}
        finally:
            # 不重试正文广播。无论广播结果如何，恢复原 IME 并严格读回。
            self.shell('ime', 'set', original)
            if self.shell('settings', 'get', 'secure', 'default_input_method') != original:
                raise Refused('original_ime_restore_unconfirmed')

    def ui_xml(self):
        remote = '/sdcard/wechat-codex-' + uuid.uuid4().hex + '.xml'
        self.run('shell', 'uiautomator', 'dump', remote)
        try:
            xml = self.run('exec-out', 'cat', remote)
            import xml.etree.ElementTree as ET
            ET.fromstring(xml)
            return xml
        finally:
            self.run('shell', 'rm', '-f', remote)

    def execute(self, operation, values):
        with self.guard():
            self.evidence_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
            run_id = time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8]
            record = {'operation': operation, 'serial': self.serial, 'owner': self.owner,
                      'status': 'started', 'before': self.snapshot(run_id + '-before')}
            receipt = self.evidence_dir / (run_id + '.json')
            try:
                if operation in ('open-wechat', 'tap', 'swipe', 'back', 'text-b64'):
                    self.require_safe_write(allow_other_app=operation == 'open-wechat')
                if operation == 'open-wechat':
                    record['result'] = self.shell('am', 'start', '-n', 'com.tencent.mm/.ui.LauncherUI')
                    if self.foreground()['package'] != 'com.tencent.mm':
                        raise Refused('open_wechat_unconfirmed_no_retry')
                elif operation == 'tap':
                    record['result'] = self.shell('input', 'tap', *map(str, values))
                elif operation == 'swipe':
                    record['result'] = self.shell('input', 'swipe', *map(str, values))
                elif operation == 'back':
                    record['result'] = self.shell('input', 'keyevent', '4')
                elif operation == 'text-b64':
                    record['result'] = self.input_text(values[0])
                elif operation == 'ui':
                    xml_path = self.evidence_dir / (run_id + '.xml')
                    xml_path.write_bytes(self.ui_xml())
                    xml_path.chmod(0o600)
                    record['result'] = {'xml': str(xml_path)}
                elif operation == 'foreground':
                    record['result'] = self.foreground()
                elif operation != 'screenshot':
                    raise Refused('unsupported_operation')
                record['status'] = ('requires_visual_readback' if operation == 'text-b64'
                                    and record['result'].get('requires_visual_readback') else 'executed')
            except BaseException as exc:
                record['status'] = 'failed_no_retry'
                record['error'] = str(exc)
                raise
            finally:
                try:
                    record['after'] = self.snapshot(run_id + '-after')
                except BaseException as exc:
                    record['after_error'] = str(exc)
                    record['status'] = 'evidence_incomplete_no_retry'
                receipt.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
                receipt.chmod(0o600)
            if record['status'] not in ('executed', 'requires_visual_readback'):
                raise Refused(record['status'])
            return {'receipt': str(receipt), **record}


def main():
    def canceled(signum, frame):
        # 让 bounded 清理子进程，input_text 的 finally 恢复原输入法。
        raise KeyboardInterrupt('interrupted_no_retry')
    signal.signal(signal.SIGTERM, canceled)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--serial')
    parser.add_argument('--profile')
    parser.add_argument('--registry', default=os.path.expanduser('~/.config/openclaw/douyin-phone-profiles.tsv'))
    parser.add_argument('--owner', required=True)
    parser.add_argument('--evidence-dir', required=True)
    parser.add_argument('--lock-root', default=os.path.join(os.environ.get('DOUYIN_PHONE_TMP_ROOT', '/private/tmp/openclaw-phone'), 'locks'))
    parser.add_argument('--adb', default='adb')
    parser.add_argument('--timeout', type=float, default=15)
    parser.add_argument('operation', choices=('open-wechat', 'screenshot', 'ui', 'tap', 'swipe', 'back', 'text-b64', 'foreground'))
    parser.add_argument('values', nargs='*')
    args = parser.parse_args()
    if not 0 < args.timeout <= 30:
        parser.error('timeout must be 0..30 seconds')
    expected = {'tap': 2, 'swipe': 5, 'text-b64': 1}.get(args.operation, 0)
    if len(args.values) != expected:
        parser.error('operation argument count mismatch')
    values = args.values
    if args.operation in ('tap', 'swipe'):
        try:
            values = [int(v) for v in values]
        except ValueError:
            parser.error('coordinates must be integers')
        if any(v < 0 or v > 20000 for v in values) or (args.operation == 'swipe' and not 1 <= values[4] <= 5000):
            parser.error('coordinates or duration out of bounds')
    try:
        serial = resolve_serial(args.serial, args.profile, args.registry)
        phone = Phone(serial, args.owner, args.evidence_dir, args.lock_root, args.adb, args.timeout)
        print(json.dumps(phone.execute(args.operation, values), ensure_ascii=False))
    except (Refused, OSError, ValueError, subprocess.SubprocessError, KeyboardInterrupt) as exc:
        print(json.dumps({'status': 'failed_no_retry', 'error': str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())

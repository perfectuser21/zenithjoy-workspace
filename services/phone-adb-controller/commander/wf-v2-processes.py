#!/usr/bin/env python3
"""持久helper启动意图、出生身份与内核读回；Agent回执不能证明OS进程终态。"""
import ast
import ctypes
import hashlib
import importlib.util
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('process_actions', HERE / 'wf-v2-actions.py')
actions = importlib.util.module_from_spec(spec)
spec.loader.exec_module(actions)


class BSDInfo(ctypes.Structure):
    # Darwin proc_info.h / PROC_PIDTBSDINFO，精确微秒出生身份，不能仅PID/秒级ps时间。
    _fields_ = [(x, ctypes.c_uint32) for x in ('flags', 'status', 'xstatus', 'pid', 'ppid', 'uid', 'gid', 'ruid', 'rgid', 'svuid', 'svgid', 'reserved')]
    _fields_ += [('comm', ctypes.c_char * 16), ('name', ctypes.c_char * 32)]
    _fields_ += [(x, ctypes.c_uint32) for x in ('nfiles', 'pgid', 'jobc', 'tdev', 'tpgid')]
    _fields_ += [('nice', ctypes.c_int32), ('seconds', ctypes.c_uint64), ('microseconds', ctypes.c_uint64)]


def identity(pid, include_zombie=False):
    if sys.platform == 'darwin':
        info = BSDInfo()
        lib = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
        ctypes.set_errno(0)
        size = lib.proc_pidinfo(int(pid), 3, 0, ctypes.byref(info), ctypes.sizeof(info))
        if size == 0:
            # errno ESRCH=3 is kernel-confirmed absence; permission/error is unknown.
            actions.need(ctypes.get_errno() in (0, 3), 'helper birth identity unavailable')
            return None
        actions.need(size == ctypes.sizeof(info), 'helper birth structure incomplete')
        if info.status == 5 and not include_zombie:  # SZOMB: no runnable code; retains historical identity in registry.
            return None
        return {'pid': int(pid), 'birth': [int(info.seconds), int(info.microseconds)], 'pgid': int(info.pgid)}
    if sys.platform.startswith('linux'):
        try:
            raw = Path('/proc/' + str(int(pid)) + '/stat').read_text().rsplit(')', 1)[1].split()
        except FileNotFoundError:
            return None
        if raw[0] == 'Z' and not include_zombie:
            return None
        return {'pid': int(pid), 'birth': raw[19], 'pgid': int(raw[2])}
    raise ValueError('helper kernel birth readback unsupported; retain execution authority fence')


def same_identity(recorded):
    actual = identity(recorded['pid'])
    return actual is not None and actual['birth'] == recorded['birth']


def census(token):
    # 继承nonce可识别正常setsid/double-fork；不把ps环境（可能含凭据）写盘或输出。
    result = subprocess.run(['ps', 'axeww', '-o', 'pid=,stat=,command='], capture_output=True, text=True, timeout=5)
    actions.need(result.returncode == 0, 'helper kernel census failed')
    marker = 'WF_COMMANDER_HELPER_TOKEN=' + token
    found = []
    for row in result.stdout.splitlines():
        if marker not in row:
            continue
        pid, status, _ = row.strip().split(None, 2)
        if status.startswith('Z'):
            continue
        actual = identity(int(pid))
        if actual:
            found.append(actual)
    return found


def child_free_source(path):
    """机械允许字面量输出/抛错；不接受自报child-free或任意import/call。"""
    if not path or Path(path).suffix != '.py':
        return None
    text = Path(path).read_text()
    try:
        tree = ast.parse(text)
        readonly = ast.parse("import sys\nwith open(sys.argv[1], 'r') as source:\n    print(source.read())\n")
        if ast.dump(tree) == ast.dump(readonly):
            return text  # 精确固定只读JSON转发子集，不执行文件内容/任意调用。
        for node in tree.body:
            if isinstance(node, ast.Import) and len(node.names) == 1 and node.names[0].name == 'json' and not node.names[0].asname:
                continue
            if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
                continue
            call = node.exc if isinstance(node, ast.Raise) and node.cause is None else node.value if isinstance(node, ast.Expr) else None
            if not isinstance(call, ast.Call) or call.keywords or not isinstance(call.func, ast.Name):
                return None
            if call.func.id not in (('ValueError', 'RuntimeError', 'TypeError') if isinstance(node, ast.Raise) else ('print',)):
                return None
            for arg in call.args:
                if isinstance(arg, ast.Call):
                    if not (isinstance(arg.func, ast.Attribute) and isinstance(arg.func.value, ast.Name)
                            and arg.func.value.id == 'json' and arg.func.attr == 'dumps' and len(arg.args) == 1 and not arg.keywords):
                        return None
                    arg = arg.args[0]
                ast.literal_eval(arg)
        return text
    except (SyntaxError, ValueError, TypeError):
        return None


class Registry:
    def __init__(self, envelope):
        self.e = envelope
        self.directory = Path.home().resolve() / 'wf-agent-runs' / envelope['run_id']
        self.path = self.directory / 'helper-processes.json'
        self.guard = self.directory / '.helper-processes.lock'

    def state(self):
        if not self.path.exists():
            return {'task_id': self.e['task_id'], 'run_id': self.e['run_id'], 'owner_epoch': self.e['owner_epoch'], 'fenced': False, 'helpers': {}}
        state = actions.read(self.path)
        actions.need(all(state.get(k) == self.e[k] for k in ('task_id', 'run_id', 'owner_epoch')), 'helper registry identity mismatch')
        return state

    def observe(self, fence=False, stop=False, seal=False, seal_when_stopped=False):
        with actions.locked(self.guard):
            state = self.state()
            state['fenced'] = state['fenced'] or fence
            state['sealed'] = state.get('sealed', False) or seal
            stopped = True
            for token, entry in state['helpers'].items():
                if not entry.get('root'):
                    stopped = False  # 已持久启动意图、未读回PID：绝不能猜已停。
                    continue
                known = {x['pid']: x for x in entry.get('identities', [])}
                known[entry['root']['pid']] = entry['root']
                for actual in census(token):
                    known[actual['pid']] = actual
                live = []
                for recorded in known.values():
                    actual = identity(recorded['pid'])
                    if actual and actual['birth'] == recorded['birth']:
                        live.append(actual)
                entry['identities'] = list(known.values())
                if stop:
                    for recorded in live:
                        actual = identity(recorded['pid'])
                        if actual and actual['birth'] == recorded['birth']:
                            try:
                                os.kill(recorded['pid'], signal.SIGKILL)
                            except ProcessLookupError:
                                pass
                    # 终态只由内核读回；kill syscall成功不是终态。
                    until = time.monotonic() + 2
                    while live and time.monotonic() < until:
                        time.sleep(.02)
                        live = [x for x in live if same_identity(x)]
                    # 确认停止期间没有新出现的脱离session子孙。
                    live += [x for x in census(token) if x not in live]
                entry['live'] = live
                entry['known_pids_stopped'] = not live
                entry['kernel_stopped'] = not live and entry.get('boundary_verified') is True
                entry['observed_at'] = time.time()
                stopped = stopped and entry['kernel_stopped']
            state['sealed'] = state['sealed'] or (seal_when_stopped and stopped)
            actions.write(self.path, state)
            return stopped

    def run(self, argv, env, timeout, purpose, source=None):
        token = uuid.uuid4().hex
        sandboxed = sys.platform == 'darwin' and Path('/usr/bin/sandbox-exec').is_file()
        safe_source = child_free_source(source)
        if safe_source is not None:
            argv = [sys.executable, '-I', '-S', '-c', safe_source, *argv[2:]]
        elif source and Path(source).suffix == '.py':
            argv = [sys.executable, '-I', '-S', *argv[1:]]
        if sandboxed:
            argv = ['/usr/bin/sandbox-exec', '-p', '(version 1)(allow default)(deny process-fork)', *argv]
        with actions.locked(self.guard):
            state = self.state()
            actions.need(not state.get('sealed', False), 'helper lifecycle sealed; no new probe/execution')
            actions.need(not state['fenced'] or purpose == 'readback', 'helper execution fenced')
            entry = {'purpose': purpose, 'intent_at': time.time(), 'identities': [], 'boundary_verified': sandboxed or safe_source is not None,
                     'boundary': 'darwin-sandbox-deny-process-fork-v1' if sandboxed else 'isolated-python-subset-v1' if safe_source is not None else 'unproven',
                     'source_sha256': hashlib.sha256(safe_source.encode()).hexdigest() if safe_source is not None else None}
            state['helpers'][token] = entry
            actions.write(self.path, state)  # 启动副作用前持久意图，父进程死亡仍保守阻断。
            child = subprocess.Popen(argv, env={**env, 'WF_COMMANDER_HELPER_TOKEN': token}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
            entry['root'] = identity(child.pid, include_zombie=True)
            actions.need(entry['root'], 'helper start kernel identity unconfirmed')
            actions.write(self.path, state)
        try:
            stdout, stderr = child.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            self.observe(fence=True, stop=True)
            try:
                child.communicate(timeout=2)
            except subprocess.TimeoutExpired:
                pass  # 未证明关管道的子孙不能延长父worker期限；registry保留未停。
            raise ValueError('frozen helper deadline exhausted; result unknown')
        finally:
            self.observe()
        with actions.locked(self.guard):
            state = self.state()
            state['helpers'][token]['terminal'] = {'exit_code': child.returncode, 'ended_at': time.time()}
            actions.write(self.path, state)
        return {'exit_code': child.returncode, 'stdout': stdout.decode(), 'stderr': stderr.decode()}

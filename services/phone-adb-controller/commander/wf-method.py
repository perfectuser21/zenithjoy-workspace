#!/usr/bin/env python3
"""当前监督器下的独立历史业务方法：真实安装闭包、双gate及唯一源码解析。"""
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import socket
import subprocess
import sys
import sysconfig
import time
from datetime import datetime

PROTOCOL = 'commander-method-v1'
REPO = 'perfectuser21/zenithjoy-workspace'
PREFIX = 'services/phone-adb-controller/commander/'
NODE_CANONICAL = "const fs=require('fs');const s=v=>Array.isArray(v)?v.map(s):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,s(v[k])])):v;process.stdout.write(JSON.stringify(s(JSON.parse(fs.readFileSync(0,'utf8')))));"


def need(value, message):
    if not value:
        raise ValueError('method: ' + message)


def canonical(value):
    # 与Brain完全共用JS数值、数字形键及UTF-16键排序语义，不用Python近似序列化。
    result = subprocess.run(['node', '-e', NODE_CANONICAL], input=json.dumps(value, ensure_ascii=False, allow_nan=False),
                            text=True, capture_output=True, check=True, timeout=10)
    return result.stdout.encode()


def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else canonical(value)).hexdigest()


def ordered(rows):
    return sorted(rows, key=lambda b: tuple(b.get(k, '') for k in ('kind', 'repo', 'path', 'revision', 'digest')))


def safe_path(path):
    need(isinstance(path, str) and re.fullmatch(r'[A-Za-z0-9_.\-/]+', path) and not path.startswith('/')
         and not any(x in ('', '.', '..') for x in path.split('/')), 'invalid source path')
    return path


def execution_skill(contract):
    if not isinstance(contract, dict):
        return False
    return bool(contract.get('skill') or any(isinstance(contract.get(k), dict) and contract[k].get('kind') == 'skill' for k in ('implementation', 'runtime')) or
                any(execution_skill(c) for k in ('activities', 'steps') for c in contract.get(k, [])))


def recovery_policy(raw):
    need(raw is None or isinstance(raw, dict), 'invalid original recovery policy')
    policy = dict(raw or {})
    for name, default, maximum in [('max_attempts', 1, 10), ('total_timeout_sec', 2400, 14400), ('cleanup_timeout_sec', 300, 1800)]:
        if policy.get(name) is None: policy[name] = default
        need(type(policy[name]) is int and 0 < policy[name] <= maximum, 'original recovery budget out of bounds')
    need(policy['total_timeout_sec'] + policy['cleanup_timeout_sec'] <= 14400, 'original total budget out of bounds')
    if 'improvement_after_failures' in policy:
        need(type(policy['improvement_after_failures']) is int and 0 < policy['improvement_after_failures'] <= 100, 'invalid improvement threshold')
    return policy


def manifest_for(release):
    payload = release['payload']
    rows = payload['workflows']
    need(len(rows) == 1 and rows[0]['payload']['key'] != 'workflow_commander.internal', 'one complete business workflow required')
    workflow = rows[0]
    source = dict(repo=workflow['source_repo'], revision=workflow['source_commit'])
    need(source['repo'] == REPO and re.fullmatch('[a-f0-9]{40}', source['revision']), 'unsupported fixed source')
    need(not execution_skill(workflow['payload'].get('contract')), 'unsupported_method_skill: business skill entry is not admitted')
    refs = workflow['payload']['activities']
    activities = payload['activities']
    need(refs and len(activities) == len({r['activity_version_id'] for r in refs}) and
         {a['id'] for a in activities} == {r['activity_version_id'] for r in refs}, 'incomplete activity closure')
    bindings = {}
    for activity in activities:
        need(activity['source_repo'] == source['repo'] and activity['source_commit'] == source['revision'], 'mixed source revisions')
        need(any(r['activity_version_id'] == activity['id'] and r['activity_id'] == activity['activity_id'] for r in refs), 'activity identity mismatch')
        need(not any(execution_skill(c) for c in [activity['payload'].get('contract'), *(s.get('contract') for s in activity['payload'].get('steps', []))]), 'unsupported_method_skill: activity or step skill entry')
        values = activity['payload'].get('implementation_bindings', [])
        need(all(b.get('kind') != 'skill' or (is_safety(b.get('path') or '') and b.get('field') == 'implementation_bindings') for b in values), 'unsupported_method_skill: business skill execution closure')
        need(any(b.get('scope') == 'activity' and b.get('kind') == 'code' and b.get('status') == 'verified' for b in values), 'activity entry not frozen')
        for binding in values:
            if binding.get('kind') == 'raw' and binding.get('status') == 'unresolved':
                continue
            row = {k: binding.get(k) for k in ('kind', 'path', 'revision', 'digest')}
            row['repo'] = binding.get('repo') or binding.get('raw', {}).get('repo') or activity['source_repo']
            need(row['kind'] in ('code', 'skill') and binding.get('status') == 'verified' and row['repo'] == source['repo']
                 and row['revision'] == source['revision'] and re.fullmatch('sha256:[a-f0-9]{64}', row['digest'] or ''), 'unverified source binding')
            safe_path(row['path'])
            need(row['kind'] != 'skill' or (is_safety(row['path']) and binding.get('field') == 'implementation_bindings'), 'unsupported_method_skill: undeclared business skill execution closure')
            need(row['path'] not in bindings or bindings[row['path']] == row, 'ambiguous source path')
            bindings[row['path']] = row
    rows = ordered(list(bindings.values()))
    need(any(b['kind'] == 'code' and not is_safety(b['path']) for b in rows), 'method requires executable business code, not only safety context')
    need(rows and ordered(payload['components']) == ordered([dict(kind='repo', **source), *rows]), 'release components differ from full frozen closure')
    return dict(protocol=PROTOCOL, workflow=dict(key=workflow['payload']['key'], workflow_id=workflow['workflow_id'],
                workflow_definition_version_id=workflow['id'], snapshot_sha256=workflow['payload_sha256']), source=source, bindings=rows)


def instance(manifest, home):
    sha = digest(manifest)
    root = home / '.local/share/zenithjoy/commander-methods' / sha
    return dict(target='mmv--method--' + sha, physical_host='mmv', method_root=str(root), manifest_sha256=sha,
                resolved_bindings=[dict(b, absolute_path=str(root / b['path'])) for b in manifest['bindings']])


def read_regular(root, relative):
    safe_path(relative)
    need(root.is_dir() and root.resolve(strict=True) == root, 'noncanonical or linked method root')
    current = root
    for part in relative.split('/'):
        current /= part
        need(not current.is_symlink(), 'method binding traverses symlink')
    need(current.is_file(), 'installed binding missing')
    return current.read_bytes()


def dependencies(manifest, root):
    paths = {b['path'] for b in manifest['bindings']}
    stdlib = Path(sysconfig.get_paths()['stdlib']).resolve()
    supported = {'argparse', 'csv', 'fcntl', 'hashlib', 'io', 'json', 'os', 'pathlib', 're', 'urllib', 'sys', 'datetime', 'time'}
    reflection = {'__import__', '__builtins__', 'eval', 'exec', 'compile', 'getattr', 'setattr', 'globals', 'locals', 'vars'}
    os_members = {'open', 'fdopen', 'fsync', 'environ'}
    forbidden = lambda name: name.startswith(('__', 'exec', 'spawn')) or name in {'system', 'popen', 'path', 'meta_path', 'path_hooks', 'modules'}
    for binding in manifest['bindings']:
        if is_safety(binding['path']):
            continue  # 安全底座只比较当前实物字节，永不执行包内副本。
        path = binding['path']; raw = read_regular(root, path)
        need(binding['kind'] != 'skill', 'unsupported_method_skill: only current safety skill bytes are read-only context')
        # 首版可机械核闭包的Python方法；其它语言/动态装载不能冒充已隔离。
        need(path.endswith('.py'), 'method language has no closed dependency admission')
        tree = ast.parse(raw.decode())
        os_aliases = {a.asname or a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names if a.name == 'os'}
        for node in ast.walk(tree):
            if isinstance(node, ast.Name):
                need(node.id not in reflection, 'dynamic method reflection is not admitted')
            if isinstance(node, ast.Attribute):
                # 报告使用os.open/fdopen/fsync，不能因此放行os.system或导入器/搜索路径修改。
                need(not forbidden(node.attr), 'indirect command or loader is not admitted')
                if isinstance(node.value, ast.Name) and node.value.id in os_aliases:
                    need(node.attr in os_members or node.attr.startswith('O_'), 'unsupported os dependency')
            if isinstance(node, ast.ImportFrom):
                need(all(not forbidden(a.name) and a.name != '*' and a.name not in reflection for a in node.names), 'indirect imported command is not admitted')
                if node.module == 'os':
                    need(all(a.name in os_members or a.name.startswith('O_') for a in node.names), 'unsupported os member')
            modules = []
            if isinstance(node, ast.Import):
                modules = [(a.name, 0) for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                modules = [(node.module or a.name, node.level) for a in node.names]
            for name, level in modules:
                base = Path(path).parent
                for _ in range(max(0, level - 1)):
                    base = base.parent
                target = str(base / name.replace('.', '/'))
                local = [target + '.py', target + '/__init__.py']
                if any(p in paths for p in local):
                    for package in range(1, len(name.split('.'))):
                        need(str(base.joinpath(*name.split('.')[:package], '__init__.py')) in paths, 'namespace package dependency is not fully frozen')
                    continue
                need(not level and name.split('.')[0] in supported, 'unsupported or dynamic dependency')
                spec = importlib.util.find_spec(name.split('.')[0])
                origin = spec.origin if spec else None
                need(origin in ('built-in', 'frozen') or (origin and Path(origin).resolve().is_relative_to(stdlib)
                     and 'site-packages' not in Path(origin).parts), 'dependency is neither frozen nor standard library: ' + name)


def collect(manifest, home):
    need(socket.gethostname().lower().split('.')[0] == 'aad17-2', 'physical host is not MMV')
    info = instance(manifest, home)
    root = Path(info['method_root'])
    need(json.loads(read_regular(root, 'method-manifest.json')) == manifest, 'installed manifest drift')
    files, identities = [], []
    for row in manifest['bindings']:
        raw = read_regular(root, row['path'])
        need('sha256:' + digest(raw) == row['digest'], 'installed source digest drift')
        path = root / row['path']; stat = path.stat()
        files.append(dict(path=row['path'], deployed_path=row['path'], content_sha256=digest(raw)))
        identities.append(dict(path=str(path), st_dev=stat.st_dev, st_ino=stat.st_ino))
    found = {str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() or p.is_symlink()}
    need(found == {'method-manifest.json', *(b['path'] for b in manifest['bindings'])}, 'unbound file in method package')
    dependencies(manifest, root)
    stat = root.stat()
    installation = dict(source_repo=manifest['source']['repo'], source_commit=manifest['source']['revision'],
                        files=files, observed_hostname=socket.gethostname(), physical_host='mmv', method_root=str(root),
                        root_identity=dict(st_dev=stat.st_dev, st_ino=stat.st_ino), file_identities=identities,
                        manifest_sha256=info['manifest_sha256'], resolved_bindings_sha256=digest(info['resolved_bindings']))
    return dict(source_repo=manifest['source']['repo'], source_commit=manifest['source']['revision'], files=files,
                observed_hostname=socket.gethostname(), installation=installation,
                method_instance=dict(info, resolved_bindings_sha256=installation['resolved_bindings_sha256'], installation_sha256=digest(installation)))


def release_row(release, definition, key):
    need(release['payload'].get('verification', {}).get('status') == 'verified', 'release not verified')
    rows = [w for w in release['payload']['workflows'] if w['id'] == definition['workflow_definition_version_id']]
    need(len(rows) == 1 and rows[0]['workflow_id'] == definition['workflow_id'] and rows[0]['payload_sha256'] == definition['snapshot_sha256']
         and rows[0]['payload']['key'] == key, 'frozen workflow release identity mismatch')
    return rows[0]


def gate(request, definition, target):
    need(all(re.fullmatch(r'[0-9a-f-]{36}', definition.get(k, '')) for k in ('release_id', 'observation_id')), 'invalid fixed release identity')
    prefix = '/api/brain/releases/' + definition['release_id']
    release = request(prefix)['release']
    need(release['id'] == definition['release_id'] and release['environment'] == 'production' and release['target'] == target, 'release target mismatch')
    need(release['manifest_sha256'] == digest({k: release[k] for k in ('environment', 'target', 'payload')}), 'formal release manifest mismatch')
    state = request(prefix + '/gate')
    need(state.get('deployed') is True and state.get('actual_matches') is True and state.get('current_observation_id') == definition['observation_id'], 'release not currently deployed')
    observation = request(prefix + '/observations/' + definition['observation_id'])['observation']
    need(observation['id'] == definition['observation_id'] and observation['release_id'] == release['id'] and observation.get('collector'), 'observation identity mismatch')
    return release, observation


def is_safety(path):
    return (path.startswith(PREFIX) and Path(path).name not in ('wf-report.py',) and
            (Path(path).name.startswith(('wf-v2', 'wf-agent', 'wf-launch', 'wf-status', 'wf-method')) or '/skills/workflow-commander/' in path)) or path in (
        'services/phone-adb-controller/douyin-phone-adb', 'services/phone-adb-controller/text-input-focus.py')


def safety_closure(release, workflow):
    ids = {r['activity_version_id'] for r in workflow['payload']['activities']}
    rows = [a for a in release['payload']['activities'] if a['id'] in ids]
    need(ids and len(rows) == len(ids), 'current meta safety closure is incomplete')
    result = set()
    for activity in rows:
        for b in activity['payload'].get('implementation_bindings', []):
            if b.get('status') == 'verified' and b.get('kind') in ('code', 'skill'):
                repo = b.get('repo') or b.get('raw', {}).get('repo') or activity['source_repo']
                result.add((b['kind'], repo, b['path'], b['digest']))
    return result


def safety_bytes(path, here, resources):
    if path.startswith(PREFIX):
        return read_regular(here, path[len(PREFIX):])
    host = resources.get('machine')
    need(host in ('xian-m4', 'xian-m1'), 'external safety dependency has no fixed host')
    name = Path(path).name
    command = "python3 -c " + shlex.quote("from pathlib import Path;import sys;a=Path.home()/'.local/bin'/" + repr(name) + ";b=Path.home()/'bin-harvest'/" + repr(name) + ";assert not a.is_symlink() and not b.is_symlink() and a.read_bytes()==b.read_bytes();sys.stdout.buffer.write(a.read_bytes())")
    return subprocess.check_output(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, command], timeout=20)


def check_goal(query, original, candidate):
    selection = query['method_selection']; goal = selection['original_goal_definition']
    need(isinstance(goal.get('original_run_id'), str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,79}', goal['original_run_id']), 'original run identity missing')
    row = release_row(original, goal, query['workflow_key'])
    need(digest(row['payload']['contract']) == digest(goal['contract']) and digest(goal['recovery']) == digest(recovery_policy(goal['contract'].get('recovery'))), 'original goal was altered')
    for name in ('key', 'capability_id', 'input_schema', 'output_schema', 'resources', 'verification', 'recovery'):
        need(goal['contract'].get(name) == candidate.get(name), 'incompatible original contract: ' + name)
    def activities(contract):
        return [{k: a.get(k) for k in ('key', 'inputs', 'outputs', 'acceptance', 'steps', 'budget', 'by')} for a in contract.get('activities', [])]
    need(activities(goal['contract']) == activities(candidate), 'activity acceptance or step contract changed')
    for key in ('input_sha256', 'deadline_at', 'cleanup_deadline_at'):
        need(key in goal and (key not in query or query[key] == goal[key]), 'original input/budget changed')
    if 'input' in query:
        need(digest(query['input']) == goal['input_sha256'], 'original input bytes changed')
    if 'contract' in query:
        need(digest(query['contract']) == digest(candidate), 'selected execution contract changed')
    need('attempt' not in query or 1 < query['attempt'] <= goal['recovery']['max_attempts'], 'original attempt budget exceeded')
    need(goal['recovery'].get('retry_safe') is True, 'original recovery disallows method selection')
    receipt = selection['selection_receipt']
    need(all(isinstance(receipt.get(k), str) and receipt[k] for k in ('previous_run_id', 'business_run_id', 'verification_task_id', 'compatibility_sha256'))
         and re.fullmatch('[a-f0-9]{64}', receipt['compatibility_sha256']), 'selection audit missing')
    if 'run_id' in query:
        need(receipt['previous_run_id'] != query['run_id'] and receipt['previous_run_id'] == query.get('recovery', {}).get('previous_attempt', {}).get('run_id'), 'previous attempt identity mismatch')


def verify(query, base_ready, request, here):
    selection = query['method_selection']
    need(selection.get('protocol') == PROTOCOL, 'unsupported selection protocol')
    supervisor = selection['supervisor_definition']
    current = base_ready({'workflow_key': 'workflow_commander.internal', 'definition': supervisor})
    supervisor_release, _ = gate(request, supervisor, 'mmv')
    meta = release_row(supervisor_release, supervisor, 'workflow_commander.internal')
    current_safety = safety_closure(supervisor_release, meta)
    definition = query['definition']; info = selection['method_instance']
    release, observation = gate(request, definition, info['target'])
    row = release_row(release, definition, query['workflow_key'])
    manifest = manifest_for(release)
    expected = instance(manifest, Path.home())
    need(info == expected, 'method target/root/resolved binding mismatch')
    original = request('/api/brain/releases/' + selection['original_goal_definition']['release_id'])['release']
    need(original['id'] == selection['original_goal_definition']['release_id'] and original['target'] == 'mmv' and original['environment'] == 'production', 'original target mismatch')
    check_goal(query, original, row['payload']['contract'])
    for binding in manifest['bindings']:
        if is_safety(binding['path']):
            need(tuple(binding[k] for k in ('kind', 'repo', 'path', 'digest')) in current_safety, 'safety binding is not in current meta closure')
            need('sha256:' + digest(safety_bytes(binding['path'], here, row['payload']['contract'].get('resources', {}))) == binding['digest'], 'historical safety shell differs from current bytes')
    actual = collect(manifest, Path.home())['method_instance']
    ref = observation.get('evidence_ref', '')
    need(ref.startswith(PROTOCOL + ':'), 'method observation evidence missing')
    metadata = json.loads(ref[len(PROTOCOL) + 1:])
    need(metadata == {k: actual[k] for k in ('physical_host', 'method_root', 'manifest_sha256', 'resolved_bindings_sha256', 'installation_sha256')}, 'method collector evidence drift')
    composition = dict(protocol='commander-composition-v1', supervisor_runtime_sha256=current['runtime_snapshot_sha256'],
                       method_manifest_sha256=actual['manifest_sha256'], resolved_bindings_sha256=actual['resolved_bindings_sha256'])
    sha = digest(composition)
    need(not definition.get('runtime_snapshot_sha256') or definition['runtime_snapshot_sha256'] == sha, 'composed runtime mismatch')
    return dict(protocol='commander-v2', ready=True, release_id=definition['release_id'], snapshot_sha256=definition['snapshot_sha256'],
                runtime_snapshot_sha256=sha, **{k: v for k, v in composition.items() if k != 'protocol'})


def execution_context(envelope, directory):
    selection = envelope['method_selection']; bindings = selection['method_instance']['resolved_bindings']
    aliases = {}
    # 旧合同中的current helper引用只能按唯一定义binding转换，不能直接运行全局路径。
    text = json.dumps(envelope['contract'], ensure_ascii=False)
    for name in re.findall(r'~/.openclaw/commander/([A-Za-z0-9_.\-/]+)', text):
        source = PREFIX + name
        rows = [b for b in bindings if b['path'] == source and not is_safety(source)]
        need(len(rows) == 1, 'legacy helper reference has no unique frozen business binding')
        aliases['~/.openclaw/commander/' + name] = rows[0]
    need(not envelope['contract'].get('skill'), 'unsupported_method_skill: business skill entry is not admitted')
    instruction = ('本次method_selection已冻结历史完整业务方法。当前Commander/安全外壳/全局workspace保持当前版。'
                   '先读method-context.json；业务helper必须经当前 python3 ~/.openclaw/commander/wf-method.py execute '
                   + str(directory / 'envelope.json') + '，stdin传{source_path:冻结repo相对path,args:字符串数组}，JSON经gateway_exec.env固定脚本管道。'
                   '原合同旧~/.openclaw/commander/helper路径仅按legacy_helper_bindings唯一映射，不能直接执行当前helper。'
                   '业务skill入口或未声明执行依赖在首版拒绝；当前安全skill仅作摘要对照，不能加载历史副本或全局同名业务skill。原目标/input/output/副作用授权和两截止时间不可变。'
                   '没有受信完整方法、依赖缺失或双gate失配就失败，不按活动混拼版本；同字节只称历史版本选择。')
    return dict(protocol=PROTOCOL, method_selection=selection, legacy_helper_bindings=aliases,
                execution=dict(host='mmv', tool='gateway_exec', envelope_path=str(directory / 'envelope.json')),
                instruction=instruction)


def resolve(envelope, source_path, ready):
    ready(envelope)
    safe_path(source_path)
    rows = [b for b in envelope['method_selection']['method_instance']['resolved_bindings'] if b['path'] == source_path]
    need(len(rows) == 1 and not is_safety(source_path), 'helper reference is not one business binding')
    return rows[0]


def execute(envelope, payload, ready):
    need(envelope['definition'].get('runtime_snapshot_sha256'), 'execution requires frozen composition')
    binding = resolve(envelope, payload['source_path'], ready)
    need(binding['kind'] == 'code', 'skill is read-only instructions, not a helper')
    args = payload.get('args'); need(isinstance(args, list) and all(isinstance(a, str) and '\0' not in a for a in args), 'argv must contain strings')
    remaining = datetime.fromisoformat(envelope['deadline_at'].replace('Z', '+00:00')).timestamp() - time.time()
    need(remaining > 0, 'original execution deadline exhausted')
    interpreter = {'.py': 'python3', '.sh': 'bash', '.mjs': 'node', '.js': 'node'}.get(Path(binding['path']).suffix)
    need(interpreter, 'unsupported frozen helper language')
    env = {k: v for k, v in os.environ.items() if k not in ('PYTHONPATH', 'NODE_PATH', 'BASH_ENV', 'ENV')}
    env['PYTHONDONTWRITEBYTECODE'] = '1'
    result = subprocess.run([interpreter, binding['absolute_path'], *args], cwd=envelope['method_selection']['method_instance']['method_root'],
                            env=env, capture_output=True, text=True, timeout=remaining)
    return dict(exit_code=result.returncode, stdout=result.stdout, stderr=result.stderr, binding=binding)


def read_bound_envelope(path, io):
    path = Path(path)
    need(path.is_absolute() and path.is_file() and path.stat().st_size <= 180000, 'bounded persisted envelope required')
    envelope = io.read(path)
    need(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,79}', envelope.get('run_id', '')), 'invalid run identity')
    directory = Path.home().resolve() / 'wf-agent-runs' / envelope['run_id']
    need(path == directory / 'envelope.json' and directory.resolve() == directory, 'method must use actual run envelope, not a copy')
    need(digest(json.loads(read_regular(directory, 'envelope.json'))) == digest(envelope), 'persisted envelope drift')
    need(digest(json.loads(read_regular(directory, 'input.json'))) == envelope['input_sha256'] == digest(envelope['input']), 'persisted original input drift')
    need(digest(json.loads(read_regular(directory, 'contract.json'))) == digest(envelope['contract']), 'persisted selected contract drift')
    return envelope


def main():
    spec = importlib.util.spec_from_file_location('method_io', Path(__file__).with_name('wf-v2-io.py'))
    io = importlib.util.module_from_spec(spec); spec.loader.exec_module(io)
    need(len(sys.argv) == 3 and sys.argv[1] in ('execute', 'resolve') and Path(sys.argv[2]).is_absolute(), 'use execute|resolve absolute_envelope')
    envelope = read_bound_envelope(sys.argv[2], io); payload = json.load(sys.stdin)
    result = execute(envelope, payload, io.ready) if sys.argv[1] == 'execute' else resolve(envelope, payload['source_path'], io.ready)
    print(json.dumps(result, ensure_ascii=False))
    return result.get('exit_code', 0)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr); sys.exit(1)

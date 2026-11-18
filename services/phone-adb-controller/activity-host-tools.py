"""Freeze typed business admission feedback for the known single-Activity host."""
import ast
import hashlib
import importlib.util
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent
BASE_SHA = {
    'TOOLS.txt': 'c9f28373276f203ab6dcdf77dcd67a0e6965aef7ba8febf376f7441ae9b9b712',
    'tools.py': '53ac7b51b19e0e65f6031d07135bb4cd677b8dee27590b987d49de59e8bcc352',
    'tool_scope.py': 'b5d39b61efc42dac48ca76a3d77d7f1bef63eed734ea076231facaf554b6386b',
}
spec = importlib.util.spec_from_file_location('activity_host_typed', ROOT/'activity-tool-result.py')
typed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(typed)
PreDispatchRejected = typed.PreDispatchRejected
emit_pre_dispatch_rejection = typed.emit_pre_dispatch_rejection
scope_rejection = typed.scope_rejection


def read_business_input(args, *, activity, allowed_operations):
    try:
        value = typed.read_business_input(args, activity=activity, allowed_operations=allowed_operations)
    except PreDispatchRejected as error:
        if type(error) is not PreDispatchRejected:
            raise
        error.details['tool_hint'] = '当前Activity为'+activity+'；使用op字段及allowed_operations；原拒绝action只读回，纠正需新action名。'
        if activity == 'collect_videos':
            error.details['tool_hint'] += '101的company_config仅preflight；公司版本已由start checker核验，读取冻结context和preflight交接，不重复freeze。'
        raise
    if activity == 'collect_videos' and value['op'] in ['discover', 'discover_readback']:
        video = value.get('video')
        if not isinstance(video, dict) or not isinstance(video.get('metrics'), dict) or not video['metrics']:
            error = scope_rejection('METRICS_OBSERVATION_REQUIRED')
            error.details = {'activity': activity, 'allowed_operations': sorted(allowed_operations),
                             'required_fields': ['video.metrics'],
                             'tool_hint': 'discover与discover_readback都必须携带同一完整video.metrics原件对象。读取本轮metrics或原discover回执中的原对象，用新action名纠正本次请求；不重做已成功discover、不自行补造字段。'}
            raise error
    return value


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def business_ops(scope):
    nodes = [n for n in ast.parse(scope).body if isinstance(n, ast.Assign)
             and any(isinstance(t, ast.Name) and t.id == 'OPS' for t in n.targets)]
    if len(nodes) != 1:
        raise ValueError('ACTIVITY_HOST_OPS_INVALID')
    value = ast.literal_eval(nodes[0].value)
    if not isinstance(value, dict) or any(not isinstance(k, str) or not isinstance(v, set)
                                        or any(not isinstance(op, str) for op in v) for k, v in value.items()):
        raise ValueError('ACTIVITY_HOST_OPS_INVALID')
    return {key: sorted(value[key]) for key in sorted(value)}


def instructions(ops, original):
    lines = ['每次只执行当前Activity；权限以宿主当前Activity的OPS为准。',
             '业务使用commander_host_tools.invoke：kind=business、action_name、args=[JSON字符串]；操作字段为op，不是operation。',
             '下面清单由冻结OPS生成，不在当前Activity清单中的业务操作禁止调用。']
    lines += [f'{key}允许操作：'+', '.join(values) for key, values in ops.items()]
    lines += ['101中company_config仅preflight调用；collect_videos使用已冻结公司政策，start checker已独立核验版本，不重新调用company_config。',
              '101的discover与discover_readback都必须传video.metrics：同一完整原始metrics对象。discover_readback使用原discover请求中的video及metrics，不只传video_id/video_url；不得重做已成功discover或自行补造metrics。',
              'ACTION_NAME是持久动作身份：同名同参数只读回。仅terminal且data.dispatched=false可按allowed_operations修正并使用新action_name；unknown不得换名重发。',
              '只按原合同和当前Skill交付证据，不修改合同、Skill、上下文、工具或Checker；是否通过仍由独立Checker判定。']
    return original+'\n冻结Activity业务操作与拒绝回执补充：\n'+'\n'.join(lines)+'\n'


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError('ACTIVITY_HOST_BASE_LAYOUT_CHANGED')
    return text.replace(old, new, 1)


def patch_sources(tools, scope):
    tools = replace_once(tools, 'from tool_scope import phone_args,scoped_business,READ', '''from tool_scope import phone_args,scoped_business,READ,OPS
import importlib.util
_spec=importlib.util.spec_from_file_location('activityhost',pathlib.Path(__file__).resolve().parent/'activity-host-tools.py')
_host=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(_host)
PreDispatchRejected=_host.PreDispatchRejected
emit_pre_dispatch_rejection=_host.emit_pre_dispatch_rejection
read_business_input=_host.read_business_input
scope_rejection=_host.scope_rejection''')
    tools = replace_once(tools, " c=read(P/'context.json');f=", " _host.verify_host(P,OPS)\n c=read(P/'context.json');f=")
    tools = replace_once(tools, "  i=scoped_business(c,key,json.loads(args[0]))", "  parsed=read_business_input(args,activity=key,allowed_operations=OPS.get(key,set()))\n  i=scoped_business(c,key,parsed,reject=scope_rejection)")
    tools = replace_once(tools, "  # A policy error before launching an operation has no external operation in flight.\n  if isinstance(e,ValueError):atomic(action,{'binding':bind,'state':'terminal','started_at':started_at,'result':{'exit_code':2,'error':str(e)},'ended_at':time.time()})", "  if type(e) is PreDispatchRejected:\n   return emit_pre_dispatch_rejection(e,action=action,binding=bind,started_at=started_at,persist=atomic)")
    scope = replace_once(scope, 'def scoped_business(c,activity,i):', 'def scoped_business(c,activity,i,*,reject=ValueError):')
    start = scope.index('def scoped_business(')
    scope = scope[:start]+scope[start:].replace('raise ValueError(', 'raise reject(')
    return tools, scope


def verify_host(root, ops):
    root = pathlib.Path(root)
    manifest = json.loads((root/'activity-host-tools.json').read_text())
    names = {'tools.py', 'tool_scope.py', 'activity-tool-result.py', 'activity-host-tools.py', 'TOOLS.txt', 'TOOLS-base.txt'}
    if root.is_symlink() or manifest.get('schema') != 'activity-host-tools/v1' or set(manifest.get('sha256', {})) != names:
        raise ValueError('ACTIVITY_HOST_MANIFEST_INVALID')
    for name, expected in manifest['sha256'].items():
        p = root/name
        if p.is_symlink() or digest(p.read_bytes()) != expected:
            raise ValueError('ACTIVITY_HOST_SOURCE_CHANGED')
    actual = {key: sorted(ops[key]) for key in sorted(ops)}
    original = (root/'TOOLS-base.txt').read_text()
    if digest(original.encode()) != BASE_SHA['TOOLS.txt'] or actual != manifest['operations'] or (root/'TOOLS.txt').read_text() != instructions(actual, original):
        raise ValueError('ACTIVITY_HOST_METHOD_DRIFT')
    return manifest


def assemble(base, target):
    base, target = pathlib.Path(base), pathlib.Path(target)
    raw = {}
    if base.is_symlink() or target.exists() or target.is_symlink():
        raise ValueError('ACTIVITY_HOST_TARGET_INVALID')
    for name, expected in BASE_SHA.items():
        p = base/name
        if p.is_symlink() or digest(p.read_bytes()) != expected:
            raise ValueError('ACTIVITY_HOST_BASE_SOURCE_CHANGED')
        raw[name] = p.read_text()
    tools, scope = patch_sources(raw['tools.py'], raw['tool_scope.py'])
    ops = business_ops(scope)
    files = {'tools.py': tools, 'tool_scope.py': scope, 'TOOLS.txt': instructions(ops, raw['TOOLS.txt']), 'TOOLS-base.txt': raw['TOOLS.txt'],
             'activity-host-tools.py': pathlib.Path(__file__).read_text(),
             'activity-tool-result.py': (ROOT/'activity-tool-result.py').read_text()}
    manifest = {'schema': 'activity-host-tools/v1', 'base_sha256': BASE_SHA,
                'operations': ops, 'sha256': {key: digest(value.encode()) for key, value in files.items()}}
    target.mkdir(mode=0o700)
    for name, value in {**files, 'activity-host-tools.json': json.dumps(manifest, ensure_ascii=False, indent=2)+'\n'}.items():
        p = target/name
        with p.open('x') as f:
            f.write(value)
        p.chmod(0o600)
    verify_host(target, {key: set(value) for key, value in ops.items()})
    return manifest


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('usage: activity-host-tools.py ORIGINAL_FROZEN_HOST NEW_CANDIDATE_DIRECTORY')
    print(json.dumps(assemble(*sys.argv[1:]), ensure_ascii=False))

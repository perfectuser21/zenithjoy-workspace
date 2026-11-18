"""Assemble the reviewed 103 host wiring without changing business permissions."""
import ast
import hashlib
import importlib.util
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent
BASE_SHA = {
    'tools.py': 'eded963eea2d469182eb6367a679e8b01d14594a70cc91775e733d29d5850698',
    'tool_scope.py': 'b5d39b61efc42dac48ca76a3d77d7f1bef63eed734ea076231facaf554b6386b',
    'checker.mjs': 'a84b739035ba1336c498dcb7defae3b4df9230c465189f22e849c184c51d8d54',
}
spec = importlib.util.spec_from_file_location('activity_103_typed', ROOT/'activity-tool-result.py')
typed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(typed)
PreDispatchRejected = typed.PreDispatchRejected
emit_pre_dispatch_rejection = typed.emit_pre_dispatch_rejection
scope_rejection = typed.scope_rejection


def read_business_input(args, *, activity, allowed_operations):
    try:
        return typed.read_business_input(args, activity=activity, allowed_operations=allowed_operations)
    except PreDispatchRejected as error:
        error.details['tool_hint'] = '当前活动仅使用allowed_operations；公司政策从冻结输入读取，mark_leads不调用company_config。原错误动作只读回，纠正需新action名；不重评。'
        raise


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def business_ops(scope):
    nodes = [n for n in ast.parse(scope).body if isinstance(n, ast.Assign)
             and any(isinstance(t, ast.Name) and t.id == 'OPS' for t in n.targets)]
    if len(nodes) != 1:
        raise ValueError('ACTIVITY103_OPS_INVALID')
    value = ast.literal_eval(nodes[0].value)
    return {k: sorted(value[k]) for k in ['scoring', 'mark_leads']}


def instructions(ops):
    lines = ['仅独立103；每次只执行当前Activity，不推进其他Activity。无手机操作。',
             '业务仅通过commander_host_tools.invoke：kind=business、action_name、args=[JSON字符串]；操作字段为op。',
             '下列操作清单直接来自宿主OPS，不在当前Activity清单的操作禁止调用。']
    lines += [f'{key}允许操作：'+', '.join(values) for key, values in ops.items()]
    lines += [
        'scoring：仅本阶段调用company_config(step=103,source_run=null)，不得传device_binding；随后score_scope。',
        'scoring：已有评分先score_recovery/score_readback，不重评；只有任务明确授权且未评分的原ID可score，limit=1,budget_max=1。',
        'mark_leads：直接使用输入中的冻结公司政策及已存评分；不要调用company_config或score_scope。',
        'mark_leads：policy_review另带claim=本103run，确定性核对已有评分而非模型复评；然后mark_leads→mark_readback→bridge_outreach→bridge_readback。',
        '所有ids/sources严格来自context.verification[103]；source_run=null，committed_partial_ids为精确comment_ids。',
        'run/line由宿主绑定。bridge操作用comment_ids/limit=1，不能错误添加committed_partial_ids。',
        'ACTION_NAME是持久动作身份：同名同参数只读回。terminal拒绝且data.dispatched=false时，按allowed_operations纠正，使用新action_name；未知结果不能换名称重发。',
        '工具响应output使用扁平字段如result.stdout；工具运行中沿原session等终态。不得直接运行需要宿主凭据的shell工具，不读取凭据。',
        '不得修改合同、Skill、上下文、工具或Checker，不使用裸SQL写、不调用其他Agent。真实排除如实，不制造线索。',
        '最终只输出本Activity的JSON提案、真实产物、证据与停止原因；是否通过由独立Checker判定。到业务截止停止新业务。',
    ]
    return '\n'.join(lines)+'\n'


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError('ACTIVITY103_BASE_LAYOUT_CHANGED')
    return text.replace(old, new, 1)


def patch_sources(tools, scope):
    tools = replace_once(tools, 'from tool_scope import phone_args,scoped_business,READ', '''from tool_scope import phone_args,scoped_business,READ,OPS
import importlib.util
_spec=importlib.util.spec_from_file_location('activity103host',pathlib.Path(__file__).resolve().parent/'activity-103-tool-host.py')
_host103=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(_host103)
PreDispatchRejected=_host103.PreDispatchRejected
emit_pre_dispatch_rejection=_host103.emit_pre_dispatch_rejection
read_business_input=_host103.read_business_input
scope_rejection=_host103.scope_rejection''')
    tools = replace_once(tools, " c=read(P/'context.json');f=", " _host103.verify_host(P,OPS)\n c=read(P/'context.json')\n if c['assigned_workflow']!='103':raise ValueError('ACTIVITY103_HOST_SCOPE')\n f=")
    tools = replace_once(tools, "  i=scoped_business(c,key,json.loads(args[0]))", "  parsed=read_business_input(args,activity=key,allowed_operations=OPS.get(key,set()))\n  i=scoped_business(c,key,parsed,reject=scope_rejection)")
    tools = replace_once(tools, "  # A policy error before launching an operation has no external operation in flight.\n  if isinstance(e,ValueError):atomic(action,{'binding':bind,'state':'terminal','started_at':started_at,'result':{'exit_code':2,'error':str(e)},'ended_at':time.time()})", "  if type(e) is PreDispatchRejected:\n   return emit_pre_dispatch_rejection(e,action=action,binding=bind,started_at=started_at,persist=atomic)")
    # Only the pure business validator receives the typed factory. Other exceptions stay unknown.
    scope = replace_once(scope, 'def scoped_business(c,activity,i):', 'def scoped_business(c,activity,i,*,reject=ValueError):')
    start = scope.index('def scoped_business(')
    scope = scope[:start]+scope[start:].replace('raise ValueError(', 'raise reject(')
    return tools, scope


def verify_host(root, ops):
    root = pathlib.Path(root)
    if root.is_symlink():
        raise ValueError('ACTIVITY103_HOST_SOURCE_CHANGED')
    manifest = json.loads((root/'tool-host-103.json').read_text())
    required = {'tools.py', 'tool_scope.py', 'activity-tool-result.py', 'activity-103-tool-host.py',
                'checker.mjs', 'activity-103-checker-repair.mjs', 'TOOLS.txt', 'repair-runtime.json'}
    if manifest.get('schema') != 'activity-103-tool-host/v1' or set(manifest.get('sha256', {})) != required:
        raise ValueError('ACTIVITY103_HOST_MANIFEST_INVALID')
    for name, expected in manifest['sha256'].items():
        p = root/name
        if p.is_symlink() or digest(p.read_bytes()) != expected:
            raise ValueError('ACTIVITY103_HOST_SOURCE_CHANGED')
    actual = {k: sorted(ops[k]) for k in ['scoring', 'mark_leads']}
    if actual != manifest['operations'] or (root/'TOOLS.txt').read_text() != instructions(actual):
        raise ValueError('ACTIVITY103_HOST_METHOD_DRIFT')
    if json.loads((root/'repair-runtime.json').read_text()) != {'mark_leads': {'checker_repair': {'max_attempts': 2, 'retry_safe': True}}}:
        raise ValueError('ACTIVITY103_REPAIR_CONFIG_INVALID')
    return manifest


def assemble(base, target):
    base, target = pathlib.Path(base), pathlib.Path(target)
    raw = {}
    for name, expected in BASE_SHA.items():
        p = base/name
        if p.is_symlink() or digest(p.read_bytes()) != expected:
            raise ValueError('ACTIVITY103_BASE_SOURCE_CHANGED')
        raw[name] = p.read_text()
    tools, scope = patch_sources(raw['tools.py'], raw['tool_scope.py'])
    ops = business_ops(scope)
    checker = raw['checker.mjs']
    old = next(line for line in checker.splitlines() if line.startswith("if(request.phase==='end')"))
    checker = replace_once(checker, old, "if(request.phase==='end'){const observed=await (request.workflow==='104'?(await import('./outreach104/checker104.mjs')).verify104(request,path.dirname(new URL(import.meta.url).pathname)):request.activity==='cleanup'?verifyCleanup(request):readback(request));console.log(JSON.stringify(await repair103Readback(request,observed,{root:path.dirname(new URL(import.meta.url).pathname)})));}")
    checker = "import {repair103Readback} from './activity-103-checker-repair.mjs';\n"+checker
    files = {'tools.py': tools, 'tool_scope.py': scope, 'TOOLS.txt': instructions(ops),
             'checker.mjs': checker, 'activity-103-checker-repair.mjs': (ROOT/'activity-103-checker-repair.mjs').read_text(),
             'repair-runtime.json': json.dumps({'mark_leads': {'checker_repair': {'max_attempts': 2, 'retry_safe': True}}})+'\n',
             'activity-103-tool-host.py': pathlib.Path(__file__).read_text(),
             'activity-tool-result.py': (ROOT/'activity-tool-result.py').read_text()}
    manifest = {'schema': 'activity-103-tool-host/v1', 'base_sha256': BASE_SHA,
                'operations': ops, 'sha256': {k: digest(v.encode()) for k, v in files.items()}}
    target.mkdir(mode=0o700)
    for name, value in {**files, 'tool-host-103.json': json.dumps(manifest, ensure_ascii=False, indent=2)+'\n'}.items():
        p = target/name
        with p.open('x') as f:
            f.write(value)
        p.chmod(0o600)
    verify_host(target, {k: set(v) for k, v in ops.items()})
    return manifest


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('usage: activity-103-tool-host.py EXISTING_FROZEN_HOST NEW_CANDIDATE_DIRECTORY')
    print(json.dumps(assemble(*sys.argv[1:]), ensure_ascii=False))

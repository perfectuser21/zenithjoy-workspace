"""Freeze typed business admission feedback for the known single-Activity host."""
import ast
import hashlib
import importlib.util
import json
import pathlib
import re
import stat
import sys
import time
import http.client
import urllib.error
import threading
import queue

ROOT = pathlib.Path(__file__).resolve().parent
BASE_SHA = {
    'TOOLS.txt': 'c9f28373276f203ab6dcdf77dcd67a0e6965aef7ba8febf376f7441ae9b9b712',
    'tools.py': '53ac7b51b19e0e65f6031d07135bb4cd677b8dee27590b987d49de59e8bcc352',
    'tool_scope.py': 'b5d39b61efc42dac48ca76a3d77d7f1bef63eed734ea076231facaf554b6386b',
}
BASE_SHA102 = {
    'TOOLS.txt': '16fef3edcf1b3f9043c62df020abb484647f0a5d2e643b3ae661d5a1b9141282',
    'tools.py': 'eded963eea2d469182eb6367a679e8b01d14594a70cc91775e733d29d5850698',
    'tool_scope.py': BASE_SHA['tool_scope.py'],
}
BASE_SHA103 = {**BASE_SHA102, 'TOOLS.txt': 'eea676142e7e50920bc5631b1388425140b0c74a8d84c20c5e9a34c173d96d16'}
spec = importlib.util.spec_from_file_location('activity_host_typed', ROOT/'activity-tool-result.py')
typed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(typed)
PreDispatchRejected = typed.PreDispatchRejected
emit_pre_dispatch_rejection = typed.emit_pre_dispatch_rejection
scope_rejection = typed.scope_rejection


class TaskAuthorityUnavailable(Exception):
    """Only the read-only Task admission stage can issue this refusal."""
    def __init__(self, reason, attempts):
        self.reason, self.attempts = reason, attempts


def bounded_task_read(read_task, route, budget):
    # A trickling response cannot reset the admission wall deadline. The daemon can only GET;
    # it never owns dispatch or writes a business receipt, and process exit does not wait for it.
    result = queue.Queue(maxsize=1)
    def read():
        try:result.put((True, read_task(route, timeout=budget)))
        except Exception as error:result.put((False, error))
    threading.Thread(target=read, daemon=True).start()
    try:ok, value = result.get(timeout=budget)
    except queue.Empty:raise TaskAuthorityUnavailable('budget_exhausted', 1) from None
    if not ok:raise value
    return value


def task_authority(context, read_task, activity):
    absolute = context['cleanup_deadline_ms'] if activity == 'cleanup' else context['business_deadline_ms']
    end = time.monotonic() + min(20, max(0, (absolute-time.time()*1000)/1000))
    remaining = lambda: min(end-time.monotonic(), (absolute-time.time()*1000)/1000)
    attempts = 0
    for identity in dict.fromkeys([context['root_task_id'], context['tasks'][context['assigned_workflow']]['task_id']]):
        for attempt in range(2):
            budget = remaining()
            if budget <= 0:
                raise TaskAuthorityUnavailable('budget_exhausted', attempts)
            attempts += 1
            try:
                value = bounded_task_read(read_task, 'tasks/'+identity, budget)
            except Exception as error:
                # HTTP status, malformed JSON, DNS, timeouts and arbitrary OSError are not transient admission retries.
                if type(error) is TaskAuthorityUnavailable:
                    raise TaskAuthorityUnavailable(error.reason, attempts) from None
                cause = error.reason if type(error) is urllib.error.URLError else error
                if type(cause) not in (http.client.RemoteDisconnected, ConnectionResetError, ConnectionAbortedError):
                    raise
                if attempt == 1 or remaining() <= 8:
                    raise TaskAuthorityUnavailable('transport_unavailable' if attempt else 'retry_budget_insufficient', attempts) from None
                time.sleep(8)
                continue
            if remaining() <= 0:
                raise TaskAuthorityUnavailable('budget_exhausted', attempts)
            value = value.get('task', value)
            if value['status'] != 'in_progress' or value['claimed_by'] != context['actor']:
                raise ValueError('TASK_AUTHORITY')
            break


def authority_refusal(error):
    return {'state': 'terminal', 'result': {'exit_code': 75, 'data': {
        'code': 'TASK_AUTHORITY_TRANSPORT_UNAVAILABLE', 'phase': 'pre_dispatch',
        'dispatched': False, 'business_receipt_created': False, 'authority_status': 'unavailable',
        'reason': error.reason, 'attempts': error.attempts, 'retryable': True,
        'retry_requires_new_action': True,
        'tool_hint': '本动作在任务鉴权阶段未派发；同action只读回原拒绝，新action才重新鉴权。不得自动重开Activity或重试任何副作用未知动作。'}}}


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




def record_start_diagnostic(c, activity, kind, args, result):
    """Project only fixed native failure filenames; never infer execution state."""
    if (c.get('assigned_workflow') != '102' or activity != 'qualification' or kind != 'phone'
            or len(args) < 2 or args[0] != 'record-start' or not isinstance(result, dict)
            or 'data' in result or type(result.get('exit_code')) is not int or result['exit_code'] == 0):
        return None
    run = c['tasks']['102']['run_tag']
    eid, root, stderr = args[1], c.get('native_root'), result.get('stderr')
    if (not isinstance(root, str) or not root.startswith('/') or len(root) > 4096
            or any(x in root.split('/') for x in ['.', '..']) or root.endswith('/')
            or not re.fullmatch(re.escape(run)+r'-[A-Za-z0-9_.-]+', eid)
            or not isinstance(stderr, str) or len(stderr) > 10000):
        return None
    files = {'startup': eid+'.capture-startup.json', 'log': eid+'.rec.log'}
    expected = ('RECORD_AUDIO_CAPTURE_UNAVAILABLE recorder not ready; see '
                + root+'/'+files['startup']+' and '+root+'/'+files['log']+'\n')
    if stderr != expected:
        return None
    return {'error_code': 'RECORD_AUDIO_CAPTURE_UNAVAILABLE', 'diagnostic_files': files}


def require_local_native_source(source, source_root):
    """Only this read-only local check, before copy2, can prove no dispatch."""
    try:
        observed = source.lstat()
    except FileNotFoundError:
        reason = 'not_found'
    else:
        reason = ('symlink' if stat.S_ISLNK(observed.st_mode) else
                  'not_regular_file' if not stat.S_ISREG(observed.st_mode) else
                  'outside_native_root' if source.resolve().parent != source_root else None)
    if reason:
        error = scope_rejection('NATIVE_LOCAL_SOURCE')
        error.details = {'source_path': str(source), 'reason': reason,
                         'tool_hint': '本地原生证据来源校验拒绝，尚未复制或外部dispatch；按真实原件文件名纠正，必须用新action名。不得伪造或改写原件。'}
        raise error


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


def method_input102(context):
    c = context or {}
    scope = c.get('verification', {}).get('102', {})
    q = scope.get('qualification_input', {})
    coverage = q.get('coverage', {})
    ids = scope.get('video_ids', [])
    duration, maximum = coverage.get('source_duration_display_seconds'), coverage.get('capture_max_seconds')
    calls = [coverage.get(k) for k in ['max_capture_sessions', 'max_asr_calls', 'max_judge_primary_calls']]
    source = c.get('source_commit', '')
    if (c.get('assigned_workflow') != '102' or c.get('recovery') or len(ids) != 1
            or not isinstance(ids[0], str) or not ids[0].isdigit() or not 16 <= len(ids[0]) <= 24
            or q.get('video_id') != ids[0] or coverage.get('kind') != 'full_video'
            or type(duration) not in (int, float) or not 0 < duration <= 300
            or type(maximum) is not int or not duration <= maximum <= 300
            or any(type(x) is not int for x in calls) or calls != [1, 1, 1]
            or len(source) != 40 or any(x not in '0123456789abcdef' for x in source)
            or type(c.get('comment_limit')) is not int or c['comment_limit'] < 1):
        raise ValueError('ACTIVITY_HOST_102_INPUT_INVALID')
    result = {'video_id': ids[0], 'duration_seconds': duration, 'capture_max_seconds': maximum,
              'source_commit': source, 'run_tag': c.get('tasks', {}).get('102', {}).get('run_tag'),
              'profile': c.get('profile'), 'policy_version': c.get('verification', {}).get('policy_version'),
              'comment_limit': c['comment_limit']}
    if not all(result[k] for k in ['run_tag', 'profile', 'policy_version']):
        raise ValueError('ACTIVITY_HOST_102_INPUT_INVALID')
    return result


def method_input103(context):
    c = context or {}
    scope = c.get('verification', {}).get('103', {})
    ids, sources = scope.get('comment_ids'), scope.get('sources')
    task = c.get('tasks', {}).get('103', {})
    source = c.get('source_commit', '')
    if (c.get('assigned_workflow') != '103' or c.get('recovery')
            or scope.get('input_mode') != 'committed_partial_ids'
            or not isinstance(ids, list) or len(ids) != 1
            or not isinstance(ids[0], str) or not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', ids[0])
            or not isinstance(sources, dict) or set(sources) != set(ids)
            or any(not isinstance(v, str) or not v.strip() or v == task.get('run_tag') for v in sources.values())
            or not isinstance(source, str) or not re.fullmatch(r'[a-f0-9]{40}', source)
            or type(c.get('comment_limit')) is not int or c['comment_limit'] != 1
            or type(c.get('max_candidates')) is not int or c['max_candidates'] != 1
            or any(not isinstance(task.get(k), str) or not task[k].strip() for k in ['task_id', 'run_id', 'run_tag'])
            or type(c.get('verification', {}).get('policy_version')) is not int or c['verification']['policy_version'] < 1):
        raise ValueError('ACTIVITY_HOST_103_INPUT_INVALID')
    return {'workflow': '103', 'comment_ids': ids, 'sources': sources,
            'source_commit': source, 'task': task, 'policy_version': c['verification']['policy_version'],
            'input_mode': 'committed_partial_ids', 'source_run': None, 'limit': 1, 'budget_max': 1}


def render102(original, method):
    # Keep the complete historical source separately. Only its reusable method prefix is executable.
    prefix = original.split('\n本轮 102 的执行输入；不修改 Skill、验收合同或业务政策。\n')[0]
    prefix = prefix.replace('覆盖全片或本轮明确前90秒（较短者）', '覆盖本轮冻结输入指定的完整视频')
    prefix = prefix.replace('方法见本文末尾本轮58秒视频补充', '方法见本文末尾由本轮冻结输入生成的补充')
    prefix = prefix.replace('（覆盖kind=full_video时替代旧90秒描述）', '（coverage.kind=full_video）')
    m = method
    return prefix + '\n本轮102冻结执行输入：\n' + json.dumps(m, ensure_ascii=False, sort_keys=True) + '\n' + '\n'.join([
        'TOOLS-base.txt保留完整历史来源及摘要，仅供来源审计；其中旧VID、旧录制、旧时长、旧source、旧run和诊断PTS均不是本轮执行指令或证据。',
        '先读本轮qualification_input、source_duration_evidence及101完整原件链；只处理上述唯一VID。公司、账号、SDK和音轨以本轮原生读回为准。',
        '先完成双锁、公司、VID、工具签名和fresh原生唯一enabled SeekBar/实屏轨道定位。必要同VID页面恢复严格沿前述一次恢复范围；不复制历史坐标。',
        f'唯一一次capture上限{m["capture_max_seconds"]}秒，单次ASR和单次主判。所有准备在record-start前完成；ready后以同EID record-status确认，再连贯执行唯一向左全轨swipe-evidence，时长<=1500ms，无补滑或二次capture。',
        '录制前不归零；录制期间不调用有no_active_capture守卫的native-audio-evidence，不打开分享页；完成上文唯一归零操作后不再操作手机或改变播放。不得以STOPPED position=0或tap/swipe成功代替原录制零点证据。',
        f'必须在本次原视频中找到真实00:00或可独立核验的原生等价零点及媒体PTS，并证明完整结束/同首帧循环；连续播放路线须真实1x无暂停跳播且覆盖本轮{m["duration_seconds"]}秒完整视频，另满足qualification_input.completion_anchor要求。墙钟等待和容器总时长不能证明覆盖，证据充分即正常stop，不必耗尽上限。',
        f'同一次录制内，归零后继续通过原record-status读media_progress：capture_state、progress_status、video.last_pts_seconds与audio.last_pts_seconds分别核对；墙钟或音频增加不能替代视频进展。可只读提取本次MKV已写入原帧定位真实零点PTS；零点未证或video进展不足本轮{m["duration_seconds"]}秒及completion_anchor余量时不因固定sleep结束就stop。',
        f'在原{m["capture_max_seconds"]}秒单次上限内继续观察；progress unknown只是缺读回，不是通过，也不重发record-start。确认完整周期或已证零点后的所需媒体区间后正常stop；达到原上限仍不足或无法证明则准确unknown并按原cleanup收尾，不得换EID或追加录制。停止后的最终原帧/PTS核验保持原标准，media_progress.coverage_verified=false不是资格结论。',
        '原record-stop支持录制自行停止：沿同EID核状态、结束音轨并验证原件，auto time-limit不是另起capture理由。停止和extract后核真实MKV/WAV，分别ffprobe视频/音频轨、PCM非静音、原生音轨/SDK/固定scrcpy摘要及当前VID。',
        '按实际视频PTS先每2或5秒联系图定位内容，在本次归零附近抽全部帧并用showinfo保存实际PTS及原尺寸零点/开头/结尾/循环帧；粗抽可能漏短暂零点。两个PTS下同intro且中间完整内容顺序可核才能证明循环。不得用旧帧或固定诊断时间戳。',
        '覆盖不能证明就保持unknown，不调用ASR。合法音频仅交既有qualification助手；固定私有COS负责上传、SHA读回、私有性、单次ASR及清理，Agent不自行上传/调用模型或重试未知。',
        f'只有真实matched才采本轮最多{m["comment_limit"]}条原生身份评论；rejected按原合同empty，模型失败/证据不足不能伪装业务不合格或成功。recipientEvidence构造与持久化按上文原接口，prepared/unknown不重发。',
        '模型HTTP未知保留unknown且禁重发；若同步helper已退出、无在途手机进程/录制、原工具回执终态，模型远端不会回调手机，可按原cleanup释放本人资源并读回。手机终态未知则查原进程，不碰别人锁。',
        '内部exit124或NATIVE_INNER_EXECUTION_TERMINATION_UNKNOWN按未知处理，不能因工具terminal就导航或释放。录制启动失败读同EID startup/rec.log，不假报ready或另起capture。全部绝对截止以context为准，不改Skill、政策、合同或检查器。',
    ]) + '\n'


def instructions(ops, original, method=None):
    lines = ['每次只执行当前Activity；权限以宿主当前Activity的OPS为准。',
             '业务使用commander_host_tools.invoke：kind=business、action_name、args=[JSON字符串]；操作字段为op，不是operation。',
             '下面清单由冻结OPS生成，不在当前Activity清单中的业务操作禁止调用。']
    lines += [f'{key}允许操作：'+', '.join(values) for key, values in ops.items()]
    lines += ['101中company_config仅preflight调用；collect_videos使用已冻结公司政策，start checker已独立核验版本，不重新调用company_config。',
              '101的discover与discover_readback都必须传video.metrics：同一完整原始metrics对象。discover_readback使用原discover请求中的video及metrics，不只传video_id/video_url；不得重做已成功discover或自行补造metrics。',
              'ACTION_NAME是持久动作身份：同名同参数只读回。仅terminal且data.dispatched=false可按allowed_operations修正并使用新action_name；unknown不得换名重发。',
              '只按原合同和当前Skill交付证据，不修改合同、Skill、上下文、工具或Checker；是否通过仍由独立Checker判定。']
    active = original
    if method:
        active = original+'\n本轮103冻结执行输入：\n'+json.dumps(method, ensure_ascii=False, sort_keys=True)+'\n' if method.get('workflow') == '103' else render102(original, method)
    return active+'\n冻结Activity业务操作与拒绝回执补充：\n'+'\n'.join(lines)+'\n'


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
    tools = replace_once(tools, 'def brain(route,body=None):', 'def brain(route,body=None,*,timeout=20):')
    tools = replace_once(tools, 'urllib.request.urlopen(req,timeout=20)', 'urllib.request.urlopen(req,timeout=timeout)')
    tools = replace_once(tools, """def task_authority(c):
 for key in [c['root_task_id'],c['tasks'][c['assigned_workflow']]['task_id']]:
  x=brain('tasks/'+key);x=x.get('task',x)
  if x['status']!='in_progress' or x['claimed_by']!=c['actor']:raise ValueError('TASK_AUTHORITY')""", """def task_authority(c):
 return _host.task_authority(c,brain,os.environ.get('COMMANDER_ACTIVITY_KEY'))""")
    tools = replace_once(tools, " task_authority(c);deadline=c['cleanup_deadline_ms'] if key=='cleanup' else c['business_deadline_ms']", """ deadline=c['cleanup_deadline_ms'] if key=='cleanup' else c['business_deadline_ms']
 try:task_authority(c)
 except _host.TaskAuthorityUnavailable as error:
  if type(error) is not _host.TaskAuthorityUnavailable:raise
  print(json.dumps(_host.authority_refusal(error),ensure_ascii=False));return 75""")
    tools = replace_once(tools, " c=read(P/'context.json');f=", " _host.verify_host(P,OPS)\n c=read(P/'context.json');f=")
    tools = replace_once(tools, "  i=scoped_business(c,key,json.loads(args[0]))", "  parsed=read_business_input(args,activity=key,allowed_operations=OPS.get(key,set()))\n  i=scoped_business(c,key,parsed,reject=scope_rejection)")
    tools = replace_once(tools, "  # A policy error before launching an operation has no external operation in flight.\n  if isinstance(e,ValueError):atomic(action,{'binding':bind,'state':'terminal','started_at':started_at,'result':{'exit_code':2,'error':str(e)},'ended_at':time.time()})", "  if type(e) is PreDispatchRejected:\n   return emit_pre_dispatch_rejection(e,action=action,binding=bind,started_at=started_at,persist=atomic)")
    tools = replace_once(tools, "   if source.is_symlink() or not source.is_file() or source.resolve().parent!=source_root:raise ValueError('NATIVE_LOCAL_SOURCE')", "   _host.require_local_native_source(source,source_root)")
    tools = replace_once(tools, " out={'binding':bind,'state':'terminal'", " diagnostic=_host.record_start_diagnostic(c,key,kind,args,result)\n if diagnostic:result={**result,'data':diagnostic}\n out={'binding':bind,'state':'terminal'")
    tools = replace_once(tools, "'stderr':result.get('stderr','')[-1200:]},ensure_ascii=False)", "'stderr':result.get('stderr','')[-1200:],**({'result':{'data':diagnostic}} if diagnostic else {})},ensure_ascii=False)")
    scope = replace_once(scope, 'def scoped_business(c,activity,i):', 'def scoped_business(c,activity,i,*,reject=ValueError):')
    start = scope.index('def scoped_business(')
    scope = scope[:start]+scope[start:].replace('raise ValueError(', 'raise reject(')
    return tools, scope



def verify_proof_manifest(context, root):
    raw = context.get('verification', {}).get('proof_manifest_path')
    if raw is None:
        return
    if not isinstance(raw, str) or not pathlib.Path(raw).is_absolute():
        raise ValueError('ACTIVITY_HOST_PROOF_REQUIRED')
    file, host = pathlib.Path(raw), pathlib.Path(root).resolve()
    resolved = file.resolve()
    if resolved == host or host in resolved.parents or file.is_symlink():
        raise ValueError('ACTIVITY_HOST_PROOF_PATH')
    if not file.is_file():
        raise ValueError('ACTIVITY_HOST_PROOF_MISSING')
    if file.stat().st_mode & 0o022:
        raise ValueError('ACTIVITY_HOST_PROOF_PATH')
    workflow = context.get('assigned_workflow')
    task = context.get('tasks', {}).get(workflow, {})
    expected = {key: task.get(key) for key in ['task_id', 'run_id', 'run_tag']}
    expected['workflow'] = workflow
    if any(not isinstance(v, str) or not v for v in expected.values()):
        raise ValueError('ACTIVITY_HOST_PROOF_SCOPE')
    try:
        proof = json.loads(file.read_text())
    except (ValueError, OSError):
        raise ValueError('ACTIVITY_HOST_PROOF_INVALID') from None
    if not isinstance(proof, dict) or proof.get('schema') != 'activity-evidence/v1' or proof.get('identity') != expected:
        raise ValueError('ACTIVITY_HOST_PROOF_SCOPE')
    # This only checks the host-owned container. Empty fields never constitute business evidence.


def verify_host(root, ops):
    root = pathlib.Path(root)
    if (root/'context.json').exists():
        verify_proof_manifest(json.loads((root/'context.json').read_text()), root)
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
    method = manifest.get('method_input103') or manifest.get('method_input102')
    if manifest.get('method_input103') and manifest.get('method_input102'):
        raise ValueError('ACTIVITY_HOST_MANIFEST_INVALID')
    is103 = bool(manifest.get('method_input103'))
    expected = BASE_SHA103 if is103 else (BASE_SHA102 if method else BASE_SHA)
    method_reader = method_input103 if is103 else method_input102
    if method and method_reader(json.loads((root/'context.json').read_text())) != method:
        raise ValueError('ACTIVITY_HOST_METHOD_INPUT_CHANGED')
    if manifest.get('base_sha256') != expected or digest(original.encode()) != expected['TOOLS.txt'] or actual != manifest['operations'] or (root/'TOOLS.txt').read_text() != instructions(actual, original, method):
        raise ValueError('ACTIVITY_HOST_METHOD_DRIFT')
    return manifest


def assemble(base, target, *, workflow='101', context=None):
    base, target = pathlib.Path(base), pathlib.Path(target)
    raw = {}
    if base.is_symlink() or target.exists() or target.is_symlink():
        raise ValueError('ACTIVITY_HOST_TARGET_INVALID')
    if workflow not in ['101', '102', '103']:
        raise ValueError('ACTIVITY_HOST_WORKFLOW_INVALID')
    method = method_input103(context) if workflow == '103' else (method_input102(context) if workflow == '102' else None)
    baselines = BASE_SHA103 if workflow == '103' else (BASE_SHA102 if workflow == '102' else BASE_SHA)
    for name, expected in baselines.items():
        p = base/name
        if p.is_symlink() or digest(p.read_bytes()) != expected:
            raise ValueError('ACTIVITY_HOST_BASE_SOURCE_CHANGED')
        raw[name] = p.read_text()
    if context is not None:
        verify_proof_manifest(context, target)
    tools, scope = patch_sources(raw['tools.py'], raw['tool_scope.py'])
    ops = business_ops(scope)
    files = {'tools.py': tools, 'tool_scope.py': scope, 'TOOLS.txt': instructions(ops, raw['TOOLS.txt'], method), 'TOOLS-base.txt': raw['TOOLS.txt'],
             'activity-host-tools.py': pathlib.Path(__file__).read_text(),
             'activity-tool-result.py': (ROOT/'activity-tool-result.py').read_text()}
    manifest = {'schema': 'activity-host-tools/v1', 'base_sha256': baselines,
                'operations': ops, 'sha256': {key: digest(value.encode()) for key, value in files.items()}}
    if method:
        manifest['method_input'+workflow] = method
    target.mkdir(mode=0o700)
    for name, value in {**files, 'activity-host-tools.json': json.dumps(manifest, ensure_ascii=False, indent=2)+'\n'}.items():
        p = target/name
        with p.open('x') as f:
            f.write(value)
        p.chmod(0o600)
    if method:
        (target/'context.json').write_text(json.dumps(context, ensure_ascii=False))
        (target/'context.json').chmod(0o600)
    verify_host(target, {key: set(value) for key, value in ops.items()})
    return manifest


if __name__ == '__main__':
    if len(sys.argv) not in [3, 4]:
        raise SystemExit('usage: activity-host-tools.py ORIGINAL_FROZEN_HOST NEW_CANDIDATE_DIRECTORY [102_OR_103_CONTEXT_JSON]')
    context = json.loads(pathlib.Path(sys.argv[3]).read_text()) if len(sys.argv) == 4 else None
    options = {'workflow': context.get('assigned_workflow'), 'context': context} if context is not None else {}
    print(json.dumps(assemble(*sys.argv[1:3], **options), ensure_ascii=False))

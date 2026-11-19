"""Exercise the assembled tools.main; substitute only Task/lock reads and native child effects."""
import contextlib, importlib.util, io, json, os, pathlib, shutil, sys, time, types

root = pathlib.Path(sys.argv[1])
case = json.loads(sys.argv[2])
sys.path.insert(0, str(root))
spec = importlib.util.spec_from_file_location('actual_phone_host', root/'tools.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
c = json.loads((root/'context.json').read_text())
workflow = c['assigned_workflow']; identity = c['tasks'][workflow]
if (root/'receipts').exists(): shutil.rmtree(root/'receipts')
input_file = root/'phone-test-input.json'
input_file.write_text(json.dumps({'activity_key': case['activity'], 'identity': identity}))
os.environ['COMMANDER_ACTIVITY_KEY'] = case['activity']
os.environ['COMMANDER_ACTIVITY_INPUT_FILE'] = str(input_file)
now = c['business_deadline_ms']/1000 + (1 if case.get('late') else -30)
if case.get('expired'): now = c['cleanup_deadline_ms']/1000+1
clock = types.SimpleNamespace(time=lambda: now, monotonic=time.monotonic, sleep=time.sleep)
m.time = clock; m._host.time = clock
calls = []; locks = []; gets = []
def brain(route, body=None, **kwargs):
    assert body is None, 'no remote mutation in this fixture'
    gets.append(route)
    if route.startswith('tasks/'):
        return {'status': 'in_progress', 'claimed_by': 'foreign' if case.get('task_foreign') else c['actor']}
    assert route == 'device-locks'
    return {'locks': [{'device_name': c['serial'], 'locked_by': c['central_owner'],
        'expires_at': '2100-01-01T00:00:00Z'}]}
m.brain = brain
def child(argv, **kwargs):
    if 'lock-status' in argv:
        locks.append(argv)
        return types.SimpleNamespace(returncode=0, stdout='lock=held owner='+('foreign' if case.get('owner_foreign') else c['local_owner'])+' stale=false', stderr='')
    calls.append({'argv': argv, 'timeout': kwargs.get('timeout')})
    if case.get('unknown'): raise OSError('fixture effect outcome unknown')
    return types.SimpleNamespace(returncode=0, stdout='fixture_native_terminal', stderr='')
m.subprocess.run = child
args = [s.replace('$RUN',identity['run_tag']).replace('$OWNER',c['local_owner']).replace('$VID','7711111111111111111') for s in case['args']]
if case.get('wrong_identity'):
    input_file.write_text(json.dumps({'activity_key': case['activity'], 'identity': {**identity, 'run_id': 'foreign'}}))
def invoke(name, supplied):
    out = io.StringIO(); rc = None; error = None
    sys.argv = [str(root/'tools.py'), 'phone', name, *supplied]
    try:
        with contextlib.redirect_stdout(out): rc = m.main()
    except Exception as e: error = type(e).__name__+':'+str(e)
    return {'rc': rc, 'stdout': out.getvalue(), 'error': error, 'dispatches': len(calls)}
first = invoke('phone-action', args)
replay = invoke('phone-action', args) if case.get('replay') else None
other = invoke('phone-new-action', args) if case.get('unknown') else None
receipts = {p.name: json.loads(p.read_text()) for p in (root/'receipts').glob('*.json')}
print(json.dumps({'first': first, 'replay': replay, 'other': other, 'calls': calls, 'locks': locks,
                  'gets': gets, 'receipts': receipts, 'controller': c['phone_controller'],
                  'profile': c['profile'], 'owner': c['local_owner']}))

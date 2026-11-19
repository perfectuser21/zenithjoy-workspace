"""Run the actually assembled host against an isolated real HTTP server."""
import contextlib, http.server, importlib.util, io, json, os, pathlib, shutil, socket, sys, threading, time, types, urllib.request
root, mode = pathlib.Path(sys.argv[1]), sys.argv[2]
sys.path.insert(0, str(root))
spec = importlib.util.spec_from_file_location('actual_host', root/'tools.py')
m = importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
c = json.loads((root/'context.json').read_text())
activity = 'cleanup' if mode == 'cleanup' else 'qualification'
if mode == 'distinct':c['root_task_id'] = '33333333-3333-4333-8333-333333333333'
now = time.time(); c['business_deadline_ms'] = (now + (7 if mode == 'short' else -1 if mode == 'cleanup' else 60))*1000
c['cleanup_deadline_ms'] = (now+90)*1000
(root/'context.json').write_text(json.dumps(c))
creds = pathlib.Path(c['credentials']['brain']);creds.parent.mkdir(parents=True,exist_ok=True);creds.write_text('BRAIN_INTERNAL_TOKEN="fixture-only"\n')
input_file = root/'test-input.json'; input_file.write_text(json.dumps({'activity_key':activity,'identity':c['tasks']['102']}))
os.environ['COMMANDER_ACTIVITY_KEY'] = activity;os.environ['COMMANDER_ACTIVITY_INPUT_FILE'] = str(input_file)
counts, sleeps, timeouts, dispatched = {}, [], [], []
elapsed = [0.0]
real = mode == 'retry-real'
if not real:
    def sleep(seconds):sleeps.append(seconds);elapsed[0]+=seconds
    m._host.time = types.SimpleNamespace(time=lambda:now+elapsed[0],monotonic=lambda:100+elapsed[0],sleep=sleep)
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_POST(self):self.do_GET()
    def do_GET(self):
        n = counts[self.path] = counts.get(self.path,0)+1
        disconnect = mode in ['exhaust','short','post','post-dispatch'] or mode in ['retry-real','distinct'] and n == 1
        if disconnect:
            self.connection.shutdown(socket.SHUT_RDWR);self.connection.close();return
        code = int(mode[4:]) if mode.startswith('http') else 200
        self.send_response(code);self.end_headers()
        if mode == 'bad-json':self.wfile.write(b'not-json');return
        self.wfile.write(json.dumps({'status':'queued' if mode == 'bad-status' else 'in_progress','claimed_by':'foreign' if mode == 'bad-owner' else c['actor']}).encode())
server = http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
thread = threading.Thread(target=server.serve_forever,daemon=True);thread.start()
original_urlopen = urllib.request.urlopen
# Only redirect the actual host's fixed Brain URL, preserving method/body/headers.
def redirected(req,timeout):
    assert req.full_url.startswith('http://127.0.0.1:5221/api/brain/')
    timeouts.append(timeout)
    replacement = urllib.request.Request('http://127.0.0.1:'+str(server.server_port)+req.full_url.split(':5221')[1],data=req.data,headers=dict(req.header_items()),method=req.get_method())
    return original_urlopen(replacement,timeout=timeout)
m.urllib.request.urlopen = redirected
# The original invoke branch is executed; its native child is the only effect substitute.
def child(*args,**kwargs):
    dispatched.append(args[0]);return types.SimpleNamespace(returncode=0,stdout='{"fixture":"readback"}',stderr='')
m.subprocess.run = child
out = io.StringIO();error = None;code = None;started = time.monotonic()
try:
    with contextlib.redirect_stdout(out):
        if mode == 'post':m.brain('device-locks',{'fixture':True})
        else:
            sys.argv = [str(root/'tools.py'),'native-readback','authority-probe']
            code = m.main()
except Exception as e:error = type(e).__name__+':'+str(e)
finally:
    duration = time.monotonic()-started
    server.shutdown();server.server_close();thread.join()
print(json.dumps({'code':code,'stdout':out.getvalue(),'error':error,'counts':counts,'sleeps':sleeps,'timeouts':timeouts,'dispatches':len(dispatched),'receipts':list(p.name for p in (root/'receipts').glob('*.json')),'duration':duration}))

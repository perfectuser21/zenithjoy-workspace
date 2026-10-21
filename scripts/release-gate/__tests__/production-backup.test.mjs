import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const source=fileURLToPath(new URL('../../backup/verify-hk-backup.py',import.meta.url));
test('异地备份拒绝过期/错误库/非法路径/摘要/零字节，未开始任何恢复',()=>{
 const script=`import importlib.util,time\ns=importlib.util.spec_from_file_location('backup',${JSON.stringify(source)});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nv={'database':'zenithjoy','name':'zenithjoy-20261021-033001.dump','sha256':'a'*64,'size':123,'mtime':time.time()}\nm.validate_source(v)\nfor key,bad in [('database','cecelia'),('name','../outside.dump'),('sha256','abc'),('size',0),('mtime',0)]:\n x=dict(v);x[key]=bad\n try:m.validate_source(x)\n except ValueError:continue\n raise AssertionError(key)\n`;
 const r=spawnSync('python3',['-c',script],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);
});
test('恢复命令强制隔离网络和scratch库，退出码与非空产出均须通过',()=>{
 const script=`import importlib.util\ns=importlib.util.spec_from_file_location('backup',${JSON.stringify(source)});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\na=m.container_args('zj-backup-proof-abc')\nassert a[a.index('--network')+1]=='none'\nassert not any(x in a for x in ['-p','--publish','--network=host','--privileged'])\nassert m.RESTORE_DATABASE=='cecelia_scratch'\nfor counts in [[],[{'schema':'public','table':'empty','rows':0}]]:\n try:m.validate_restored(counts,1)\n except ValueError:continue\n raise AssertionError('empty restore accepted')\nm.validate_restored([{'schema':'public','table':'real','rows':2}],1)\n`;
 const r=spawnSync('python3',['-c',script],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);
});
test('恢复失败仍只清理本次容器及其匿名数据卷，不遗留生产副本卷',()=>{
 const script=`import importlib.util,tempfile,pathlib,types\ns=importlib.util.spec_from_file_location('backup',${JSON.stringify(source)});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\ncalls=[]\ndef command(args,**kwargs):\n calls.append(args)\n if '--list' in args:return types.SimpleNamespace(stdout=b'1; 0 1 TABLE DATA public real postgres')\n if '--exit-on-error' in args:raise RuntimeError('restore failed')\n return types.SimpleNamespace(stdout=b'')\nm.command=command;m.subprocess.run=lambda *a,**k:types.SimpleNamespace(returncode=0)\nwith tempfile.TemporaryDirectory() as root:\n p=pathlib.Path(root)/'source.dump';p.write_bytes(b'dump')\n try:m.verify_restore(p)\n except RuntimeError:pass\n else:raise AssertionError('failed restore reported success')\nassert calls[-1][:3]==['docker','rm','-v']\nassert calls[-1][-1].startswith('zj-backup-proof-')\nassert '-f' not in calls[-1]\n`;
 const r=spawnSync('python3',['-c',script],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);
});
test('定时备份必须先认领任务，真实失败只记失败且保留回执',()=>{
 const runner=fileURLToPath(new URL('../../backup/run-hk-backup.py',import.meta.url));
 const script=`import importlib.util,tempfile,pathlib,json,threading
from http.server import BaseHTTPRequestHandler,HTTPServer
s=importlib.util.spec_from_file_location('runner',${JSON.stringify(runner)});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
events=[]
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  body=json.loads(self.rfile.read(int(self.headers['Content-Length'])));events.append((self.path,body))
  self.send_response(200);self.end_headers();self.wfile.write(json.dumps({'id':'fixture-task'} if self.path.endswith('/tasks') else {'ok':True}).encode())
 def do_PATCH(self):self.do_POST()
server=HTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
try:
 with tempfile.TemporaryDirectory() as d:
  def fail():
   assert events[-2][0].endswith('/claim'),'backup ran before claim'
   assert events[-1][1].get('status')=='in_progress','backup ran before in_progress'
   raise RuntimeError('fixture restore failed')
  try:m.run_recorded(pathlib.Path(d),'http://127.0.0.1:'+str(server.server_port),fail)
  except RuntimeError:pass
  else:raise AssertionError('failed restore accepted')
  assert events[-1][1]['status']=='failed'
  assert events[-1][1]['result']['actor']=='zenithjoy-backup-verifier'
  receipts=list((pathlib.Path(d)/'runs').glob('*.json'));assert len(receipts)==1
  assert json.loads(receipts[0].read_text())['status']=='failed'
finally:server.shutdown()
`;
 const r=spawnSync('python3',['-c',script],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);
});

test('真实验证子进程超时回收本run整进程组和Docker恢复容器，保留其他run',()=>{
 const runner=fileURLToPath(new URL('../../backup/run-hk-backup.py',import.meta.url));
 const script=String.raw`import importlib.util,tempfile,pathlib,json,os,subprocess,time,sys,signal
s=importlib.util.spec_from_file_location('runner',${JSON.stringify(runner)});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
with tempfile.TemporaryDirectory() as directory:
 root=pathlib.Path(directory);run_id='a'*32
 docker=root/'docker'
 docker.write_text("#!/usr/bin/env python3\nimport json,os,sys,pathlib\np=pathlib.Path(os.environ['FAKE_DOCKER_STATE']);s=json.loads(p.read_text()) if p.exists() else {};a=sys.argv[1:]\nif a[0]=='ps': print('\\n'.join(k for k,v in s.items() if v['Config']['Labels']['zenithjoy.backup-run']==a[a.index('--filter')+1].split('=',2)[2]))\nelif a[0]=='inspect': print(json.dumps([s[a[-1]]]))\nelif a[0]=='stop': pass\nelif a[0]=='rm': del s[a[-1]];p.write_text(json.dumps(s))\nelse: raise RuntimeError(a)\n")
 docker.chmod(0o755);os.environ['PATH']=str(root)+os.pathsep+os.environ['PATH'];os.environ['FAKE_DOCKER_STATE']=str(root/'docker-state.json')
 fixture=root/'verify-fixture.py'
 fixture.write_text("import subprocess,sys,os,json,pathlib,time\nr=sys.argv[sys.argv.index('--run-id')+1]\nstate={}\nfor identity,owner in [('owned',r),('foreign','b'*32)]:state[identity]={'Id':identity,'Name':'/zj-backup-proof-'+owner,'Config':{'Labels':{'zenithjoy.backup-run':owner,'zenithjoy.purpose':'isolated-backup-restore'}}}\npathlib.Path(os.environ['FAKE_DOCKER_STATE']).write_text(json.dumps(state))\nchild=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)\npathlib.Path(os.environ['FAKE_DOCKER_STATE']+'.pid').write_text(str(child.pid))\ntime.sleep(60)\n")
 try:
  if hasattr(m,'run_verifier'):m.run_verifier(root,run_id,script=fixture,timeout=1)
  else:subprocess.run([sys.executable,str(fixture),'--store',str(root),'--run-id',run_id],check=True,capture_output=True,text=True,timeout=1)
 except subprocess.TimeoutExpired:pass
 else:raise AssertionError('timeout reported success')
 state=json.loads((root/'docker-state.json').read_text())
 pid=int((root/'docker-state.json.pid').read_text())
 if set(state)!={'foreign'}:
  os.kill(pid,signal.SIGKILL)
  raise AssertionError('owned daemon container survived timeout: '+str(list(state)))
 for _ in range(40):
  probe=subprocess.run(['ps','-o','stat=','-p',str(pid)],capture_output=True,text=True)
  if not probe.stdout.strip() or probe.stdout.strip().startswith('Z'):break
  time.sleep(.05)
 else:raise AssertionError('owned descendant survived timeout')
`;
 const r=spawnSync('python3',['-c',script],{encoding:'utf8',timeout:10000});
 assert.equal(r.status,0,r.stderr);
});

# Test boundary: real core/kernel; HOME, logical hostname and loopback ports map.
import os,sys,pathlib,types,json,signal,subprocess,fcntl,socket,pwd,threading,time
_fixture_main=__name__=='__main__'
_fixture_root=pathlib.Path(__file__).resolve().parent
_cfg=json.loads((_fixture_root/'native-fixture.json').read_text())
# Never change UID/PID/kernel/argv; only this isolated realm machine name maps.
socket.gethostname=lambda:_cfg['logical_hostname']
_native_getpwuid=pwd.getpwuid
pwd.getpwuid=lambda uid:types.SimpleNamespace(pw_dir=_cfg['home'],pw_name=_native_getpwuid(uid).pw_name)
_native_socket=socket.socket
class MappedSocket(_native_socket):
 def connect(self,address):
  host,port=address
  if port in (5041,5042):
   assert host=='127.0.0.1';address=(host,_cfg['ports'][str(port)])
  return super().connect(address)
socket.socket=MappedSocket
_native_run=subprocess.run
def traced_run(args,*a,**kw):
 result=_native_run(args,*a,**kw)
 if len(args)>1 and str(args[1]).endswith('device-epoch-fence-review.mjs'):
  with (_fixture_root/'verifier-subprocess.jsonl').open('a') as out:out.write(json.dumps({'code':result.returncode,'stderr':result.stderr,'stdout_length':len(result.stdout)})+'\n')
 return result
subprocess.run=traced_run
__name__='fixture_service_core'
exec(compile((_fixture_root/'adb-host-service-core.py').read_bytes(),str(_fixture_root/'adb-host-service-core.py'),'exec'),globals())
if _fixture_main:
 if pathlib.Path(sys.argv[-1]).name=='initial-fixture-receipt.json':
  p=json.loads(pathlib.Path(sys.argv[3]).read_text());p['port']=int(p['endpoint'].rsplit(':',1)[1]);base=pathlib.Path(_cfg['home'])/'.config/zenithjoy'
  with instance_service_locks(base,p) as fd:
   child=subprocess.Popen(foreground_command(p));os.ftruncate(fd,0);os.write(fd,(json.dumps({'supervisor_pid':os.getpid(),'child_pid':child.pid})+'\n').encode());os.fsync(fd)
   def forward(sig,frame):
    if child.poll() is None:child.send_signal(sig)
    if _cfg.get('continuation_old_handler'):child.wait(timeout=10)
   if _cfg.get('continuation_old_handler'):
    def ready():
     while not child._waitpid_lock.locked():time.sleep(.001)
     (_fixture_root/'initial-wait-held').write_text(str(os.getpid()))
    threading.Thread(target=ready,daemon=True).start()
   signal.signal(signal.SIGTERM,forward);signal.signal(signal.SIGINT,forward);child.wait()
 else:main()

# Actual readonly helper, mapped fixture HOME/listeners; no invented PID facts.
import os,sys,pathlib,json,types,pwd
_fixture_main=__name__=='__main__';_fixture_root=pathlib.Path(__file__).resolve().parent
_cfg=json.loads((_fixture_root/'native-fixture.json').read_text());_getpwuid=pwd.getpwuid
pwd.getpwuid=lambda uid:types.SimpleNamespace(pw_dir=_cfg['home'],pw_name=_getpwuid(uid).pw_name)
__name__='fixture_process_core'
exec(compile((_fixture_root/'adb-private-supervisor-core.py').read_bytes(),str(_fixture_root/'adb-private-supervisor-core.py'),'exec'),globals())
# Only the controlled historical source label changes; all kernel, process,
# listener and lock observations still use the unmodified production functions.
_native_context=context
def context(document):
 source=document.get('supervisor_source',{})
 if _cfg.get('failedRoot') and source.get('source_commit')==_cfg['failedSource']['commit']:
  assert source.get('runtime_root')==_cfg['failedRoot'] and source.get('service_sha256')==_cfg['failedServiceSha']
 if document.get('action')=='terminal' and _cfg.get('failedRoot') and source.get('runtime_root')==_cfg['failedRoot']:
  assert source['source_commit']==_cfg['failedSource']['commit']=='4ba9a0849f281f07f42186d7f465f1c144286dab'
  assert source['service_sha256']==_cfg['failedServiceSha']
  global OLD_SOURCE,OLD_SERVICE_SHA
  before=(OLD_SOURCE,OLD_SERVICE_SHA)
  try:
   OLD_SOURCE,OLD_SERVICE_SHA=source['source_commit'],source['service_sha256']
   return _native_context(document)
  finally:OLD_SOURCE,OLD_SERVICE_SHA=before
 return _native_context(document)
_native_listeners=listeners
def listeners(port,child_pid=None):
 rows=_native_listeners(_cfg['ports'].get(str(port),port),child_pid)
 return [{**row,'endpoint':row['endpoint'].replace(':'+str(_cfg['ports'].get(str(port),port)),':'+str(port))} for row in rows]
if _fixture_main:
 try:print(json.dumps(run(json.load(sys.stdin)),sort_keys=True))
 except Exception as e:
  import traceback;traceback.print_exc();sys.exit(2)

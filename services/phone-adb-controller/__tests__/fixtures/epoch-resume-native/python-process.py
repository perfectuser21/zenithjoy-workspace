# Actual readonly helper, mapped fixture HOME/listeners; no invented PID facts.
import os,sys,pathlib,json,types,pwd
_fixture_main=__name__=='__main__';_fixture_root=pathlib.Path(__file__).resolve().parent
_cfg=json.loads((_fixture_root/'native-fixture.json').read_text());_getpwuid=pwd.getpwuid
pwd.getpwuid=lambda uid:types.SimpleNamespace(pw_dir=_cfg['home'],pw_name=_getpwuid(uid).pw_name)
__name__='fixture_process_core'
exec(compile((_fixture_root/'adb-private-supervisor-core.py').read_bytes(),str(_fixture_root/'adb-private-supervisor-core.py'),'exec'),globals())
_native_listeners=listeners
def listeners(port,child_pid=None):
 rows=_native_listeners(_cfg['ports'].get(str(port),port),child_pid)
 return [{**row,'endpoint':row['endpoint'].replace(':'+str(_cfg['ports'].get(str(port),port)),':'+str(port))} for row in rows]
if _fixture_main:
 try:print(json.dumps(run(json.load(sys.stdin)),sort_keys=True))
 except Exception as e:
  import traceback;traceback.print_exc();sys.exit(2)

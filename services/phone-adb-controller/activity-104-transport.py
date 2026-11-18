"""104 local parent boundary; no phone invocation at import or validation."""
import hashlib,json,pathlib
from local_transport import local_command,pinned_transport
EXPECTED_BINDING_SHA='ASSEMBLY_REPLACES_BINDING_SHA'
KEYS=[] # ASSEMBLY_REPLACES_KEYS

def verify_context(c):
 p=pathlib.Path(__file__).parent/'outreach-host-binding.json'
 if p.is_symlink() or hashlib.sha256(p.read_bytes()).hexdigest()!=EXPECTED_BINDING_SHA:raise ValueError('ACTIVITY_104_CONTEXT_FROZEN')
 frozen=json.loads(p.read_text());actual={k:c.get(k) for k in KEYS};actual['sender_id']=c.get('sender_id',c.get('account'))
 if actual!=frozen:raise ValueError('ACTIVITY_104_CONTEXT_CHANGED')
 a=c['authorization_asset'];p=pathlib.Path(a['path'])
 if p.is_symlink() or hashlib.sha256(p.read_bytes()).hexdigest()!=a['sha256']:raise ValueError('ACTIVITY_104_AUTHORIZATION_SOURCE')
 auth=json.loads(p.read_text())
 if (auth.get('root_task_id')!=c['root_task_id'] or auth.get('schema')!='run-send-authorization/v1'
     or auth.get('max_new_recipients')!=1 or auth.get('max_send_attempts')!=1
     or hashlib.sha256(auth['message'].encode()).hexdigest()!=auth.get('message_sha256')):raise ValueError('ACTIVITY_104_AUTHORIZATION_SCOPE')
 for key in ['node','python']:
  p=pathlib.Path(c[key])
  if not p.is_absolute() or p.is_symlink() or hashlib.sha256(p.read_bytes()).hexdigest()!=c[key+'_sha256']:raise ValueError('ACTIVITY_104_SOURCE_TOOLCHAIN')
 pinned_transport(c)
 return frozen

def command(c,args):
 verify_context(c)
 if c.get('transport')!='local':raise ValueError('ACTIVITY_104_TRANSPORT')
 return local_command(c,args)


def preflight_result(c,result,run):
 if result.returncode:return result
 verify_context(c)
 from local_transport import local_environment
 p=pathlib.Path(c['runtime_root'])/'adb-managed-client.py'
 if p.is_symlink() or hashlib.sha256(p.read_bytes()).hexdigest()!=c['verification']['runtime_sha256'].get('adb-managed-client.py'):raise ValueError('ACTIVITY_104_SOURCE_ADB')
 hardware=run([c['python'],str(p),'-s',c['adb_serial'],'shell','getprop','ro.serialno'],capture_output=True,text=True,timeout=12,env=local_environment(c))
 if hardware.returncode or hardware.stdout.strip()!=c['serial']:raise ValueError('ACTIVITY_104_HARDWARE_BINDING')
 fields=dict(x.split('=',1) for x in result.stdout.splitlines() if '=' in x)
 if fields.get('serial')!=c['adb_serial']:raise ValueError('ACTIVITY_104_ADB_BINDING')
 result.stdout+='\nhardware_serial='+c['serial']+'\n'
 return result

import importlib.util,json,hashlib,tempfile,unittest
from pathlib import Path
from unittest.mock import patch

def module(name):
 spec=importlib.util.spec_from_file_location(name,Path(__file__).resolve().parent.parent/(name+'.py'));mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
p=module('deployment-installed');c=p
class Tests(unittest.TestCase):
 def test_installed_package_identity_and_actual_paths(self):
  with tempfile.TemporaryDirectory() as tmp:
   home=Path(tmp).resolve();package=home/'.local/share/zenithjoy/publish-releases'/('a'*40);root=package/'.agents/skills/multi-platform-publish';root.mkdir(parents=True)
   for name in p.ATTACHMENTS:
    file=package/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(b'installed')
   managed=home/'.openclaw/skills/multi-platform-publish';managed.parent.mkdir(parents=True);managed.symlink_to(root)
   info=dict(source='openclaw-managed',eligible=True,modelVisible=True,baseDir=str(root),filePath=str(root/'SKILL.md'))
   digest=hashlib.sha256(b'installed').hexdigest();entries=[dict(path=x,content_sha256=digest) for x in p.ATTACHMENTS+p.CONTROLLERS]
   remote=dict(manifest={'source_commit':'b'*40},execution_copies=[dict(repo_path=x,path=d+'/'+Path(x).name,sha256=digest) for x in p.CONTROLLERS for d in ('bin-harvest','.local/bin')])
   def call(args,**kw):return json.dumps(info if args[0]=='openclaw' else remote).encode()
   with patch.object(p.subprocess,'check_output',side_effect=call):
    result=p.collect_publish(home,entries,c.read_regular);self.assertEqual(result['installed_package_revision'],'a'*40);self.assertEqual(len(result['files']),8)
    self.assertEqual(result['locations'][p.CONTROLLERS[0]]['installed_revision'],'b'*40)
    remote['execution_copies'][0]['sha256']='c'*64
    with self.assertRaisesRegex(ValueError,'执行字节'):p.collect_publish(home,entries,c.read_regular)
    remote['execution_copies'][0]['sha256']=digest
    file=package/p.ATTACHMENTS[-1];file.unlink();file.symlink_to(root/'SKILL.md')
    with self.assertRaisesRegex(ValueError,'软链接'):p.collect_publish(home,entries,c.read_regular)
    file.unlink();file.write_bytes(b'installed');info['baseDir']=str(home/'checkout/.agents/skills/multi-platform-publish')
    with self.assertRaisesRegex(ValueError,'安装根'):p.collect_publish(home,entries,c.read_regular)


class AggregateTests(unittest.TestCase):
 def test_real_local_files_remote_readback_and_official_skill_identity(self):
  import subprocess,os,shlex,sys
  original=subprocess.check_output
  with tempfile.TemporaryDirectory() as tmp:
   home=Path(tmp).resolve();remote=home/'phone';remote.mkdir();package=home/'.local/share/zenithjoy/publish-releases'/('a'*40)
   runtime=home/'.openclaw/commander';workspace=home/'openclaw-root/workspaces-root/clawd-work-commander'
   data=b'fixed production source';h=hashlib.sha256(data).hexdigest()
   def put(root,name):
    file=root/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(data)
   for name in p.ATTACHMENTS:put(package,name)
   managed=home/'.openclaw/skills/multi-platform-publish';managed.parent.mkdir(parents=True);managed.symlink_to(package/'.agents/skills/multi-platform-publish')
   controller_entries=[dict(path=n,deployed_path=Path(n).name,content_sha256=h) for n in p.CONTROLLERS]
   for n in p.CONTROLLERS:
    for folder in ('bin-harvest','.local/bin'):put(remote/folder,Path(n).name)
    for folder in ('bin-harvest','.openclaw/leadgen-scripts'):put(home/folder,Path(n).name)
   ack=dict(source_repo='repo',source_commit='b'*40,release_id='xian-release',observation_id='xian-observation',environment='production',target='xian-m4',files=controller_entries)
   (remote/'bin-harvest/deployment-manifest.json').write_text(json.dumps(ack))
   files={'AGENTS.md':h,'skills/workflow-commander/SKILL.md':h}
   for name in files:put(runtime,name);put(workspace,name)
   releases={'release':{'workflows':{'one':{'snapshot_sha256':h}}}}
   (runtime/'runtime-manifest.json').write_text(json.dumps(dict(protocol='commander-v2',files=files,releases=releases,runtime_snapshot_sha256=hashlib.sha256(json.dumps(files,sort_keys=True,separators=(',',':')).encode()).hexdigest())))
   paths=list(p.ATTACHMENTS+p.CONTROLLERS)+['services/phone-adb-controller/commander/'+name for name in files]
   spec=dict(manifest=dict(source_repo='repo',source_commit='b'*40,files=[dict(path=n,deployed_path='component:'+n,content_sha256=h) for n in paths]),local_manifest=dict(files=controller_entries),commander_files=files,commander_releases=releases,xian_ack=ack)
   work_info=dict(source='openclaw-workspace',eligible=True,modelVisible=True,filePath=str(workspace/'skills/workflow-commander/SKILL.md'))
   def call(args,**kwargs):
    if args[0]=='openclaw':
     if 'work-commander' in args:return json.dumps(work_info).encode()
     return json.dumps(dict(source='openclaw-managed',eligible=True,modelVisible=True,baseDir=str(package/'.agents/skills/multi-platform-publish'),filePath=str(package/p.ATTACHMENTS[0]))).encode()
    code=shlex.split(args[-1])[2]
    return original([sys.executable,'-c',"import socket;socket.gethostname=lambda:'mac-mini-m4-xian';"+code],env=dict(os.environ,HOME=str(remote)))
   with patch.object(p.socket,'gethostname',return_value='aad17-2'),patch.object(p.subprocess,'check_output',side_effect=call):
    result=p.collect(spec,home);self.assertEqual(len(result['files']),len(paths));self.assertEqual(result['publish_readback']['installed_package_revision'],'a'*40)
    work_info['source']='openclaw-managed'
    with self.assertRaisesRegex(ValueError,'官方实际skill'):p.collect(spec,home)
    work_info['source']='openclaw-workspace';spec['xian_ack']=dict(ack,observation_id='other')
    with self.assertRaisesRegex(ValueError,'ACK'):p.collect(spec,home)

class GuardTests(unittest.TestCase):
 def test_real_kernel_lock_conflict_and_release(self):
  import subprocess,os,time,signal,sys
  guard=module('deployment-guard')
  with tempfile.TemporaryDirectory() as tmp:
   env=dict(os.environ,HOME=tmp)
   server=subprocess.Popen([sys.executable,'-u','-c',guard.SERVER],stdin=subprocess.PIPE,stdout=subprocess.PIPE,env=env)
   try:
    self.assertTrue(json.loads(server.stdout.readline())['locked'])
    second=subprocess.run([sys.executable,'-u','-c',guard.SERVER],input=b'',capture_output=True,env=env)
    self.assertNotEqual(second.returncode,0)
   finally:server.stdin.close();server.wait(timeout=5)
   third=subprocess.run([sys.executable,'-u','-c',guard.SERVER],input=b'',capture_output=True,env=env)
   self.assertEqual(third.returncode,0,third.stderr)
 def test_lost_lock_transport_terminates_deployment(self):
  import subprocess,sys,os
  guard=module('deployment-guard')
  with tempfile.TemporaryDirectory() as tmp:
   marker=Path(tmp)/'forbidden'
   transport=[sys.executable,'-u','-c',"import json,time;print(json.dumps({'locked':True,'target':'mmv'}),flush=True);time.sleep(.2)"]
   with self.assertRaisesRegex(ValueError,'锁通道丢失'):
    guard.guarded([sys.executable,'-c',"import time;from pathlib import Path;time.sleep(2);Path("+repr(str(marker))+").write_text('unexpected')"],transport=transport)
   self.assertFalse(marker.exists())

 def test_guard_termination_stops_child_before_releasing_remote_lock(self):
  import subprocess,sys,os,signal,time
  guard=module('deployment-guard')
  for signum in (signal.SIGTERM,signal.SIGHUP):
   with self.subTest(signal=signum),tempfile.TemporaryDirectory() as tmp:
    home=Path(tmp);started=home/'started';marker=home/'forbidden';driver=home/'driver.py'
    child_code="import os,time;from pathlib import Path;Path("+repr(str(started))+").write_text(str(os.getpid()));time.sleep(1.2);Path("+repr(str(marker))+").write_text('unexpected')"
    guard_path=Path(guard.__file__)
    driver.write_text("import importlib.util,sys;spec=importlib.util.spec_from_file_location('guard',"+repr(str(guard_path))+");g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g);sys.exit(g.guarded([sys.executable,'-c',"+repr(child_code)+"],transport=[sys.executable,'-u','-c',g.SERVER]))")
    proc=subprocess.Popen([sys.executable,str(driver)],env=dict(os.environ,HOME=tmp),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    child_pid=None
    try:
     deadline=time.monotonic()+5
     while not started.exists() and time.monotonic()<deadline:time.sleep(.02)
     self.assertTrue(started.exists());child_pid=int(started.read_text());proc.send_signal(signum);proc.wait(timeout=7)
     time.sleep(1.4)
     self.assertFalse(marker.exists(),'guard已退出但部署子进程继续写入')
     retry=subprocess.run([sys.executable,'-u','-c',guard.SERVER],input=b'',capture_output=True,env=dict(os.environ,HOME=tmp),timeout=5)
     self.assertEqual(retry.returncode,0,retry.stderr)
    finally:
     if proc.poll() is None:proc.kill();proc.wait()
     if child_pid:
      try:os.killpg(child_pid,signal.SIGKILL)
      except ProcessLookupError:pass

if __name__=='__main__':unittest.main()

#!/usr/bin/env python3
"""Actions与任意调用机共享MMV上的内核部署锁；SSH失联则终止本次部署。"""
import fcntl,json,os,selectors,shlex,signal,stat,subprocess,sys,time
from pathlib import Path
SERVER = r'''
import fcntl,json,os,sys
from pathlib import Path
root=Path.home()/'.openclaw/commander';root.mkdir(parents=True,exist_ok=True)
fd=os.open(root/'.deployment.lock',os.O_RDWR|os.O_CREAT|getattr(os,'O_NOFOLLOW',0),0o600)
try:
 fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
 print(json.dumps({'locked':True,'target':'mmv'}),flush=True)
 sys.stdin.buffer.read()
finally:os.close(fd)
'''

def inherited():
 fd=int(os.environ['WF_DEPLOY_LOCK_FD']);info=os.fstat(fd)
 if not stat.S_ISFIFO(info.st_mode) or os.environ.get('WF_DEPLOY_LOCK_INODE')!=str(info.st_ino):raise ValueError('部署锁传输FD身份不符')

def guarded(argv, transport=None):
 command=transport or ['ssh','-T','-o','BatchMode=yes','-o','ConnectTimeout=10','mmv','python3 -u -c '+shlex.quote(SERVER)]
 lease=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE)
 child=None
 try:
  with selectors.DefaultSelector() as selector:
   selector.register(lease.stdout,selectors.EVENT_READ)
   if not selector.select(15):raise ValueError('MMV部署锁握手超时')
   line=lease.stdout.readline(4096)
  if not line or json.loads(line)!=dict(locked=True,target='mmv'):raise ValueError('另一部署持锁或MMV锁通道失败')
  fd=lease.stdin.fileno();env=dict(os.environ,WF_DEPLOY_LOCK_FD=str(fd),WF_DEPLOY_LOCK_INODE=str(os.fstat(fd).st_ino))
  child=subprocess.Popen(argv,env=env,pass_fds=(fd,),start_new_session=True)
  while child.poll() is None:
   if lease.poll() is not None:raise ValueError('MMV部署锁通道丢失，终止部署')
   time.sleep(0.1)
  if lease.poll() is not None:raise ValueError('部署完成前MMV锁丢失')
  return child.returncode
 finally:
  if child and child.poll() is None:
   os.killpg(child.pid,signal.SIGTERM)
   try:child.wait(timeout=5)
   except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()
  lease.stdin.close()
  try:lease.wait(timeout=5)
  except subprocess.TimeoutExpired:lease.kill();lease.wait()

if __name__=='__main__':
 try:
  if sys.argv[1]=='check':inherited()
  else:sys.exit(guarded(sys.argv[1:]))
 except (ValueError,OSError,KeyError) as error:print(str(error),file=sys.stderr);sys.exit(2)

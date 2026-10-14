#!/usr/bin/env python3
"""同line原目录锁的内核互斥与死owner恢复；不按TTL抢锁，不清未知旧目录。"""
import os,sys,json,socket,stat,fcntl,uuid
root,line,parent,token=sys.argv[1:];parent=int(parent)
if not line or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in line):sys.exit(2)
os.makedirs(root,mode=0o700,exist_ok=True)
lock=os.path.join(root,line+'.lock');guard=os.path.join(root,line+'.guard');owner_path=os.path.join(lock,'owner.json');held=False
fd=os.open(guard,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
def read_owner():
 s=os.lstat(owner_path)
 if not stat.S_ISREG(s.st_mode) or s.st_size>4096 or stat.S_IMODE(s.st_mode)!=0o600:raise ValueError('unknown owner')
 with open(owner_path,'r') as f:return json.load(f)
try:
 try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:sys.exit(3)
 if os.path.lexists(lock):
  if not stat.S_ISDIR(os.lstat(lock).st_mode):sys.exit(3)
  try:
   old=read_owner()
   if old.get('version')!=1 or old.get('line')!=line or old.get('host')!=socket.gethostname() or type(old.get('pid')) is not int or old['pid']<=1 or not isinstance(old.get('token'),str) or str(uuid.UUID(old['token']))!=old['token'] or os.listdir(lock)!=['owner.json']:sys.exit(3)
   try:os.kill(old['pid'],0)
   except ProcessLookupError:pass
   else:sys.exit(3)
   if read_owner()!=old:sys.exit(3)
   os.unlink(owner_path);os.rmdir(lock)
  except (OSError,ValueError,TypeError):sys.exit(3)
 os.mkdir(lock,0o700)
 owner={'version':1,'line':line,'host':socket.gethostname(),'pid':parent,'token':token}
 try:
  with os.fdopen(os.open(owner_path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600),'w') as f:json.dump(owner,f);f.flush();os.fsync(f.fileno())
 except Exception:os.rmdir(lock);raise
 held=True;print('ORDER_LOCK_READY',flush=True)
 sys.stdin.buffer.read() # 父进程exit/kill时pipe EOF；仅释放本token，内核guard自行释放。
finally:
 if held:
  try:
   if read_owner()!=owner:raise ValueError('owner changed')
   os.unlink(owner_path);os.rmdir(lock)
  except Exception:
   print('ORDER_LOCK_RELEASE_UNKNOWN',file=sys.stderr);os.close(fd);sys.exit(4)
 os.close(fd)

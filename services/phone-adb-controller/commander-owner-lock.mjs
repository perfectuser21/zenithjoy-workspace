// Parent and helper share one open file description. Neither PID liveness nor
// Node's cached child state authorizes a commit: the flock holder executes it.
import {spawn} from 'node:child_process';
import {openSync,closeSync,lstatSync,fstatSync,constants} from 'node:fs';
const helper=String.raw`
import os,sys,fcntl,stat,json,hashlib,re
p=sys.argv[1]; pending=p[:-6]; f=3
s=os.fstat(f)
def private(path):
 t=os.lstat(path)
 if not stat.S_ISDIR(t.st_mode) or t.st_uid!=os.getuid() or t.st_mode&0o022: raise RuntimeError('private directory changed')
 return (t.st_dev,t.st_ino)
directories=[os.path.dirname(p),os.path.dirname(os.path.dirname(p))]
identities=[private(x) for x in directories]
def held():
 t=os.lstat(p)
 if not stat.S_ISREG(t.st_mode) or t.st_uid!=os.getuid() or t.st_mode&0o077 or (s.st_dev,s.st_ino)!=(t.st_dev,t.st_ino): raise RuntimeError('guard changed')
 if identities!=[private(x) for x in directories]: raise RuntimeError('directory changed')
if not stat.S_ISREG(s.st_mode) or s.st_uid!=os.getuid() or s.st_mode&0o077: raise RuntimeError('unsafe guard')
fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB); held()
def digest(raw): return hashlib.sha256(raw).hexdigest()
def view():
 fd=os.open(pending,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  t=os.fstat(fd); raw=os.read(fd,16385); a=os.fstat(fd); path=os.lstat(pending)
  if not stat.S_ISREG(t.st_mode) or t.st_uid!=os.getuid() or t.st_mode&0o077 or t.st_nlink!=1 or len(raw)!=t.st_size or len(raw)>16384 or (t.st_dev,t.st_ino,t.st_ctime_ns,t.st_size)!=(a.st_dev,a.st_ino,a.st_ctime_ns,a.st_size) or (t.st_dev,t.st_ino)!=(path.st_dev,path.st_ino): raise RuntimeError('pending changed')
  return raw,{'dev':t.st_dev,'ino':t.st_ino,'size':t.st_size,'ctime_ns':str(t.st_ctime_ns)}
 finally: os.close(fd)
def write_new(path,raw):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:
  with os.fdopen(fd,'wb',closefd=False) as out: out.write(raw); out.flush(); os.fsync(fd)
 finally: os.close(fd)
def commit(q):
 held(); op=q['op']
 if op=='check': return {'held':True}
 if op=='reserve':
  raw=q['raw'].encode(); record=json.loads(raw)
  if len(raw)>16384 or record.get('protocol')!='commander-owner-turn-v1' or record.get('status')!='reserved' or record.get('session')!='agent:work-commander:'+os.path.basename(pending)[:-13]: raise RuntimeError('reservation invalid')
  write_new(pending,raw); data,identity=view(); return {'identity':identity,'sha256':digest(data)}
 if op not in ('returned','not_started','reconciled_inactive'): raise RuntimeError('unknown operation')
 raw,identity=view(); expected=q['expected']; record=json.loads(raw)
 if identity!=expected['identity'] or digest(raw)!=expected['sha256'] or record.get('status')!='reserved' or record.get('protocol')!='commander-owner-turn-v1': raise RuntimeError('pending CAS changed')
 nonce=record.get('transport_nonce','')
 if not re.fullmatch('[a-f0-9-]{36}',nonce): raise RuntimeError('nonce invalid')
 receipt=q['receipt_json'].encode(); body=json.loads(receipt)
 if body.get('status')!=op or body.get('original_sha256')!=digest(raw): raise RuntimeError('receipt invalid')
 if op=='reconciled_inactive':
  attempt=q['archive_id']
  if not re.fullmatch('[a-f0-9-]{36}',attempt) or body.get('original')!=record or body.get('business_result')!='unknown': raise RuntimeError('reconcile receipt invalid')
  archive=pending+'.'+nonce+'.'+attempt+'.reconciled_inactive'; os.mkdir(archive,0o700)
  original=os.path.join(archive,'original.pending.json'); target=os.path.join(archive,'receipt.json')
 else:
  if any(body.get(k)!=record.get(k) for k in ('session','run_id','binding_id','source_commit','task_id','rpc_readback_nonce','transport_nonce')): raise RuntimeError('receipt scope changed')
  target=pending+'.'+nonce+'.'+op+'.json'; original=pending+'.'+nonce+'.'+op+'.original.json'
  if os.path.lexists(original): raise RuntimeError('original archive exists')
 write_new(target,receipt)
 # The process performing this compare and rename itself owns flock. If it dies
 # before rename, pending remains; after rename, exact original + receipt remain.
 held(); final,identity_after=view()
 if identity_after!=identity or final!=raw: raise RuntimeError('pending CAS changed')
 os.rename(pending,original)
 return {'original_path':original,'receipt_path':target,'receipt_sha256':digest(receipt)}
print(json.dumps({'ready':True,'identity':{'dev':s.st_dev,'ino':s.st_ino}}),flush=True)
for line in iter(lambda:sys.stdin.buffer.readline(4*1024*1024+1),b''):
 if len(line)>4*1024*1024 or not line.endswith(b'\n'): raise RuntimeError('command too large')
 q=json.loads(line)
 try: result={'id':q['id'],'ok':True,'result':commit(q)}
 except Exception: result={'id':q.get('id'),'ok':False}
 print(json.dumps(result),flush=True)
`;
const unknown=()=>Object.assign(Error('COMMANDER_OWNER_TURN_UNRESOLVED'),{executionStopped:false});
export async function acquireOwnerLock(file){
 const guard=file+'.guard',fd=openSync(guard,constants.O_RDWR|constants.O_CREAT|constants.O_NOFOLLOW,0o600),stat=fstatSync(fd);
 if(!stat.isFile()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0){closeSync(fd);throw unknown();}
 const child=spawn('/usr/bin/python3',['-I','-c',helper,guard],{stdio:['pipe','pipe','pipe',fd]});
 let output='',identity,closed=false,nextId=0,readyResolve,readyReject;const waiting=new Map();
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const lost=()=>{readyReject(unknown());for(const p of waiting.values())p.reject(unknown());waiting.clear();};
 child.stdin.on('error',lost);child.on('error',lost);
 const ended=new Promise(resolve=>child.once('close',(code,signal)=>{lost();resolve({code,signal});}));
 child.stderr.on('data',()=>{});
 child.stdout.on('data',b=>{
  output+=b.toString();if(output.length>4096){lost();child.stdin.end();return;}
  while(output.includes('\n')){
   const i=output.indexOf('\n'),line=output.slice(0,i);output=output.slice(i+1);
   try{
    const q=JSON.parse(line);
    if(!identity){if(q.ready!==true)throw unknown();identity=q.identity;readyResolve(identity);}
    else{const p=waiting.get(q.id);if(!p)throw unknown();waiting.delete(q.id);q.ok===true?p.resolve(q.result):p.reject(unknown());}
   }catch{lost();child.stdin.end();}
  }
 });
 const release=async()=>{if(!closed){closed=true;child.stdin.end();await ended;closeSync(fd);}};
 try{
  const timer=setTimeout(()=>readyReject(unknown()),5000);
  try{await ready;}finally{clearTimeout(timer);}
  release.assertHeld=()=>{const current=lstatSync(guard);if(closed||child.exitCode!==null||child.signalCode!==null||child.stdin.destroyed||!current.isFile()||current.isSymbolicLink()||current.uid!==process.getuid()||(current.mode&0o077)!==0||current.dev!==identity.dev||current.ino!==identity.ino)throw unknown();};
  release.command=(op,body={})=>{
   if(closed||waiting.size)return Promise.reject(unknown());
   const id=++nextId,raw=JSON.stringify({...body,id,op})+'\n';if(Buffer.byteLength(raw)>4*1024*1024)return Promise.reject(unknown());
   return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{waiting.delete(id);reject(unknown());child.stdin.end();},5000);waiting.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});child.stdin.write(raw,error=>{if(error){const p=waiting.get(id);waiting.delete(id);p?.reject(unknown());}});});
  };
  release.pid=child.pid;release.assertHeld();return release;
 }catch(error){await release();throw error;}
}

// A kernel lock is held by this parent's private pipe, not by a PID/TTL lease.
// Parent death closes stdin; fcntl then releases without deleting the guard inode.
import {spawn} from 'node:child_process';
import {lstatSync} from 'node:fs';
const helper=String.raw`
import os,sys,fcntl,stat,json
p=sys.argv[1]
f=os.open(p,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
s=os.fstat(f)
if not stat.S_ISREG(s.st_mode) or s.st_uid!=os.getuid() or s.st_mode&0o077: raise RuntimeError('unsafe guard')
fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
t=os.lstat(p)
if (s.st_dev,s.st_ino)!=(t.st_dev,t.st_ino): raise RuntimeError('guard replaced')
print(json.dumps({'dev':s.st_dev,'ino':s.st_ino}),flush=True)
sys.stdin.buffer.read()
`;
export async function acquireOwnerLock(file){
 const guard=file+'.guard',child=spawn('/usr/bin/python3',['-I','-c',helper,guard],{stdio:['pipe','pipe','pipe']});
 child.stdin.on('error',()=>{});
 let output='',errors='',settled=false;
 const ended=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
 const release=async()=>{child.stdin.end();await ended;};
 try{
  const identity=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{child.stdin.end();reject(Error('COMMANDER_OWNER_TURN_UNRESOLVED'));},5000);
   const done=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
   child.once('error',()=>done(Error('COMMANDER_OWNER_TURN_UNRESOLVED')));
   child.once('close',()=>done(Error('COMMANDER_OWNER_TURN_UNRESOLVED')));
   child.stderr.on('data',b=>{errors+=b.toString();if(errors.length>4096)child.stdin.end();});
   child.stdout.on('data',b=>{output+=b.toString();if(output.length>1024)return done(Error('COMMANDER_OWNER_TURN_UNRESOLVED'));if(output.includes('\n')){try{done(null,JSON.parse(output));}catch{done(Error('COMMANDER_OWNER_TURN_UNRESOLVED'));}}});
  });
  const s=lstatSync(guard);if(!s.isFile()||s.isSymbolicLink()||s.dev!==identity.dev||s.ino!==identity.ino)throw Error('COMMANDER_OWNER_TURN_UNRESOLVED');
  release.assertHeld=()=>{const current=lstatSync(guard);if(child.exitCode!==null||child.signalCode!==null||child.stdin.destroyed||!current.isFile()||current.isSymbolicLink()||current.uid!==process.getuid()||(current.mode&0o077)!==0||current.dev!==identity.dev||current.ino!==identity.ino)throw Error('COMMANDER_OWNER_TURN_UNRESOLVED');};
  release.pid=child.pid;release.assertHeld();return release;
 }catch(error){await release();throw error;}
}

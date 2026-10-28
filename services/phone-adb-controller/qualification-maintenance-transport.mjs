import {spawn} from 'node:child_process';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
const error=()=>Error('MAINTENANCE_HOST_UNKNOWN');
const need=x=>{if(!x)throw error();};
export const CANDIDATE_BYTES_READER=String.raw`import base64,hashlib,json,os,pathlib,socket,stat,sys
root=pathlib.Path(sys.argv[1]);assert root.is_absolute() and root.resolve(strict=True)==root
total=0
def read(relative):
 global total
 assert isinstance(relative,str) and not relative.startswith('/') and all(p and p not in ('.','..') for p in relative.split('/'))
 path=root
 for piece in relative.split('/'):
  path=path/piece;s=path.lstat();assert not stat.S_ISLNK(s.st_mode) and s.st_uid==os.getuid() and s.st_mode&0o022==0
 before=path.stat();assert stat.S_ISREG(before.st_mode) and before.st_size<=8*1024*1024
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  a=os.fstat(fd);assert (a.st_dev,a.st_ino)==(before.st_dev,before.st_ino)
  with os.fdopen(os.dup(fd),'rb') as f:raw=f.read(8*1024*1024+1)
  b=os.fstat(fd);c=path.lstat();assert (a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns)==(b.st_dev,b.st_ino,b.st_size,b.st_mtime_ns)==(c.st_dev,c.st_ino,c.st_size,c.st_mtime_ns)
 finally:os.close(fd)
 total+=len(raw);assert len(raw)<=8*1024*1024 and total<=64*1024*1024
 return raw
raw=read('deployment-manifest.json');manifest=json.loads(raw);seen=set();files=[]
assert isinstance(manifest.get('files'),list) and 0<len(manifest['files'])<=1024
for item in manifest['files']:
 path=item['deployed_path'];assert path not in seen;seen.add(path)
 assert hashlib.sha256(read(path)).hexdigest()==item['content_sha256'];files.append(item)
assert read('deployment-manifest.json')==raw
print(json.dumps({'manifest_raw':base64.b64encode(raw).decode(),'observed':{'source_repo':manifest['source_repo'],'source_commit':manifest['source_commit'],'files':files,'observed_hostname':socket.gethostname()}}))
`;
export function candidateRuntimeRoot(target,sha) {
 need(['mmv','xian-m4'].includes(target)&&/^[a-f0-9]{40}$/.test(sha||''));
 return join(target==='mmv'?homedir():'/Users/jinnuoshengyuan','.local/share/zenithjoy/phone-candidates',sha,'runtime');
}
// 输入仅服务自己构造的固定opcode；不提供generic shell/代码执行接口。
export async function openMaintenancePeer(child,init,{timeoutMs=30000}={}) {
 let pending,closed=false,bytes=0,stderrBytes=0;
 const failed=()=>{if(pending){const p=pending;pending=null;clearTimeout(p.timer);p.reject(error());}};
 child.on('error',failed);child.on('exit',()=>{closed=true;failed();});
 child.stderr.on('data',b=>{stderrBytes+=b.length;if(stderrBytes>65536)failed();});
 const lines=createInterface({input:child.stdout});
 lines.on('line',line=>{
  bytes+=Buffer.byteLength(line);if(bytes>24*1024*1024||!pending){failed();child.stdin.end();return;}
  const p=pending;pending=null;clearTimeout(p.timer);
  try{p.resolve(JSON.parse(line));}catch{p.reject(error());}
 });
 const request=input=>new Promise((resolve,reject)=>{
  if(closed||pending){reject(error());return;}
  const timer=setTimeout(()=>{failed();child.stdin.end();},timeoutMs);
  pending={resolve,reject,timer};child.stdin.write(JSON.stringify(input)+'\n',e=>{if(e)failed();});
 });
 try{
  const identity=await request(init);
  need(identity.status==='guard_held'&&Number.isInteger(identity.pid)&&identity.pid>1
   &&typeof identity.start_identity==='string'&&/^\d+(?::\d+)?$/.test(identity.start_identity)
   &&Number.isInteger(identity.uid)&&/^[a-f0-9]{64}$/.test(identity.script_sha256||''));
  return {identity,request,close:async()=>{
   if(closed)return;
   const done=new Promise(resolve=>child.once('exit',resolve));child.stdin.end();
   let timer;try{await Promise.race([done,new Promise((_,reject)=>{timer=setTimeout(()=>reject(error()),10000);})]);}
   finally{clearTimeout(timer);lines.close();}
  }};
 }catch(e){child.stdin.end();lines.close();throw e;}
}
export function openMaintenanceGuard(scope) {
 const root=candidateRuntimeRoot('xian-m4',scope.maintenance_source.commit);
 // 字符串只含上面固定home和验证过的SHA；shell不插入scope或任意路径。
 const command='exec /opt/homebrew/bin/python3 -B -I '+root+'/qualification-maintenance-host.py';
 const child=spawn('/usr/bin/ssh',['-T','-o','BatchMode=yes','-o','ConnectTimeout=10','xian-m4',command],{stdio:['pipe','pipe','pipe']});
 return openMaintenancePeer(child,{serial:scope.serial,profile:scope.profile,owner:scope.local_owner,deadline_seconds:300});
}
export async function collectRemoteMaintenanceCandidate(sha) {
 const root=candidateRuntimeRoot('xian-m4',sha);
 const child=spawn('/usr/bin/ssh',['-T','-o','BatchMode=yes','-o','ConnectTimeout=10','xian-m4',
  'exec /opt/homebrew/bin/python3 -B -I - '+root],{stdio:['pipe','pipe','pipe']});
 return new Promise((resolve,reject)=>{
  let raw='',size=0;const timer=setTimeout(()=>{child.stdin.destroy();child.stdout.destroy();reject(error());},40000);
  child.stdout.on('data',b=>{size+=b.length;if(size>24*1024*1024){child.stdout.destroy();reject(error());}else raw+=b;});
  child.stderr.resume();child.on('error',()=>{clearTimeout(timer);reject(error());});
  child.on('close',code=>{clearTimeout(timer);try{need(code===0);resolve(JSON.parse(raw));}catch{reject(error());}});
  child.stdin.end(CANDIDATE_BYTES_READER);
 });
}

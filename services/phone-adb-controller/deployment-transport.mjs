// SSH只传固定helper和JSON。工具目录与运行目录分离，任何执行前重新校验完整工具闭包。
import {realpathSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {readDeploymentSource} from './deployment-fixed-source.mjs';
import {digest} from './runtime-definition.mjs';
export const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const TOOLS=['transaction','maintenance','candidate-fence','effects','service','host'].map(n=>'deployment-'+n+'.py').concat(['install-phone-recovery.sh','input-runtime-release.py','phone-lock-root.py']);
const run=(host,code,args,input)=>execFileSync('ssh',['-T','-o','BatchMode=yes','-o','ConnectTimeout=15',host,
 'python3 -c '+quote(code)+' '+args.map(quote).join(' ')],{input:input===undefined?undefined:JSON.stringify(input),encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024});
const BASE=String.raw`import os,sys,json,hashlib,pwd,re,tempfile,runpy
from pathlib import Path
home=Path(pwd.getpwuid(os.getuid()).pw_dir).resolve();sha=sys.argv[1]
assert re.fullmatch('[a-f0-9]{40}',sha)
root=home/'.local/share/zenithjoy/phone-deploy-tools'/sha
for p in [root,*root.parents]:assert not p.is_symlink()
def sync(p):
 fd=os.open(p,os.O_RDONLY)
 try:os.fsync(fd)
 finally:os.close(fd)
def atomic(p,b):
 fd,n=tempfile.mkstemp(prefix='.fixed-tool-',dir=p.parent)
 try:
  with os.fdopen(fd,'wb') as f:f.write(b);f.flush();os.fchmod(f.fileno(),0o600);os.fsync(f.fileno())
  os.replace(n,p);sync(p.parent)
 finally:
  if os.path.exists(n):os.unlink(n)
`;
const INSTALL=BASE+String.raw`
import base64
x=json.load(sys.stdin);assert set(x)=={'files'} and 0<len(x['files'])<=20
missing=[];p=root
while not p.exists():missing.append(p);p=p.parent
for p in reversed(missing):p.mkdir(mode=0o700);sync(p);sync(p.parent)
manifest={}
for name,value in x['files'].items():
 assert re.fullmatch('[a-z][a-z0-9-]+[.](py|sh)',name)
 b=base64.b64decode(value['bytes'],validate=True);h=hashlib.sha256(b).hexdigest();assert h==value['sha256'] and len(b)<262144
 p=root/name;assert not p.is_symlink()
 if p.exists():assert p.read_bytes()==b,'immutable deployment helper changed'
 else:atomic(p,b)
 manifest[name]=h
p=root/'manifest.json';raw=json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()
if p.exists():assert not p.is_symlink() and p.read_bytes()==raw,'immutable deployment helper manifest changed'
else:atomic(p,raw)
print(json.dumps({'home':str(home),'root':str(root),'source_commit':sha,'files':manifest}))
`;
const EXECUTE=BASE+String.raw`
p=root/'manifest.json';assert not p.is_symlink();manifest=json.loads(p.read_bytes())
for name,h in manifest.items():
 assert re.fullmatch('[a-z][a-z0-9-]+[.](py|sh)',name)
 p=root/name;assert not p.is_symlink() and p.is_file() and hashlib.sha256(p.read_bytes()).hexdigest()==h,'deployment tool drift'
name=sys.argv[2];assert name in manifest
sys.argv=[str(root/name),*sys.argv[3:]]
if name.endswith('.py'):runpy.run_path(str(root/name),run_name='__main__')
else:
 import subprocess
 assert name=='install-phone-recovery.sh' and sys.argv[1:]==['xian-m4','--render']
 subprocess.run(['/bin/bash',*sys.argv],check=True)
`;
export function stageTools(root,sha){
 const files=Object.fromEntries(TOOLS.map(name=>{const bytes=readDeploymentSource(root,sha,'services/phone-adb-controller/'+name);return[name,{bytes:bytes.toString('base64'),sha256:digest(bytes)}];}));
 return Object.fromEntries(['xian-m4','mmv'].map(host=>[host,JSON.parse(run(host,INSTALL,[sha],{files}))]));
}
export function deploymentTransport(sha){
 if(!/^[a-f0-9]{40}$/.test(sha))throw Error('invalid deployment transport SHA');
 return {
  call(host,name,action,transaction,input){
   if(!['mmv','xian-m4'].includes(host)||!TOOLS.includes(name))throw Error('invalid deployment transport target');
   return JSON.parse(run(host,EXECUTE,[sha,name,action,...(transaction?[transaction]:[])],input));
  },
  renderService(){return run('xian-m4',EXECUTE,[sha,'install-phone-recovery.sh','xian-m4','--render']);}
 };
}

if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
 try{
  const [sha,host,name,action,transaction]=process.argv.slice(2);
  const raw=readFileSync(0,'utf8');
  const result=deploymentTransport(sha).call(host,name,action,transaction,raw.trim()?JSON.parse(raw):undefined);
  process.stdout.write(JSON.stringify(result)+'\n');
 }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}

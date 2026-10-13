// Local-only transport for the paired input deployment smoke. Other deployment
// commands retain the existing record-only stub; only this pair is executed and verified.
import {appendFileSync,copyFileSync,existsSync,mkdirSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {basename,join,resolve} from 'node:path';
import {spawnSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const self=fileURLToPath(import.meta.url);
const digest=b=>createHash('sha256').update(b).digest('hex');
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const paths=root=>({stage:join(root,'input-runtime-deploy.fixture'),home:join(root,'remote'),registry:join(root,'remote/registry.tsv'),locks:join(root,'remote/locks'),receipt:join(root,'pair-receipt.json')});
export function prepare(root){
 root=resolve(root);const p=paths(root);
 for(const d of [root,p.stage,p.home,join(p.home,'bin-harvest'),join(p.home,'.local/bin'),p.locks])mkdirSync(d,{recursive:true,mode:0o700});
 writeFileSync(p.registry,'profile\tserial\tmodel\nlegacy\tSER1\tm\na\tSER2\tm\nb\tSER3\tm\nc\tSER4\tm\n');
 for(const serial of ['SER1','SER2','SER3','SER4'])writeFileSync(join(p.locks,serial+'.guard'),'');
 for(const mode of ['ssh','scp'])writeFileSync(join(root,mode),`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(self)} transport ${quote(root)} ${mode} "$@"\n`,{mode:0o700});
 return p;
}
export function transport(root,mode,args){
 root=resolve(root);const p=paths(root);const ok=stdout=>({status:0,stdout:stdout||'',stderr:''});
 try{
  if(mode==='scp'){
   appendFileSync(join(root,'scp.log'),args.join('\n')+'\n');const target=args.at(-1);
   if(target.startsWith(`xian-m4:${p.stage}`)){
    const destination=target.slice('xian-m4:'.length);
    const sources=args.slice(0,-1).filter(a=>!a.startsWith('-'));
    if(![p.stage+'/',join(p.stage,'input-runtime-release.py')].includes(destination))throw Error('unexpected paired upload destination');
    for(const source of sources){
     const name=basename(source);if(!['input-runtime-release.py','douyin-phone-adb','text-input-focus.py'].includes(name))throw Error('unexpected paired source');
     copyFileSync(source,join(p.stage,name));
    }
   }
   return ok(); // Legacy, unrelated deployment uploads remain record-only.
  }
  if(mode!=='ssh')throw Error('unknown transport');
  appendFileSync(join(root,'ssh.log'),args.join(' ')+'\n');const [host,cmd]=args;
  if(host==='xian-m4'&&cmd==='mktemp -d /tmp/input-runtime-deploy.XXXXXX')return ok(p.stage+'\n');
  if(cmd?.includes(p.stage)){
   if(host!=='xian-m4')throw Error('unexpected paired host');
   if(cmd.startsWith('rm -f '))return ok(); // Retain our temporary originals until caller audit/cleanup.
   const script=join(p.stage,'input-runtime-release.py'),expected=join(p.stage,'expected.json');
   let argv;
   if(cmd===`python3 ${script} capture ~/bin-harvest ~/.local/bin > ${expected}`){
    if(existsSync(p.receipt))unlinkSync(p.receipt);
    argv=[script,'capture',join(p.home,'bin-harvest'),join(p.home,'.local/bin')];
    const r=spawnSync('python3',argv,{encoding:'utf8'});
    if(r.status===0)writeFileSync(expected,r.stdout);
    return {status:r.status??2,stdout:'',stderr:r.stderr||''};
   }
   if(existsSync(p.receipt))unlinkSync(p.receipt);
   if(cmd!==`python3 ${script} install ${p.stage}/douyin-phone-adb ${p.stage}/text-input-focus.py ${expected} ~/.config/openclaw/douyin-phone-profiles.tsv /private/tmp/openclaw-phone/locks ~/bin-harvest ~/.local/bin`)throw Error('unexpected paired install command/destination');
   argv=[script,'install',join(p.stage,'douyin-phone-adb'),join(p.stage,'text-input-focus.py'),expected,p.registry,p.locks,join(p.home,'bin-harvest'),join(p.home,'.local/bin')];
   const r=spawnSync('python3',argv,{encoding:'utf8'});
   if(r.status===0){
    // Receipt exists only after the real source/revision/CAS/kernel guard and pair readback.
    const hashes=Object.fromEntries(['douyin-phone-adb','text-input-focus.py'].map(n=>[n,digest(readFileSync(join(p.stage,n)))]));
    writeFileSync(p.receipt,JSON.stringify({status:'verified',host,remote_dirs:['~/bin-harvest','~/.local/bin'],hashes,installer_result:JSON.parse(r.stdout)}));
   }
   return {status:r.status??2,stdout:r.stdout||'',stderr:r.stderr||''};
  }
  return ok(); // No real SSH invocation or execution of unrelated remote shell text.
 }catch(e){return {status:2,stdout:'',stderr:e.message+'\n'};}
}
export function verify(root){
 const p=paths(resolve(root));if(!existsSync(p.receipt))throw Error('paired deployment not verified');
 const receipt=JSON.parse(readFileSync(p.receipt,'utf8'));
 if(receipt.status!=='verified'||receipt.host!=='xian-m4'||JSON.stringify(receipt.remote_dirs)!==JSON.stringify(['~/bin-harvest','~/.local/bin']))throw Error('paired deployment not verified');
 for(const dir of ['bin-harvest','.local/bin'])for(const name of ['douyin-phone-adb','text-input-focus.py']){
  if(digest(readFileSync(join(p.home,dir,name)))!==receipt.hashes[name])throw Error('paired runtime readback mismatch');
 }
 return receipt;
}
if(process.argv[1]&&resolve(process.argv[1])===self){
 try{
  const [command,root,mode,...args]=process.argv.slice(2);
  if(command==='prepare')prepare(root);
  else if(command==='verify')console.log(JSON.stringify(verify(root)));
  else if(command==='transport'&&mode==='ssh'&&args.at(-1)?.startsWith('python3 -u -c ')){
   // 执行真实内核部署锁与流式握手，HOME指向隔离远端目录。
   const child=spawn('sh',['-c',args.at(-1)],{stdio:'inherit',env:{...process.env,HOME:paths(resolve(root)).home}});
   process.exitCode=await new Promise(r=>child.on('close',r));
  }
  else if(command==='transport'){const r=transport(root,mode,args);process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exitCode=r.status;}
  else throw Error('unknown fixture operation');
 }catch(e){console.error(e.message);process.exitCode=2;}
}

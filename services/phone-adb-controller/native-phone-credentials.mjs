// Code-only fixed credential readers. Neither a Worker path nor an environment
// fallback can select a file. Secret bytes are never returned in metadata.
import {readSync,openSync,closeSync,fstatSync,lstatSync,realpathSync,constants} from 'node:fs';
import {join} from 'node:path';import {userInfo} from 'node:os';import {createHash} from 'node:crypto';
const keys=Object.freeze({openrouter:'OPENROUTER_API_KEY',dashscope:'DASHSCOPE_API_KEY'}),sha=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>Object.assign(Error('NATIVE_PHONE_CREDENTIAL'),{code:'NATIVE_PHONE_CREDENTIAL'});
export function createNativePhoneCredentialReader({provider,frozen}={}){
 try{
  if(!Object.hasOwn(keys,provider))throw fail();
  const home=realpathSync(userInfo().homedir),folder=join(home,'.credentials'),path=join(folder,provider+'.env'),descriptor=structuredClone(frozen?.collection_phone_scope?.credentials?.[provider]);
  if(!descriptor||Object.keys(descriptor).sort().join(',')!=='path,sha256'||descriptor.path!==path||!/^[a-f0-9]{64}$/.test(descriptor.sha256||''))throw fail();
  function read(){let fd;try{
   if(realpathSync(userInfo().homedir)!==home||realpathSync(folder)!==folder)throw fail();
   const directory=lstatSync(folder);if(!directory.isDirectory()||directory.isSymbolicLink()||directory.uid!==process.getuid()||(directory.mode&0o077))throw fail();
   fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const a=fstatSync(fd);
   if(!a.isFile()||a.uid!==process.getuid()||(a.mode&0o777)!==0o600||a.nlink!==1||a.size<1||a.size>65536)throw fail();
   const buffer=Buffer.alloc(a.size+1);let n=0;while(n<buffer.length){const k=readSync(fd,buffer,n,buffer.length-n,null);if(!k)break;n+=k;}const bytes=buffer.subarray(0,n),z=fstatSync(fd),current=lstatSync(path),lastDirectory=lstatSync(folder);
   if(current.isSymbolicLink()||realpathSync(path)!==path||['dev','ino','size','mtimeMs','ctimeMs'].some(k=>a[k]!==z[k]||a[k]!==current[k])||['dev','ino','mode','uid'].some(k=>directory[k]!==lastDirectory[k])||bytes.length!==a.size||sha(bytes)!==descriptor.sha256)throw fail();
   const rows=new TextDecoder('utf-8',{fatal:true}).decode(bytes).split(/\r?\n/).map(v=>v.trim()).filter(v=>v&&!v.startsWith('#')),prefix=keys[provider]+'=',selected=rows.filter(v=>v.startsWith(prefix));
   if(selected.length!==1)throw fail();let value=selected[0].slice(prefix.length);if(value.length>=2&&((value[0]==='"'&&value.at(-1)==='"')||(value[0]==="'"&&value.at(-1)==="'")))value=value.slice(1,-1);
   if(!/^[A-Za-z0-9_.-]{8,2048}$/.test(value))throw fail();return value;
  }catch{throw fail();}finally{if(fd!==undefined)closeSync(fd);}}
  // Validate the descriptor and file before admitting the dependent domain.
  read();return read;
 }catch{throw fail();}
}

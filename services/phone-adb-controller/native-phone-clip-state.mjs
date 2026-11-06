// Code-only cache for the original clipboard nonce guard. Never bind write()
// to Worker input: the caller supplies only its independently verified shared URL.
import {constants,openSync,closeSync,readSync,writeFileSync,fsyncSync,lstatSync,fstatSync,realpathSync,mkdirSync,renameSync,readdirSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';import {randomUUID,createHash} from 'node:crypto';
const fail=code=>Object.assign(Error('NATIVE_PHONE_CLIP_STATE_'+code),{code:'NATIVE_PHONE_CLIP_STATE_'+code});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function createNativePhoneClipState({home,profile,assertResources}={}){
 if(typeof home!=='string'||resolve(home)!==home||!/^[-A-Za-z0-9_.]{1,80}$/.test(profile||'')||['.','..'].includes(profile)||typeof assertResources!=='function')throw fail('SCOPE');
 const paths=[home,join(home,'.config'),join(home,'.config','openclaw'),join(home,'.config','openclaw','locate-cache')],directory=paths.at(-1),file=join(directory,profile+'-last-clip.txt'),directories=new Map();
 let baseline,busy=false,unknown=false,reads=0,writes=0,writingTemp;
 const active=()=>{if(unknown)throw fail('UNKNOWN');};
 const directoryCheck=(path,create)=>{
  let st;try{st=lstatSync(path);}catch(error){if(error.code!=='ENOENT')throw error;if(path===home||directories.has(path))throw fail('DIRECTORY_DRIFT');if(!create)return false;mkdirSync(path,{mode:0o700});const parent=openSync(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(parent);}finally{closeSync(parent);}st=lstatSync(path);}
  if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o022)||realpathSync(path)!==path)throw fail('DIRECTORY');
  const pinned=directories.get(path);if(pinned&&(pinned.dev!==st.dev||pinned.ino!==st.ino))throw fail('DIRECTORY_DRIFT');directories.set(path,{dev:st.dev,ino:st.ino});return true;
 };
 const chain=create=>{for(let index=0;index<paths.length;index++)if(!directoryCheck(paths[index],create&&index>0))return false;return true;};
 const regular=st=>st.isFile()&&st.uid===process.getuid()&&st.nlink===1&&!(st.mode&0o022)&&st.size<=4096;
 const fingerprint=(st,bytes)=>({dev:st.dev,ino:st.ino,size:st.size,mtime:st.mtimeMs,ctime:st.ctimeMs,mode:st.mode,sha256:sha(bytes)});
 const same=(left,right)=>JSON.stringify(left?.identity??null)===JSON.stringify(right?.identity??null);
 function capture(){
  if(!chain(false))return {identity:null,bytes:Buffer.alloc(0)};
  if(readdirSync(directory).some(name=>name.startsWith('.'+profile+'-last-clip.')&&name.endsWith('.tmp')&&name!==writingTemp))throw fail('PENDING_WRITE');
  let before;try{before=lstatSync(file);}catch(error){if(error.code==='ENOENT')return {identity:null,bytes:Buffer.alloc(0)};throw error;}
  if(before.isSymbolicLink()||!regular(before))throw fail('FILE');
  let fd;try{
   fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);const opened=fstatSync(fd);
   if(!regular(opened)||opened.dev!==before.dev||opened.ino!==before.ino)throw fail('FILE_DRIFT');
   const buffer=Buffer.alloc(4096);let length=0;while(length<buffer.length){const count=readSync(fd,buffer,length,buffer.length-length,null);if(count===0)break;length+=count;}
   if(length>4096)throw fail('LIMIT');const bytes=buffer.subarray(0,length),after=fstatSync(fd),named=lstatSync(file);
   if(!regular(after)||!regular(named)||named.isSymbolicLink()||JSON.stringify(fingerprint(opened,bytes))!==JSON.stringify(fingerprint(after,bytes))||JSON.stringify(fingerprint(after,bytes))!==JSON.stringify(fingerprint(named,bytes))||after.size!==length)throw fail('FILE_DRIFT');
   chain(false);return {identity:fingerprint(after,bytes),bytes:Buffer.from(bytes)};
  }finally{if(fd!==undefined)closeSync(fd);}
 }
 const guard=async()=>{active();if(await assertResources()===false)throw fail('RESOURCES');active();};
 async function owned(operation){active();if(busy)throw fail('BUSY');busy=true;try{await guard();return await operation();}catch(error){unknown=true;throw error;}finally{busy=false;}}
 const read=()=>owned(async()=>{
  const current=capture();if(baseline!==undefined&&!same(baseline,current))throw fail('STATE_DRIFT');
  await guard();const returned=capture();if(!same(current,returned))throw fail('STATE_DRIFT');baseline=returned;reads++;
  // The old shell command substitution strips trailing LF, while nonempty
  // legacy whitespace still conservatively requests a nonce before copying.
  const text=returned.bytes.toString('utf8');return text.replace(/\n+$/,'')||(text.length?'\n':'');
 });
 const validUrl=url=>{
  if(typeof url!=='string'||!url||Buffer.byteLength(url)>4095||/[\s\\]/.test(url)||!/^https:\/\/(v\.douyin\.com|www\.douyin\.com|www\.iesdouyin\.com)\//.test(url))return false;
  try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.host===u.hostname&&['v.douyin.com','www.douyin.com','www.iesdouyin.com'].includes(u.hostname);}catch{return false;}
 };
 const write=url=>{
  if(!validUrl(url))return Promise.reject(fail('URL'));
  return owned(async()=>{
   chain(true);const current=capture();if(baseline!==undefined&&!same(baseline,current))throw fail('STATE_DRIFT');
   const bytes=Buffer.from(url+'\n'),temp=join(directory,'.'+profile+'-last-clip.'+randomUUID()+'.tmp');let fd,parent;
   try{
    parent=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);const pinned=directories.get(directory),actual=fstatSync(parent);if(actual.dev!==pinned.dev||actual.ino!==pinned.ino)throw fail('DIRECTORY_DRIFT');
    fd=openSync(temp,constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW|constants.O_WRONLY,0o600);writingTemp=temp.slice(directory.length+1);const st=fstatSync(fd);if(!regular(st)||(st.mode&0o777)!==0o600)throw fail('TEMP');writeFileSync(fd,bytes);fsyncSync(fd);closeSync(fd);fd=undefined;fsyncSync(parent);
    const beforeRename=capture();if(!same(current,beforeRename))throw fail('STATE_DRIFT');const tempStat=lstatSync(temp);if(tempStat.isSymbolicLink()||!regular(tempStat)||tempStat.dev!==st.dev||tempStat.ino!==st.ino||tempStat.size!==bytes.length||(tempStat.mode&0o777)!==0o600)throw fail('TEMP_DRIFT');
    renameSync(temp,file);fsyncSync(parent);const published=capture();if(published.identity?.sha256!==sha(bytes)||published.identity?.ino!==st.ino||published.identity?.dev!==st.dev)throw fail('WRITE_UNVERIFIED');
    await guard();const after=capture();if(!same(published,after))throw fail('WRITE_UNVERIFIED');baseline=after;writes++;
   }finally{writingTemp=undefined;if(fd!==undefined)closeSync(fd);if(parent!==undefined)closeSync(parent);}
  });
 };
 return Object.freeze({read,write,snapshot:()=>Object.freeze({unknown,pending:busy?1:0,reads,writes,execution_stopped:'not_attested',path:file})});
}

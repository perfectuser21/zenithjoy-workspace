#!/usr/bin/env node
// Fixed child adapter only. No process spawning, device sockets, business tools,
// permissions or stop verdicts live here. All commands go to its Code parent.
import {Socket} from 'node:net';import {fileURLToPath} from 'node:url';import {realpathSync,lstatSync} from 'node:fs';
export async function runNativeScrcpyAdbShim(argv,{environment=process.env,stdout=process.stdout,stderr=process.stderr}={}){
 const path=environment.ZJ_SCRCPY_NATIVE_SOCKET,nonce=environment.ZJ_SCRCPY_NATIVE_NONCE,scope=environment.ZJ_SCRCPY_NATIVE_SCOPE,deadline=Number(environment.ZJ_SCRCPY_NATIVE_DEADLINE);
 if(typeof path!=='string'||!path.endsWith('/adb.sock')||Buffer.byteLength(path)>100||!/^[a-f0-9]{48}$/.test(nonce||'')||!/^[a-f0-9]{64}$/.test(scope||'')||!Number.isSafeInteger(deadline)||Date.now()>=deadline||!Array.isArray(argv)||argv.length>48||argv.some(arg=>typeof arg!=='string'||arg.length>4096||/[\x00\r\n]/.test(arg)))return 64;
 const directory=path.slice(0,-9),parent=lstatSync(directory),socketStat=lstatSync(path);if(parent.isSymbolicLink()||!parent.isDirectory()||parent.uid!==process.getuid()||(parent.mode&0o777)!==0o700||realpathSync(directory)!==directory||!socketStat.isSocket()||socketStat.isSymbolicLink()||socketStat.uid!==process.getuid()||(socketStat.mode&0o777)!==0o600)return 64;
 const socket=new Socket(),request=Buffer.from(JSON.stringify({protocol:'native-scrcpy-adb/v1',nonce,scope_sha256:scope,argv})),header=Buffer.alloc(4);header.writeUInt32BE(request.length);let buffer=Buffer.alloc(0),exit=null,failed=false,peerEof=false,total=0,writing=Promise.resolve();
 const output=(stream,bytes)=>new Promise((yes,no)=>{stream.write(bytes,error=>error?no(error):yes());});
 return new Promise(resolve=>{
  let finished=false;const complete=code=>{if(finished)return;finished=true;clearTimeout(timer);resolve(code!==75&&Date.now()>=deadline?75:code);};
  const timer=setTimeout(()=>{failed=true;socket.destroy();complete(75);},Math.max(1,deadline-Date.now()));
  const reject=()=>{failed=true;socket.destroy();};socket.on('error',reject);socket.once('connect',()=>socket.end(Buffer.concat([header,request])));
  socket.on('data',bytes=>{if(Date.now()>=deadline){failed=true;socket.destroy();complete(75);return;}total+=bytes.length;if(total>16*1024*1024){reject();return;}buffer=Buffer.concat([buffer,bytes]);
   while(buffer.length>=5){if(Date.now()>=deadline){failed=true;socket.destroy();complete(75);return;}const kind=buffer[0],size=buffer.readUInt32BE(1);if(size>4*1024*1024||exit!==null){reject();return;}if(buffer.length<5+size)return;const data=buffer.subarray(5,5+size);buffer=buffer.subarray(5+size);
    if(kind===1||kind===2){writing=writing.then(()=>output(kind===1?stdout:stderr,data));writing.catch(reject);}
    else if(kind===3&&size===4){exit=data.readUInt32BE();if(exit>255)reject();}
    else{reject();return;}
   }
  });socket.once('end',()=>{peerEof=true;if(buffer.length||exit===null)failed=true;});
  socket.once('close',async()=>{try{await writing;}catch{failed=true;}complete(failed||!peerEof||exit===null?75:exit);});socket.connect(path);
 });
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.exitCode=await runNativeScrcpyAdbShim(process.argv.slice(2));}catch{process.exitCode=75;}
 if(process.exitCode===75){process.stdout.destroy();process.stderr.destroy();}
}

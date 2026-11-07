// AOSP shell_protocol.h @ 0e1749ad8d981f81c77711096b01a8a632879115:
// one ID byte + uint32 LE length; EXIT payload is
// exactly one byte, CloseStdin is ID 4 with zero payload. No OS-stop authority.
import {fileURLToPath} from 'node:url';
export const protocolModulePath=fileURLToPath(import.meta.url);
const fail=()=>{throw Object.assign(new Error('ADB_SHELL_V2_PROTOCOL'),{code:'ADB_SHELL_V2_PROTOCOL'});};
export function adbRequest(service){
 if(typeof service!=='string'||!service||!/^\x20*[\x21-\x7e][\x20-\x7e]*$/.test(service))fail();
 const bytes=Buffer.from(service,'ascii');if(bytes.length>65535)fail();return Buffer.concat([Buffer.from(bytes.length.toString(16).padStart(4,'0')),bytes]);
}
export function adbPayloadLength(header,max){
 if(!Buffer.isBuffer(header)||header.length!==4||!Number.isSafeInteger(max)||max<0)fail();const text=header.toString('latin1');if(!/^[a-fA-F0-9]{4}$/.test(text))fail();const n=parseInt(text,16);if(n>max)fail();return n;
}
export const closeStdinFrame=()=>Buffer.from([4,0,0,0,0]);
export function createShellV2Decoder({maxBytes=2*1024*1024}={}){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>13*1024*1024)fail();
 let buffer=Buffer.alloc(0),exitCode,total=0,finished=false;const stdout=[],stderr=[];
 return Object.freeze({
  hasExit:()=>exitCode!==undefined,
  push(bytes){
   if(finished||!Buffer.isBuffer(bytes))fail();if(!bytes.length)return;
   total+=bytes.length;if(total>maxBytes||exitCode!==undefined)fail();buffer=Buffer.concat([buffer,bytes]);
   while(buffer.length>=5){
    const id=buffer[0],length=buffer.readUInt32LE(1);
    if(![1,2,3].includes(id)||length>65536||id===3&&length!==1)fail();if(buffer.length<5+length)return;
    const data=buffer.subarray(5,5+length);buffer=buffer.subarray(5+length);
    if(id===3){exitCode=data[0];if(buffer.length)fail();}else (id===1?stdout:stderr).push(data);
   }
  },
  finish(){if(finished||buffer.length||exitCode===undefined)fail();finished=true;return {exit_code:exitCode,stdout:Buffer.concat(stdout),stderr:Buffer.concat(stderr),wire_bytes:total};}
 });
}

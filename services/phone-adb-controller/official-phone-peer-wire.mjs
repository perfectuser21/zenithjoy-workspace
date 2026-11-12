import {brotliCompressSync,brotliDecompressSync,constants} from 'node:zlib';
export const PHONE_PEER_FRAME_LIMIT=16*1024*1024;
const protocol='official-phone-peer-wire/v1';
const wireLimit=1024*1024;
const fail=()=>{throw Error('OFFICIAL_PHONE_PEER_FRAME');};
export function encodePhonePeerBootstrap(envelope){
 const raw=JSON.stringify(envelope),bytes=Buffer.from(raw);
 if(bytes.length>PHONE_PEER_FRAME_LIMIT)fail();
 if(envelope?.message?.protocol!=='official-phone-peer-bootstrap/v1'||bytes.length<64*1024)return raw;
 const payload=brotliCompressSync(bytes,{params:{[constants.BROTLI_PARAM_QUALITY]:4,[constants.BROTLI_PARAM_LGWIN]:24}});
 const encoded=JSON.stringify({protocol,encoding:'br',raw_length:bytes.length,payload_base64:payload.toString('base64')});
 return Buffer.byteLength(encoded)<bytes.length&&Buffer.byteLength(encoded)<=wireLimit?encoded:raw;
}
export function decodePhonePeerBootstrap(value){
 if(value&&Object.keys(value).sort().join(',')==='message,signature')return value;
 if(!value||Object.keys(value).sort().join(',')!=='encoding,payload_base64,protocol,raw_length'||value.protocol!==protocol||value.encoding!=='br'||!Number.isSafeInteger(value.raw_length)||value.raw_length<1||value.raw_length>PHONE_PEER_FRAME_LIMIT||typeof value.payload_base64!=='string'||Buffer.byteLength(JSON.stringify(value))>wireLimit)fail();
 const base64=value.payload_base64;
 if(!base64.length||base64.length%4!==0||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))fail();
 const payload=Buffer.from(base64,'base64');if(payload.toString('base64')!==base64)fail();
 let raw;try{raw=brotliDecompressSync(payload,{maxOutputLength:value.raw_length});}catch{fail();}
 if(raw.length!==value.raw_length)fail();
 const envelope=JSON.parse(raw.toString('utf8'));
 if(!envelope||Object.keys(envelope).sort().join(',')!=='message,signature'||envelope.message?.protocol!=='official-phone-peer-bootstrap/v1')fail();
 return envelope;
}
export async function* readPhonePeerLines(input){
 let buffer=Buffer.allocUnsafe(64*1024),length=0,skipLF=false;
 for await(const chunk of input){
  const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);let start=0;
  while(start<bytes.length){
   if(skipLF){skipLF=false;if(bytes[start]===10){start++;continue;}}
   let end=start;while(end<bytes.length&&bytes[end]!==10&&bytes[end]!==13)end++;
   const newline=end<bytes.length?end:-1;
   const needed=length+end-start;if(needed>PHONE_PEER_FRAME_LIMIT)fail();
   if(needed>buffer.length){const grown=Buffer.allocUnsafe(Math.min(PHONE_PEER_FRAME_LIMIT,Math.max(needed,buffer.length*2)));buffer.copy(grown,0,0,length);buffer=grown;}
   bytes.copy(buffer,length,start,end);length=needed;
   if(newline<0)break;
   const line=buffer.subarray(0,length).toString('utf8');length=0;skipLF=bytes[newline]===13;
   yield line;
   start=newline+1;
  }
 }
 if(length)yield buffer.subarray(0,length).toString('utf8');
}

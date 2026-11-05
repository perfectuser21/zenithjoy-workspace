// Parent Code relay. The broker and the official authority keep their original
// verdict/identity rules; a model supplies only an operation's bounded input.
import {openSync,closeSync,fstatSync,lstatSync,readFileSync,constants} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {callActivityTool} from './activity-skill-tool.mjs';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const copy=value=>JSON.parse(JSON.stringify(value));
const freeze=value=>{
 if(object(value)||Array.isArray(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}
 return value;
};
const fields={inspect:new Set(['question','progress','error']),phone:new Set(['command','args']),business:new Set(['operation','input'])};

export function createActivitySkillBrokerClient({request,requestPath,authorize=async()=>false,canReadback=()=>false}={}){
 if(!object(request)||request.protocol!=='leadgen-activity-v1'||request.mode!=='execute'
  ||typeof requestPath!=='string'||resolve(requestPath)!==requestPath||request.broker_request_path!==requestPath
  ||!Number.isSafeInteger(request.deadline_ms)||typeof authorize!=='function'||typeof canReadback!=='function')throw Error('PARENT_BROKER_REQUEST_INVALID');
 const fixed=freeze(copy(request));
 const parent=lstatSync(dirname(requestPath));
 if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==process.getuid()||(parent.mode&0o077)!==0)throw Error('PARENT_BROKER_DIRECTORY_INVALID');
 const readBoundRequest=()=>{
  const fd=openSync(requestPath,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
   const stat=fstatSync(fd);
   if(!stat.isFile()||stat.uid!==process.getuid()||(stat.mode&0o777)!==0o600||stat.nlink!==1)throw Error('PARENT_BROKER_REQUEST_NOT_PRIVATE');
   const value=JSON.parse(readFileSync(fd,'utf8'));
   if(typeof value.socket!=='string'||!/^\/[^\0\r\n]+\.sock$/.test(value.socket)
    ||!isDeepStrictEqual(value,{...fixed,socket:value.socket}))throw Error('PARENT_BROKER_SCOPE_MISMATCH');
   return {dev:stat.dev,ino:stat.ino,value};
  }finally{closeSync(fd);}
 };
 const original=readBoundRequest();
 const verifyFile=()=>{
  const next=readBoundRequest();
  if(next.dev!==original.dev||next.ino!==original.ino||!isDeepStrictEqual(next.value,original.value))throw Error('PARENT_BROKER_REQUEST_CHANGED');
 };
 let sealed=false,pending=false,dispatched=false,unknown=false;
 const snapshot=()=>({sealed,pending,execution_unknown:unknown});
 const admit=()=>{
  if(sealed)throw Error('PARENT_BROKER_SEALED');
  if(Date.now()>=fixed.deadline_ms)throw Error('PARENT_BROKER_EXPIRED');
 };
 return Object.freeze({
  snapshot,
  seal(){sealed=true;if(dispatched)unknown=true;return snapshot();},
  async call(op,body={}){
   admit();
   if(!Object.hasOwn(fields,op))throw Error('PARENT_BROKER_OPERATION_NOT_ALLOWED');
   if(!object(body)||Object.keys(body).some(key=>!fields[op].has(key))
    ||op==='inspect'&&Object.values(body).some(value=>typeof value!=='string'||value.length>16000))throw Error('PARENT_BROKER_INPUT_INVALID');
   if(pending)throw Error('PARENT_BROKER_BUSY');
   const input=copy(body);
   if(unknown&&op!=='inspect'&&!(op==='business'&&canReadback(input.operation,input.input)===true))throw Error('PARENT_BROKER_DELIVERY_UNKNOWN');
   pending=true;
   try{
    verifyFile();
    if(await authorize(fixed,{op,body:freeze(copy(input))})!==true)throw Error('PARENT_BROKER_UNAUTHORIZED');
    admit();verifyFile();
    dispatched=true;
    try{
     const response=await callActivityTool(requestPath,op,input);
     admit();verifyFile();
     if(response.result?.execution_stopped===false||response.result?.external_effect==='unknown')unknown=true;
     return response;
    }catch(error){
     // A broker's explicit failure is a delivered acknowledgement, not a lost
     // request. Its own sticky native/commit uncertainty remains authoritative.
     if(!/^SKILL_PRIMARY_[A-Z0-9_]+$/.test(String(error?.message||''))||error.message==='SKILL_PRIMARY_EVENT_DELIVERY_UNKNOWN')unknown=true;
     throw error;
    }finally{dispatched=false;}
   }finally{pending=false;}
  },
 });
}

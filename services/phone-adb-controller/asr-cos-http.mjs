import https from 'node:https';
import {verifiedCosUtilities} from './asr-cos-dependencies.mjs';
/** A single ClientRequest: no SDK network path, redirect or retry. */
export function singleHttpsRequest({method,url,headers={},body,maxBytes,timeoutMs}){
 return new Promise((resolve,reject)=>{
  let settled=false;
  const done=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(Error('ASR_TRANSPORT_UNCONFIRMED')):resolve(result);};
  const req=https.request(url,{method,headers,agent:false},res=>{
   const chunks=[];let length=0;
   res.on('data',b=>{length+=b.length;if(length>maxBytes){req.destroy();done(true);}else chunks.push(b);});
   res.on('aborted',()=>done(true));res.on('error',()=>done(true));
   res.on('end',()=>done(null,{status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
  });
  const timer=setTimeout(()=>{req.destroy();done(true);},timeoutMs);
  req.on('error',()=>done(true));if(body)req.write(body);req.end();
 });
}
export const officialSign=options=>verifiedCosUtilities().getAuth(options);
export function ownerOnlyAcl(bytes){
 if(bytes.length>65536||/<!DOCTYPE|<!ENTITY/i.test(bytes.toString()))return false;
 const parsed=verifiedCosUtilities().xml2json(bytes.toString());
 const policy=parsed.AccessControlPolicy,owner=policy?.Owner?.ID;
 const value=policy?.AccessControlList?.Grant,grants=Array.isArray(value)?value:value?[value]:[];
 return typeof owner==='string'&&owner.length>0&&grants.length===1&&grants[0].Permission==='FULL_CONTROL'&&grants[0].Grantee?.ID===owner&&!grants[0].Grantee?.URI;
}

// Code-only, one owned request. This capability permits protocol housekeeping,
// never a shell/RECV dispatch, result verdict, lease extension or stop claim.
import {createHash} from 'node:crypto';
const owners=new WeakMap(),tickets=new WeakMap();
const canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
const fail=()=>{throw Object.assign(Error('NATIVE_PHONE_PROTOCOL_TICKET'),{code:'NATIVE_PHONE_PROTOCOL_TICKET'});};
export function registerNativePhoneProtocolIssuer(owner,issue){
 if(!owner||typeof issue!=='function'||owners.has(owner))fail();owners.set(owner,issue);
}
export async function issueNativePhoneProtocolTicket(owner,{source,scope,request}={}){
 // Dynamic only on the explicitly opted-in Code path: legacy/no-ticket wire
 // observers retain their original finite import and authority behavior.
 const [{isNativePhoneRuntime},{issuePreflightLocalScope,readPreflightLocalScope}]=await Promise.all([import('./native-phone-runtime.mjs'),import('./preflight-phone-scope.mjs')]);
 if(!isNativePhoneRuntime(owner)||!owners.has(owner))fail();
 const value=owners.get(owner)({source,scope,request});
 if(!value||typeof value.check!=='function')fail();
 const local=issuePreflightLocalScope(value.preflightRuntime,value.activityScope);
 const check=()=>{value.check();readPreflightLocalScope(local,{runtime:value.preflightRuntime,scope:value.activityScope});};
 check();const cap=Object.freeze({});tickets.set(cap,{owner,source:hash(source),scope:canonical(scope),request:canonical(request),check,used:false});return cap;
}
export function claimNativePhoneProtocolTicket(cap,{source,scope,request}={}){
 const p=tickets.get(cap);if(!p||p.used||p.source!==hash(source)||p.scope!==canonical(scope)||p.request!==canonical(request))fail();p.used=true;p.check();return p.check;
}

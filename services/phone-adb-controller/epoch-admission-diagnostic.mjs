const stages=new Set(['scope','frozen','record','policy','initial_business','source','initial_old_daemon','initial_new_daemon','evidence_root','new_inventory','old_inventory','fresh_business','business_drift','final_old_daemon','final_new_daemon','final_record_policy','final_facts','unknown']);
const endpoints=new Set(['task','definition','reconciliation','device_locks','none']);
const phases=new Set(['request','response','body','json','none']);
const failures=new Set(['timeout','socket','http_status','content_type','body_limit','invalid_json','native_or_fs','coded_guard','unknown']);
const transportCodes=new Set(['UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','ECONNRESET','ECONNREFUSED','EHOSTUNREACH','ENETUNREACH','ETIMEDOUT','ENOTFOUND','ENOENT','EACCES','EIO']);
const keys=['protocol','stage','endpoint','read_phase','failure','http_status','transport_code'];
export function ownDiagnosticValue(value,key){
 try{return value&&(typeof value==='object'||typeof value==='function')?Object.getOwnPropertyDescriptor(value,key)?.value:undefined;}catch{return undefined;}
}
export function epochErrorCode(error){const code=ownDiagnosticValue(error,'code');return typeof code==='string'&&/^[A-Z][A-Z0-9_]{0,95}$/.test(code)?code:undefined;}
export function projectEpochDiagnostic(error){
 const value=ownDiagnosticValue(error,'epoch_diagnostic');if(!value||typeof value!=='object')return undefined;
 try{if(Object.getOwnPropertyNames(value).length!==keys.length||Object.getOwnPropertySymbols(value).length)return undefined;}catch{return undefined;}
 const d=Object.fromEntries(keys.map(key=>[key,ownDiagnosticValue(value,key)]));
 if(d.protocol!=='epoch-admission-diagnostic/v1'||!stages.has(d.stage)||!endpoints.has(d.endpoint)||!phases.has(d.read_phase)||!failures.has(d.failure)||!(d.http_status===null||Number.isInteger(d.http_status)&&d.http_status>=100&&d.http_status<=599)||!(d.transport_code===null||transportCodes.has(d.transport_code)))return undefined;
 return d;
}
export function epochDiagnosticFields(error){const value=projectEpochDiagnostic(error);return value?{epoch_diagnostic:value}:{};}
function transportCode(error){const direct=ownDiagnosticValue(error,'code'),cause=ownDiagnosticValue(ownDiagnosticValue(error,'cause'),'code');return transportCodes.has(direct)?direct:transportCodes.has(cause)?cause:null;}
function failureError(error,diagnostic){const code=epochErrorCode(error);return Object.assign(Error(code??'EPOCH_READ_FAILED'),code?{code,epoch_diagnostic:diagnostic}:{epoch_diagnostic:diagnostic});}
export function brainReadFailure(error,{endpoint,read_phase,http_status,signal,failure}){
 const code=transportCode(error),reason=failure??(signal.aborted?'timeout':code?'socket':'unknown');
 return failureError(error,{protocol:'epoch-admission-diagnostic/v1',stage:'unknown',endpoint,read_phase,failure:reason,http_status,transport_code:code});
}
export function admissionFailure(error,stage){
 const previous=projectEpochDiagnostic(error),code=transportCode(error);
 const diagnostic=previous?{...previous,stage}:{protocol:'epoch-admission-diagnostic/v1',stage,endpoint:'none',read_phase:'none',failure:code?'native_or_fs':epochErrorCode(error)?.startsWith('EPOCH_')?'coded_guard':'unknown',http_status:null,transport_code:code};
 return failureError(error,diagnostic);
}

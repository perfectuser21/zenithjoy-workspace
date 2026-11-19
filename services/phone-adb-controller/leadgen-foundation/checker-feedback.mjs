// This reports a complete independent check failure; it grants no execution or retry authority.
const identityKeys=['task_id','run_id','run_tag','workflow','activity','attempt'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const evidence=value=>Array.isArray(value)&&value.length>0&&value.every(item=>object(item)
 &&typeof item.source==='string'&&item.source.trim()&&object(item.observation)&&Object.keys(item.observation).length>0);
export function knownFailure(request,value){
 if(request?.phase!=='end'||value?.outcome!=='blocked'||request.proposal?.execution_stopped===false
  ||!object(value.identity)||Object.keys(value.identity).length!==identityKeys.length
  ||identityKeys.some(key=>!Object.hasOwn(request,key)||value.identity[key]!==request[key])
  ||typeof request.nonce!=='string'||!request.nonce||value.nonce!==request.nonce
  ||!object(value.output)||value.output.read_only!==true||Object.hasOwn(value.output,'readback_error')
  ||!Array.isArray(request.checks)||request.checks.length===0||new Set(request.checks).size!==request.checks.length
  ||!Array.isArray(value.checks)||value.checks.length!==request.checks.length
  ||new Set(value.checks.map(check=>check?.id)).size!==request.checks.length
  ||request.checks.some(id=>typeof id!=='string'||!id||!value.checks.some(check=>check?.id===id))
  ||value.checks.some(check=>!['passed','failed'].includes(check?.status)||!evidence(check.evidence))
  ||!value.checks.some(check=>check.status==='failed'))return value;
 const result=structuredClone(value);
 result.outcome='failed';result.retryable=false;
 // A read-only observation cannot certify the preceding Agent's side effects.
 result.external_effect='unknown';
 result.checks=result.checks.map(check=>check.status==='failed'?{...check,
  expected:{status:'passed'},actual:{status:check.status,evidence:check.evidence},reason:'independent_check_failed'}:check);
 return result;
}

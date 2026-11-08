const fail=()=>{throw Error('PUBLIC_DOMAIN_STEP_MAPPING');};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
// Only actual independent readback rows become Step judgments. AV declarations
// locate their identity and timing; they never supply a successful observation.
export function publicDomainStepChecks({frozen,executionSlot,checked,evidence}){
 const declarations=(frozen.activities||[]).flatMap(a=>(a.version?.payload?.steps||[]).map(step=>({a,step})));
 const rows=(checked?.step_dod||[]).flatMap(x=>x.steps||[]),result=[];
 for(const row of rows){
  const exact=declarations.filter(({step})=>step.registration?.key===row.key);
  const matches=exact.length?exact:declarations.filter(({a,step})=>a.reference.slot_key===row.activity&&(row.key===step.locator?.step_key||row.key?.endsWith('.'+step.locator?.step_key)));
  if(matches.length!==1)fail();const {a,step}=matches[0],at=step.contract?.dod?.at||a.reference.slot_key;
  if(row.activity!==a.reference.slot_key||row.at!==executionSlot||at!==executionSlot||!UUID.test(step.step_id||'')||step.locator?.activity_id!==a.reference.activity_id||!/^[a-f0-9]{64}$/.test(step.registration?.source_sha256||''))fail();
  if(result.some(r=>r.step_id===step.step_id))fail();
  const verdict=row.pass===true?'pass':row.pass===false?'fail':'unknown';
  result.push({step_id:step.step_id,activity_key:a.reference.slot_key,activity_id:a.reference.activity_id,reference_id:a.reference.reference_id,activity_definition_version_id:a.version.id,
   verdict,acceptance_ref:`step:${step.step_id}@${step.registration.source_sha256}`,evidence:[{...evidence,observation:structuredClone(row)}]});
 }
 return result;
}

// Mechanical projection only: no business verdict or second acceptance standard.
import {createHash} from 'node:crypto';
const canonical=x=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const digest=x=>createHash('sha256').update(canonical(x)).digest('hex');
const need=(ok,code)=>{if(!ok)throw Error('CONTRACT_'+code);};
const key=x=>typeof x==='string'&&/^[a-z][a-z0-9_]*$/.test(x);
function resolveActivity(documents,workflow,activity,seen=new Set()){
 need(key(workflow)&&key(activity),'REFERENCE');const ref=workflow+'.'+activity;
 need(!seen.has(ref),'REFERENCE_CYCLE');seen.add(ref);
 const matches=documents[workflow]?.activities?.filter(a=>(a.key??a.ref?.split('.')[1])===activity)??[];
 need(matches.length===1,'REFERENCE_UNIQUE');const item=matches[0];
 if(item.ref){const parts=item.ref.split('.');need(parts.length===2,'REFERENCE');return resolveActivity(documents,...parts,seen);}
 return {workflow,activity,item};
}
export function generateAcceptance({documents,workflow,activity}){
 const resolved=resolveActivity(documents,workflow,activity),document=structuredClone(resolved.item);
 // Same semantic exclusion as leadgen-methods: A/B source bindings cannot create a digest cycle.
 delete document.implementation_bindings;
 need(document.key===resolved.activity&&typeof document.version==='string'&&Array.isArray(document.inputs)&&Array.isArray(document.outputs),'BODY');
 need(Array.isArray(document.preconditions)&&document.preconditions.length>0&&Array.isArray(document.postconditions)&&document.postconditions.length>0,'CRITERIA');
 const criteria=[];
 const append=(id,phase,requirement,source_pointer)=>{
  need(typeof requirement==='string'?requirement.trim().length>0:requirement&&typeof requirement==='object'&&!Array.isArray(requirement)&&Object.keys(requirement).length>0,'CRITERION');
  criteria.push({id,phase,requirement:structuredClone(requirement),source_pointer});
 };
 for(const [field,phase]of [['inputs','start'],['preconditions','start'],['outputs','end'],['postconditions','end'],['side_effects','end']]){
  need(Array.isArray(document[field]),'BODY');
  for(const [i,value]of document[field].entries())append(field+'_'+i,phase,value,'/'+field+'/'+i);
 }
 for(const field of ['idempotency','failure'])append(field,'end',document[field],'/'+field);
 return {source:{repo:'perfectuser21/zenithjoy-workspace',path:'product-map/contracts/'+resolved.workflow+'.yaml',activity_ref:resolved.workflow+'.'+resolved.activity,contract_digest:digest(document)},document,criteria};
}
/** Must receive documents from the actual registered B revision, not the A snapshot itself. */
export function verifyAcceptance(acceptance,authority){
 const expected=generateAcceptance(authority);
 need(acceptance?.source?.contract_digest===expected.source.contract_digest&&canonical(acceptance.document)===canonical(expected.document),'AUTHORITY_DRIFT');
 need(canonical(acceptance)===canonical(expected),'ACCEPTANCE_DRIFT');return true;
}

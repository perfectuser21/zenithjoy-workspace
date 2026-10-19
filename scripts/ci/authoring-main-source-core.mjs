/** 来源续版编排；验证任务先记账，冻结/注册回归不代表手机execution。 */
export async function renewDefinitions(scopes,{revision,checkMain,task,verify,complete,register,activate,hash}){
 if(!/^[a-f0-9]{40}$/.test(revision))throw Error('AUTHORING_SOURCE_SHA_INVALID');
 await checkMain();
 for(const scope of scopes){
  for(const item of scope.documents){
   const key=item.definition.key;
   const validation=await task(`validation:${key}`,{scope:scope.scope,definition:item.definition});
   const proof=await verify(item,scope);
   if(proof.definition_sha256!==hash(item.definition)||!proof.evidence_refs?.length)throw Error('AUTHORING_SOURCE_PROOF_INVALID');
   await complete(validation,{workflow_validation:{verdict:'PASS',definition_sha256:proof.definition_sha256,
    actor:'ci:authoring-source-validation',evidence_refs:proof.evidence_refs,activity_keys:item.definition.activities.map(a=>a.key),
    validation_scope:'fixed_git_freeze_scratch_registration',business_runtime_status:'not_evaluated'}});
   await checkMain();
   await register(item,scope,validation);
  }
  await checkMain();
  await activate(scope,{expected_active:{id:scope.manifest.id,digest:scope.manifest.digest}});
  await checkMain();
 }
}

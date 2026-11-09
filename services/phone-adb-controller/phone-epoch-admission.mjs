// A lost external epoch is independent of this parent's own child close facts.
// Only the single maintenance validator decides route/Task/noninterference facts.
export function createPhoneEpochGuard({root,env,frozen,state}){
 const spec=frozen?.discovery_phone_scope||frozen?.collection_phone_scope;
 if(spec?.policy?.schema_version!==2)return undefined;
 return async()=>{
  try{
   if(state.epochFenceLost)throw Object.assign(Error('EPOCH_ADMISSION_LOST'),{code:'EPOCH_ADMISSION_LOST'});
   const {canAuthorizeNativeFrame}=await import('./device-epoch-fence-admission.mjs');
   const proof=await canAuthorizeNativeFrame({root,env,frozen});
   if(proof?.authorized!==true)throw Object.assign(Error('EPOCH_ADMISSION_REQUIRED'),{code:'EPOCH_ADMISSION_REQUIRED'});
   return proof;
  }catch(error){
   state.epochFenceLost=true;state.executionUnknown=true;
   const code=/^EPOCH_[A-Z0-9_]+$/.test(error.code||'')?error.code:'EPOCH_ADMISSION_FAILED';
   throw Object.assign(Error(code),{code,epochFenceLost:true,resourceUnknown:true,externalEffect:'unknown'});
  }
 };
}

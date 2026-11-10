import {epochErrorCode,epochDiagnosticFields} from './epoch-admission-diagnostic.mjs';
// A lost external epoch is independent of this parent's own child close facts.
// Only the single maintenance validator decides route/Task/noninterference facts.
export function createPhoneEpochGuard({root,env,frozen,state,deadlineMs}){
 const spec=frozen?.discovery_phone_scope||frozen?.collection_phone_scope;
 if(spec?.policy?.schema_version!==2)return undefined;
 const readBudget=deadlineMs===undefined?undefined:Object.freeze({deadlineMs,maxAttempts:2});
 return async()=>{
  try{
   if(state.epochFenceLost)throw Object.assign(Error('EPOCH_ADMISSION_LOST'),{code:'EPOCH_ADMISSION_LOST'});
   const {canAuthorizeNativeFrame}=await import('./device-epoch-fence-admission.mjs');
   const proof=await canAuthorizeNativeFrame({root,env,frozen,readBudget});
   if(proof?.authorized!==true)throw Object.assign(Error('EPOCH_ADMISSION_REQUIRED'),{code:'EPOCH_ADMISSION_REQUIRED'});
   return proof;
  }catch(error){
   state.epochFenceLost=true;state.executionUnknown=true;
   const originalCode=epochErrorCode(error),code=/^EPOCH_[A-Z0-9_]+$/.test(originalCode??'')?originalCode:'EPOCH_ADMISSION_FAILED';
   throw Object.assign(Error(code),{code,epochFenceLost:true,resourceUnknown:true,externalEffect:'unknown',...epochDiagnosticFields(error)});
  }
 };
}

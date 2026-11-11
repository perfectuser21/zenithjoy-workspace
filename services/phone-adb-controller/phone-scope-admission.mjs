import {createPhoneEpochGuard} from './phone-epoch-admission.mjs';
import {isPhoneOperationAdmission} from './phone-operation-admission.mjs';
const fail=()=>{throw Error('PHONE_SCOPE_ADMISSION_UNVERIFIED');};
export function phoneScopeAdmission({root,env,frozen,state,deadlineMs,operationAdmission}){
 const specification=frozen.discovery_phone_scope||frozen.collection_phone_scope;
 if(specification?.policy?.schema_version===2)return createPhoneEpochGuard({root,env,frozen,state,deadlineMs});
 const value=operationAdmission?.admission,c=operationAdmission?.context;
 if(!c||c.root!==root||c.env!==env||c.frozen.snapshot_sha256!==frozen.snapshot_sha256||c.taskId!==frozen.agent_input.task_id||!isPhoneOperationAdmission(value,c)||value.kind!=='usb-local')fail();
 return ()=>value.assert({phase:'native',resourceOnly:false});
}

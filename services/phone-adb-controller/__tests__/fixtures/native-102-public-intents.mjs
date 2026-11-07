// Test-model selection only. A failed device/tool response ends this synthetic
// Worker turn; the production Judge/cleanup still determine the run's outcome.
export function createNative102PublicIntentReader({slots,currentActivity,latestTool,onError}){
 const finish=()=>({type:'finish'}),report=(activity,error)=>{try{onError({activity,error:String(error?.message||error)});}catch{}return finish();};
 return ()=>{let activity;try{activity=currentActivity();const previous=latestTool(activity);if(previous&&(previous.error||previous.response?.ok!==true))throw Error('previous tool failed: '+JSON.stringify(previous));const next=slots[activity]?.shift();if(next===undefined)throw Error('unexpected Worker turn for '+activity);if(typeof next!=='function')return next;return async()=>{try{return await next();}catch(error){return report(activity,error);}};}catch(error){return report(activity,error);}};
}

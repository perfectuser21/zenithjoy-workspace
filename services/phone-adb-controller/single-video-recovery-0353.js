// 仅准备0353单VID的新授权范围；不会修改旧ab689作用域或替用户产生决定。
'use strict';
const legacy=require('./single-video-recovery.js');
const SCOPE=Object.freeze({...legacy.SCOPE,scope_version:2,original_task_id:'7315379c-c2b8-4d0f-a87a-88e64bb204a9',original_run:'cicd24c9_102_recovered_20261024_0353',source_status:'待人工核验:cicd24c9_102_recovered_20261024_0353'});
const RECOVERY_RUN='single_video_recovery_0353_a1';
function recovery(input){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.decision_id||'')||input.decision_id===legacy.DECISION)throw Error('RECOVERY_DECISION_INVALID');
 return legacy.createRecovery({scope:SCOPE,decision:input.decision_id,run:RECOVERY_RUN,authority:q=>require('./single-video-recovery-0353-authority.js').authority(q)});
}
module.exports={SCOPE,RECOVERY_RUN,recoverSingleVideo:(pool,input,deps)=>recovery(input).recoverSingleVideo(pool,input,deps),readbackSingleVideo:(pool,input,deps)=>recovery(input).readbackSingleVideo(pool,input,deps)};

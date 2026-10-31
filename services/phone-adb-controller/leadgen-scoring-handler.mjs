import {readFileSync,writeFileSync,appendFileSync,existsSync,renameSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import admission from './leadgen-comment-admission.js';
import exclusion from './leadgen-score-exclusion.js';
export function createScoringHandler({env,run,line,state,queue}){return async()=>{
      const admissionSource=env.LEADGEN_SOURCE_RUN===admission.SOURCE_RUN;
      const admissionRequested=env.LEADGEN_102G_ADMISSION_DECISION_ID!==undefined
        ||env.LEADGEN_102G_ADMISSION_TASK_ID!==undefined;
      if(admissionSource||admissionRequested){
        if(!admissionSource||line!=='jinuo'||env.LEADGEN_SEND==='1'
          ||!env.LEADGEN_102G_ADMISSION_DECISION_ID||!env.LEADGEN_102G_ADMISSION_TASK_ID
          ||!Number.isSafeInteger(Number(env.LEADGEN_LIMIT||2))||Number(env.LEADGEN_LIMIT||2)>3)
          throw Error('ADMISSION_RUN_SCOPE_INVALID');
      }
      if(env.LEADGEN_POLICY_REVIEW_IDS!==undefined){
        const ids=JSON.parse(env.LEADGEN_POLICY_REVIEW_IDS);
        if(env.LEADGEN_POLICY_CLAIM!==run||!env.LEADGEN_SOURCE_RUN)throw Error('POLICY_REVIEW_SCOPE_INVALID');
        const review=await queue('policy_review',{claim:env.LEADGEN_POLICY_CLAIM,ids});
        writeFileSync(join(env.WFR_RUN_DIR,`${run}-policy-review.json`),JSON.stringify(review),{mode:0o600});
        return {scored:0,ids,policy_review_failures:review.verified?0:Math.max(1,review.rows?.filter(v=>v.status!=='pass').length||0),
          ...(review.verified===true?{}:{status:'partial'})};
      }
      const attemptFile=join(env.WFR_RUN_DIR,`${run}-score-attempt.json`);
      const sourceRun=env.LEADGEN_SOURCE_RUN||null;
      const requested=Number(env.LEADGEN_LIMIT||2);
      if(!Number.isSafeInteger(requested)||requested<1)throw Error('POLICY_SCORE_BUDGET_INVALID');
      const budget=Math.min(50,requested);
      const falseRecoveryRequested=env.LEADGEN_103L_RECOVERY_ID!==undefined
        ||env.LEADGEN_103L_RECOVERY_TASK_ID!==undefined;
      const falseRecovery=falseRecoveryRequested?{
        comment_id:env.LEADGEN_103L_RECOVERY_ID,maintenance_task_id:env.LEADGEN_103L_RECOVERY_TASK_ID}:null;
      const legacyRecovery=env.LEADGEN_LEGACY_RECOVERY_ID?{comment_id:env.LEADGEN_LEGACY_RECOVERY_ID,
        old_run:env.LEADGEN_LEGACY_SCORE_RUN,maintenance_task_id:env.LEADGEN_LEGACY_RECOVERY_TASK_ID}:null;
      if(legacyRecovery&&(!sourceRun||budget!==1))throw Error('POLICY_SCORE_LEGACY_RECOVERY_SCOPE_INVALID');
      if(falseRecovery&&(legacyRecovery||line!==exclusion.recoveryScope.line
        ||sourceRun!==exclusion.recoveryScope.source_run||budget!==1||env.LEADGEN_SEND==='1'
        ||falseRecovery.comment_id!==exclusion.recoveryScope.comment_id
        ||falseRecovery.maintenance_task_id!==exclusion.recoveryScope.task_id))
        throw Error('FALSE_EXCLUSION_SCOPE_INVALID');
      state.company_config=await queue('company_config',{step:'103'});
      if(falseRecovery){
        const fields={comment_id:falseRecovery.comment_id,maintenance_task_id:falseRecovery.maintenance_task_id,
          old_run:exclusion.recoveryScope.old_run,candidate_source_commit:state.source_commit};
        const accepted=await queue('recover_false_exclusion_102l',fields);
        const readback=await queue('recover_false_exclusion_102l_readback',fields);
        if(!['applied','already_applied'].includes(accepted.status)
          ||readback.verified!==true||readback.comment_id!==falseRecovery.comment_id
          ||readback.new_run!==run)throw Error('FALSE_EXCLUSION_READBACK_INVALID');
      }
      if(admissionSource){
        const fields={decision_id:env.LEADGEN_102G_ADMISSION_DECISION_ID,
          maintenance_task_id:env.LEADGEN_102G_ADMISSION_TASK_ID,video_id:admission.VIDEO_ID,
          candidate_source_commit:state.source_commit};
        const accepted=await queue('admit_102g_comments',fields);
        const readback=await queue('admit_102g_readback',fields);
        if(!['applied','already_applied'].includes(accepted.status)
          ||readback.status!=='already_applied'
          ||accepted.decision_id!==fields.decision_id||readback.decision_id!==fields.decision_id
          ||JSON.stringify(accepted.comment_ids)!==JSON.stringify(admission.COMMENT_IDS)
          ||JSON.stringify(readback.comment_ids)!==JSON.stringify(admission.COMMENT_IDS))
          throw Error('ADMISSION_READBACK_INVALID');
      }
      let attempt=existsSync(attemptFile)?JSON.parse(readFileSync(attemptFile,'utf8')):null;
      const hadAttempt=Boolean(attempt);
      const scope=attempt?null:legacyRecovery?{ids:[legacyRecovery.comment_id]}
        :falseRecovery?{ids:[falseRecovery.comment_id]}:await queue('score_scope');
      if(scope&&!sourceRun&&(!scope.sources||scope.ids.some(id=>typeof scope.sources[id]!=='string')))throw Error('POLICY_SCORE_SCOPE_AMBIGUOUS');
      if(scope&&sourceRun&&!scope.sources)scope.sources=Object.fromEntries(scope.ids.map(id=>[id,sourceRun]));
      const saveAttempt=value=>{const temp=`${attemptFile}.${process.pid}.${randomUUID()}.tmp`;
        writeFileSync(temp,JSON.stringify(value),{flag:'wx',mode:0o600});renameSync(temp,attemptFile);};
      if(attempt){if(attempt.line!==line||attempt.run!==run||attempt.source_run!==sourceRun
        ||attempt.budget!==budget||!Array.isArray(attempt.ids)||attempt.ids.length>1000
        ||new Set(attempt.ids).size!==attempt.ids.length||!Array.isArray(attempt.blocked_ids)
        ||!sourceRun&&(!attempt.sources||attempt.ids.some(id=>typeof attempt.sources[id]!=='string')))
        throw Error('POLICY_SCORE_RECOVERY_SCOPE_INVALID');
      if(attempt&&sourceRun&&!attempt.sources)attempt.sources=Object.fromEntries(attempt.ids.map(id=>[id,sourceRun]));
      }else{attempt={line,run,source_run:sourceRun,ids:scope.ids,sources:scope.sources,budget,blocked_ids:[],cursor:null};saveAttempt(attempt);}
      const liveScope=hadAttempt&&!legacyRecovery?await queue('score_scope'):null;
      if(liveScope&&sourceRun&&!liveScope.sources)liveScope.sources=Object.fromEntries(liveScope.ids.map(id=>[id,sourceRun]));
      if(liveScope&&(!Array.isArray(liveScope.ids)||attempt.ids.some(id=>liveScope.ids.includes(id)
        &&attempt.sources[id]!==liveScope.sources?.[id])))
        throw Error('POLICY_SCORE_RECOVERY_SCOPE_INVALID');
      let recovered;
      try{recovered=await queue('score_recovery',{ids:attempt.ids,sources:attempt.sources});}catch{return {scored:0,ids:[],status:'partial',reason:'POLICY_SCORE_RECOVERY_AMBIGUOUS'};}
      const recoveredExcluded=recovered.excluded_ids||[];
      if(recovered.verified!==true||recovered.scored+recoveredExcluded.length>attempt.budget
        ||new Set([...recovered.ids,...recoveredExcluded]).size!==recovered.ids.length+recoveredExcluded.length
        ||[...recovered.ids,...recoveredExcluded].some(id=>!attempt.ids.includes(id)))
        return {scored:0,ids:[],status:'partial',reason:'POLICY_SCORE_RECOVERY_AMBIGUOUS'};
      if(liveScope){
        if(attempt.ids.some(id=>!liveScope.ids.includes(id)&&![...recovered.ids,...recoveredExcluded].includes(id)))
          throw Error('POLICY_SCORE_RECOVERY_SCOPE_INVALID');
      }
      const remaining=attempt.budget-recovered.scored-recoveredExcluded.length;
      const r=remaining>0&&(!state.budgetDeadline||Date.now()<state.budgetDeadline)
        ?await queue('score',{limit:remaining,budget_max:attempt.budget,ids:attempt.ids,sources:attempt.sources,blocked_ids:attempt.blocked_ids,cursor:attempt.cursor,...(legacyRecovery?{legacy_recovery:legacyRecovery}:{})})
        :{scored:0,ids:[],excluded:0,excluded_ids:[],blocked:attempt.blocked_ids.length,blocked_ids:attempt.blocked_ids,next_cursor:attempt.cursor};
      attempt={...attempt,blocked_ids:r.blocked_ids||attempt.blocked_ids,cursor:r.next_cursor||attempt.cursor};saveAttempt(attempt);
      const allIds=[...new Set([...recovered.ids,...r.ids])];
      const allExcluded=[...new Set([...recoveredExcluded,...(r.excluded_ids||[])])];
      appendFileSync(join(env.WFR_RUN_DIR,'activity.log'),`SORT_STATS ${JSON.stringify(r)}\n`,{mode:0o600});
      const readback=await queue('score_readback',{ids:allIds,sources:attempt.sources});
      writeFileSync(join(env.WFR_RUN_DIR,`${run}-scoring-readback.json`),JSON.stringify(readback),{mode:0o600});
      const exclusionReadback=allExcluded.length?await queue('score_exclusion_readback',{ids:allExcluded,
        sources:Object.fromEntries(allExcluded.map(id=>[id,attempt.sources[id]]))}):
        {verified:true,failures:0,ids:[],excluded_reasons:[]};
      writeFileSync(join(env.WFR_RUN_DIR,`${run}-exclusion-readback.json`),JSON.stringify(exclusionReadback),{mode:0o600});
      const review=allIds.length?await queue('policy_review',{claim:run,ids:allIds,sources:Object.fromEntries(allIds.map(id=>[id,attempt.sources[id]]))}):
        {verified:allExcluded.length>0,rows:[],reason:allExcluded.length?'no_scored_comments':'empty_batch'};
      writeFileSync(join(env.WFR_RUN_DIR,`${run}-policy-review.json`),JSON.stringify(review),{mode:0o600});
      return {...r,scored:allIds.length,ids:allIds,excluded:allExcluded.length,excluded_ids:allExcluded,
        excluded_reasons:exclusionReadback.excluded_reasons||[],recovered:recovered.scored,recovered_excluded:recoveredExcluded.length,
        scoring_readback_failures:readback.failures,exclusion_readback_failures:exclusionReadback.failures,
        policy_review_failures:review.verified?0:Math.max(1,review.rows?.filter(v=>v.status!=='pass').length||0),
        ...(!readback.verified||!exclusionReadback.verified||!review.verified||attempt.blocked_ids.length?{status:'partial'}:{})};};}

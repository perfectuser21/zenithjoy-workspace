import {readFileSync,writeFileSync,appendFileSync,existsSync,renameSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
export function createScoringHandler({env,run,line,state,queue}){return async()=>{
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
      const scope=await queue('score_scope');
      if(!sourceRun&&(!scope.sources||scope.ids.some(id=>typeof scope.sources[id]!=='string')))throw Error('POLICY_SCORE_SCOPE_AMBIGUOUS');
      const saveAttempt=value=>{const temp=`${attemptFile}.${process.pid}.${randomUUID()}.tmp`;
        writeFileSync(temp,JSON.stringify(value),{flag:'wx',mode:0o600});renameSync(temp,attemptFile);};
      let attempt=existsSync(attemptFile)?JSON.parse(readFileSync(attemptFile,'utf8')):null;
      if(attempt){if(attempt.line!==line||attempt.run!==run||attempt.source_run!==sourceRun
        ||attempt.budget!==budget||!Array.isArray(attempt.ids)||!attempt.ids.every(id=>scope.ids.includes(id)&& (sourceRun||attempt.sources?.[id]===scope.sources[id])))
        throw Error('POLICY_SCORE_RECOVERY_SCOPE_INVALID');
      }else{attempt={line,run,source_run:sourceRun,ids:scope.ids,...(!sourceRun?{sources:scope.sources}:{}),budget,blocked_ids:[],cursor:null};saveAttempt(attempt);}
      let recovered;
      try{recovered=await queue('score_recovery',{ids:attempt.ids,...(!sourceRun?{sources:attempt.sources}:{})});}catch{return {scored:0,ids:[],status:'partial',reason:'POLICY_SCORE_RECOVERY_AMBIGUOUS'};}
      if(recovered.verified!==true||recovered.scored>attempt.budget||new Set(recovered.ids).size!==recovered.ids.length
        ||recovered.ids.some(id=>!attempt.ids.includes(id)))return {scored:0,ids:[],status:'partial',reason:'POLICY_SCORE_RECOVERY_AMBIGUOUS'};
      const remaining=attempt.budget-recovered.scored;
      const r=remaining>0&&(!state.budgetDeadline||Date.now()<state.budgetDeadline)
        ?await queue('score',{limit:remaining,budget_max:attempt.budget,ids:attempt.ids,...(!sourceRun?{sources:attempt.sources}:{}),blocked_ids:attempt.blocked_ids,cursor:attempt.cursor})
        :{scored:0,ids:[],blocked:attempt.blocked_ids.length,blocked_ids:attempt.blocked_ids,next_cursor:attempt.cursor};
      attempt={...attempt,blocked_ids:r.blocked_ids||attempt.blocked_ids,cursor:r.next_cursor||attempt.cursor};saveAttempt(attempt);
      const allIds=[...new Set([...recovered.ids,...r.ids])];
      appendFileSync(join(env.WFR_RUN_DIR,'activity.log'),`SORT_STATS ${JSON.stringify(r)}\n`,{mode:0o600});
      const readback=await queue('score_readback',{ids:allIds,...(!sourceRun?{sources:attempt.sources}:{})});
      writeFileSync(join(env.WFR_RUN_DIR,`${run}-scoring-readback.json`),JSON.stringify(readback),{mode:0o600});
      const review=allIds.length?await queue('policy_review',{claim:run,ids:allIds,...(!sourceRun?{sources:Object.fromEntries(allIds.map(id=>[id,attempt.sources[id]]))}:{})}):{verified:false,rows:[],reason:'empty_batch'};
      writeFileSync(join(env.WFR_RUN_DIR,`${run}-policy-review.json`),JSON.stringify(review),{mode:0o600});
      return {...r,scored:allIds.length,ids:allIds,recovered:recovered.scored,scoring_readback_failures:readback.failures,policy_review_failures:review.verified?0:Math.max(1,review.rows?.filter(v=>v.status!=='pass').length||0),
        ...(!readback.verified||!review.verified||attempt.blocked_ids.length?{status:'partial'}:{})};};}

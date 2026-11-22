import {createHash} from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const requireEvidence = (valid, code) => { if (!valid) throw Error('QUALIFICATION_AGENT_OVERLAY_' + code); };

function replaceOnce(source, before, after) {
  const offset = source.indexOf(before);
  requireEvidence(offset >= 0 && source.indexOf(before, offset + before.length) < 0, 'LAYOUT');
  return source.slice(0, offset) + after + source.slice(offset + before.length);
}

const operations = `export async function main({context:c,video_id,audio,artifact_dir,operation,submission_action_name,submission_wire},injectedDeps){
 const agentPreparation=operation==='prepare_activity_agent',agentSubmission=operation==='submit_activity_agent';
 const agentMode=agentPreparation||agentSubmission;
 need(operation===undefined||agentMode,'QUALIFICATION_OPERATION_INVALID');`;

const bindMode = `  need(canonical(j.scope)===canonical(scope),'JOURNAL_SCOPE_CHANGED');
  if(agentPreparation&&!fs.existsSync(journal))j.mode='activity_agent';
  need((j.mode??'legacy')===(agentMode?'activity_agent':'legacy'),'QUALIFICATION_MODE_CHANGED');`;

const dossierAndDecision = `  const activityDossier=async()=>{
   need(typeof deps.activityPolicy==='function','ACTIVITY_AGENT_POLICY_UNAVAILABLE');
   const policy=await deps.activityPolicy(snapshot),asrReceipt=asset(asrFile);
   need(policy&&asrReceipt,'ACTIVITY_AGENT_DOSSIER_UNAVAILABLE');
   const dossier={scope,policy,policy_sha256:j.policy_sha256,transcript:j.transcript,
    transcript_sha256:hash(JSON.stringify(j.transcript)),visual,asr_receipt_sha256:asrReceipt.sha256};
   return {status:'prepared',dossier,dossier_sha256:hash(canonical(dossier)),journal:asset(journal)};
  };
  if(agentSubmission){
   need(['asr_done','decided','commit_started','done'].includes(j.phase)&&typeof j.transcript==='string','ACTIVITY_AGENT_DOSSIER_UNAVAILABLE');
   held.assertHeld();await deps.authority();need(now()<c.business_deadline_ms,'BUSINESS_DEADLINE');
   const prepared=await activityDossier();
   const {verifyActivityAgentDecision}=await import('./agent-decision.mjs');
   const submitted=verifyActivityAgentDecision({context:c,inputFile:process.env.COMMANDER_ACTIVITY_INPUT_FILE,now,
    submissionActionName:submission_action_name,submissionWire:submission_wire,dossier:prepared.dossier,
    dossierSha256:prepared.dossier_sha256,audio});
   if(j.agent_decision_provenance){
    need(canonical(j.agent_decision_provenance)===canonical(submitted.provenance)&&canonical(j.decision)===canonical(submitted.decision),'QUALIFICATION_AGENT_DECISION_CHANGED');
   }else{
    need(j.phase==='asr_done','ACTIVITY_AGENT_JOURNAL_PHASE');
    j.decision=submitted.decision;j.agent_decision_provenance=submitted.provenance;j.phase='decided';flush();
   }
  }
  if(agentPreparation&&['asr_done','decided','commit_started','done'].includes(j.phase)){
   return j.phase==='asr_done'?activityDossier():output(j.decision?.verdict==='unknown'?j.decision:unknown('ACTIVITY_AGENT_DOSSIER_UNAVAILABLE','asr'));
  }`;

const stopBeforeJudge = `  if(agentPreparation){
   if(j.phase!=='asr_done')return output(j.decision??unknown('ACTIVITY_AGENT_DOSSIER_UNAVAILABLE','asr'));
   held.assertHeld();await deps.authority();need(now()<c.business_deadline_ms,'BUSINESS_DEADLINE');
   return activityDossier();
  }`;

// Candidate only. The caller admits the original 102 helper and runtime-deps from
// the same frozen assembly receipt before placing the result under a separate profile.
export function buildQualificationAgentOverlay({helper, runtimeDeps, expected}) {
  requireEvidence(typeof helper === 'string' && typeof runtimeDeps === 'string' &&
    hash(helper) === expected?.helper && hash(runtimeDeps) === expected?.runtimeDeps, 'SOURCE');

  helper = replaceOnce(helper, 'export async function main({context:c,video_id,audio,artifact_dir},injectedDeps){', operations);
  helper = replaceOnce(helper, "  need(canonical(j.scope)===canonical(scope),'JOURNAL_SCOPE_CHANGED');", bindMode);
  helper = replaceOnce(helper, 'const output=decision=>({...decision,task_id:',
    'const output=decision=>({...decision,...(j.agent_decision_provenance===undefined?{}:{decision_provenance:j.agent_decision_provenance}),task_id:');
  helper = replaceOnce(helper, "  if(j.phase==='done'){", dossierAndDecision + "\n  if(j.phase==='done'){");
  helper = replaceOnce(helper, "  if(j.phase==='asr_done'){", stopBeforeJudge + "\n  if(j.phase==='asr_done'){");
  runtimeDeps = replaceOnce(runtimeDeps, '  judge:(text,snapshot,{audit,judgeEvidence})=>',
    "  activityPolicy:snapshot=>JSON.parse(company.configTargetProfile(snapshot,'102')),\n  judge:(text,snapshot,{audit,judgeEvidence})=>");
  return {helper, runtimeDeps};
}

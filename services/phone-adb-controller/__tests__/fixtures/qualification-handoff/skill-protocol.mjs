import {digest,canonical} from './commander-canonical.mjs';
const identityKeys=['task_id','run_id','run_tag','workflow','activity','attempt'];
const evidenceValid=value=>Array.isArray(value)&&value.length>0&&value.every(e=>e&&typeof e.source==='string'&&e.source.trim()
  &&e.observation&&typeof e.observation==='object'&&!Array.isArray(e.observation)&&Object.keys(e.observation).length);
// 失败报告必须来自完整、同轮、同nonce的独立检查；缺明细不是可返工结论。
export function verifySkillFailure(value,request) {
  if(!value||value.outcome!=='failed'||!value.identity||identityKeys.some(k=>value.identity[k]!==request[k])
    ||Object.keys(value.identity).some(k=>!identityKeys.includes(k))||value.nonce!==request.nonce
    ||!Array.isArray(value.checks)||value.checks.length!==request.checks.length
    ||new Set(value.checks.map(c=>c?.id)).size!==request.checks.length
    ||request.checks.some(id=>!value.checks.some(c=>c?.id===id&&['passed','failed'].includes(c.status)&&evidenceValid(c.evidence)))
    ||!value.checks.some(c=>c.status==='failed')
    ||value.checks.some(c=>c.status==='failed'&&(!Object.hasOwn(c,'expected')||!Object.hasOwn(c,'actual')
      ||typeof c.reason!=='string'||!c.reason.trim()))
    ||typeof value.retryable!=='boolean'||!['none','known','unknown'].includes(value.external_effect))throw Error('skill_readback_unconfirmed');
  canonical(value);
  if(Buffer.byteLength(JSON.stringify(value))>131072)throw Error('skill_failure_oversized');
  return value;
}
export function verifySkillReadback(value,request,{allowEmpty=false}={}) {
  if(!value||typeof value!=='object'||!value.identity||identityKeys.some(k=>value.identity[k]!==request[k])
    ||Object.keys(value.identity).some(k=>!identityKeys.includes(k))||value.nonce!==request.nonce
    ||!['passed',...(allowEmpty?['empty']:[])].includes(value.outcome)
    ||!value.output||typeof value.output!=='object'||Array.isArray(value.output)
    ||!Array.isArray(value.checks)||value.checks.length!==request.checks.length
    ||new Set(value.checks.map(c=>c.id)).size!==request.checks.length
    ||request.checks.some(id=>!value.checks.some(c=>c.id===id&&c.status==='passed'&&Array.isArray(c.evidence)&&c.evidence.length
      &&c.evidence.every(e=>typeof e.source==='string'&&e.source.trim()&&e.observation&&typeof e.observation==='object'
        &&!Array.isArray(e.observation)&&Object.keys(e.observation).length))))throw Error('skill_readback_unconfirmed');
  canonical(value);return value;
}
export function codexWorkerArgs(codex,thread,output,auth) {
  return [...(codex.args??[]),...(auth?.args??[]),'exec',...(thread?['resume']:[]),...(auth?['--ignore-user-config']:[]),'--json','--skip-git-repo-check','-o',output,...(thread?[thread]:[]),'-'];
}
export const sameIdentity=(a,b)=>Boolean(a&&b&&digest(a)===digest(b));

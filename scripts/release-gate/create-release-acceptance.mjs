// 将既有业务验收规程绑定到候选，提交现有 Brain 建单接口；不执行/代填验收。
// node scripts/release-gate/create-release-acceptance.mjs <SHA> <api,dashboard|staff-hub> <request.json>
// request.json 使用既有 POST /api/brain/acceptance/runs 形状，携带真实双源版本戳。
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {REPO,parseTargets,releaseContract} from './acceptance-record.mjs';
function need(ok,message){if(!ok)throw new Error(message);}
export function prepareAcceptance(input,{sha,targets}) {
  targets=parseTargets(targets);
  need(/^[a-f0-9]{40}$/.test(sha),'候选SHA无效');
  const draft=structuredClone(input), d=draft.detail||{};
  need(/^[a-zA-Z0-9_.:-]{1,180}$/.test(draft.run_key||'')&&draft.title&&draft.gp_id,'缺验收单身份/业务规程锚');
  need(d.tenant_account&&d.spec_sha,'缺验收租户或规程版本');
  for(const field of ['backend_sha','frontend_sha']) {
    need(/^[a-f0-9]{40}$/.test(d[field]||'')&&d[field]===d[field+'_src2'],'缺真实且一致的双源版本戳');
  }
  for(const field of new Set(targets.map(t=>t==='api'?'backend_sha':'frontend_sha')))need(d[field]===sha,'实测版本不是候选');
  need(!d.gate_verdict&&!d.ai_status&&!draft.status,'不得预填验收状态');
  need(Array.isArray(draft.checks)&&draft.checks.length>0,'缺业务验收规程');
  need(new Set(draft.checks.map(c=>c.check_key)).size===draft.checks.length,'重复验收格');
  for(const c of draft.checks){
    need(/^S\d+-c[1-4]$/.test(c.check_key||'')&&c.name&&['FR','NFR','Invariant','SOP'].includes(c.kind),'验收格不符合既有Brain规程');
    need(!c.result&&!c.adjudication&&!c.ai_verdict,'不得预填业务通过');
  }
  const contract=releaseContract(targets);
  draft.checks=contract.checks;
  draft.detail={...d,spec_sha:contract.spec_sha,source_repo:REPO,environment:'staging',release_targets:targets};
  draft.source='manual';
  return draft;
}
export async function createAcceptance(draft,{baseUrl='http://localhost:5221',fetchImpl=fetch}={}) {
  const response=await fetchImpl(new URL('/api/brain/acceptance/runs',baseUrl),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(draft),redirect:'error',signal:AbortSignal.timeout(20000)});
  need(response.ok,`Brain建单失败HTTP ${response.status}`);
  const record=await response.json();
  for(const field of ['source_repo','environment','backend_sha','frontend_sha','spec_sha'])need(record.run?.detail?.[field]===draft.detail[field],'已有同名验收单与本候选不同');
  need(JSON.stringify(record.run.detail.release_targets)===JSON.stringify(draft.detail.release_targets),'已有单覆盖范围不同');
  return {run_key:record.run.run_key,created:record.created,status:record.run.status};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log(JSON.stringify(await createAcceptance(prepareAcceptance(JSON.parse(readFileSync(process.argv[4],'utf8')),{sha:process.argv[2],targets:process.argv[3]}))));}
 catch(e){console.error(e.message);process.exitCode=1;}
}

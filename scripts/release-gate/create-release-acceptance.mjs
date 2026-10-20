// 建单器读取真实 staging 版本和 GitHub 部署证据，生成固定规程；绝不代填验收。
// node scripts/release-gate/create-release-acceptance.mjs <SHA> <api,dashboard|staff-hub> <request.json>
// request.json 只需 run_key/title/gp_id/detail.tenant_account（其余业务上下文可选）。
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {REPO,parseTargets,releaseContract} from './acceptance-record.mjs';
import {verifyStaging} from './staging-evidence.mjs';
function need(ok,message){if(!ok)throw new Error(message);}
const SHA40=/^[a-f0-9]{40}$/;
// 来自 deploy/nginx.staging.conf 和 deploy/docker-compose.staff-hub-staging.yml。
// Staff Hub 8091 只绑定 Tailscale；不采用任意用户URL，也不关闭TLS校验。
const STAGING_ORIGINS=Object.freeze({
  dashboard:'https://staging-autopilot.zenjoymedia.media',
  'staff-hub':'http://100.86.118.99:8091',
});
function validateIdentity(input) {
  need(input&&typeof input==='object','缺验收申请');
  need(/^[a-zA-Z0-9_.:-]{1,180}$/.test(input.run_key||'')&&input.title&&input.gp_id,'缺验收单身份/业务规程锚');
  need(typeof input.detail?.tenant_account==='string'&&input.detail.tenant_account.trim(),'缺验收租户');
  need(!input.detail.gate_verdict&&!input.detail.ai_status&&!input.status,'不得预填验收状态');
  if(input.checks!==undefined) {
    need(Array.isArray(input.checks),'checks必须为数组');
    for(const check of input.checks)need(check&&!check.result&&!check.adjudication&&!check.ai_verdict,'不得预填业务通过');
  }
}
export function prepareAcceptance(input,{sha,targets}) {
  targets=parseTargets(targets).slice().sort();
  need(SHA40.test(sha),'候选SHA无效');
  validateIdentity(input);
  const draft=structuredClone(input), d=draft.detail;
  for(const field of ['backend_sha','frontend_sha']) {
    need(SHA40.test(d[field]||'')&&d[field]===d[field+'_src2'],'缺真实且一致的双源版本戳');
  }
  for(const field of new Set(targets.map(t=>t==='api'?'backend_sha':'frontend_sha')))need(d[field]===sha,'实测版本不是候选');
  const contract=releaseContract(targets);
  draft.checks=contract.checks;
  draft.detail={...d,spec_sha:contract.spec_sha,source_repo:REPO,environment:'staging',release_targets:targets};
  draft.source='manual';
  return draft;
}
async function readVersion(url,field,fetchImpl) {
  const probe=new URL(url); probe.searchParams.set('release_probe',randomUUID());
  const response=await fetchImpl(probe,{redirect:'error',cache:'no-store',headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(20000)});
  need(response.ok,`读取实际staging版本失败: ${url} HTTP ${response.status}`);
  let body;
  try { body=await response.json(); } catch { throw new Error(`实际staging版本入口${url}未返回JSON版本回执`); }
  const version=field==='backend'?body?.build?.sha:body?.sha;
  need(SHA40.test(version||''),`实际staging版本戳缺失或非法: ${url}`);
  return version;
}
export async function collectStagingVersions({sha,targets,fetchImpl=fetch,api}) {
  need(SHA40.test(sha),'候选SHA无效');
  targets=parseTargets(targets);
  const frontends=targets.filter(t=>t!=='api').sort();
  if(!frontends.length)frontends.push('dashboard');
  const observations=[];
  for(const target of frontends) {
    const origin=STAGING_ORIGINS[target];
    const [backend,frontend]=await Promise.all([
      readVersion(`${origin}/api/health`,'backend',fetchImpl),
      readVersion(`${origin}/release-sha.json`,'frontend',fetchImpl),
    ]);
    if(targets.includes('api'))need(backend===sha,'实际API版本不是候选');
    if(targets.includes(target))need(frontend===sha,`实际${target}版本不是候选`);
    observations.push({target,backend,frontend,backend_url:`${origin}/api/health`,frontend_url:`${origin}/release-sha.json`});
  }
  const backend=observations[0].backend;
  need(observations.every(o=>o.backend===backend),'不同预发入口代理了不同API版本');
  const backendEvidence=verifyStaging({sha:backend,targets:['api'],api})[0];
  const frontendEvidence=observations.map(o=>verifyStaging({sha:o.frontend,targets:[o.target],api})[0]);
  const frontend=observations[0].frontend;
  return {
    backend_sha:backend,backend_sha_src2:backendEvidence.sha,
    frontend_sha:frontend,frontend_sha_src2:frontendEvidence[0].sha,
    version_sources:{observed_at:new Date().toISOString(),backend:backendEvidence,
      frontends:observations.map((o,i)=>({...o,deployment:frontendEvidence[i]}))},
  };
}
export async function createAcceptance(draft,{baseUrl='http://localhost:5221',fetchImpl=fetch}={}) {
  const response=await fetchImpl(new URL('/api/brain/acceptance/runs',baseUrl),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(draft),redirect:'error',signal:AbortSignal.timeout(20000)});
  need(response.ok,`Brain建单失败HTTP ${response.status}`);
  const record=await response.json(), run=record.run;
  need(run?.id&&typeof run.status==='string'&&typeof record.created==='boolean','Brain建单回执身份不完整');
  for(const field of ['run_key','title','gp_id','source'])need(run[field]===draft[field],`已有同名验收单身份不同: ${field}`);
  for(const field of ['source_repo','environment','tenant_account','backend_sha','backend_sha_src2','frontend_sha','frontend_sha_src2','spec_sha','release_targets']) {
    need(isDeepStrictEqual(run.detail?.[field],draft.detail[field]),`已有同名验收单冻结字段不同: ${field}`);
  }
  const contract=releaseContract(draft.detail.release_targets);
  need(draft.detail.spec_sha===contract.spec_sha,'申请规程版本不符');
  need(Array.isArray(record.checks)&&record.checks.length===contract.checks.length,'建单回读缺格或多格');
  const keys=new Set(record.checks.map(c=>c.check_key));
  need(keys.size===contract.checks.length,'建单回读存在重复格');
  for(const expected of contract.checks) {
    const actual=record.checks.find(c=>c.check_key===expected.check_key);
    need(actual?.run_id===run.id&&actual.name===expected.name&&actual.kind===expected.kind,'建单回读验收格不匹配合同或串单');
  }
  return {run_key:run.run_key,created:record.created,status:run.status};
}
export async function createReleaseAcceptance(input,{sha,targets,fetchImpl=fetch,api}={}) {
  validateIdentity(input);
  const versions=await collectStagingVersions({sha,targets,fetchImpl,api});
  const draft=prepareAcceptance({...structuredClone(input),detail:{...input.detail,...versions}},{sha,targets});
  return createAcceptance(draft,{fetchImpl});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log(JSON.stringify(await createReleaseAcceptance(JSON.parse(readFileSync(process.argv[4],'utf8')),{sha:process.argv[2],targets:process.argv[3]})));}
 catch(e){console.error(e.message);process.exitCode=1;}
}

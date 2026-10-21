// 完整整包事务的固定协议；旧候选只能准备实验，不能冒充具备回退能力。
import {commanderMap} from './deployment-targets.mjs';
const need=(ok,message)=>{if(!ok)throw Error('phone deployment protocol: '+message);};
export function verifyTransactionProtocol(bytes){
 const value=JSON.parse(bytes);
 need(JSON.stringify(value)==='{"protocol":"phone-package-transaction-v1"}','unsupported protocol');
 return true;
}
export function inheritedDeploymentStdio(env){
 const values=['WF_DEPLOY_LOCK_FD','WF_DEPLOY_RESPONSE_FD'].map(key=>{
  need(/^[0-9]+$/.test(env[key]||''),'invalid descriptor');const n=Number(env[key]);
  need(Number.isSafeInteger(n)&&n>=3&&n<=1024,'invalid descriptor');return n;
 });
 need(values[0]!==values[1],'duplicate descriptor');
 const stdio=Array(Math.max(...values)+1).fill('ignore');stdio[1]='inherit';stdio[2]='inherit';
 for(const n of values)stdio[n]=n;return stdio;
}
export function restorationPlan(releases,manifests){
 const repo='perfectuser21/zenithjoy-workspace',sha=manifests.mmv.source_commit;
 need(/^[a-f0-9]{40}$/.test(sha),'invalid previous source');
 for(const target of ['xian-m4','mmv']){
  const r=releases[target],m=manifests[target];
  need(r?.id===m?.release_id&&r.target===target&&r.environment==='production','previous native release identity');
  need(m.source_repo===repo&&m.source_commit===sha&&r.payload.components.some(c=>c.kind==='repo'&&c.repo===repo&&c.revision===sha),'previous source mismatch');
 }
 return {source_repo:repo,source_commit:sha,environment:'production',release_ids:Object.fromEntries(Object.entries(releases).map(([host,r])=>[host,r.id])),releases,commander_releases:commanderMap(releases.mmv)};
}

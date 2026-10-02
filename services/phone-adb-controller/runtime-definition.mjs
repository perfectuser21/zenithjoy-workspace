// 运行前只读固定版本；运行目录是之后所有判定与身份解析的唯一来源。
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, rmSync, realpathSync, statSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
export const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k,v[k]])) : v);
export const digest = value => createHash('sha256').update(Buffer.isBuffer(value) || typeof value === 'string' ? value : canonical(value)).digest('hex');
export function localPath(root, relative) {
  if (!relative || relative.startsWith('/') || relative.split('/').includes('..')) throw Error('非法部署路径');
  const p=realpathSync(resolve(root,relative)); const base=realpathSync(root);
  if (!p.startsWith(base+sep)) throw Error('部署路径越界'); return p;
}
function verifyVersion(v, type, id, versionId) {
  if (!v || v.id!==versionId || v.payload?.[`${type}_id`]!==id || !/^[a-f0-9]{40}$/.test(v.source_commit)) throw Error('版本规范身份或固定来源无效');
  const source={repo:v.source_repo,path:v.source_path,commit:v.source_commit};
  if (digest({source,payload:v.payload})!==v.payload_sha256 || digest(v.payload.contract)!==v.contract_sha256) throw Error('版本digest摘要不符');
}
export function readFrozen(runDir) {
  const snapshot=JSON.parse(readFileSync(resolve(runDir,'run-definition.json'),'utf8'));
  const {snapshot_sha256,...body}=snapshot;
  if (digest(body)!==snapshot_sha256) throw Error('运行快照digest不符');
  for (const [file,hash] of Object.entries(snapshot.files)) if (digest(readFileSync(resolve(runDir,file)))!==hash) throw Error(`冻结文件digest不符: ${file}`);
  return snapshot;
}
export async function freezeDefinition(o) {
  if (existsSync(resolve(o.runDir,'run-definition.json'))) return readFrozen(o.runDir);
  const list=await o.get('/api/brain/workflows'); const matches=(Array.isArray(list)?list:list.workflows||[]).filter(w=>w.key===o.workflowKey);
  if(matches.length!==1 || !matches[0].current_definition_version_id) throw Error('工作流必须有唯一已登记current version');
  const w=matches[0]; const version=(await o.get(`/api/brain/workflows/${w.id}/versions/${w.current_definition_version_id}`))?.version;
  verifyVersion(version,'workflow',w.id,w.current_definition_version_id);
  if (!o.rawContractSha256 || version.contract_sha256!==o.rawContractSha256) throw Error('部署计划contract摘要与版本不同');
  const manifest=JSON.parse(readFileSync(o.manifestPath||resolve(o.deploymentRoot,'deployment-manifest.json'),'utf8'));
  if(manifest.source_commit!==version.source_commit || manifest.source_repo!==version.source_repo) throw Error('部署来源与固定版本不同');
  const checked=new Map();
  for (const file of manifest.files||[]) {
    const sourcePath=localPath(o.deploymentRoot,file.deployed_path);
    const bytes=readFileSync(sourcePath); const mode=statSync(sourcePath).mode & 0o555;
    const actual=digest(bytes);
    if(actual!==file.content_sha256) throw Error(`实际部署文件digest不符: ${file.path}`);
    checked.set(file.path,{...file,actual_content_sha256:actual,status:'verified_local',bytes,mode});
  }
  if(!checked.size) throw Error('部署实现清单为空');
  for(const path of [o.planPath,o.stepSpecPath]) if(![...checked.values()].some(file=>localPath(o.deploymentRoot,file.deployed_path)===realpathSync(path))) throw Error('实际plan/step文件不在部署清单manifest');
  const activities=[];
  for(const ref of version.payload.activities||[]) {
    if(!ref.reference_id || !ref.activity_version_id) throw Error('缺少活动使用位置或版本');
    const av=(await o.get(`/api/brain/activities/${ref.activity_id}/versions/${ref.activity_version_id}`))?.version;
    verifyVersion(av,'activity',ref.activity_id,ref.activity_version_id);
    const implementations=(av.payload.implementation_bindings||[]).map(binding=>{
      const deployed=checked.get(binding.path);
      if(binding.status==='verified' && deployed) {
        const expected=binding.content_sha256 || binding.digest?.replace(/^sha256:/,'');
        if(binding.repo!==manifest.source_repo || binding.revision!==manifest.source_commit || expected!==deployed.actual_content_sha256) throw Error(`实现binding digest或来源不符: ${binding.path}`);
        return {...binding,execution_verification:'verified_local',actual_content_sha256:deployed.actual_content_sha256,execution_path:`runtime/${deployed.deployed_path}`};
      }
      return {...binding,execution_verification:'unknown',execution_reason:'not_verified_on_execution_host'};
    });
    const entry=av.payload.contract.runtime?.entry;
    if(entry && !implementations.some(b=>b.execution_verification==='verified_local' && b.path===`services/phone-adb-controller/${entry}`)) throw Error(`运行入口没有本机已核验binding: ${entry}`);
    activities.push({reference:ref,version:av,implementations});
  }
  if(!activities.length) throw Error('运行工作流无活动');
  if(o.activityRefs && o.activityRefs.length!==activities.length) throw Error('部署活动引用数量与版本不同');
  if(o.activityRefs) for(const expected of o.activityRefs){
    const actual=activities.find(a=>a.reference.slot_key===expected.slot_key);
    if(!actual || actual.reference.sequence_no!==expected.sequence_no || actual.version.payload.definition_key!==expected.definition_key || actual.version.contract_sha256!==expected.contract_sha256) throw Error('部署计划活动引用与版本不同');
  }
  const plan=readFileSync(o.planPath); const steps=readFileSync(o.stepSpecPath); JSON.parse(steps);
  const files={'workflow.plan':digest(plan),'step-dod.json':digest(steps)};
  for(const file of checked.values()) files[`runtime/${file.deployed_path}`]=file.actual_content_sha256;
  const body={schema_version:1,workflow_version:version,activities,deployment:manifest,files};
  const snapshot={...body,snapshot_sha256:digest(body)};
  const staging=`${o.runDir}.freeze-${randomUUID()}`; mkdirSync(staging,{recursive:true,mode:0o700});
  try {
    for(const file of checked.values()){
      const target=resolve(staging,'runtime',file.deployed_path);mkdirSync(dirname(target),{recursive:true});
      writeFileSync(target,file.bytes,{mode:file.mode});
    }
    writeFileSync(resolve(staging,'workflow.plan'),plan);writeFileSync(resolve(staging,'step-dod.json'),steps);
    writeFileSync(resolve(staging,'run-definition.json'),JSON.stringify(snapshot,null,2));
    mkdirSync(dirname(o.runDir),{recursive:true}); renameSync(staging,o.runDir);
  } finally {rmSync(staging,{recursive:true,force:true});}
  return snapshot;
}

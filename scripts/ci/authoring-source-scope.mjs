import {greaterVersion} from './authoring-source-version.mjs';
import {isDeepStrictEqual} from 'node:util';

/** 每份固定定义保留其原生来源快照，供scratch登记读回。 */
export async function loadAuthoringScope({api,scope,files,revision,repo,owners,skills,readDefinition,validateSnapshot,digestMapManifest}){
 const active=await api('GET',`map?scope=${scope}`);
 const documents=[],snapshots=new Map();
 for(const path of files){
  const definition=readDefinition(path);
  if(definition.source?.repo!==repo||definition.source.ref!==path||definition.source.revision!==revision)throw Error('AUTHORING_OWNER_SOURCE_CONFLICT');
  const matches=owners.filter(w=>w.key===definition.key);if(matches.length!==1)throw Error('AUTHORING_OWNER_AMBIGUOUS');
  const owner=matches[0],current=(await api('GET',`workflows/${owner.id}/versions/${owner.current_definition_version_id}`)).version;
  if(!current||current.workflow_id!==owner.id||current.id!==owner.current_definition_version_id||current.source_repo!==repo||current.source_path!==path
   ||!/^[a-f0-9]{40}$/.test(current.source_commit||'')||current.payload?.registration_protocol!=='definition-freeze-v1'
   ||current.payload.contract?.key!==definition.key||current.payload.contract.version!==owner.version
   ||definition.capability_id!==owner.capability_id||current.payload.contract.capability_id!==owner.capability_id)throw Error('AUTHORING_OWNER_SOURCE_CONFLICT');
  if(current.source_commit===revision){if(definition.version!==owner.version)throw Error('AUTHORING_SAME_SOURCE_VERSION_CONFLICT');}
  else if(!greaterVersion(definition.version,owner.version))throw Error('AUTHORING_SOURCE_VERSION_BUMP_REQUIRED');
  if(!snapshots.has(current.source_commit)){
   const {snapshot}=await api('GET',`implementation-ci/snapshot?scope=${scope}&repo=${repo}&revision=${current.source_commit}`);
   validateSnapshot(snapshot);snapshots.set(current.source_commit,snapshot);
  }
  const s=snapshots.get(current.source_commit);
  if(s.scope!==scope||s.repo!==repo||s.revision!==current.source_commit)throw Error('AUTHORING_SNAPSHOT_IDENTITY_CONFLICT');
  // 原生snapshot必须仍含这个owner当前冻结seed；不能用另一revision的部分snapshot代替。
  const seeds=s.definitions.workflows.filter(v=>v.id===current.id),canonical=s.canonical.workflows.filter(w=>w.id===owner.id);
  if(seeds.length!==1||['id','workflow_id','source_repo','source_path','source_commit','contract_sha256','payload_sha256','payload']
   .some(key=>!isDeepStrictEqual(seeds[0][key],current[key]))||canonical.length!==1
   ||canonical[0].current_definition_version_id!==current.id||canonical[0].key!==owner.key
   ||canonical[0].version!==owner.version||canonical[0].capability_id!==owner.capability_id)throw Error('AUTHORING_OWNER_SNAPSHOT_CONFLICT');
  documents.push({definition,owner,snapshot:s,skills:skills.filter(x=>x.id===definition.runtime.skill_id||definition.activities.some(a=>a.implementation?.skill_id===x.id))});
 }
 // 逐定义登记并非原子操作。旧snapshot可失去历史map，但scope仍必须有唯一真实active完整map。
 // 不把map塞回旧snapshot、不改它的摘要；来源证据与scope的激活CAS分别保存。
 const manifests=[...snapshots.values()].map(s=>s.map?.manifest).filter(Boolean);
 if(!manifests.length)throw Error('AUTHORING_COMPLETE_MANIFEST_REQUIRED');
 for(const manifest of manifests){
  if(manifest.manifest?.scope_key!==scope||manifest.digest!==digestMapManifest(manifest.manifest))throw Error('AUTHORING_COMPLETE_MANIFEST_REQUIRED');
  if(manifest.id!==active.manifest_version_id||manifest.digest!==active.manifest_digest)throw Error('AUTHORING_MAP_ACTIVE_CHANGED');
 }
 const manifest=manifests[0];
 const provesCapability=(id,snapshot)=>{
  const bindings=manifest.manifest.capabilities.filter(n=>n.brain_binding?.entity_type==='capability'&&n.brain_binding.entity_id===id);
  return bindings.length===1&&bindings[0].brain_binding.source_repo===repo
   &&snapshot.canonical.workflows.some(w=>w.capability_id===id)
   &&snapshot.canonical.journeys.some(j=>j.id===id&&j.parent_journey_id);
 };
 for(const item of documents)if(!provesCapability(item.owner.capability_id,item.snapshot))throw Error('AUTHORING_CAPABILITY_ANCHOR_CONFLICT');
 for(const s of snapshots.values())for(const gap of s.gaps){
  if(gap.code==='scope_manifest_missing'&&!s.map?.manifest&&gap.scope===scope&&gap.revision===s.revision)continue;
  if(gap.code==='workflow_capability_unmapped'){
   if(!provesCapability(gap.capability_id,s))throw Error('AUTHORING_CAPABILITY_ANCHOR_CONFLICT');
   continue;
  }
  if(gap.code==='authoring_definition_missing'&&documents.some(d=>d.definition.key===gap.key))continue;
  if(gap.code==='manifest_source_mismatch'&&s.map?.manifest&&gap.revision===s.revision)continue;
  throw Error('AUTHORING_BASE_SNAPSHOT_UNKNOWN');
 }
 const after=await api('GET',`map?scope=${scope}`);
 if(after.manifest_version_id!==active.manifest_version_id||after.manifest_digest!==active.manifest_digest)throw Error('AUTHORING_MAP_ACTIVE_CHANGED');
 return{scope,documents,manifest};
}

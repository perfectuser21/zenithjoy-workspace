import {greaterVersion} from './authoring-source-version.mjs';

/** 每份固定定义保留其原生来源快照，供scratch登记读回。 */
export async function loadAuthoringScope({api,scope,files,revision,repo,owners,skills,readDefinition,validateSnapshot,digestMapManifest}){
 const documents=[];let snapshot;
 for(const path of files){
  const definition=readDefinition(path);
  const matches=owners.filter(w=>w.key===definition.key);if(matches.length!==1)throw Error('AUTHORING_OWNER_AMBIGUOUS');
  const owner=matches[0],current=(await api('GET',`workflows/${owner.id}/versions/${owner.current_definition_version_id}`)).version;
  if(current.workflow_id!==owner.id||current.id!==owner.current_definition_version_id||current.source_repo!==repo||current.source_path!==path||current.payload.registration_protocol!=='definition-freeze-v1')throw Error('AUTHORING_OWNER_SOURCE_CONFLICT');
  if(current.source_commit===revision){if(definition.version!==owner.version)throw Error('AUTHORING_SAME_SOURCE_VERSION_CONFLICT');}
  else if(!greaterVersion(definition.version,owner.version))throw Error('AUTHORING_SOURCE_VERSION_BUMP_REQUIRED');
  const body=await api('GET',`implementation-ci/snapshot?scope=${scope}&repo=${repo}&revision=${current.source_commit}`);
  const s=body.snapshot;validateSnapshot(s);
  if(s.scope!==scope||s.repo!==repo||s.revision!==current.source_commit)throw Error('AUTHORING_SNAPSHOT_IDENTITY_CONFLICT');
  if(!s.map?.manifest||s.map.manifest.digest!==digestMapManifest(s.map.manifest.manifest))throw Error('AUTHORING_COMPLETE_MANIFEST_REQUIRED');
  if(!s.gaps.every(g=>['authoring_definition_missing','manifest_source_mismatch','workflow_capability_unmapped'].includes(g.code)))throw Error('AUTHORING_BASE_SNAPSHOT_UNKNOWN');
  if(snapshot&&snapshot.map.manifest.id!==s.map.manifest.id)throw Error('AUTHORING_MAP_CHANGED');snapshot=s;
  documents.push({definition,owner,snapshot:s,skills:skills.filter(x=>x.id===definition.runtime.skill_id||definition.activities.some(a=>a.implementation?.skill_id===x.id))});
 }
 return{scope,documents,manifest:snapshot.map.manifest};
}

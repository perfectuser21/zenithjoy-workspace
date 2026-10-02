// Release索引提供完整历史定义；不以current指针补全缺失版本。
export async function loadRuntimeRelease(options,manifest,digest){
 const id=options.releaseId||manifest.release_id;
 if(!id || manifest.release_id!==id || !manifest.observation_id)throw Error('release与部署观测身份不匹配');
 const release=(await options.get(`/api/brain/releases/${encodeURIComponent(id)}`))?.release;
 if(!release || release.id!==id)throw Error('release身份不匹配');
 if(release.manifest_sha256!==digest({environment:release.environment,target:release.target,payload:release.payload}))throw Error('release摘要不符');
 if(release.environment!==manifest.environment || release.target!==manifest.target)throw Error('release与实际部署目标不匹配');
 const versions=release.payload?.workflows||[];
 const matches=versions.filter(v=>v.payload?.workflow_id===options.workflowKey || v.payload?.key===options.workflowKey);
 if(matches.length!==1)throw Error('release必须包含唯一明确工作流身份');
 const version=matches[0];
 return {release,version,activityVersion(ref){
  const matches=(release.payload.activities||[]).filter(v=>v.id===ref.activity_version_id && v.payload?.activity_id===ref.activity_id);
  if(matches.length!==1)throw Error('release缺少唯一活动版本');return matches[0];
 }};
}

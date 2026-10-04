import { readFileSync,writeFileSync,mkdirSync,renameSync } from 'node:fs';
import { join } from 'node:path';
// Release索引提供完整历史定义；不以current指针补全缺失版本。
// release_versions 不可变（manifest_sha256 摘要）：校验通过后落 releaseCacheDir，下批先读缓存、同一摘要规则复核，
// 通过就不再跨境下载整包；缓存缺失/损坏/摘要不符一律丢弃，回 Brain 重取（Brain 的那份仍要过同一摘要校验）。
const sealed=(release,id,digest)=>release && release.id===id
 && release.manifest_sha256===digest({environment:release.environment,target:release.target,payload:release.payload});
function readCached(dir,id,digest){
 if(!dir)return null;
 try{const release=JSON.parse(readFileSync(join(dir,`${encodeURIComponent(id)}.json`),'utf8'));return sealed(release,id,digest)?release:null;}
 catch{return null;}
}
function writeCached(dir,release){
 if(!dir)return;
 try{mkdirSync(dir,{recursive:true});const path=join(dir,`${encodeURIComponent(release.id)}.json`),tmp=`${path}.${process.pid}.tmp`;
  writeFileSync(tmp,JSON.stringify(release));renameSync(tmp,path);}
 catch{/* 缓存只是加速，写失败不影响本批 */}
}
export async function loadRuntimeRelease(options,manifest,digest){
 const id=options.releaseId||manifest.release_id;
 if(!id || manifest.release_id!==id || !manifest.observation_id)throw Error('release与部署观测身份不匹配');
 let release=readCached(options.releaseCacheDir,id,digest);
 if(!release){
  release=(await options.get(`/api/brain/releases/${encodeURIComponent(id)}`))?.release;
  if(!release || release.id!==id)throw Error('release身份不匹配');
  if(!sealed(release,id,digest))throw Error('release摘要不符');
  writeCached(options.releaseCacheDir,release);
 }
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

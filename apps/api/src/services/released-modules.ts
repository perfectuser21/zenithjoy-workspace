import legacy from './install-pack-legacy-modules.json';
import type {ModuleDescriptor} from './walking-skeleton.service';
import {readInstallPackManifest} from './install-pack-manifest';
// 无正式模块清单的旧分发保留原有选择；候选目录永远不参与心跳。
export function selectReleasedModules(baseline:Record<string,ModuleDescriptor>,manifest:unknown=readInstallPackManifest(undefined,true)):Record<string,ModuleDescriptor>{
 const modules=(manifest as {modules?:unknown}|null)?.modules;
 if(modules===undefined){
  if(manifest && ('release_journal' in Object(manifest)||'release_receipt' in Object(manifest)))throw Error('admitted manifest lost module inventory');
  const pinned:Record<string,ModuleDescriptor>={};
  for(const [key,descriptor]of Object.entries(baseline)){
   const version=(legacy.versions as Record<string,string>)[key];
   if(!version)throw Error('new module requires admitted release');
   pinned[key]={...descriptor,required_version:version};
  }
  return pinned;
 }
 if(!Array.isArray(modules)||modules.length!==Object.keys(baseline).length)throw Error('invalid admitted module inventory');
 const selected:Record<string,ModuleDescriptor>={};
 for(const m of modules){
  if(!m||!Object.prototype.hasOwnProperty.call(baseline,m.line_id)||Object.prototype.hasOwnProperty.call(selected,m.line_id))throw Error('invalid admitted module');
  const version=String(m.filename).match(new RegExp('^'+m.line_id+'-v([0-9]+\\.[0-9]+\\.[0-9]+)\\.tar\\.gz$'))?.[1];
  if(!version)throw Error('invalid admitted module version');
  selected[m.line_id]={...baseline[m.line_id],required_version:version};
 }
 return selected;
}

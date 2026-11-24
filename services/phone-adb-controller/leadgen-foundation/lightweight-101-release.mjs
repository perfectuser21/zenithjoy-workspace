import {buildSync} from 'esbuild';
import {readFileSync,writeFileSync} from 'node:fs';
import {isBuiltin} from 'node:module';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'yaml';
import {hash} from './context.mjs';
import {projectAgentProfile,verifyAgentProfile} from './profile-contract.mjs';

const defaultRoot=fileURLToPath(new URL('../../../',import.meta.url));
const sourcePrefix='services/phone-adb-controller/';
const workflow='douyin_video_discovery';

export function generateLightweight101Profile(repoRoot=defaultRoot){
  const read=name=>readFileSync(join(repoRoot,name));
  const original=JSON.parse(read(sourcePrefix+'leadgen-foundation/profiles/101.json'));
  const originalSkillCount=Object.keys(original.profile.files).filter(name=>name.startsWith(sourcePrefix+'skills/')).length;
  const entry=sourcePrefix+'leadgen-foundation/lightweight-101-worker.mjs';
  // The bundler resolves the dependency graph without executing any worker source.
  // Publish original source bytes and hashes rather than generated/transformed code.
  const {metafile}=buildSync({absWorkingDir:repoRoot,entryPoints:[entry],bundle:true,write:false,
    platform:'node',format:'esm',packages:'external',metafile:true,logLevel:'silent'});
  if(Object.values(metafile.inputs).some(input=>input.imports.some(dep=>dep.external&&!isBuiltin(dep.path))))
    throw Error('LIGHT101_EXTERNAL_DEPENDENCY');
  for(const file of Object.keys(metafile.inputs).sort()){
    if(!file.startsWith(sourcePrefix)||file.split('/').includes('..'))throw Error('LIGHT101_SOURCE_SCOPE');
    original.profile.files[file]=hash(read(file));
  }
  const files=Object.keys(original.profile.files);
  if(files.length>200||files.filter(name=>name.startsWith(sourcePrefix+'skills/')).length!==originalSkillCount)
    throw Error('LIGHT101_SOURCE_LIMIT');
  original.profile.leadgen.discovery_variant='lightweight-host-script-v1';
  const documents=Object.fromEntries([workflow,'douyin_video_processing','douyin_comment_scoring','douyin_lead_outreach']
    .map(key=>[key,parse(read('product-map/contracts/'+key+'.yaml').toString('utf8'))]));
  const result=projectAgentProfile(original,{documents,workflow});
  verifyAgentProfile(result,{documents,workflow});
  return result;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [output,...extra]=process.argv.slice(2);
  if(!output||extra.length)throw Error('Usage: node lightweight-101-release.mjs <new-profile-output.json>');
  const profile=generateLightweight101Profile();
  writeFileSync(resolve(output),JSON.stringify(profile,null,2)+'\n',{flag:'wx',mode:0o600});
}

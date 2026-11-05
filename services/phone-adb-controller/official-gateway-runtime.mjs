// Audited raw-model source policy. File pins do not attest a process's loaded memory.
import {openSync,closeSync,fstatSync,readFileSync,lstatSync,constants,realpathSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const fail=()=>Error('OFFICIAL_CONTROL_GATEWAY_RUNTIME'),sha=b=>createHash('sha256').update(b).digest('hex');
function read(path){const st=lstatSync(path);if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o022)||![0,process.getuid()].includes(st.uid)||st.size>16*1024*1024)throw fail();const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const a=fstatSync(fd),bytes=readFileSync(fd),z=fstatSync(fd);if(a.dev!==st.dev||a.ino!==st.ino||z.dev!==a.dev||z.ino!==a.ino||z.size!==a.size||z.mtimeMs!==a.mtimeMs)throw fail();return bytes;}finally{closeSync(fd);}}
export function verifyOfficialGatewayRuntime({runtimeRoot,source,gatewayVersion}){
 try{
  if(!isAbsolute(runtimeRoot||'')||!/^[a-f0-9]{40}$/.test(source?.commit||'')||!Array.isArray(source.files))throw fail();
  for(const name of ['official-gateway-runtime.mjs','official-gateway-runtime.json']){
   const entries=source.files.filter(e=>e.path===name);if(entries.length!==1||!/^[a-f0-9]{64}$/.test(entries[0].sha256)||sha(read(join(runtimeRoot,name)))!==entries[0].sha256)throw fail();
   if(name.endsWith('.mjs')&&sha(read(fileURLToPath(import.meta.url)))!==entries[0].sha256)throw fail();
  }
  const bytes=read(join(runtimeRoot,'official-gateway-runtime.json')),policy=JSON.parse(bytes);
  if(Object.keys(policy).sort().join(',')!=='agent_config_path,files,gateway_version,package_root,schema_version'||policy.schema_version!==1||policy.gateway_version!=='2026.9.8'||gatewayVersion!==policy.gateway_version||!isAbsolute(policy.package_root)||realpathSync(policy.package_root)!==policy.package_root||!Array.isArray(policy.files)||policy.files.length!==7)throw fail();
  const root=lstatSync(policy.package_root);if(!root.isDirectory()||root.isSymbolicLink()||(root.mode&0o022)||![0,process.getuid()].includes(root.uid)||JSON.parse(read(join(policy.package_root,'package.json'))).version!==policy.gateway_version)throw fail();
  if(!isAbsolute(policy.agent_config_path||'')||realpathSync(policy.agent_config_path)!==policy.agent_config_path)throw fail();
  const cs=lstatSync(policy.agent_config_path);if(cs.uid!==process.getuid()||(cs.mode&0o777)!==0o600)throw fail();
  const config=JSON.parse(read(policy.agent_config_path)),projection={};for(const agent of ['skill-factory','work-commander']){const m=config.agents?.entries?.[agent]?.model;if(!m||m.primary!=='openai/gpt-6.1-sol'||!Array.isArray(m.fallbacks)||m.fallbacks.length)throw fail();projection[agent]={primary:m.primary,fallbacks:[]};}
  const seen=new Set();for(const f of policy.files){if(Object.keys(f).sort().join(',')!=='path,sha256'||!/^dist\/[A-Za-z0-9_.-]+\.mjs$/.test(f.path)||seen.has(f.path)||!/^[a-f0-9]{64}$/.test(f.sha256)||sha(read(join(policy.package_root,f.path)))!==f.sha256)throw fail();seen.add(f.path);}
  return Object.freeze({source_policy_verified:true,model_policy_sha256:sha(JSON.stringify(projection)),gateway_version:gatewayVersion,descriptor_sha256:sha(bytes),verified_files:7,loaded_process_attested:false,trust_assumption:'Gateway hello version and audited installed distribution source; loaded process memory is not attested'});
 }catch{throw fail();}
}

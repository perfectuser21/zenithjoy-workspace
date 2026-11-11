// Private deployment material. Never print a plan: it contains service credentials.
import {createHash} from 'node:crypto';
import {readFileSync, lstatSync, realpathSync, mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {join, resolve, basename, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

const need=(ok,message)=>{if(!ok)throw Error('Video tools release refused: '+message);};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const credentials=['DASHSCOPE_API_KEY','ALIYUN_ACCESS_KEY_ID','ALIYUN_ACCESS_KEY_SECRET',
  'COS_SECRET_ID','COS_SECRET_KEY','COS_BUCKET','COS_REGION'];
export function createPlan(roster,{sha,image,base}){
  need(/^[a-f0-9]{40}$/.test(sha)&&roster?.source_commit===sha&&roster.schema_version===1,'fixed source mismatch');
  need(/^sha256:[a-f0-9]{64}$/.test(image),'immutable canvas image required');
  const environment=roster.environment||'production';
  need(['production','staging'].includes(environment),'invalid target environment');
  need(environment==='staging'||base===undefined,'production cannot inherit staging settings');
  const apiService=environment==='staging'?'zenithjoy-api-staging':'zenithjoy-api-prod';
  const origin=new URL(roster.origin);
  need(origin.protocol==='https:'&&origin.origin===roster.origin&&!origin.username&&!origin.password,'HTTPS origin required');
  need(Array.isArray(roster.users)&&roster.users.length>0&&roster.users.length<=20,'explicit employee roster required');
  const instances=environment==='staging'?JSON.parse(base?.environment?.CREATIVE_CANVAS_INSTANCES||'{}'):{};
  const serviceTokens=environment==='staging'?JSON.parse(base?.environment?.CREATIVE_CANVAS_SERVICE_TOKENS||'{}'):{};
  need(instances&&typeof instances==='object'&&!Array.isArray(instances)&&serviceTokens&&typeof serviceTokens==='object'&&!Array.isArray(serviceTokens),'invalid retained staging mapping');
  const replacing=new Set(roster.users.filter(u=>Object.hasOwn(instances,u.id)).map(u=>u.id));
  for(const id of replacing){
    need(base?.stopped_handoffs?.[id]?.instance===instances[id]&&base.stopped_handoffs[id].token===serviceTokens[id],'existing employee requires a verified stopped-instance maintenance handoff');
    delete instances[id];delete serviceTokens[id];
  }
  const ids=new Set(Object.keys(instances)),emails=new Set(),tokens=new Set(Object.values(serviceTokens)),services={},networks={},volumes={};
  for(const user of roster.users){
    need(typeof user.id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(user.id),'invalid employee ID');
    need(typeof user.email==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)&&user.email===user.email.toLowerCase(),'canonical employee email required');
    need(typeof user.token==='string'&&/^[A-Za-z0-9_-]{32,512}$/.test(user.token),'private instance token required');
    need(!ids.has(user.id)&&!emails.has(user.email)&&!tokens.has(user.token),'duplicate employee or service token');
    ids.add(user.id);emails.add(user.email);tokens.add(user.token);
    const key=digest(user.id).slice(0,20), prefix=environment==='staging'?'zj-canvas-stage':'zj-canvas',name=`${prefix}-${sha.slice(0,12)}-${key}`, network=`${name}-net`,volume=`${prefix}-user-${key}-data`;
    networks[network]={name:network};volumes[volume]={name:volume};
    instances[user.id]=`http://${name}:8188`;serviceTokens[user.id]=user.token;
    services[name]={image,container_name:name,restart:'unless-stopped',networks:[network],
      environment:{ZENITHJOY_CANVAS_API:`http://${apiService}:5200`,ZENITHJOY_CANVAS_TOKEN:user.token},
      labels:{'org.opencontainers.image.revision':sha,'com.zenithjoy.canvas.employee':user.id},
      volumes:[`${volume}:/data`],read_only:true,tmpfs:['/tmp:size=256m,mode=1777'],cap_drop:['ALL'],security_opt:['no-new-privileges:true'],mem_limit:'1g',
      healthcheck:{test:['CMD','python','-c',"import urllib.request; urllib.request.urlopen('http://127.0.0.1:8188/system_stats', timeout=3).read()"],interval:'15s',timeout:'5s',retries:8,start_period:'60s'}};
  }
  const providerEnv={};
  for(const key of credentials){need(typeof roster.providers?.[key]==='string'&&roster.providers[key].trim()&&!/[\r\n\0$]/.test(roster.providers[key]),'missing or unsafe provider credential: '+key);providerEnv[key]=roster.providers[key];}
  for(const key of ['DASHSCOPE_BASE_URL','DASHSCOPE_WORKSPACE_ID','ALI_VIDEO_HTTPS_PROXY']){
    if(roster.providers[key]!==undefined){need(typeof roster.providers[key]==='string'&&!/[\r\n\0]/.test(roster.providers[key]),'invalid production provider setting');providerEnv[key]=roster.providers[key];}
  }
  need(new Set(Object.values(instances)).size===Object.keys(instances).length,'shared retained canvas instance');
  const baseNetworks=base?.networks||['zenithjoy-net'];
  need(Array.isArray(baseNetworks)&&baseNetworks.every(n=>/^[a-zA-Z0-9_.-]+$/.test(n)),'invalid API network baseline');
  const apiNetworks=Object.fromEntries([...new Set([...baseNetworks,...Object.keys(networks)])].map(name=>[name,{name,external:true}]));
  const extraEnvironment=environment==='staging'?{STAFF_EMAILS:[...new Set([...(base?.environment?.STAFF_EMAILS||'').split(',').map(s=>s.trim()).filter(Boolean),...roster.users.map(u=>u.email)])].join(',')}:{};
  const origins=[...new Set([...(base?.environment?.CREATIVE_CANVAS_ALLOWED_ORIGINS||'').split(',').filter(Boolean),roster.origin])].join(',');
  const apiOverlay={services:{[apiService]:{networks:Object.keys(apiNetworks),environment:{...providerEnv,...extraEnvironment,CREATIVE_CANVAS_INSTANCES:JSON.stringify(instances),CREATIVE_CANVAS_SERVICE_TOKENS:JSON.stringify(serviceTokens),CREATIVE_CANVAS_ALLOWED_ORIGINS:origins}}},networks:apiNetworks};
  return {schema_version:1,source_commit:sha,image,environment,api_service:apiService,...(base?{base}:{}),users:roster.users.map(({id,email})=>({id,email})),compose:{services,networks,volumes},apiOverlay};
}
export function readPrivate(path){
  const full=resolve(path),st=lstatSync(full);
  need(st.isFile()&&!st.isSymbolicLink()&&realpathSync(full)===full&&st.uid===process.getuid()&&(st.mode&0o777)===0o600,'private file must be canonical, owned and mode 600');
  need(st.size<=1048576,'private configuration too large');
  return readFileSync(full,'utf8');
}
function readPlan(path){
  const plan=JSON.parse(readPrivate(path));
  const prepared=JSON.parse(readPrivate(join(resolve(path,'..'),'video-tools-prepared.json')));
  need(prepared.source_commit===plan.source_commit&&prepared.plan_sha256===digest(plan)&&prepared.overlay_sha256===digest(plan.apiOverlay),'private plan or metadata changed');
  need((prepared.api_source_commit||prepared.source_commit)===basename(dirname(resolve(path))),'private plan belongs to another API release');
  return plan;
}
function immutableWrite(path,value){
  const bytes=JSON.stringify(value,null,2)+'\n';
  if(existsSync(path)){need(readPrivate(path)===bytes,'prepared configuration changed for retained SHA');return;}
  writeFileSync(path,bytes,{flag:'wx',mode:0o600});
}
export function writePrepared(root,rosterPath,plan){
  const roster=JSON.parse(readPrivate(rosterPath));
  need(JSON.stringify(createPlan(roster,{sha:plan.source_commit,image:plan.image,base:plan.base}))===JSON.stringify(plan),'roster differs from prepared plan');
  const directory=join(resolve(root),plan.source_commit);
  mkdirSync(directory,{recursive:true,mode:0o700});
  need(!lstatSync(directory).isSymbolicLink()&&realpathSync(directory)===directory,'unsafe release directory');
  if(plan.environment==='production'&&existsSync(join(directory,'release.json'))){
    const release=JSON.parse(readPrivate(join(directory,'release.json')));
    need(release.video_tools_sha256===digest(plan.apiOverlay),'cannot retrofit a retained production release; stage a fresh candidate');
  }
  immutableWrite(join(directory,'canvas-plan.json'),plan);
  immutableWrite(join(directory,'canvas-compose.json'),plan.compose);
  immutableWrite(join(directory,'video-tools.json'),plan.apiOverlay);
  immutableWrite(join(directory,'video-tools-prepared.json'),{schema_version:1,source_commit:plan.source_commit,api_source_commit:plan.source_commit,plan_sha256:digest(plan),overlay_sha256:digest(plan.apiOverlay)});
}
export function inheritPrepared(root,current,target){
  need(/^[a-f0-9]{40}$/.test(current)&&/^[a-f0-9]{40}$/.test(target)&&current!==target,'invalid inheritance source');
  const source=join(resolve(root),current),destination=join(resolve(root),target);
  const release=JSON.parse(readPrivate(join(source,'release.json'))),plan=readPlan(join(source,'canvas-plan.json'));
  need(release.verified===true&&release.sha===current&&release.video_tools_sha256===digest(plan.apiOverlay),'current private configuration is not a retained verified release');
  need(!existsSync(join(destination,'release.json')),'target is already retained');
  mkdirSync(destination,{recursive:true,mode:0o700});
  immutableWrite(join(destination,'canvas-plan.json'),plan);
  immutableWrite(join(destination,'video-tools.json'),plan.apiOverlay);
  immutableWrite(join(destination,'video-tools-prepared.json'),{schema_version:1,source_commit:plan.source_commit,api_source_commit:target,inherited_from:current,plan_sha256:digest(plan),overlay_sha256:digest(plan.apiOverlay)});
}
export function validateReadback(plan,{containers,api},requireApi=true){
  const expected=Object.values(plan.compose.services);
  need(Array.isArray(containers)&&containers.length===expected.length,'instance count differs');
  for(const service of expected){
    const current=containers.find(c=>c.name===service.container_name);
    need(current&&current.image===plan.image&&current.healthy===true,'instance image or health differs');
    need(current.ports.length===0&&JSON.stringify([...current.networks].sort())===JSON.stringify(service.networks),'instance network or host exposure differs');
    need(current.volume===service.volumes[0].split(':')[0]&&current.token===service.environment.ZENITHJOY_CANVAS_TOKEN&&current.api===service.environment.ZENITHJOY_CANVAS_API,'instance volume or private identity differs');
  }
  if(requireApi){
    const desired=plan.apiOverlay.services[plan.api_service];
    need(api&&desired.networks.every(n=>api.networks.includes(n)),'API private networks absent');
    for(const [key,value] of Object.entries(desired.environment))need(api.environment[key]===value,'API configuration mismatch: '+key);
  }
  return {verified:true,source_commit:plan.source_commit,instances:expected.length};
}
export function inspectRuntime(plan,requireApi=true,exec=execFileSync){
  const inspect=name=>JSON.parse(exec('docker',['inspect',name],{encoding:'utf8',stdio:['ignore','pipe','pipe']}))[0];
  const environment=c=>Object.fromEntries(c.Config.Env.map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}));
  const containers=Object.values(plan.compose.services).map(service=>{
    const c=inspect(service.container_name),e=environment(c);
    return {name:service.container_name,image:c.Image,healthy:c.State.Health?.Status==='healthy',ports:Object.values(c.HostConfig.PortBindings||{}).filter(Boolean),networks:Object.keys(c.NetworkSettings.Networks),volume:c.Mounts.find(m=>m.Destination==='/data')?.Name,token:e.ZENITHJOY_CANVAS_TOKEN,api:e.ZENITHJOY_CANVAS_API};
  });
  let api;
  if(requireApi){const c=inspect(plan.api_service);api={environment:environment(c),networks:Object.keys(c.NetworkSettings.Networks)};}
  for(const name of Object.keys(plan.compose.networks)){
    const n=JSON.parse(exec('docker',['network','inspect',name],{encoding:'utf8',stdio:['ignore','pipe','pipe']}))[0];
    const allowed=new Set([plan.api_service,...Object.values(plan.compose.services).filter(s=>s.networks.includes(name)).map(s=>s.container_name)]);
    need(Object.values(n.Containers||{}).every(c=>allowed.has(c.Name)),'unexpected container on employee network');
  }
  const result=validateReadback(plan,{containers,api},requireApi);
  const probe=readFileSync(new URL('./canvas-capabilities.py',import.meta.url),'utf8');
  for(const service of Object.values(plan.compose.services)){
    const reply=JSON.parse(exec('docker',['exec',service.container_name,'python','-c',probe],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,maxBuffer:65536}));
    need(reply?.verified===true&&Array.isArray(reply.nodes)&&Array.isArray(reply.templates),'instance capability check did not return verified evidence');
  }
  return result;
}
export function mergeImage(root,sha,image,service){
  need(/^[a-f0-9]{40}$/.test(sha)&&/^sha256:[a-f0-9]{64}$/.test(image),'invalid fixed API image');
  const plan=readPlan(join(resolve(root),sha,'canvas-plan.json'));
  need(plan.source_commit===sha&&plan.api_service===service,'API overlay target differs');
  const output=structuredClone(plan.apiOverlay);output.services[service].image=image;
  const file=join(resolve(root),sha,'image.json');
  // Only the image selector is mutable during staging image loading. The private
  // configuration it includes is bound to the immutable prepared plan above.
  writeFileSync(file,JSON.stringify(output)+'\n',{mode:0o600});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const [action,...args]=process.argv.slice(2);
    if(action==='prepare'){
      const [root,rosterPath,sha,image,basePath]=args;const roster=JSON.parse(readPrivate(rosterPath));const base=basePath?JSON.parse(readPrivate(basePath)):undefined;const plan=createPlan(roster,{sha,image,base});writePrepared(root,rosterPath,plan);
      console.log(JSON.stringify({prepared:true,source_commit:sha,instances:plan.users.length}));
    }else if(action==='verify'||action==='verify-instances'){
      const plan=readPlan(args[0]),prepared=JSON.parse(readPrivate(join(dirname(resolve(args[0])),'video-tools-prepared.json')));
      console.log(JSON.stringify({...inspectRuntime(plan,action==='verify'),canvas_source_commit:plan.source_commit,api_source_commit:prepared.api_source_commit||prepared.source_commit}));
    }else if(action==='merge-image'){
      mergeImage(...args);
    }else if(action==='inherit'){
      inheritPrepared(...args);
    }else throw Error('usage: prepare ROOT ROSTER SHA IMAGE | verify PLAN | verify-instances PLAN');
  }catch(error){console.error(error.message);process.exitCode=1;}
}

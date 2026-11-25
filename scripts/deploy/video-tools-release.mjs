// Private deployment material. Never print a plan: it contains service credentials.
import {randomUUID} from 'node:crypto';
import {readFileSync, lstatSync, realpathSync, writeFileSync, existsSync, renameSync, unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const need=(ok,message)=>{if(!ok)throw Error('Video tools release refused: '+message);};
const credentials=['DASHSCOPE_API_KEY','ALIYUN_ACCESS_KEY_ID','ALIYUN_ACCESS_KEY_SECRET',
  'COS_SECRET_ID','COS_SECRET_KEY','COS_BUCKET','COS_REGION'];
const providerOptions=['DASHSCOPE_BASE_URL','DASHSCOPE_WORKSPACE_ID','ALI_VIDEO_HTTPS_PROXY'];
const retiredCanvasEnvironment={
  CREATIVE_CANVAS_INSTANCES:'{}',
  CREATIVE_CANVAS_SERVICE_TOKENS:'{}',
  CREATIVE_CANVAS_ALLOWED_ORIGINS:'',
};
const canvasNetwork = name => /^(?:zj-canvas-(?:stage-)?[a-f0-9]{12}-[a-f0-9]{20}-net|(?:zenithjoy-)?canvas-staging-net)$/.test(name);
export function readPrivate(path){
  const full=resolve(path),st=lstatSync(full);
  need(st.isFile()&&!st.isSymbolicLink()&&realpathSync(full)===full&&st.uid===process.getuid()&&(st.mode&0o777)===0o600,'private file must be canonical, owned and mode 600');
  need(st.size<=1048576,'private configuration too large');
  return readFileSync(full,'utf8');
}
function stageWithoutCanvas(service, image, input, file, restore) {
  need(service==='zenithjoy-api-staging'&&/^sha256:[a-f0-9]{64}$/.test(image),'fixed staging image required');
  const previous=JSON.parse(readPrivate(input));
  const previousService=previous.services?.[service];
  need(previousService&&typeof previousService==='object','previous staging service missing');
  const previousEnv=previousService.environment||{};
  need(typeof previousEnv==='object'&&!Array.isArray(previousEnv),'invalid staging environment');
  const unsetCanvas=Object.keys(retiredCanvasEnvironment).some(key=>Object.hasOwn(previousEnv,key));
  let output;
  if(restore) {
    previousService.image=image;
    if(unsetCanvas) Object.assign(previousEnv,retiredCanvasEnvironment);
    if(previousService.environment||unsetCanvas) previousService.environment=previousEnv;
    if(Array.isArray(previousService.networks)) previousService.networks=previousService.networks.filter(name=>!canvasNetwork(name));
    else for(const name of Object.keys(previousService.networks||{})) {
      if(canvasNetwork(name)||canvasNetwork(previous.networks?.[name]?.name||'')) delete previousService.networks[name];
    }
    for(const name of Object.keys(previous.networks||{})) {
      if(canvasNetwork(name)||canvasNetwork(previous.networks[name]?.name||'')) delete previous.networks[name];
    }
    output=previous;
  } else {
    const environment={...retiredCanvasEnvironment};
    for(const key of [...credentials,...providerOptions,'STAFF_EMAILS']) {
      const value=previousEnv[key];
      if(value!==undefined&&value!==null) {
        need(typeof value==='string'&&!/[\r\n\0]/.test(value),'unsafe staging provider setting: '+key);
        environment[key]=value.replaceAll('$','$$$$');
      }
    }
    output={services:{[service]:{image,environment}}};
  }
  const temporary=file+'.'+randomUUID();
  writeFileSync(temporary,JSON.stringify(output)+'\n',{flag:'wx',mode:0o600});
  try { renameSync(temporary,file); } finally { if(existsSync(temporary)) unlinkSync(temporary); }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const [action,...args]=process.argv.slice(2);
    if(action==='stage-without-comfy'||action==='restore-stage-without-comfy'){
      stageWithoutCanvas(...args.slice(0,4),action==='restore-stage-without-comfy');
    }else throw Error('usage: stage-without-comfy|restore-stage-without-comfy SERVICE IMAGE INPUT OUTPUT');
  }catch(error){console.error(error.message);process.exitCode=1;}
}

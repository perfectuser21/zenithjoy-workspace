// Runtime loading uses only frozen artifact bytes. No package search or installer.
import {openSync,closeSync,fstatSync,lstatSync,readFileSync,realpathSync,constants} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';

const names=['official-gateway-dependencies.mjs','vendor/official-gateway-sdk.json','vendor/official-gateway-client.mjs','vendor/official-gateway-client.LICENSE.txt'];
const fail=()=>Object.assign(Error('OFFICIAL_GATEWAY_DEPENDENCIES_UNVERIFIED'),{code:'OFFICIAL_GATEWAY_DEPENDENCIES_UNVERIFIED'});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function snapshot(root,path){
 let fd;
 try{
  const target=join(root,path);
  if(realpathSync(dirname(target))!==dirname(target))throw fail();
  fd=openSync(target,constants.O_RDONLY|constants.O_NOFOLLOW);
  const before=fstatSync(fd),seen=lstatSync(target);
  if(!before.isFile()||seen.isSymbolicLink()||before.uid!==process.getuid()||(before.mode&0o022)||before.nlink!==1||before.size>4*1024*1024
   ||before.dev!==seen.dev||before.ino!==seen.ino)throw fail();
  const bytes=readFileSync(fd),after=fstatSync(fd),last=lstatSync(target);
  if(bytes.length!==before.size||['dev','ino','size','ctimeMs'].some(key=>before[key]!==after[key])||last.dev!==before.dev||last.ino!==before.ino)throw fail();
  return bytes;
 }catch{throw fail();}finally{if(fd!==undefined)closeSync(fd);}
}

export async function loadOfficialGatewayDependencies({runtimeRoot,source}={}){
 try{
  const own=dirname(fileURLToPath(import.meta.url));
  if(typeof runtimeRoot!=='string'||resolve(runtimeRoot)!==runtimeRoot||realpathSync(runtimeRoot)!==runtimeRoot||runtimeRoot!==own
   ||!/^[a-f0-9]{40}$/.test(source?.commit||'')||!Array.isArray(source.files))throw fail();
  const bytes=new Map();
  for(const name of names){
   const entries=source.files.filter(entry=>entry.path===name);
   if(entries.length!==1||!/^[a-f0-9]{64}$/.test(entries[0].sha256||''))throw fail();
   const data=snapshot(runtimeRoot,name);if(sha(data)!==entries[0].sha256)throw fail();bytes.set(name,data);
  }
  const manifest=JSON.parse(bytes.get(names[1]).toString('utf8'));
  if(manifest.version!==1||manifest.gateway_client!=='2026.8.1'||manifest.websocket!=='8.21.3'||manifest.protocol!==4
   ||manifest.module_sha256!==sha(bytes.get(names[2]))||manifest.license_sha256!==sha(bytes.get(names[3]))
   ||manifest.package_search!==false||manifest.optional_native_modules!==false)throw fail();
  // Detached import evaluates the bytes just verified, closing pathname TOCTOU.
  // The bundle permits require() only for Node builtins; it has no package fallback.
  // A separate module instance prevents mutable SDK classes leaking across runs.
  const sdk=await import('data:text/javascript;base64,'+bytes.get(names[2]).toString('base64')+'#'+source.commit+'-'+randomUUID());
  if(typeof sdk.GatewayProtocolClient!=='function'||typeof sdk.WebSocket!=='function'||typeof sdk.rawDataToString!=='function')throw fail();
  return Object.freeze({GatewayProtocolClient:sdk.GatewayProtocolClient,WebSocket:sdk.WebSocket,rawDataToString:sdk.rawDataToString,
   identity:Object.freeze({gateway_client:manifest.gateway_client,websocket:manifest.websocket,protocol:manifest.protocol,module_sha256:manifest.module_sha256,source_commit:source.commit})});
 }catch{throw fail();}
}

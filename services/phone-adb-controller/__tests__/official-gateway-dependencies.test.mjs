import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const base=fileURLToPath(new URL('../',import.meta.url));
const paths=['official-gateway-dependencies.mjs','vendor/official-gateway-sdk.json','vendor/official-gateway-client.mjs','vendor/official-gateway-client.LICENSE.txt'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const api=await import('../official-gateway-dependencies.mjs').catch(error=>{
 if(error.code==='ERR_MODULE_NOT_FOUND'&&error.url===new URL('../official-gateway-dependencies.mjs',import.meta.url).href)return {};
 throw error;
});
async function using(fn){
 assert.equal(typeof api.loadOfficialGatewayDependencies,'function','cold runtime must load the frozen official SDK without global/node_modules fallback');
 const root=mkdtempSync(join(tmpdir(),'official-gateway-sdk-'));
 try{
  for(const path of paths){mkdirSync(dirname(join(root,path)),{recursive:true,mode:0o700});copyFileSync(join(base,path),join(root,path));}
  const source={commit:'a'.repeat(40),files:paths.map(path=>({path,sha256:hash(readFileSync(join(root,path)))}))};
  const local=await import(pathToFileURL(join(root,paths[0])));
  await fn({root,source,load:local.loadOfficialGatewayDependencies});
 }finally{rmSync(root,{recursive:true,force:true});}
}
test('frozen SDK loads in a cold directory without node_modules',()=>using(async({root,source,load})=>{
 const sdk=await load({runtimeRoot:root,source});
 assert.equal(typeof sdk.GatewayProtocolClient,'function');
 assert.equal(typeof sdk.WebSocket,'function');
 assert.equal(sdk.rawDataToString(Buffer.from('actual wire bytes')),'actual wire bytes');
 assert.equal(sdk.identity.gateway_client,'2026.8.1');
 assert.equal(sdk.identity.websocket,'8.21.3');
 assert.equal(Object.isFrozen(sdk),true);
}));
test('tampered bundle is rejected before evaluating any of its bytes',()=>using(async({root,source,load})=>{
 const key='__officialSdkTamperExecuted';delete globalThis[key];
 writeFileSync(join(root,paths[2]),'globalThis.__officialSdkTamperExecuted=true;\n');
 await assert.rejects(load({runtimeRoot:root,source}),/OFFICIAL_GATEWAY_DEPENDENCIES/);
 assert.equal(globalThis[key],undefined);
}));
test('every runtime artifact and loader itself must occur exactly once in the frozen source',()=>using(async({root,source,load})=>{
 for(const path of paths){
  const absent={...source,files:source.files.filter(file=>file.path!==path)};
  await assert.rejects(load({runtimeRoot:root,source:absent}),/OFFICIAL_GATEWAY_DEPENDENCIES/);
  const duplicate={...source,files:[...source.files,source.files.find(file=>file.path===path)]};
  await assert.rejects(load({runtimeRoot:root,source:duplicate}),/OFFICIAL_GATEWAY_DEPENDENCIES/);
 }
}));
test('symlinked artifact is rejected even when its bytes match',()=>using(async({root,source,load})=>{
 const target=join(root,'original-sdk.mjs');copyFileSync(join(root,paths[2]),target);rmSync(join(root,paths[2]));symlinkSync(target,join(root,paths[2]));
 await assert.rejects(load({runtimeRoot:root,source}),/OFFICIAL_GATEWAY_DEPENDENCIES/);
}));
test('a different runtime root cannot borrow the loaded source identity',()=>using(async({root,source,load})=>{
 const other=join(root,'other');mkdirSync(other,{mode:0o700});
 await assert.rejects(load({runtimeRoot:other,source}),/OFFICIAL_GATEWAY_DEPENDENCIES/);
}));

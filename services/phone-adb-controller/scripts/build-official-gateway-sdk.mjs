// Offline authoring only. Runtime never invokes this compiler or an installer.
import {readFileSync,writeFileSync,mkdirSync,lstatSync,realpathSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {isBuiltin} from 'node:module';
import {build,version as compilerVersion} from 'esbuild';

const here=dirname(fileURLToPath(import.meta.url)),output=join(here,'../vendor');
const source=resolve(process.argv[2]||'');
if(!process.argv[2]||realpathSync(source)!==source||compilerVersion!=='0.28.1')throw Error('SDK_BUILD_SOURCE_UNVERIFIED');
const planBytes=readFileSync(join(here,'official-gateway-sdk-inputs.json')),plan=JSON.parse(planBytes);
const digest=(data,kind='sha256',encoding='hex')=>createHash(kind).update(data).digest(encoding);
const tarballs={'@openclaw/gateway-client':'openclaw-gateway-client.tgz','@openclaw/gateway-protocol':'openclaw-gateway-protocol.tgz',ws:'ws.tgz','ipaddr.js':'ipaddr.js.tgz',typebox:'typebox.tgz'};
const allowed=new Map(),licenses=[];
for(const pkg of plan.packages){
 if(!Object.hasOwn(tarballs,pkg.name))throw Error('SDK_BUILD_PACKAGE_UNEXPECTED');
 const archive=readFileSync(join(source,tarballs[pkg.name]));
 if('sha512-'+digest(archive,'sha512','base64')!==pkg.integrity)throw Error('SDK_BUILD_ARCHIVE_INTEGRITY');
 for(const file of pkg.files){
  const path=join(source,'node_modules',pkg.name,file.path),stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||realpathSync(path)!==path||(stat.mode&0o022)||digest(readFileSync(path))!==file.sha256)throw Error('SDK_BUILD_FILE_UNVERIFIED');
  allowed.set(path,file.sha256);
 }
 const license=pkg.files.filter(file=>/^license(?:\.md|\.txt)?$/i.test(file.path));
 if(license.length!==1)throw Error('SDK_BUILD_LICENSE_UNVERIFIED');
 licenses.push(pkg.name+'@'+pkg.version+'\n'+readFileSync(join(source,'node_modules',pkg.name,license[0].path),'utf8'));
}
if(plan.packages.length!==5)throw Error('SDK_BUILD_PACKAGE_COUNT');
const entry=`export {GatewayProtocolClient} from ${JSON.stringify(join(source,'node_modules/@openclaw/gateway-client/dist/browser.mjs'))};\n`
 +`export {rawDataToString} from ${JSON.stringify(join(source,'node_modules/@openclaw/gateway-client/dist/websocket-data.mjs'))};\n`
 +`export {default as WebSocket} from ${JSON.stringify(join(source,'node_modules/ws/wrapper.mjs'))};\n`;
const banner='import {createRequire as sdkCreateRequire,isBuiltin as sdkIsBuiltin} from "node:module";\n'
 +'const sdkBuiltinRequire=sdkCreateRequire("file:///official-gateway-builtin-only.cjs");\n'
 +'const require=id=>{if(!sdkIsBuiltin(id))throw Error("SDK_PACKAGE_LOOKUP_DISABLED");return sdkBuiltinRequire(id);};';
const result=await build({stdin:{contents:entry,resolveDir:source,sourcefile:'official-gateway-entry.mjs'},absWorkingDir:source,
 bundle:true,write:false,metafile:true,platform:'node',format:'esm',target:'node22',minifyWhitespace:true,minifySyntax:true,legalComments:'inline',
 define:{'process.env.WS_NO_BUFFER_UTIL':'"1"','process.env.WS_NO_UTF_8_VALIDATE':'"1"'},banner:{js:banner},logLevel:'silent',
 plugins:[{name:'frozen-source-bytes',setup(compiler){compiler.onLoad({filter:/.*/},args=>{
  if(!allowed.has(args.path))throw Error('SDK_BUILD_UNPINNED_INPUT');
  const contents=readFileSync(args.path);if(digest(contents)!==allowed.get(args.path))throw Error('SDK_BUILD_INPUT_CHANGED');
  return {contents,loader:args.path.endsWith('.json')?'json':'js'};
 });}}]});
const inputs=[];
for(const name of Object.keys(result.metafile.inputs)){
 if(name==='official-gateway-entry.mjs')continue;
 const path=resolve(source,name);if(!allowed.has(path))throw Error('SDK_BUILD_UNPINNED_IMPORT');
 inputs.push({path:path.slice(source.length+1),sha256:allowed.get(path)});
}
for(const data of Object.values(result.metafile.outputs))for(const item of data.imports)if(!item.external||!isBuiltin(item.path))throw Error('SDK_BUILD_EXTERNAL_PACKAGE');
if(result.outputFiles.length!==1)throw Error('SDK_BUILD_OUTPUT_UNEXPECTED');
const module=result.outputFiles[0].contents,license=licenses.join('\n\n---\n\n');
const manifest={version:1,gateway_client:'2026.8.1',websocket:'8.21.3',protocol:4,package_search:false,optional_native_modules:false,
 module_sha256:digest(module),license_sha256:digest(license),compiler:{name:'esbuild',version:compilerVersion},
 source_manifest_sha256:digest(planBytes),packages:plan.packages.map(({name,version,integrity})=>({name,version,integrity})),inputs};
mkdirSync(output,{recursive:true});
writeFileSync(join(output,'official-gateway-client.mjs'),module);
writeFileSync(join(output,'official-gateway-client.LICENSE.txt'),license);
writeFileSync(join(output,'official-gateway-sdk.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({module_sha256:manifest.module_sha256,bytes:module.length,verified_inputs:inputs.length,packages:5,network_calls:0,install_scripts:0}));

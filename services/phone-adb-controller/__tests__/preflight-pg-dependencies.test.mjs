import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,chmodSync,symlinkSync,mkdirSync,existsSync} from 'node:fs';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const entry=fileURLToPath(new URL('../preflight-pg-dependencies.mjs',import.meta.url));

test('官方固定闭包可在私有候选安装并载入Pool，篡改模块后新进程拒载',async()=>{
 const root=mkdtempSync(join(tmpdir(),'preflight-pg-official-'));chmodSync(root,0o700);
 try{
  const installed=spawnSync(process.execPath,[entry,'install',root,'a'.repeat(40)],{encoding:'utf8',timeout:60000});
  assert.equal(installed.status,0,installed.stderr);
  const identity=JSON.parse(installed.stdout);
  assert.equal(identity.packages,14);assert.equal(identity.entry_version,'8.18.0');
  const code=`import {loadPreflightPg} from ${JSON.stringify(new URL('../preflight-pg-dependencies.mjs',import.meta.url).href)};
   const pg=loadPreflightPg({runtimeRoot:process.argv[1],frozen:JSON.parse(process.argv[2])});
   if ('native' in pg) throw Error('optional native capability must not escape'); const pool=new pg.Pool({max:1}); console.log(typeof pool.query); await pool.end();`;
  const frozen={deployment:{source_commit:'a'.repeat(40)},preflight_pg:identity.frozen};
  const pgModule=await import('../preflight-pg-dependencies.mjs');
  assert.equal(typeof pgModule.loadScoringPg,'function','103必须使用scoring_pg独立冻结键，不伪preflight');
  const scoringFrozen={deployment:frozen.deployment,execution_mode:'agent',workflow_version:{payload:{key:'douyin_comment_scoring'}},agent_input:{workflow_key:'douyin_comment_scoring',profile:'mmv-scoring',serial:'none'},scoring_pg:identity.frozen};
  const scoringPool=new (pgModule.loadScoringPg({runtimeRoot:root,frozen:scoringFrozen}).Pool)({max:1});await scoringPool.end();
  assert.throws(()=>loadForScoring({...scoringFrozen,scoring_pg:undefined}),/SCORING_PG/);
  assert.throws(()=>loadForScoring({...scoringFrozen,agent_input:{...scoringFrozen.agent_input,serial:'4311010223'}}),/SCORING_PG/);
  function loadForScoring(scope){return pgModule.loadScoringPg({runtimeRoot:root,frozen:scope});}
  assert.throws(()=>pgModule.loadPreflightPg({runtimeRoot:root,frozen:scoringFrozen}),/FROZEN_LOCK/);

  const launch=(env={},scope=frozen)=>spawnSync(process.execPath,['--input-type=module','-e',code,root,JSON.stringify(scope)],{encoding:'utf8',timeout:10000,env:{...process.env,NODE_PATH:'',NODE_PG_FORCE_NATIVE:'',...env}});
  {const {prepareFrozenPreflightPg,preflightPgDeployment,loadPreflightPg}=await import('../preflight-pg-dependencies.mjs'),runRoot=join(root,'run-runtime');mkdirSync(runRoot,{mode:0o700});
  const expectedDeployment=preflightPgDeployment({runtimeRoot:root,sourceCommit:frozen.deployment.source_commit});
  const https=createRequire(import.meta.url)('node:https'),originalGet=https.get;let networkCalls=0;https.get=()=>{networkCalls++;throw Error('FROZEN_INSTALL_MUST_BE_OFFLINE');};syncBuiltinESMExports();
  try{await prepareFrozenPreflightPg({sourceRuntimeRoot:root,runtimeRoot:runRoot,frozen,expectedDeployment});}finally{https.get=originalGet;syncBuiltinESMExports();}assert.equal(networkCalls,0);
  assert.deepEqual(preflightPgDeployment({runtimeRoot:runRoot,sourceCommit:frozen.deployment.source_commit}),expectedDeployment);
  const ownPool=new (loadPreflightPg({runtimeRoot:runRoot,frozen}).Pool)({max:1});await ownPool.end();
  await assert.rejects(prepareFrozenPreflightPg({sourceRuntimeRoot:root,runtimeRoot:runRoot,frozen,expectedDeployment}),/EEXIST/);
  const refused=join(root,'refused-runtime');mkdirSync(refused,{mode:0o700});await assert.rejects(prepareFrozenPreflightPg({sourceRuntimeRoot:root,runtimeRoot:refused,frozen,expectedDeployment:{...expectedDeployment,manifest_sha256:'0'.repeat(64)}}),/DEPLOYMENT/);assert.equal(existsSync(join(refused,'_dependencies')),false);
  const archive=join(root,'_dependencies/preflight-pg/tarballs/pg-8.18.0.tgz'),originalArchive=readFileSync(archive);writeFileSync(archive,Buffer.from('tampered candidate'));
  try{const independent=new (loadPreflightPg({runtimeRoot:runRoot,frozen}).Pool)({max:1});await independent.end();const other=join(root,'refused-source-runtime');mkdirSync(other,{mode:0o700});await assert.rejects(prepareFrozenPreflightPg({sourceRuntimeRoot:root,runtimeRoot:other,frozen,expectedDeployment}),/PREFLIGHT_PG/);assert.equal(existsSync(join(other,'_dependencies')),false);}finally{writeFileSync(archive,originalArchive);}
  const runEntry=join(runRoot,'_dependencies/preflight-pg/node_modules/pg/lib/index.js'),originalEntry=readFileSync(runEntry);writeFileSync(runEntry,'throw Error("run module tampered")');assert.throws(()=>loadPreflightPg({runtimeRoot:runRoot,frozen}),/PREFLIGHT_PG/);writeFileSync(runEntry,originalEntry);
  }
  assert.equal(launch().status,0);
  assert.equal(launch({},{...frozen,preflight_pg:{package_lock_sha256:identity.frozen.package_lock_sha256,lock_sha256:identity.frozen.lock_sha256}}).status,0);
  chmodSync(join(root,'_dependencies/preflight-pg'),0o755);assert.notEqual(launch().status,0);chmodSync(join(root,'_dependencies/preflight-pg'),0o700);
  const foreign=join(root,'foreign-global'),marker=join(root,'foreign-loaded');mkdirSync(join(foreign,'pg'),{recursive:true});
  writeFileSync(join(foreign,'pg/index.js'),`require('fs').writeFileSync(${JSON.stringify(marker)},'executed');module.exports={Pool:class{query(){}end(){}}};`);
  for(const env of [{NODE_PATH:foreign},{NODE_PG_FORCE_NATIVE:'1'}]){assert.notEqual(launch(env).status,0);assert.equal(existsSync(marker),false);}
  assert.notEqual(launch({},{...frozen,source_commit:'b'.repeat(40)}).status,0);
  assert.notEqual(launch({},{...frozen,preflight_pg:{...identity.frozen,lock_sha256:'f'.repeat(64)}}).status,0);
  const manifestPath=join(root,'_dependencies/preflight-pg/manifest.json'),manifestBytes=readFileSync(manifestPath);
  writeFileSync(manifestPath,'Bearer FIXTURE_ONLY_NO_SECRET_MUST_NOT_LEAK');const badManifest=launch();assert.notEqual(badManifest.status,0);assert.doesNotMatch(badManifest.stderr,/FIXTURE_ONLY_NO_SECRET_MUST_NOT_LEAK/);writeFileSync(manifestPath,manifestBytes);
  const child=join(root,'_dependencies/preflight-pg/node_modules/pg-pool/index.js'),originalChild=readFileSync(child);rmSync(child);
  const foreignHome=join(root,'foreign-home');mkdirSync(join(foreignHome,'.node_modules/pg-pool'),{recursive:true});writeFileSync(join(foreignHome,'.node_modules/pg-pool/index.js'),`require('fs').writeFileSync(${JSON.stringify(marker)},'executed');`);
  assert.notEqual(launch({HOME:foreignHome}).status,0);assert.equal(existsSync(marker),false);writeFileSync(child,originalChild,{mode:0o600});
  const {preflightPgDeployment}=await import('../preflight-pg-dependencies.mjs');
  const {collectDeployment}=await import('../deployment-manifest.mjs');
  const dependency=preflightPgDeployment({runtimeRoot:root,sourceCommit:'a'.repeat(40)});
  const {buildWriteSet,parseDeployArrays}=await import('../deployment-write-set.mjs');
  const emptyGroups=Object.fromEntries(Object.keys(parseDeployArrays(readFileSync(new URL('../deploy.sh',import.meta.url),'utf8'))).map(k=>[k,[]]));
  const writes=buildWriteSet({groups:emptyGroups,sha:'a'.repeat(40),homes:{mmv:'/Users/mmv','xian-m4':'/Users/m4'},read:()=>{throw Error('unexpected Git read');},mode:()=>0o644,commanderFiles:[],commanderManifest:Buffer.from('{}'),preflightPgRuntimeRoot:root});
  for(const [host,dir]of [['mmv','bin-harvest'],['mmv','.openclaw/leadgen-scripts'],['xian-m4','bin-harvest']]){
   const file=writes[host].find(e=>e.path===dir+'/_dependencies/preflight-pg/node_modules/pg/lib/index.js');assert.ok(file,'private dependency must be declared in exact restoration write set');
   assert.equal(file.after.mode,0o600);assert.equal(file.after.sha256,createHash('sha256').update(readFileSync(join(root,'_dependencies/preflight-pg/node_modules/pg/lib/index.js'))).digest('hex'));
  }
  const script=Buffer.from('# harmless fixture');writeFileSync(join(root,'leadgen-run.sh'),script);
  const manifest={source_repo:'perfectuser21/zenithjoy-workspace',source_commit:'a'.repeat(40),files:[{path:'services/phone-adb-controller/leadgen-run.sh',deployed_path:'leadgen-run.sh',content_sha256:createHash('sha256').update(script).digest('hex')}],dependencies:{preflight_pg:dependency}};
  assert.deepEqual(collectDeployment(root,manifest).dependencies,manifest.dependencies);
  const missing=structuredClone(manifest);missing.files.push({path:'services/phone-adb-controller/preflight-pg-lock.json',deployed_path:'preflight-pg-lock.json',content_sha256:identity.frozen.lock_sha256});delete missing.dependencies;assert.throws(()=>collectDeployment(root,missing),/PREFLIGHT_PG/);
  const falseManifest=structuredClone(manifest);falseManifest.dependencies.preflight_pg.manifest_sha256='f'.repeat(64);
  assert.throws(()=>collectDeployment(root,falseManifest),/PREFLIGHT_PG/);
  const partial=join(root,'partial');mkdirSync(partial,{mode:0o700});
  const {installPreflightPg}=await import('../preflight-pg-dependencies.mjs');
  const pinned=JSON.parse(readFileSync(join(root,'preflight-pg-lock.json')));
  const tarballs=new Map(pinned.packages.map(e=>[e.name,readFileSync(join(root,'_dependencies/preflight-pg/tarballs',e.name+'-'+e.version+'.tgz'))]));
  const fs=createRequire(import.meta.url)('node:fs'),originalWrite=fs.writeFileSync;let faulted=false;
  fs.writeFileSync=(path,data,options)=>{if(String(path).startsWith(partial+'/')&&String(path).includes('manifest')){faulted=true;originalWrite(path,Buffer.from(data).subarray(0,7),options);throw Error('fixture interrupted manifest write');}return originalWrite(path,data,options);};syncBuiltinESMExports();
  try{await assert.rejects(installPreflightPg({runtimeRoot:partial,sourceCommit:'a'.repeat(40),tarballs}),/fixture interrupted/);}finally{fs.writeFileSync=originalWrite;syncBuiltinESMExports();}
  assert.equal(faulted,true);assert.equal(existsSync(join(partial,'_dependencies/preflight-pg/manifest.json')),false,'partial manifest cannot become a commit marker');
  await assert.rejects(installPreflightPg({runtimeRoot:partial,sourceCommit:'a'.repeat(40),tarballs}),/EEXIST/,'partial tree must never be adopted or overwritten');
  const module=join(root,'_dependencies/preflight-pg/node_modules/pg/lib/index.js');
  writeFileSync(module,readFileSync(module)+'\nthrow Error("TAMPER_MUST_NOT_EXECUTE")');
  const denied=launch();assert.notEqual(denied.status,0);assert.match(denied.stderr,/PREFLIGHT_PG_FILE_DIGEST/);assert.doesNotMatch(denied.stderr,/TAMPER_MUST_NOT_EXECUTE/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

function archive(rows){
 const chunks=[];
 for(const {name,data='',type='0'} of rows){const bytes=Buffer.from(data),h=Buffer.alloc(512);h.write(name);h.write('0000600\0',100);h.write('0000000\0',108);h.write('0000000\0',116);h.write(bytes.length.toString(8).padStart(11,'0')+'\0',124);h.write('00000000000\0',136);h.fill(32,148,156);h.write(type,156);h.write('ustar\0',257);h.write('00',263);const sum=[...h].reduce((a,b)=>a+b,0);h.write(sum.toString(8).padStart(6,'0')+'\0 ',148);chunks.push(h,bytes,Buffer.alloc((512-bytes.length%512)%512));}
 return gzipSync(Buffer.concat([...chunks,Buffer.alloc(1024)]));
}
const pkg={name:'fixture',version:'1.0.0',scripts:{install:'touch MUST_NOT_EXIST'}};
const rootRow={name:'package/package.json',data:JSON.stringify(pkg)};
function pin(bytes){return {name:'fixture',version:'1.0.0',integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64')};}

test('SSRI和安全tar解析保留字节，不执行package安装脚本',async()=>{
 const {verifiedTarFiles}=await import('../preflight-pg-dependencies.mjs');const raw=archive([rootRow,{name:'package/lib/index.js',data:'module.exports=42;'}]);const files=verifiedTarFiles(raw,pin(raw));
 assert.equal(files.get('lib/index.js').toString(),'module.exports=42;');assert.deepEqual(JSON.parse(files.get('package.json')),pkg);
 const corrupted=Buffer.from(raw);corrupted[20]^=1;assert.throws(()=>verifiedTarFiles(corrupted,pin(raw)),/PREFLIGHT_PG_SSRI/);
});
for(const [label,rows]of [
 ['parent traversal',[rootRow,{name:'package/../escape'}]],
 ['absolute path',[rootRow,{name:'/outside'}]],
 ['symlink',[rootRow,{name:'package/lib/a',type:'2'}]],
 ['hardlink',[rootRow,{name:'package/lib/a',type:'1'}]],
 ['pax path override',[rootRow,{name:'package/pax',type:'x'}]],
 ['duplicate entry',[rootRow,rootRow]],
 ['wrong package identity',[{name:'package/package.json',data:'{"name":"other","version":"1.0.0"}'}]],
])test('tar拒绝 '+label,async()=>{
 const {verifiedTarFiles}=await import('../preflight-pg-dependencies.mjs');const raw=archive(rows);assert.throws(()=>verifiedTarFiles(raw,pin(raw)),/PREFLIGHT_PG_/);
});

test('Git锁闭包机械检查拒不同版本/父级依赖映射或漏optional',async()=>{
 const {verifyPreflightPgLock}=await import('../preflight-pg-dependencies.mjs');const bytes=readFileSync(new URL('../../../package-lock.json',import.meta.url));const original=JSON.parse(bytes);
 const identity=verifyPreflightPgLock(bytes);assert.equal(identity.lock_sha256,'a8ca6b5cb0ab3337928d39100c3f7322113e3649b570c84bbf919ac4e5a3941c');
 for(const mutate of [d=>d.packages['node_modules/pg-pool'].version='3.12.0',d=>delete d.packages['node_modules/pg'].optionalDependencies,d=>d.packages['node_modules/pg'].dependencies.pgpass='999']){
  const changed=structuredClone(original);mutate(changed);assert.throws(()=>verifyPreflightPgLock(Buffer.from(JSON.stringify(changed))),/PREFLIGHT_PG_GIT_LOCK_DIGEST/);
 }
});

test('中央release固定真实Git descriptor而不将第三方文件伪装Git code',async()=>{
 const {bindingComponents}=await import('../deployment-targets.mjs');
 const identity={lock_sha256:'a8ca6b5cb0ab3337928d39100c3f7322113e3649b570c84bbf919ac4e5a3941c',package_lock_sha256:JSON.parse(readFileSync(new URL('../preflight-pg-lock.json',import.meta.url))).package_lock_sha256};
 const binding={kind:'code',scope:'activity',status:'verified',repo:'perfectuser21/zenithjoy-workspace',path:'services/phone-adb-controller/preflight-pg-lock.json',revision:'a'.repeat(40),digest:'sha256:'+identity.lock_sha256};
 const components=bindingComponents({activities:[{payload:{implementation_bindings:[binding]}}]},'a'.repeat(40),{preflightPgLock:identity});
 assert.throws(()=>bindingComponents({activities:[]},'a'.repeat(40),{preflightPgLock:identity}),/统一部署/);
 assert.equal(components.length,2);assert.equal(components[0].path,'services/phone-adb-controller/preflight-pg-lock.json');
 assert.ok(components.every(c=>!c.path?.includes('_dependencies/')));
 assert.throws(()=>bindingComponents({activities:[]},'a'.repeat(40),{preflightPgLock:{lock_sha256:'f'.repeat(64)}}),/PREFLIGHT|统一部署/);
});

test('无闭包和可写或符号链接根不能借全局pg载入',async()=>{
 const {loadPreflightPg,preflightPgLockIdentity}=await import('../preflight-pg-dependencies.mjs');
 const root=mkdtempSync(join(tmpdir(),'preflight-pg-denied-'));
 try{
  assert.throws(()=>loadPreflightPg({runtimeRoot:root,frozen:{deployment:{source_commit:'a'.repeat(40)},preflight_pg:preflightPgLockIdentity()}}),/PREFLIGHT_PG/);
  chmodSync(root,0o777);assert.throws(()=>preflightPgLockIdentity({runtimeRoot:root}),/PREFLIGHT_PG/);
  chmodSync(root,0o700);symlinkSync(root,root+'-link');assert.throws(()=>preflightPgLockIdentity({runtimeRoot:root+'-link'}),/PREFLIGHT_PG/);
 }finally{rmSync(root+'-link',{force:true});rmSync(root,{recursive:true,force:true});}
});

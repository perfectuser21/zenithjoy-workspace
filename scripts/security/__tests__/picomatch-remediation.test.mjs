import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,cpSync,mkdirSync,rmSync,readdirSync} from 'node:fs';
import {resolve,join,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {spawnSync,execFileSync} from 'node:child_process';
import {gunzipSync,gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const api=await import('../verify-picomatch-remediation.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const folder='scripts/security/picomatch-remediation';
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'picomatch-proof-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));for(const p of [folder,'package.json','package-lock.json','apps/dashboard/package.json','apps/dashboard/package-lock.json']){mkdirSync(dirname(join(dir,p)),{recursive:true});cpSync(join(root,p),join(dir,p),{recursive:true});}return dir;}
function unpack(t,file){const dir=mkdtempSync(join(tmpdir(),'picomatch-package-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));execFileSync('tar',['-xzf',file,'-C',dir]);return join(dir,'package');}
test('only complete locked distributions receive a live same-process remediation brand',()=>{
 assert.equal(typeof api.verifyRemediation,'function');
 for(const [project,count]of [['.',4],['apps/dashboard',5]]){const scope={repositoryRoot:root,projectRoot:resolve(root,project)},proof=api.verifyRemediation(scope);assert.equal(proof.policy_id,'repeated_extglob_rejected');assert.equal(proof.inventory.length,count);assert.equal(proof.advisory_id,'GHSA-fc5q-39xc-vjpf');assert.equal(api.isVerifiedRemediation(proof,scope),true);assert.equal(api.isVerifiedRemediation(JSON.parse(JSON.stringify(proof)),scope),false);assert.equal(Object.isFrozen(proof.inventory),true);}
});
for(const mutation of ['missing-site','extra-site','wrong-version','registry-replacement','wrong-integrity','archive-drift'])test('proof fails closed for '+mutation,t=>{
 assert.equal(typeof api.verifyRemediation,'function');const dir=fixture(t),p=join(dir,'package-lock.json'),lock=JSON.parse(readFileSync(p)),key='node_modules/picomatch';
 if(mutation==='missing-site')delete lock.packages[key];
 if(mutation==='extra-site')lock.packages['node_modules/unexpected/node_modules/picomatch']={...lock.packages[key]};
 if(mutation==='wrong-version')lock.packages[key].version='9.9.9';
 if(mutation==='registry-replacement')lock.packages[key].resolved='https://registry.npmjs.org/picomatch/-/picomatch-4.0.7.tgz';
 if(mutation==='wrong-integrity')lock.packages[key].integrity='sha512-invalid';
 if(mutation==='archive-drift'){const m=JSON.parse(readFileSync(join(dir,folder,'manifest.json'))),f=join(dir,m.patched_packages[0].path);writeFileSync(f,Buffer.concat([readFileSync(f),Buffer.from('drift')]));}
 writeFileSync(p,JSON.stringify(lock));assert.throws(()=>api.verifyRemediation({repositoryRoot:dir,projectRoot:dir}),/PICOMATCH_REMEDIATION_/);
});
test('brand becomes invalid if the checked lock changes afterwards',t=>{assert.equal(typeof api.verifyRemediation,'function');const dir=fixture(t),scope={repositoryRoot:dir,projectRoot:dir},proof=api.verifyRemediation(scope);writeFileSync(join(dir,'package-lock.json'),readFileSync(join(dir,'package-lock.json'),'utf8')+' ');assert.equal(api.isVerifiedRemediation(proof,scope),false);});
for(const mode of ['checksum','trailing-tar','partial-block','single-eof','directory-conflict'])test('ambiguous tar is rejected even when manifest and lock hashes are updated: '+mode,t=>{
 const dir=fixture(t),manifestPath=join(dir,folder,'manifest.json'),manifest=JSON.parse(readFileSync(manifestPath)),item=manifest.patched_packages.find(x=>x.version==='4.0.7'),archivePath=join(dir,item.path);let raw=gunzipSync(readFileSync(archivePath));
 if(mode==='checksum')raw.write('000000\0 ',148,'ascii');
 else if(mode==='trailing-tar')raw=Buffer.concat([raw,raw]);
 else if(mode==='partial-block')raw=Buffer.concat([raw,Buffer.from([0])]);
 else {let end=0;while(!raw.subarray(end,end+512).every(x=>x===0)){const size=parseInt(raw.subarray(end+124,end+136).toString().replace(/\0.*$/s,'').trim(),8);end+=512+Math.ceil(size/512)*512;}
 if(mode==='single-eof')raw=raw.subarray(0,end+512);
 else {const header=Buffer.from(raw.subarray(0,512));header.fill(0,124,136);header.write('00000000000',124,'ascii');header[156]=53;header.fill(32,148,156);const sum=header.reduce((a,b)=>a+b,0);header.write(sum.toString(8).padStart(6,'0')+'\0 ',148,'ascii');raw=Buffer.concat([raw.subarray(0,end),header,raw.subarray(end)]);}}

 const bytes=gzipSync(raw);item.sha256=createHash('sha256').update(bytes).digest('hex');item.integrity='sha512-'+createHash('sha512').update(bytes).digest('base64');writeFileSync(archivePath,bytes);writeFileSync(manifestPath,JSON.stringify(manifest));const path=join(dir,'package-lock.json'),lock=JSON.parse(readFileSync(path));lock.packages['node_modules/picomatch'].integrity=item.integrity;writeFileSync(path,JSON.stringify(lock));
 assert.throws(()=>api.verifyRemediation({repositoryRoot:dir,projectRoot:dir}),/PICOMATCH_REMEDIATION_ARCHIVE/);
});
test('original packages reproduce the advisory; patched public parsing entries reject repeated extglobs',t=>{
 assert.equal(typeof api.verifyRemediation,'function');const proof=api.verifyRemediation({repositoryRoot:root,projectRoot:join(root,'apps/dashboard')}),manifest=JSON.parse(readFileSync(join(root,folder,'manifest.json')));
 for(const item of manifest.upstream_packages){const original=unpack(t,join(root,item.path));for(const [pattern,input]of [['+(*)','a'.repeat(33)+'/'],['+(*a)','a'.repeat(33)+'!']]){const r=spawnSync(process.execPath,['-e',"const p=require(process.argv[1]),f=p(process.argv[2]);process.stdout.write('compiled\\n');f(process.argv[3]);",original,pattern,input],{encoding:'utf8',timeout:1000});assert.match(r.stdout,/compiled/);assert.equal(r.error?.code,'ETIMEDOUT',item.version+' original must reproduce');}}
 for(const item of manifest.patched_packages){const patched=unpack(t,join(root,item.path));const script=`const assert=require('node:assert/strict'),p=require(process.argv[1]),parse=require(process.argv[1]+'/lib/parse.js');for(const pattern of ['+(*)','+(*a)','*(*)','*(*a)','@(+(*a))','+(a|aa)','a/+(*a)','+(\\\\*)'])for(const options of [{},{maxExtglobRecursion:false},{bash:true},{capture:true},{windows:true},{fastpaths:false}]){for(const call of [()=>p(pattern,options),()=>p.makeRe(pattern,options),()=>p.parse(pattern,options),()=>parse(pattern,options)])assert.throws(call,e=>e.code==='PICOMATCH_REPEATED_EXTGLOB_BLOCKED');assert.equal(parse.fastpaths(pattern,options),undefined);}for(const [pattern,input,result]of [['src/**/*.js','src/a.js',true],['**/*.{js,ts}','src/a.ts',true],['@(src|lib)/**/*.js','lib/a.js',true],['file.?(c|m)js','file.mjs',true],['!foo.js','bar.js',true],['[ab].js','a.js',true],['\\\\+\\\\(\\\\*\\\\)','+(*)',true]])assert.equal(p(pattern)(input),result);console.log('bounded-and-compatible');`;
 const r=spawnSync(process.execPath,['-e',script,patched],{encoding:'utf8',timeout:4000});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/bounded-and-compatible/);}
 assert.equal(api.isVerifiedRemediation(proof,{repositoryRoot:root,projectRoot:join(root,'apps/dashboard')}),true);
});
test('same name and version install from pinned archives with ignore-scripts and survive reinstall',t=>{
 assert.equal(typeof api.verifyRemediation,'function');const manifest=JSON.parse(readFileSync(join(root,folder,'manifest.json')));
 for(const item of manifest.patched_packages){const dir=mkdtempSync(join(tmpdir(),'picomatch-install-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const pkg={name:'isolated-remediation-test',version:'1.0.0',private:true,dependencies:{picomatch:item.version}},record={version:item.version,resolved:'file:'+join(root,item.path),integrity:item.integrity};writeFileSync(join(dir,'package.json'),JSON.stringify(pkg));writeFileSync(join(dir,'package-lock.json'),JSON.stringify({name:pkg.name,version:pkg.version,lockfileVersion:3,requires:true,packages:{'':pkg,'node_modules/picomatch':record}}));
 for(const command of ['ci','install']){const r=spawnSync('npm',[command,'--ignore-scripts','--offline','--no-fund','--no-audit'],{cwd:dir,encoding:'utf8',timeout:45000,env:{...process.env,npm_config_cache:join(dir,'.cache')}});assert.equal(r.status,0,r.stderr);const check=spawnSync(process.execPath,['-e',"const assert=require('node:assert/strict'),p=require('picomatch');assert.equal(require('picomatch/package.json').version,process.argv[1]);assert.throws(()=>p('+(*a)'),e=>e.code==='PICOMATCH_REPEATED_EXTGLOB_BLOCKED');assert.equal(p('src/**/*.js')('src/a.js'),true);",item.version],{cwd:dir,encoding:'utf8',timeout:3000});assert.equal(check.status,0,check.stderr);rmSync(join(dir,'node_modules'),{recursive:true});}}
});

test('API容器的真实COPY安装上下文包含根锁引用的全部补丁包',t=>{
 const stage=mkdtempSync(join(tmpdir(),'picomatch-docker-stage-'));t.after(()=>rmSync(stage,{recursive:true,force:true}));
 const dockerfile=readFileSync(join(root,'apps/api/Dockerfile'),'utf8'),install=dockerfile.indexOf('RUN npm ci --workspace=apps/api');assert.ok(install>0);
 for(const line of dockerfile.slice(0,install).split('\n').filter(line=>line.startsWith('COPY '))){
  const words=line.trim().split(/\s+/).slice(1),destination=words.pop();
  for(const source of words){
   const sources=source.endsWith('/*.patched.tgz')?readdirSync(join(root,dirname(source))).filter(name=>name.endsWith('.patched.tgz')).map(name=>join(dirname(source),name)):[source];
   for(const item of sources){const target=join(stage,destination,basename(item));mkdirSync(dirname(target),{recursive:true});cpSync(join(root,item),target,{recursive:true});}
  }
 }
 const lock=JSON.parse(readFileSync(join(stage,'package-lock.json')));
 for(const [path,entry]of Object.entries(lock.packages))if(path.endsWith('/picomatch')){
  assert.ok(entry.resolved.startsWith('file:'));const bytes=readFileSync(resolve(stage,entry.resolved.slice(5)));
  assert.equal('sha512-'+createHash('sha512').update(bytes).digest('base64'),entry.integrity);
 }
});

test('distribution preserves merged main 4.0.7 upgrades and retires superseded patch versions',()=>{
 const manifest=JSON.parse(readFileSync(join(root,folder,'manifest.json')));
 assert.deepEqual(manifest.patched_packages.map(x=>x.version).sort(),['2.3.2','4.0.7']);
 for(const path of ['package-lock.json','apps/dashboard/package-lock.json']){const lock=JSON.parse(readFileSync(join(root,path)));for(const [site,pkg]of Object.entries(lock.packages))if(site.endsWith('/picomatch'))assert.ok(['2.3.2','4.0.7'].includes(pkg.version),site+' must retain main upgrade');}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,realpathSync,chmodSync,existsSync,linkSync} from 'node:fs';
import os from 'node:os';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {digest} from '../runtime-definition.mjs';
import {deploymentManifest} from '../deployment-manifest.mjs';
const file='services/phone-adb-controller/commander/skills/workflow-commander/SKILL.md';
function fixture(t){
 const temp=mkdtempSync(join(tmpdir(),'deployment-fixed-source-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));
 const root=join(temp,'workspace'),source=join(root,'.skills-source');mkdirSync(source,{recursive:true});
 const git=(dir,...args)=>execFileSync('git',['-C',dir,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 for(const dir of [root,source]){git(dir,'init','-q','-b','cp-fixture');git(dir,'config','core.hooksPath','/dev/null');}
 const payload=Buffer.from('# fixed skill\n');writeFileSync(join(source,'manual.md'),payload);mkdirSync(join(source,'distribution'));
 writeFileSync(join(source,'distribution/catalog.json'),JSON.stringify({profiles:{zenithjoy:{files:[{path:file,source:'manual.md',sha256:digest(payload)}]}}}));
 const commit=dir=>{git(dir,'add','.');git(dir,'-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');return git(dir,'rev-parse','HEAD');};
 const sourceRevision=commit(source);writeFileSync(join(root,'.gitignore'),'.skills-source/\nservices/phone-adb-controller/commander/skills/\n');
 mkdirSync(join(root,'scripts'));writeFileSync(join(root,'scripts/skills-source.py'),readFileSync(new URL('../../../scripts/skills-source.py',import.meta.url)));
 writeFileSync(join(root,'.skills-source.json'),JSON.stringify({repository:'perfectuser21/zenithjoy-skills',revision:sourceRevision,profile:'zenithjoy',loader_sha256:'0'.repeat(64)}));
 const revision=commit(root);return {root,payload,revision,git};
}
test('fresh migrated deployment prepares exact pinned skill bytes and manifest accepts removed Git path',async t=>{
 const f=fixture(t);const {readDeploymentSource}=await import('../deployment-fixed-source.mjs');
 assert.throws(()=>f.git(f.root,'show',`${f.revision}:${file}`));
 assert.deepEqual(readDeploymentSource(f.root,f.revision,file,{materialize:true}),f.payload);
 const actual=deploymentManifest(f.root,['commander/skills/workflow-commander/SKILL.md'],{commit:f.revision});
 assert.equal(actual.files[0].content_sha256,digest(f.payload));
});
test('fixed source refuses mutable installed skill, bootstrap, symlink and unmapped path',async t=>{
 const f=fixture(t);const {readDeploymentSource}=await import('../deployment-fixed-source.mjs');
 readDeploymentSource(f.root,f.revision,file,{materialize:true});
 writeFileSync(join(f.root,'scripts/skills-source.py'),'raise RuntimeError("mutable bootstrap must not run")');
 assert.deepEqual(readDeploymentSource(f.root,f.revision,file),f.payload);
 writeFileSync(join(f.root,file),'mutable skill');
 assert.throws(()=>readDeploymentSource(f.root,f.revision,file),/漂移/);
 assert.throws(()=>deploymentManifest(f.root,['commander/skills/workflow-commander/SKILL.md'],{commit:f.revision}),/漂移/);
 rmSync(join(f.root,file));symlinkSync(join(f.root,'missing-target'),join(f.root,file));
 assert.throws(()=>readDeploymentSource(f.root,f.revision,file,{materialize:true}),/符号链接/);
 assert.throws(()=>readDeploymentSource(f.root,f.revision,'not-in-catalog.md',{materialize:true}));
 assert.throws(()=>readDeploymentSource(f.root,f.revision,'../outside',{materialize:true}),/路径/);
});
test('Git replace cannot forge pinned skill bytes and ambient Git redirects cannot change release source',async t=>{
 const f=fixture(t);const {readDeploymentSource}=await import('../deployment-fixed-source.mjs');
 readDeploymentSource(f.root,f.revision,file,{materialize:true});
 const original=process.env.GIT_DIR;process.env.GIT_DIR=join(f.root,'.skills-source/.git');
 try{assert.deepEqual(readDeploymentSource(f.root,f.revision,file),f.payload);assert.equal(deploymentManifest(f.root,['commander/skills/workflow-commander/SKILL.md']).source_commit,f.revision);}finally{if(original===undefined)delete process.env.GIT_DIR;else process.env.GIT_DIR=original;}
 const cache=join(f.root,'.skills-source'),old=f.git(cache,'rev-parse','HEAD'),forged=Buffer.from('forged runtime skill\n');
 writeFileSync(join(cache,'manual.md'),forged);writeFileSync(join(cache,'distribution/catalog.json'),JSON.stringify({profiles:{zenithjoy:{files:[{path:file,source:'manual.md',sha256:digest(forged)}]}}}));
 f.git(cache,'add','.');f.git(cache,'-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','forged object');
 f.git(cache,'replace',old,f.git(cache,'rev-parse','HEAD'));writeFileSync(join(f.root,file),forged);
 assert.throws(()=>readDeploymentSource(f.root,f.revision,file),/漂移/);
});

test('deployment source plan rejects missing local cache without attempting a fetch',async t=>{
 const f=fixture(t);const {readDeploymentSource}=await import('../deployment-fixed-source.mjs');
 rmSync(join(f.root,'.skills-source'),{recursive:true});
 assert.throws(()=>readDeploymentSource(f.root,f.revision,file,{materialize:true}),/缓存不存在/);
});

async function coldFixture(t){
 const temp=realpathSync(mkdtempSync(join(tmpdir(),'fixed-skill-cold-')));t.after(()=>rmSync(temp,{recursive:true,force:true}));const root=join(temp,'workspace'),origin=join(temp,'origin'),home=join(temp,'home'),bin=join(temp,'bin'),log=join(temp,'calls.jsonl');
 for(const path of [root,origin,home,bin])mkdirSync(path,{mode:0o700});mkdirSync(join(home,'.credentials'),{mode:0o700});const mirror=join(home,'.credentials/zenithjoy-skills-source-read.key'),fake='FIXTURE_PRIVATE_SKILL_KEY_ONLY';writeFileSync(mirror,fake+'\n',{mode:0o600});
 const realGit=execFileSync('which',['git'],{encoding:'utf8'}).trim(),python=execFileSync('python3',['-c','import sys;print(sys.executable)'],{encoding:'utf8'}).trim();
 const git=(dir,...args)=>execFileSync(realGit,['-C',dir,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const commit=dir=>{git(dir,'add','.');git(dir,'-c','user.name=fixture','-c','user.email=fixture@example.invalid','-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','commit','-qm','fixed cold fixture');return git(dir,'rev-parse','HEAD');};
 for(const dir of [root,origin])git(dir,'init','-q','-b','fixture');mkdirSync(join(origin,'distribution'));
 const payload=Buffer.from('# exact cold source\n');writeFileSync(join(origin,'manual.md'),payload);
 writeFileSync(join(origin,'distribution/catalog.json'),JSON.stringify({profiles:{zenithjoy:{files:[{path:file,source:'manual.md',sha256:digest(payload)}]}}}));
 const loader=Buffer.from(`import json,os,pathlib,sys\nw=pathlib.Path(sys.argv[sys.argv.index('--workspace')+1]);(w/'loader-flags.json').write_text(json.dumps({'key_env_present':'SKILLS_SOURCE_SSH_KEY' in os.environ}))\nprint('fixture loader returned')\n`);writeFileSync(join(origin,'distribution/skills_source.py'),loader);const skillRevision=commit(origin);
 mkdirSync(join(root,'scripts'));writeFileSync(join(root,'scripts/skills-source.py'),readFileSync(new URL('../../../scripts/skills-source.py',import.meta.url)));writeFileSync(join(root,'.skills-source.json'),JSON.stringify({repository:'perfectuser21/zenithjoy-skills',revision:skillRevision,profile:'zenithjoy',loader_sha256:digest(loader)}));writeFileSync(join(root,'.gitignore'),'.skills-source/\nloader-flags.json\n');const revision=commit(root);
 writeFileSync(join(bin,'git'),`#!${python}\nimport json,os,sys\nwith open(os.environ['FIXTURE_GIT_LOG'],'a') as f:f.write(json.dumps({'kind':'git','args':sys.argv[1:],'has_key':'SKILLS_SOURCE_SSH_KEY' in os.environ})+'\\n')\nos.execv(os.environ['FIXTURE_REAL_GIT'],['git',*sys.argv[1:]])\n`,{mode:0o700});
 writeFileSync(join(bin,'ssh'),`#!${python}\nimport hashlib,json,os,pathlib,stat,sys\na=sys.argv[1:];identity=pathlib.Path(a[a.index('-i')+1]);s=identity.lstat()\nassert stat.S_ISREG(s.st_mode) and stat.S_IMODE(s.st_mode)==0o600 and s.st_uid==os.getuid() and s.st_nlink==1\nassert '-F' in a and '/dev/null' in a and 'StrictHostKeyChecking=yes' in a and 'IdentityAgent=none' in a\nassert hashlib.sha256(identity.read_bytes()).hexdigest()==os.environ['FIXTURE_KEY_HASH']\nwith open(os.environ['FIXTURE_GIT_LOG'],'a') as f:f.write(json.dumps({'kind':'ssh','has_key':'SKILLS_SOURCE_SSH_KEY' in os.environ,'identity':str(identity),'mode':stat.S_IMODE(s.st_mode)})+'\\n')\nif os.environ.get('FIXTURE_FAIL')=='1':\n print('Host key verification failed '+identity.read_text(),file=sys.stderr);sys.exit(255)\nos.execv(os.environ['FIXTURE_UPLOAD_PACK'],['git-upload-pack',os.environ['FIXTURE_SOURCE']])\n`,{mode:0o700});
 const upload=execFileSync('which',['git-upload-pack'],{encoding:'utf8'}).trim(),userinfo=os.userInfo,envKeys=['PATH','HOME','FIXTURE_GIT_LOG','FIXTURE_REAL_GIT','FIXTURE_SOURCE','FIXTURE_KEY_HASH','FIXTURE_UPLOAD_PACK','FIXTURE_FAIL'],prior=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{PATH:bin+':'+process.env.PATH,HOME:home,FIXTURE_GIT_LOG:log,FIXTURE_REAL_GIT:realGit,FIXTURE_SOURCE:origin,FIXTURE_KEY_HASH:digest(Buffer.from(fake+'\n')),FIXTURE_UPLOAD_PACK:upload});os.userInfo=(...args)=>({...userinfo(...args),homedir:home});syncBuiltinESMExports();
 t.after(()=>{os.userInfo=userinfo;for(const k of envKeys){if(prior[k]===undefined)delete process.env[k];else process.env[k]=prior[k];}syncBuiltinESMExports();});
 return{root,home,mirror,fake,revision,skillRevision,log,git,payload};
}

test('cold pinned bootstrap alone receives approved mirror; real fakeSSH fetch preserves source and scrubs every Git/loader child',async t=>{
 const f=await coldFixture(t),{prepareDeploymentSkillSources,readDeploymentSource,fixedSourceEnvironment}=await import('../deployment-fixed-source.mjs');
 const run=cp.execFileSync,seen=[];cp.execFileSync=(command,args,options)=>{if(command==='python3'&&args.includes('-c')){assert.equal(digest(Buffer.from(options.env.SKILLS_SOURCE_SSH_KEY||'')),digest(Buffer.from(f.fake+'\n')));assert.equal(options.env.GIT_ALLOW_PROTOCOL,'ssh');assert.ok(!args.join(' ').includes(f.fake));seen.push(options.env.TMPDIR);}return run(command,args,options);};syncBuiltinESMExports();
 try{prepareDeploymentSkillSources(f.root,f.revision);}finally{cp.execFileSync=run;syncBuiltinESMExports();}
 assert.equal(seen.length,1);assert.ok(seen.every(path=>path&&!existsSync(path)));assert.equal(f.git(join(f.root,'.skills-source'),'rev-parse','HEAD'),f.skillRevision);
 const calls=readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse);assert.ok(calls.some(c=>c.kind==='ssh'));assert.ok(calls.every(c=>!c.has_key));assert.ok(calls.filter(c=>c.kind==='ssh').every(c=>!existsSync(c.identity)));
 assert.equal(JSON.parse(readFileSync(join(f.root,'loader-flags.json'))).key_env_present,false);assert.equal(fixedSourceEnvironment().SKILLS_SOURCE_SSH_KEY,undefined);
 assert.deepEqual(readDeploymentSource(f.root,f.revision,file,{materialize:true}),f.payload);rmSync(f.mirror);prepareDeploymentSkillSources(f.root,f.revision);
});

test('cold bootstrap errors never echo key and private temporary identity tree is removed on failure',async t=>{
 const f=await coldFixture(t),{prepareDeploymentSkillSources}=await import('../deployment-fixed-source.mjs');process.env.FIXTURE_FAIL='1';
 assert.throws(()=>prepareDeploymentSkillSources(f.root,f.revision),e=>/^SKILL_SOURCE_BOOTSTRAP_/.test(e.message)&&!e.message.includes(f.fake));
 const calls=readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse);assert.ok(calls.some(c=>c.kind==='ssh'));assert.ok(calls.every(c=>!c.has_key));assert.ok(calls.filter(c=>c.kind==='ssh').every(c=>!existsSync(c.identity)));
});

for(const kind of ['missing','mode','symlink','hardlink','directory','fifo','empty','oversized','nul','invalid-utf8'])test(`cold key mirror rejects ${kind} before bootstrap or release work`,async t=>{
 const f=await coldFixture(t),{prepareDeploymentSkillSources}=await import('../deployment-fixed-source.mjs');
 if(kind==='mode')chmodSync(f.mirror,0o644);
 else if(kind==='hardlink')linkSync(f.mirror,f.mirror+'.link');
 else if(kind==='empty')writeFileSync(f.mirror,'');
 else if(kind==='oversized')writeFileSync(f.mirror,Buffer.alloc(65537,65));
 else if(kind==='nul')writeFileSync(f.mirror,Buffer.from([65,0,66]));
 else if(kind==='invalid-utf8')writeFileSync(f.mirror,Buffer.from([0xff]));
 else {rmSync(f.mirror);if(kind==='symlink')symlinkSync('missing-target',f.mirror);if(kind==='directory')mkdirSync(f.mirror);if(kind==='fifo')execFileSync('mkfifo',[f.mirror]);}
 const run=cp.execFileSync;let bootstrap=0;cp.execFileSync=(command,args,options)=>{if(command==='python3')bootstrap++;return run(command,args,options);};syncBuiltinESMExports();
 const previous=process.env.SKILLS_SOURCE_SSH_KEY;process.env.SKILLS_SOURCE_SSH_KEY=f.fake;
 try{assert.throws(()=>prepareDeploymentSkillSources(f.root,f.revision),e=>e.message==='SKILL_SOURCE_BOOTSTRAP_KEY_INVALID'&&!e.message.includes(f.fake));}
 finally{cp.execFileSync=run;if(previous===undefined)delete process.env.SKILLS_SOURCE_SSH_KEY;else process.env.SKILLS_SOURCE_SSH_KEY=previous;syncBuiltinESMExports();}
 assert.equal(bootstrap,0);assert.ok(!existsSync(f.log)||readFileSync(f.log,'utf8').split('\n').filter(Boolean).map(JSON.parse).every(c=>c.kind==='git'&&!c.has_key));
});
test('cold bootstrap timeout/error object cannot leak output or leave its owned private temporary tree',async t=>{
 const f=await coldFixture(t),{prepareDeploymentSkillSources}=await import('../deployment-fixed-source.mjs'),run=cp.execFileSync;let temporary;
 cp.execFileSync=(command,args,options)=>{if(command==='python3'){temporary=options.env.TMPDIR;assert.ok(existsSync(temporary));writeFileSync(join(temporary,'partial-secret'),f.fake,{mode:0o600});throw Object.assign(Error(f.fake),{code:'ETIMEDOUT',stderr:Buffer.from(f.fake),stdout:Buffer.from(f.fake)});}return run(command,args,options);};syncBuiltinESMExports();
 try{assert.throws(()=>prepareDeploymentSkillSources(f.root,f.revision),e=>e.message==='SKILL_SOURCE_BOOTSTRAP_FAILED'&&!JSON.stringify(e).includes(f.fake)&&!e.cause);}
 finally{cp.execFileSync=run;syncBuiltinESMExports();}
 assert.ok(temporary&&!existsSync(temporary));
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
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

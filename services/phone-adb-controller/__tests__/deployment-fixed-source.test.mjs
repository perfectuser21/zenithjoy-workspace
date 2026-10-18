import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
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
 assert.throws(()=>readDeploymentSource(f.root,f.revision,'not-in-catalog.md',{materialize:true}));
 assert.throws(()=>readDeploymentSource(f.root,f.revision,'../outside',{materialize:true}),/路径/);
});

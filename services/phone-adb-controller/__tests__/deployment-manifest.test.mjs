import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { deploymentManifest } from '../deployment-manifest.mjs';
test('部署manifest必须绑定git固定commit的真实字节，dirty同HEAD不能盖章',()=>{
 const root=mkdtempSync(join(tmpdir(),'deployment-fixed-'));const source=join(root,'services/phone-adb-controller');mkdirSync(source,{recursive:true});writeFileSync(join(source,'run.sh'),'original\n');
 const git=(...args)=>execFileSync('git',['-C',root,...args],{stdio:'pipe'});
 git('init');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture');
 const manifest=deploymentManifest(root,['run.sh']);assert.match(manifest.source_commit,/^[a-f0-9]{40}$/);assert.equal(manifest.files[0].deployed_path,'run.sh');
 writeFileSync(join(source,'run.sh'),'dirty\n');assert.throws(()=>deploymentManifest(root,['run.sh']),/固定commit/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { deploymentManifest } from '../deployment-manifest.mjs';
test('部署manifest必须绑定git固定commit的真实字节，dirty同HEAD不能盖章',()=>{
 const root=mkdtempSync(join(tmpdir(),'deployment-fixed-'));const source=join(root,'services/phone-adb-controller');mkdirSync(source,{recursive:true});writeFileSync(join(source,'run.sh'),'original\n');
 const git=(...args)=>execFileSync('git',['-C',root,...args],{stdio:'pipe'});
 git('init','-b','cp-10021800-runtime-fixture');git('add','.');const tree=git('write-tree').toString().trim();const commit=git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit-tree',tree,'-m','fixture').toString().trim();
 const manifest=deploymentManifest(root,['run.sh'],{commit});assert.match(manifest.source_commit,/^[a-f0-9]{40}$/);assert.equal(manifest.files[0].deployed_path,'run.sh');
 git('update-ref','HEAD',commit);
 const cli=join(root,'manifest-cli-link.mjs');symlinkSync(new URL('../deployment-manifest.mjs',import.meta.url).pathname,cli);
 const output=execFileSync(process.execPath,[cli,root,'run.sh'],{encoding:'utf8'});
 assert.deepEqual(JSON.parse(output),manifest,'符号链接部署入口必须真正执行并输出manifest');
 writeFileSync(join(source,'run.sh'),'dirty\n');assert.throws(()=>deploymentManifest(root,['run.sh'],{commit}),/固定commit/);
});

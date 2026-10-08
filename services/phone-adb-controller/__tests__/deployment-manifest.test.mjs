import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,symlinkSync,copyFileSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { spawnSync } from 'node:child_process';
import { deploymentManifest,collectDeployment } from '../deployment-manifest.mjs';
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

test('部署后collect必须读实际文件字节和机器身份，篡改拒绝而非复制声明摘要',()=>{
 const root=mkdtempSync(join(tmpdir(),'deployment-readback-'));writeFileSync(join(root,'run.sh'),'actual\n');
 const manifest={source_repo:'fixture/repo',source_commit:'a'.repeat(40),files:[{path:'services/phone-adb-controller/run.sh',deployed_path:'run.sh',content_sha256:createHash('sha256').update('actual\n').digest('hex')}]};
 const mf=join(root,'manifest.json');writeFileSync(mf,JSON.stringify(manifest));
 const cli=new URL('../deployment-manifest.mjs',import.meta.url).pathname;
 const r=spawnSync(process.execPath,[cli,'collect',root,mf],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 const result=JSON.parse(r.stdout);assert.equal(result.files[0].content_sha256,manifest.files[0].content_sha256);assert.equal(result.observed_hostname,hostname());
 writeFileSync(join(root,'run.sh'),'tampered');const bad=spawnSync(process.execPath,[cli,'collect',root,mf],{encoding:'utf8'});assert.notEqual(bad.status,0);assert.match(bad.stderr,/实际.*digest/);

});

test('设备冻结及MMV读回保留checks/plans嵌套路径，同commit绑定全部RPC来源',async()=>{
 const {RPC_FILES,rpcSource}=await import('../leadgen-client.mjs');
 const root=mkdtempSync(join(tmpdir(),'rpc-nested-source-')),device=mkdtempSync(join(tmpdir(),'rpc-nested-device-')),mmv=mkdtempSync(join(tmpdir(),'rpc-nested-mmv-'));
 const prefix=join(root,'services/phone-adb-controller');
 for(const path of RPC_FILES){const dest=join(prefix,path);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,`fixture fixed bytes: ${path}\n`);}
 const git=(...args)=>execFileSync('git',['-C',root,...args],{stdio:'pipe'});git('init','-b','cp-rpc-nested-fixture');git('add','.');
 const tree=git('write-tree').toString().trim();const commit=git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit-tree',tree,'-m','fixture').toString().trim();
 const manifest=deploymentManifest(root,RPC_FILES,{commit});
 for(const target of [device,mmv])for(const entry of manifest.files){const dest=join(target,entry.deployed_path);mkdirSync(dirname(dest),{recursive:true});copyFileSync(join(root,entry.path),dest);}
 const frozen={deployment:manifest,files:Object.fromEntries(manifest.files.map(f=>[`runtime/${f.deployed_path}`,f.content_sha256]))};
 const source=rpcSource(frozen);assert.equal(source.commit,commit);assert.deepEqual(source.files.map(f=>f.path),RPC_FILES);
 for(const target of [device,mmv]){const actual=collectDeployment(target,manifest);assert.equal(actual.source_commit,commit);assert.deepEqual(actual.files,manifest.files);}
 for(const entry of source.files.filter(f=>f.path.startsWith('checks/')||f.path.startsWith('plans/')))assert.ok(manifest.files.some(f=>f.deployed_path===entry.path&&f.content_sha256===entry.sha256));
 assert.equal(source.files.filter(f=>f.path.startsWith('checks/douyin-')).length,4);assert.equal(source.files.filter(f=>f.path.startsWith('plans/')).length,4);
 writeFileSync(join(mmv,'checks/douyin-video-discovery.yaml'),'tampered');assert.throws(()=>collectDeployment(mmv,manifest),/实际文件digest不符/);
 delete frozen.files['runtime/plans/douyin_video_processing.steps.json'];assert.throws(()=>rpcSource(frozen),/缺远端依赖/);
});

test('MMV完整正式部署清单用固定Git字节覆盖CORE/SH/PLAN/CTL及原数据层，双实际路径collect一致',()=>{
 const source=readFileSync(new URL('../deploy.sh',import.meta.url),'utf8');
 const arrays=source.slice(source.indexOf('MMV_JS_FILES=('),source.indexOf('# 在任何SSH前'));
 const files=execFileSync('bash',['-c',arrays+'\nprintf "%s\\n" "${MMV_RUNTIME_FILES[@]}"'],{encoding:'utf8'}).trim().split('\n');
 assert.equal(new Set(files).size,files.length);
 for(const path of ['leadgen-run.sh','leadgen-workflow.mjs','runtime-receipts.mjs','douyin-phone-adb','phone-lock-helper.py','leadgen-rpc.mjs','leadgen-queue.js','sort-comments.js','plans/douyin_comment_scoring.plan','checks/douyin-comment-scoring.yaml'])assert.ok(files.includes(path),`MMV正式包缺 ${path}`);
 const root=mkdtempSync(join(tmpdir(),'mmv-full-fixed-')),prefix=join(root,'services/phone-adb-controller'),runner=mkdtempSync(join(tmpdir(),'mmv-full-runner-')),rpc=mkdtempSync(join(tmpdir(),'mmv-full-rpc-'));
 for(const path of files){const dest=join(prefix,path);mkdirSync(dirname(dest),{recursive:true});copyFileSync(new URL('../'+path,import.meta.url),dest);}
 const git=(...args)=>execFileSync('git',['-C',root,...args],{stdio:'pipe'});git('init','-b','cp-mmv-full-fixture');git('add','.');const tree=git('write-tree').toString().trim();
 const commit=git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit-tree',tree,'-m','fixture').toString().trim();const manifest=deploymentManifest(root,files,{commit});
 for(const target of [runner,rpc]){for(const f of manifest.files){const dest=join(target,f.deployed_path);mkdirSync(dirname(dest),{recursive:true});copyFileSync(join(root,f.path),dest);}
  const actual=collectDeployment(target,manifest);assert.equal(actual.source_commit,commit);assert.deepEqual(actual.files,manifest.files);}
 writeFileSync(join(rpc,'leadgen-queue.js'),'drift');assert.throws(()=>collectDeployment(rpc,manifest),/实际文件digest不符/);
});

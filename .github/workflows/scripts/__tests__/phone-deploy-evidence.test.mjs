import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const url=new URL('../phone-deploy-evidence.mjs',import.meta.url),sha='a'.repeat(40),repo='perfectuser21/zenithjoy-workspace';
async function implementation(){assert.ok(existsSync(url),'必须验证实际GitHub run/artifact来源');return import(url);}
function run(){return {id:42,status:'completed',conclusion:'success',event:'push',head_branch:'main',head_sha:sha,path:'.github/workflows/pilot-release-verification.yml',repository:{id:1,full_name:repo},head_repository:{id:1,full_name:repo}};}
test('拒绝PR/fork/错workflow/非主线/旧SHA/未成功run，接受主线push和dispatch',async()=>{
 const {validateSourceRun}=await implementation();assert.equal(validateSourceRun(run(),sha).id,42);assert.equal(validateSourceRun({...run(),event:'workflow_dispatch'},sha).id,42);
 for(const change of [{event:'pull_request'},{head_repository:{id:2,full_name:repo}},{head_branch:'feature'},{path:'.github/workflows/other.yml'},{conclusion:'failure'},{head_sha:'b'.repeat(40)},{status:'in_progress'}])assert.throws(()=>validateSourceRun({...run(),...change},sha));
});
test('固定同run SHA artifact；过期/重复/不同run与fork来源均拒绝',async()=>{
 const {selectArtifact}=await implementation();const name=`pilot-release-verification-${sha}`;
 const good={id:55,name,expired:false,workflow_run:{id:42,head_branch:'main',head_sha:sha,repository_id:1,head_repository_id:1}};
 assert.equal(selectArtifact([good],name,run()).id,55);
 for(const items of [[good,good],[{...good,expired:true}],[{...good,workflow_run:{...good.workflow_run,id:43}}],[{...good,workflow_run:{...good.workflow_run,head_repository_id:2}}],[]])assert.throws(()=>selectArtifact(items,name,run()));
});
test('真实ZIP只读取固定JSON，不释放旁带代码或路径',async()=>{
 const {readArtifactJson}=await implementation();const dir=mkdtempSync(join(tmpdir(),'phone-artifact-'));writeFileSync(join(dir,'head.json'),'{"snapshot":{"revision":"fixed"}}');writeFileSync(join(dir,'extra-tool.mjs'),'throw Error("must not execute")');
 execFileSync('zip',['-q','bundle.zip','head.json','extra-tool.mjs'],{cwd:dir});
 assert.deepEqual(readArtifactJson(readFileSync(join(dir,'bundle.zip')),'head.json'),{snapshot:{revision:'fixed'}});
 assert.throws(()=>readArtifactJson(readFileSync(join(dir,'bundle.zip')),'receipt.json'));
});

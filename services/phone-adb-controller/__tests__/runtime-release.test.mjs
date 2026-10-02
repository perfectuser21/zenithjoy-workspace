import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freezeDefinition,digest } from '../runtime-definition.mjs';
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'release-runtime-')),sha='a'.repeat(40),repo='fixture/repo';
 const files=['entry.sh','workflow.plan','steps.json'].map((name,i)=>{const bytes=['#!/bin/sh\necho original\n','WF_CAP=test\n','{"steps":[]}'][i];writeFileSync(join(root,name),bytes);return {path:`services/phone-adb-controller/${name}`,deployed_path:name,content_sha256:digest(bytes)};});
 const version=(id,payload)=>{const source={repo,path:'contracts/test.yaml',commit:sha};return {id,source_repo:repo,source_path:source.path,source_commit:sha,payload,contract_sha256:digest(payload.contract),payload_sha256:digest({source,payload})};};
 const av=version('av-fixed',{activity_id:'activity',definition_key:'test.run',contract:{id:'run'},steps:[],implementation_bindings:[{kind:'code',status:'verified',repo,path:files[0].path,revision:sha,content_sha256:files[0].content_sha256}]});
 const wv=version('wv-fixed',{workflow_id:'workflow',key:'brain-test',contract:{capability:'test'},activities:[{reference_id:'ref',slot_key:'run',sequence_no:1,activity_id:'activity',activity_version_id:av.id}]});
 const payload={schema_version:1,workflows:[wv],activities:[av],components:[],ci_evidence:[],allowed_enabler_calls:[],verification:{}};
 const release={id:'release-fixed',release_key:'fixture',manifest_sha256:digest(payload),environment:'scratch',target:'fixture-host',payload};
 const manifest={source_repo:repo,source_commit:sha,release_id:release.id,observation_id:'observation',environment:'scratch',target:'fixture-host',files};writeFileSync(join(root,'deployment-manifest.json'),JSON.stringify(manifest));
 const calls=[];const get=async path=>{calls.push(path);if(path===`/api/brain/releases/${release.id}`)return {release};if(path.startsWith('/api/brain/activities/'))return {version:av};if(path==='/api/brain/workflows')return [{id:'workflow',key:'brain-test',current_definition_version_id:'wv-latest'}];return {version:version('wv-latest',{...wv.payload})};};
 return {root,release,manifest,calls,options:{releaseId:release.id,runDir:join(root,'run'),deploymentRoot:root,planPath:join(root,'workflow.plan'),stepSpecPath:join(root,'steps.json'),rawContractSha256:wv.contract_sha256,workflowKey:'brain-test',get}};
}
test('显式release冻结历史版本，禁止查current/latest且续跑不换release',async()=>{
 const f=fixture();const result=await freezeDefinition(f.options);
 assert.equal(result.workflow_version.id,'wv-fixed');assert.equal(result.release.id,'release-fixed');
 assert.deepEqual(f.calls,['/api/brain/releases/release-fixed']);
 writeFileSync(join(f.root,'entry.sh'),'changed');const resumed=await freezeDefinition({...f.options,releaseId:'different-release'});
 assert.equal(resumed.snapshot_sha256,result.snapshot_sha256);assert.deepEqual(f.calls,['/api/brain/releases/release-fixed']);
 assert.equal(readFileSync(join(f.options.runDir,'runtime/entry.sh'),'utf8'),'#!/bin/sh\necho original\n');
});
test('release摘要或部署release身份冲突拒绝，不产生部分运行快照',async()=>{
 const f=fixture();f.release.manifest_sha256='b'.repeat(64);
 await assert.rejects(freezeDefinition(f.options),/release.*摘要|release.*digest/);
 const g=fixture();await assert.rejects(freezeDefinition({...g.options,releaseId:'other'}),/release.*不匹配|release.*不同/);
});

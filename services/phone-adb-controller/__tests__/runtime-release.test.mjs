import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync } from 'node:fs';
import { tmpdir,hostname } from 'node:os';
import { candidateArchivePath,deploymentTarget } from '../deployment-release.mjs';
const actualHost=deploymentTarget(hostname());
import { dirname,join } from 'node:path';
import { agentInput,freezeDefinition,digest } from '../runtime-definition.mjs';
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'release-runtime-')),sha='a'.repeat(40),repo='fixture/repo';
 const files=['entry.sh','workflow.plan','steps.json'].map((name,i)=>{const bytes=['#!/bin/sh\necho original\n','WF_CAP=test\n','{"steps":[]}'][i];writeFileSync(join(root,name),bytes);return {path:`services/phone-adb-controller/${name}`,deployed_path:name,content_sha256:digest(bytes)};});
 const version=(id,payload)=>{const source={repo,path:'contracts/test.yaml',commit:sha};return {id,source_repo:repo,source_path:source.path,source_commit:sha,payload,contract_sha256:digest(payload.contract),payload_sha256:digest({source,payload})};};
 const av=version('av-fixed',{activity_id:'activity',definition_key:'test.run',contract:{id:'run'},steps:[],implementation_bindings:[{kind:'code',status:'verified',repo,path:files[0].path,revision:sha,content_sha256:files[0].content_sha256}]});
 const wv=version('wv-fixed',{workflow_id:'workflow',key:'brain-test',contract:{capability:'test'},activities:[{reference_id:'ref',slot_key:'run',sequence_no:1,activity_id:'activity',activity_version_id:av.id}]});
 const payload={schema_version:1,workflows:[wv],activities:[av],components:[],ci_evidence:[],allowed_enabler_calls:[],verification:{}};
 const release={id:'release-fixed',release_key:'fixture',manifest_sha256:digest({environment:'scratch',target:actualHost,payload}),environment:'scratch',target:actualHost,payload};
 const manifest={source_repo:repo,source_commit:sha,release_id:release.id,observation_id:'observation',environment:'scratch',target:actualHost,files};writeFileSync(join(root,'deployment-manifest.json'),JSON.stringify(manifest));
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

test('freeze及已有冻结件resume必须核实际主机，不接受复制的目标声明',async()=>{
 const f=fixture();f.release.target='totally-other-machine';f.manifest.target=f.release.target;
 f.release.manifest_sha256=digest({environment:f.release.environment,target:f.release.target,payload:f.release.payload});writeFileSync(join(f.root,'deployment-manifest.json'),JSON.stringify(f.manifest));
 await assert.rejects(freezeDefinition(f.options),/实际.*机器|实际.*主机/);
 const g=fixture();await freezeDefinition(g.options);const path=join(g.options.runDir,'run-definition.json');const {snapshot_sha256,...body}=JSON.parse(readFileSync(path,'utf8'));
 body.release.target='totally-other-machine';body.deployment.target=body.release.target;writeFileSync(path,JSON.stringify({...body,snapshot_sha256:digest(body)}));
 await assert.rejects(freezeDefinition(g.options),/实际.*机器|实际.*主机/);
});

function historicalFoundation(t){
 const f=fixture();t.after(()=>rmSync(f.root,{recursive:true,force:true}));
 const [current]=f.manifest.files,revision='c'.repeat(40),bytes='historical foundation host bytes\n';
 const archive={path:current.path,deployed_path:candidateArchivePath(revision,current.path),source_revision:revision,content_sha256:digest(bytes)};
 f.manifest.files.push(archive);
 const av=f.release.payload.activities[0];
 av.payload.contract.runtime={entry:current.path};
 const binding={...av.payload.implementation_bindings[0],purpose:'foundation_host',revision,content_sha256:archive.content_sha256};
 av.payload.implementation_bindings.push(binding);
 const component={kind:'code',repo:f.manifest.source_repo,path:current.path,revision,digest:`sha256:${archive.content_sha256}`};
 f.release.payload.components.push(component);
 f.release.environment=f.manifest.environment=`staging:${f.manifest.source_commit}`;
 const write=()=>{
  const archivedPath=join(f.root,archive.deployed_path);
  mkdirSync(dirname(archivedPath),{recursive:true});writeFileSync(archivedPath,bytes);
  av.contract_sha256=digest(av.payload.contract);
  av.payload_sha256=digest({source:{repo:av.source_repo,path:av.source_path,commit:av.source_commit},payload:av.payload});
  f.release.manifest_sha256=digest({environment:f.release.environment,target:f.release.target,payload:f.release.payload});
  writeFileSync(join(f.root,'deployment-manifest.json'),JSON.stringify(f.manifest));
 };
 return {...f,av,archive,binding,bytes,component,current,write};
}

test('固定 staging release 冻结同路径下当前执行文件与历史宿主文件',async t=>{
 const f=historicalFoundation(t);f.write();
 const frozen=await freezeDefinition(f.options),[current,archived]=frozen.activities[0].implementations;
 assert.equal(current.execution_path,`runtime/${f.current.deployed_path}`);
 assert.equal(archived.execution_path,`runtime/${f.archive.deployed_path}`);
 assert.equal(archived.execution_verification,'verified_local');
 assert.equal(frozen.files[archived.execution_path],f.archive.content_sha256);
 assert.equal(frozen.files[current.execution_path],f.current.content_sha256);
 assert.equal(readFileSync(join(f.options.runDir,archived.execution_path),'utf8'),f.bytes);
 assert.equal(readFileSync(join(f.options.runDir,current.execution_path),'utf8'),'#!/bin/sh\necho original\n');
});

test('历史宿主 Skill 随 release 冻结但不能代替当前 Agent 主方法',async t=>{
 const f=historicalFoundation(t),workflow='douyin_video_discovery';
 const w=f.release.payload.workflows[0];w.payload.key=workflow;
 w.payload_sha256=digest({source:{repo:w.source_repo,path:w.source_path,commit:w.source_commit},payload:w.payload});
 const options={...f.options,workflowKey:workflow,executionMode:'agent',agentInput:agentInput({
  LEADGEN_EXECUTION_MODE:'agent',WF_BRAIN_WORKFLOW:workflow,WF_BRAIN_TASK_ID:'11111111-1111-4111-8111-111111111111',
  WFR_TAG:'primary101',P:'cloud-phone-test',SERIAL:'fixture-device',LEADGEN_LINE:'yuesheng',WF_RUN_START_TS:'1700000000',
 })};
 f.binding.kind=f.component.kind='skill';f.write();
 await assert.rejects(freezeDefinition(options),/AGENT_PRIMARY_SKILL_BINDING_UNVERIFIED/);
 const name='skills/current/SKILL.md',path=`services/phone-adb-controller/${name}`,text='# Current method\n';
 mkdirSync(join(f.root,'skills/current'),{recursive:true});writeFileSync(join(f.root,name),text);
 f.manifest.files.push({path,deployed_path:name,content_sha256:digest(text)});
 f.av.payload.implementation_bindings.push({kind:'skill',status:'verified',repo:f.manifest.source_repo,path,revision:f.manifest.source_commit,content_sha256:digest(text)});
 f.write();
 const frozen=await freezeDefinition(options);
 assert.deepEqual(frozen.activities[0].implementations.filter(b=>b.kind==='skill').map(b=>b.execution_path),[`runtime/${f.archive.deployed_path}`,`runtime/${name}`]);
});

test('历史宿主必须是固定 staging 的确切归档与 release 组件，且不能充当当前入口或 Skill',async t=>{
 const changes={
  production:f=>{f.release.environment=f.manifest.environment='production';},
  differentStaging:f=>{f.release.environment=f.manifest.environment=`staging:${'f'.repeat(40)}`;},
  differentPurpose:f=>{delete f.binding.purpose;},
  differentKind:f=>{f.binding.kind='skill';},
  noPinnedRelease:f=>{delete f.options.releaseId;delete f.manifest.release_id;},
  missingCurrentEntry:f=>{f.av.payload.implementation_bindings.shift();},
  missingComponent:f=>{f.release.payload.components=[];},
  componentDigest:f=>{f.component.digest=`sha256:${'e'.repeat(64)}`;},
  wrongArchivePath:f=>{f.archive.deployed_path='wrong-archive.sh';},
  wrongCurrentPath:f=>{f.current.deployed_path=candidateArchivePath(f.manifest.source_commit,f.current.path);mkdirSync(dirname(join(f.root,f.current.deployed_path)),{recursive:true});writeFileSync(join(f.root,f.current.deployed_path),readFileSync(join(f.root,'entry.sh')));},
  wrongRevision:f=>{f.archive.source_revision='d'.repeat(40);},
  wrongBindingDigest:f=>{f.binding.content_sha256='d'.repeat(64);},
  duplicateRevision:f=>{f.manifest.files.push({...f.archive,deployed_path:'second-archive.sh'});writeFileSync(join(f.root,'second-archive.sh'),f.bytes);},
 };
 for(const [name,change] of Object.entries(changes)){
  await t.test(name,async t=>{
   const f=historicalFoundation(t);change(f);f.write();
   await assert.rejects(freezeDefinition(f.options),/实现binding|运行入口|部署文件.*重复/);
   assert.equal(existsSync(join(f.options.runDir,'run-definition.json')),false);
  });
 }
});

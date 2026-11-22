import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {foundationFixture} from './helpers/leadgen-foundation-fixture.mjs';
import {prepareLeadgenHost} from '../leadgen-foundation/adapter.mjs';
import {prepareLeadgenHost as prepareCandidate} from '../leadgen-foundation/qualification-agent-adapter.mjs';
import {canonical} from '../leadgen-foundation/context.mjs';
import {deriveQualificationAgentHost, qualificationAgentContract, qualificationAgentProfile, qualificationAgentSourcePaths, qualificationAgentTools} from '../qualification-agent-candidate.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('候选仅改 qualification，冻结 Agent 证据并拒绝旧 Judge 工具', async t => {
  const f = await foundationFixture('102');
  t.after(f.close);
  const stock = await prepareLeadgenHost(f);
  const files = Object.fromEntries(Object.keys(stock.receipt.files)
    .map(name => [name, fs.readFileSync(path.join(stock.profile.cwd,name))]));
  const legacy = f.run.contract.activities.find(a=>a.key==='qualification').acceptance.document.version==='3.5.8';
  const frozenContract = legacy ? qualificationAgentContract(f.run.contract) : f.run.contract;
  const candidateSource = fs.readFileSync(new URL('../qualification-agent-decision.mjs',import.meta.url),'utf8');
  const published=JSON.parse(fs.readFileSync(new URL('../leadgen-foundation/profiles/102.json',import.meta.url)));
  const params = {files, expected: stock.receipt.files, frozenContract, candidateSource,
    candidateSha256:digest(candidateSource),hostTools:published.profile.skill_runtime.host_tools};
  const revised = deriveQualificationAgentHost(params);
  const sources=Object.fromEntries(qualificationAgentSourcePaths.map(name=>[name,digest(fs.readFileSync(new URL('../../../'+name,import.meta.url)))]));
  const methodSources=Object.fromEntries(Object.keys(published.profile.files)
    .filter(name=>name.startsWith('services/phone-adb-controller/skills/')).map(name=>[name,'c'.repeat(64)]));
  const profile=legacy ? qualificationAgentProfile(published,{methodRevision:'b'.repeat(40),methodSources,sources}) : published;
  assert.equal(profile.profile.adapter,qualificationAgentSourcePaths[0]);
  assert.match(profile.profile.files[profile.profile.skill_runtime.activities.qualification.skill],/^[a-f0-9]{64}$/);
  assert.equal(profile.profile.leadgen.contract_sha256,digest(canonical(profile.contract)));
  assert.equal(published.profile.skill_runtime.host_tools.kinds.includes('qualify'),legacy);
  assert.doesNotMatch(revised.files['agent-tools.txt'],/tools.py qualify ACTION_NAME|一次ASR\+一次主判/);

  const qualification = revised.contract.activities.find(a=>a.key==='qualification');
  assert.equal(qualification.runtime.checker_repair,undefined,
    '首次资格执行必须保有默认工具，不能依据仅覆盖宿主工具的证明自动重跑');
  assert.match(revised.files['agent-tools.txt'],/cleanup.*snapshot-evidence.*fetch-native/);
  assert.match(JSON.stringify(qualification.acceptance.document),/Activity Agent/);
  assert.doesNotMatch(JSON.stringify(qualification.acceptance.document),/逐VID核对原生结构化主判选择和置信度/);
  assert.doesNotMatch(JSON.stringify(qualification.acceptance.document),/kind=qualify[、，。]/);
  assert.deepEqual(qualification.acceptance.document.model.map(item=>item.provider),['dashscope']);
  assert.deepEqual(qualification.failure,qualification.acceptance.document.failure);
  assert.doesNotMatch(JSON.stringify(qualification.failure),/OpenRouter|judge-video\.js/);
  assert.match(qualification.acceptance.document.steps.find(step=>step.key==='judge_content').implementation.ref,/qualify-submit/);
  for (const n of ['preflight','dedup','collection','cleanup']) {
    assert.deepEqual(revised.contract.activities.find(a=>a.key===n),f.run.contract.activities.find(a=>a.key===n));
  }
  assert.doesNotMatch(revised.tools.kinds.join(','),/(^|,)qualify(,|$)/);
  assert.ok(['qualify-prepare','qualify-submit'].every(name=>revised.tools.kinds.includes(name)));
  for (const [name,bytes] of Object.entries(revised.files)) assert.equal(revised.sha256[name],digest(bytes));
  assert.throws(()=>deriveQualificationAgentHost({...params,files:{...files,'tools.py':files['tools.py']+'\n# drift'}}),/QUALIFICATION_AGENT_CANDIDATE_SOURCE/);
  const resultFile = path.join(f.root,'result.py');
  fs.writeFileSync(resultFile,revised.files['activity-tool-result.py']);
  const py = spawnSync('python3',['-c',`
import importlib.util
import sys
spec=importlib.util.spec_from_file_location("result",sys.argv[1])
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
video='7711111111111111111'
c={'assigned_workflow':'102','verification':{'102':{'video_ids':[video]}}}
for kind,args in [('qualify-prepare',[video,'/native/input.wav']),('qualify-submit',[video,'/native/input.wav','{}'])]:
  assert module.admit_tool_request(c,'qualification',kind,args) == {}
  for ctx,act in [(c,'collection'),({**c,'assigned_workflow':'103'},'qualification'),
    ({**c,'recovery':{'mode':'qualification-readonly-v1'}},'qualification')]:
    try: module.admit_tool_request(ctx,act,kind,args)
    except module.PreDispatchRejected: pass
    else: raise RuntimeError('invalid scope accepted')
try: module.admit_tool_request(c,'qualification','qualify',[video,'/native/input.wav'])
except module.PreDispatchRejected: pass
else: raise RuntimeError('legacy judge unexpectedly selectable')
`,resultFile],{encoding:'utf8'});
  assert.equal(py.status,0,py.stderr);
  assert.deepEqual(fs.readFileSync(path.join(stock.profile.cwd,'tools.py')),files['tools.py']);
});

test('独立 102 入口冻结宿主、重启按原散列恢复，并拒绝遗漏候选方法', async t => {
  const f = await foundationFixture('102');
  t.after(f.close);
  const readAdapter = name => fs.readFileSync(new URL('../leadgen-foundation/'+name,import.meta.url),'utf8');
  assert.equal(readAdapter('qualification-agent-adapter.mjs'),
    readAdapter('adapter.mjs').replace("from './assembly.mjs';","from './qualification-agent-assembly.mjs';"));
  if (f.run.contract.activities.find(a=>a.key==='qualification').acceptance.document.version==='3.5.8') {
    f.run.contract = qualificationAgentContract(f.run.contract);
  }
  f.profile.leadgen.contract_sha256 = digest(canonical(f.run.contract));
  const source = 'services/phone-adb-controller/qualification-agent-decision.mjs';
  const target = path.join(f.profile.cwd,source);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.copyFileSync(new URL('../qualification-agent-decision.mjs',import.meta.url),target);
  f.profile.files[source]=digest(fs.readFileSync(target));
  const stock=JSON.parse(fs.readFileSync(new URL('../leadgen-foundation/profiles/102.json',import.meta.url)));
  const tools=stock.profile.skill_runtime.host_tools;
  const legacyKinds=tools.kinds.filter(kind=>!['qualify','qualify-prepare','qualify-submit'].includes(kind));
  f.profile.skill_runtime.host_tools={...tools,kinds:[...legacyKinds,'qualify']};
  await assert.rejects(()=>prepareCandidate(f),/QUALIFICATION_AGENT_CANDIDATE_PROFILE/);
  f.profile.skill_runtime.host_tools=qualificationAgentTools(f.profile.skill_runtime.host_tools);
  const prepared=await prepareCandidate(f);
  await prepared.verifySource();
  const verified=spawnSync('python3',['-c','from pathlib import Path; import tools; tools._host.verify_host(Path.cwd(),tools.OPS)'],
    {cwd:prepared.profile.cwd,encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  assert.equal(verified.status,0,verified.stderr);
  const recovered=await prepareCandidate(f);
  assert.equal(prepared.receipt.recovered,false);
  assert.deepEqual(recovered.receipt,{...prepared.receipt,recovered:true});
  assert.equal(prepared.receipt.files['qualification/agent-decision.mjs'],f.profile.files[source]);
  assert.equal(prepared.profile.skill_runtime.host_tools.kinds.includes('qualify'),false);
  fs.appendFileSync(target,'\n// drift');
  await assert.rejects(()=>prepareCandidate(f),/PROFILE_SOURCE/);
});

test('准备材料超过宿主输出上限时仍交付同一原件，二次写入不许替换', async t => {
  const {publishActivityAgentDossier}=await import('../qualification-agent-decision.mjs');
  const f = await foundationFixture('102');
  t.after(f.close);
  const video='7711111111111111111';
  const directory=path.join(f.root,'qualification-receipts',video);
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const dossier={scope:{video_id:video},transcript:'精确引文'.repeat(8000)};
  const prepared={status:'prepared',dossier,dossier_sha256:digest(canonical(dossier)),journal:{path:'fixture'}};
  const receipt=publishActivityAgentDossier({checker_evidence_root:f.root},prepared);
  assert.ok(JSON.stringify(receipt).length < 12000);
  assert.equal(receipt.dossier,undefined);
  const saved=fs.readFileSync(receipt.dossier_ref.path);
  assert.equal(digest(saved),receipt.dossier_ref.sha256);
  assert.deepEqual(JSON.parse(saved),dossier);
  assert.deepEqual(publishActivityAgentDossier({checker_evidence_root:f.root},prepared),receipt);
  assert.throws(()=>publishActivityAgentDossier({checker_evidence_root:f.root},{...prepared,dossier:{...dossier,transcript:'改写'}}),
    /QUALIFICATION_AGENT_DOSSIER_CHANGED/);
});

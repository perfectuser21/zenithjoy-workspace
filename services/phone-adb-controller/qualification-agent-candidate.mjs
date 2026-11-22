import {createHash} from 'node:crypto';
import {buildQualificationAgentOverlay} from './qualification-agent-overlay.mjs';
import {generateAcceptance} from './leadgen-foundation/contract-acceptance.mjs';
import {canonical} from './leadgen-foundation/context.mjs';

const workflow = 'douyin_video_processing';
const activity = 'qualification';
const hash = value => createHash('sha256').update(value).digest('hex');
const need = (value, code) => { if (!value) throw Error('QUALIFICATION_AGENT_CANDIDATE_' + code); };
const newTools = ['qualify-prepare', 'qualify-submit'];

function replaceOnce(source, before, after) {
  const index = source.indexOf(before);
  need(index >= 0 && source.indexOf(before,index + before.length) < 0,'LAYOUT');
  return source.slice(0,index) + after + source.slice(index + before.length);
}

export function qualificationAgentContract(contract) {
  const result = structuredClone(contract);
  need(result.workflow === workflow, 'CONTRACT');
  const target = result.activities.find(item => item.key === activity);
  need(target?.acceptance?.document?.version === '3.5.8','CONTRACT');
  const document = target.acceptance.document;
  document.version = '3.6.0';
  const evidence = document.postconditions.find(rule => rule.probe === 'qual_reason_present');
  const provenance = '逐VID核对原生结构化主判选择和置信度与持久原值，原样记录提供者结果；';
  need(evidence?.asserts?.includes(provenance),'CONTRACT');
  evidence.asserts = replaceOnce(evidence.asserts,provenance,
    '新判断以同一资格 Activity Agent 的原准备和提交为唯一主判原件。核对宿主记录的 task/run/action/attempt、原冻结政策、原转写逐字引文、原画面帧标签、dossier 摘要、准备和提交摘要与持久结论、理由、转写均同源。使用实际提交回执和独立 PG 读回；历史缓存仍按原方法对应的真实 Judge 或 Agent 原件验收。');
  const legacyReceipt = '另从同一 host.receipts 列表按 activity=qualification、kind=qualify、operation=当前VID、state=terminal、exit_code=0 定位唯一正式调用原回执，按返回的 path 读取；judge-response.json 仅是主判响应。不要猜文件名。';
  evidence.asserts = replaceOnce(evidence.asserts,legacyReceipt,
    '另从同一 host.receipts 列表定位本 VID 资格准备和提交的正式原回执，按 activity=qualification、kind=qualify-prepare 或 qualify-submit、operation=当前VID、state=terminal、exit_code=0 筛选，读取返回的真实 path。提交必须引用经宿主绑定的准备回执及实际提交和同一执行轮次。历史 Judge 证据只适用于有原始记录的缓存。');
  document.model = document.model.filter(model => model.provider!=='openrouter');
  const verdict = document.steps.find(step=>step.key==='judge_content');
  verdict.implementation.ref = '资格 Activity Skill 的同一 Agent 按冻结政策判断，qualify-submit 提交，经宿主核证后由原事务持久化并读回。';
  document.failure.retryable = [
    '录音或转写证据不完整时保留真实回执与 pending，仅沿原动作恢复可确认的步骤。',
    '提交材料不符合契约时按 Checker 原因补交；提交结果不明时按原动作读回并保留 pending。',
  ];
  document.failure.needs_human.cases = ['本次录音转写、契约材料或提交回执经允许的恢复仍无法确认。'];
  document.failure.needs_human.alert.object = '沿资格 Activity 回执向 Commander 升级真实失败原因。';
  target.failure = structuredClone(document.failure);
  target.acceptance = generateAcceptance({documents:{[workflow]:{activities:[document]}},workflow,activity});
  return result;
}

const dispatch = String.raw` if kind in ('qualify-prepare','qualify-submit'):
  resource_authority(c)
  raw=pathlib.Path(args[1]);audio=raw.resolve(strict=True)
  if not raw.is_absolute() or raw!=audio or raw.is_symlink() or not audio.is_file() or not audio.is_relative_to(P/'native') or audio.suffix.lower()!='.wav':raise ValueError('AUDIO_SOURCE_SCOPE')
  payload={'context':c,'video_id':args[0],'audio':str(audio),'artifact_dir':str(P/'qualification-receipts'/args[0]),'operation':'prepare_activity_agent' if kind=='qualify-prepare' else 'submit_activity_agent'}
  if kind=='qualify-submit':payload.update(submission_action_name=action_name,submission_wire=args[2])
  return subprocess.run([c['node'],str(P/'qualification/main.mjs')],input=json.dumps(payload),capture_output=True,text=True,env=environment(c),timeout=420)`;

const admission = String.raw`    elif kind in ('qualify-prepare','qualify-submit'):
        if c.get('recovery', {}).get('mode') == 'qualification-readonly-v1':
            reject('QUALIFICATION_RECOVERY_READ_ONLY')
        expected_count = 2 if kind == 'qualify-prepare' else 3
        if stage != '102' or activity != 'qualification' or len(args) != expected_count or args[0] not in c['verification'].get('102', {}).get('video_ids', []):
            reject('QUALIFICATION_SCOPE')
        if kind == 'qualify-submit':
            try:
                proposal = json.loads(args[2])
            except ValueError:
                proposal = None
            if not isinstance(proposal, dict):
                reject('QUALIFICATION_SUBMISSION_FORMAT')
    elif kind == 'qualify':
        reject('QUALIFICATION_LEGACY_JUDGE_DISABLED')`;

export function qualificationAgentTools(hostTools) {
  need(Array.isArray(hostTools?.kinds),'TOOLS');
  const kinds = hostTools.kinds;
  if (kinds.includes('qualify')) {
    need(newTools.every(name=>!kinds.includes(name)),'TOOLS');
    return {...hostTools,kinds:[...kinds.filter(name=>name!=='qualify'),...newTools]};
  }
  need(newTools.every(name=>kinds.filter(kind=>kind===name).length===1),'TOOLS');
  return hostTools;
}

export const qualificationAgentSourcePaths = [
  'services/phone-adb-controller/leadgen-foundation/qualification-agent-adapter.mjs',
  'services/phone-adb-controller/leadgen-foundation/qualification-agent-assembly.mjs',
  'services/phone-adb-controller/qualification-agent-candidate.mjs',
  'services/phone-adb-controller/qualification-agent-decision.mjs',
  'services/phone-adb-controller/qualification-agent-overlay.mjs',
];

export function qualificationAgentProfile(original, {methodRevision, methodSources, sources}) {
  const result=structuredClone(original);
  const {profile}=result;
  const skill=profile.skill_runtime.activities.qualification?.skill;
  const methodPaths=Object.keys(profile.files).filter(name=>name.startsWith('services/phone-adb-controller/skills/'));
  const pinned=(container,name)=>/^[a-f0-9]{64}$/.test(container?.[name]??'');
  need(profile.leadgen.workflow==='102' && methodPaths.includes(skill) &&
    /^[a-f0-9]{40}$/.test(methodRevision??'') && methodPaths.every(name=>pinned(methodSources,name)) &&
    qualificationAgentSourcePaths.every(name=>pinned(sources,name)),'PROFILE');
  result.contract=qualificationAgentContract(result.contract);
  profile.leadgen.method_revision=methodRevision;
  profile.leadgen.contract_sha256=hash(canonical(result.contract));
  profile.adapter=qualificationAgentSourcePaths[0];
  for (const name of methodPaths) profile.files[name]=methodSources[name];
  for (const name of qualificationAgentSourcePaths) profile.files[name]=sources[name];
  profile.skill_runtime.host_tools=qualificationAgentTools(profile.skill_runtime.host_tools);
  return result;
}

export function deriveQualificationAgentHost({files, expected, frozenContract, candidateSource, candidateSha256, hostTools}) {
  need(typeof candidateSource==='string' && candidateSource.length>0 && hash(candidateSource)===candidateSha256 &&
    Object.keys(files).length===Object.keys(expected).length &&
    Object.entries(files).every(([name,bytes])=>hash(bytes)===expected[name]),'SOURCE');
  const target = frozenContract?.activities?.find(item=>item.key===activity);
  need(frozenContract?.workflow===workflow &&
    target?.acceptance?.document?.version==='3.6.0','CONTRACT');
  const tools = qualificationAgentTools(hostTools);
  const result = {...files};
  const text = name => result[name].toString('utf8');
  const helper = 'qualification/helper.mjs';
  const runtime = 'qualification/runtime-deps.mjs';
  const overlay = buildQualificationAgentOverlay({helper:text(helper),runtimeDeps:text(runtime),
    expected:{helper:expected[helper],runtimeDeps:expected[runtime]}});
  result[helper]=overlay.helper;
  result[runtime]=overlay.runtimeDeps;
  result['qualification/agent-decision.mjs']=candidateSource;
  const main = 'qualification/main.mjs';
  result[main]=replaceOnce(text(main),`console.log(JSON.stringify(await main(JSON.parse(fs.readFileSync(0,'utf8')))));`,
    `import {publishActivityAgentDossier} from './agent-decision.mjs';const request=JSON.parse(fs.readFileSync(0,'utf8'));const result=await main(request);console.log(JSON.stringify(request.operation==='prepare_activity_agent'&&result.status==='prepared'?publishActivityAgentDossier(request.context,result):result));`);

  result['tools.py']=replaceOnce(text('tools.py'),'def invoke(c,key,kind,args):','def invoke(c,key,kind,args,action_name):');
  result['tools.py']=replaceOnce(text('tools.py'),'r=invoke(c,key,kind,args);','r=invoke(c,key,kind,args,name);');
  result['tools.py']=replaceOnce(text('tools.py')," if kind=='qualify':",dispatch+"\n if kind=='qualify':");
  result['activity-tool-result.py']=replaceOnce(text('activity-tool-result.py'),"'metrics', 'qualify',","'metrics', 'qualify', 'qualify-prepare', 'qualify-submit',");
  const resultTools=text('activity-tool-result.py');
  const start=resultTools.indexOf("    elif kind == 'qualify':");
  const end=resultTools.indexOf("    elif kind == 'metrics':",start);
  need(start>=0&&end>start,'LAYOUT');
  result['activity-tool-result.py']=resultTools.slice(0,start) + admission + '\n' + resultTools.slice(end);
  // TOOLS.txt and TOOLS-base.txt remain the historical originals checked by verify_host.
  let instructions=text('agent-tools.txt');
  instructions=replaceOnce(instructions,'python3 tools.py qualify ACTION_NAME VID 本目录native内真实WAV绝对路径',
    'commander_host_tools.invoke：qualify-prepare 传本 VID 和本轮原 WAV 绝对路径，qualify-submit 用同一 VID/WAV 加本次资格提案 JSON。');
  instructions=replaceOnce(instructions,'只有合法音频传tools qualify。其一次ASR+一次主判，不确定保unknown，不追加模型。',
    '只有合法音频传 qualify-prepare 并读取返回的原 dossier_ref 和 dossier_sha256。由同一 Activity Agent 按 Skill 完成业务语义判断后提交，不确定保 unknown。');
  result['agent-tools.txt']=replaceOnce(instructions,'102新增既有kind为qualify、collection-evidence、collection-readback',
    '102新增可用 kind 为 qualify-prepare、qualify-submit、collection-evidence、collection-readback');
  if (!target.runtime.checker_repair) {
    result['agent-tools.txt'] += '\n资格执行可用当前 Agent 的常规文件与媒体工具读取本轮冻结输入、原始材料和证据；业务动作仍使用注册的 commander_host_tools。\n'
      + 'cleanup：本轮操作过 App 时，保留关闭和归位的原操作回执。在归位后、释放设备前，用 phone 的 snapshot-evidence 生成以本轮 run_tag 加连字符开头的桌面截图，再用 fetch-native 归档到本轮 native 证据根。交工具实际返回的归档原件路径，勿引用固定文件名。\n';
  }
  const manifest = JSON.parse(text('activity-host-tools.json'));
  for(const name of Object.keys(manifest.sha256))manifest.sha256[name]=hash(result[name]);
  result['activity-host-tools.json']=JSON.stringify(manifest,null,2)+'\n';
  return {files:result,sha256:Object.fromEntries(Object.entries(result).map(([n,bytes])=>[n,hash(bytes)])),
    contract:frozenContract,tools};
}

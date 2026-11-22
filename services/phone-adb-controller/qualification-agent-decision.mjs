import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const sha = value => createHash('sha256').update(value).digest('hex');
const actionName = /^[a-zA-Z0-9_-]{1,100}$/;
const actionId = /^[a-f0-9]{64}$/;
const need = (valid, code) => { if (!valid) throw Error('QUALIFICATION_AGENT_' + code); };

function protectedJson(file) {
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.uid !== process.getuid() || stat.nlink !== 1 ||
        (stat.mode & 0o077) || stat.size > 1024 * 1024) throw Error('UNPROTECTED');
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (bytes.length !== stat.size ||
        ['size', 'mtimeMs', 'ctimeMs'].some(key => stat[key] !== after[key])) throw Error('UNPROTECTED');
    return {value: JSON.parse(bytes.toString('utf8')), sha256: sha(bytes)};
  } finally { fs.closeSync(descriptor); }
}

function protectedDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077) ||
      fs.realpathSync(directory) !== directory) throw Error('UNPROTECTED');
}

function dossierFile(context, video) {
  need(/^\d{10,24}$/.test(video??'') && path.isAbsolute(context.checker_evidence_root??''), 'DOSSIER_SCOPE');
  const directory=path.join(context.checker_evidence_root,'qualification-receipts',video);
  protectedDirectory(directory);
  return path.join(directory,'activity-agent-dossier.json');
}

export function publishActivityAgentDossier(context, prepared) {
  const {dossier, ...receipt} = prepared;
  const file = dossierFile(context,dossier.scope.video_id);
  const bytes=Buffer.from(JSON.stringify(dossier)+'\n');
  need(bytes.length<=1024*1024,'DOSSIER_SIZE');
  const sha256=sha(bytes);
  if (!fs.existsSync(file)) {
    const temp=file+'.'+randomUUID();
    try {
      fs.writeFileSync(temp,bytes,{mode:0o600,flag:'wx'});
      try { fs.linkSync(temp,file); }
      catch (error) { if (error.code!=='EEXIST') throw error; }
    } finally { fs.rmSync(temp,{force:true}); }
  }
  need(protectedJson(file).sha256===sha256,'DOSSIER_CHANGED');
  return {...receipt,dossier_ref:{path:file,sha256}};
}

function readHostBinding(context, inputFile, now) {
  try {
    const host = context.checker_evidence_root;
    const task = context.tasks['102'];
    if (!path.isAbsolute(host) || !path.isAbsolute(inputFile ?? '') ||
        !actionName.test(task.run_id)) throw Error('SCOPE');
    const current = protectedJson(inputFile);
    const input = current.value;
    const identity = input.identity;
    const attempt = identity.attempt ?? 1;
    const actionDirectory = path.join(host, 'control', task.run_id, 'actions', identity.action_id);
    const directory = path.join(actionDirectory, 'host-tools');
    if (![identity.action_id, identity.definition_sha256, identity.input_sha256].every(value => actionId.test(value)) ||
        !Number.isSafeInteger(attempt) || attempt < 1 ||
        inputFile !== path.join(actionDirectory, 'activity-input.json') ||
        input.activity_key !== 'qualification' || identity.activity_key !== 'qualification' ||
        input.transport !== 'codex-cli' || identity.task_id !== task.task_id || identity.run_id !== task.run_id ||
        input.context?.execution_attempt !== attempt ||
        input.activity_contract?.runtime?.checker_repair?.effect_scope !== 'host_tools') throw Error('SCOPE');
    protectedDirectory(actionDirectory);
    protectedDirectory(directory);
    const sealed = protectedJson(path.join(actionDirectory, 'host-tools-binding.json'));
    const binding = sealed.value;
    if (!isDeepStrictEqual(binding.identity, identity) || binding.activity_key !== 'qualification' ||
        binding.input_file !== inputFile || binding.input_sha256 !== current.sha256 ||
        !Number.isFinite(binding.deadline_ms) || now() >= binding.deadline_ms ||
        binding.directory !== directory || binding.cwd !== host || binding.entry !== 'invoke.mjs' ||
        !['qualify-prepare', 'qualify-submit'].every(kind => binding.kinds?.includes(kind))) throw Error('SCOPE');
    return {directory, binding_sha256: sealed.sha256,
      authority: {...identity, attempt, activity_input_sha256: current.sha256}};
  } catch {
    throw Error('QUALIFICATION_AGENT_HOST_BINDING');
  }
}

function readToolReceipt(file, source, requestSha, state, error) {
  try {
    const receipt = protectedJson(file).value;
    if (receipt.state !== state || receipt.binding_sha256 !== source.binding_sha256 ||
        receipt.request_sha256 !== requestSha) throw Error('RECEIPT');
    return receipt;
  } catch { throw Error('QUALIFICATION_AGENT_' + error); }
}

export function verifyActivityAgentDecision({context, inputFile, now, submissionActionName, submissionWire, dossier, dossierSha256, audio}) {
  const source = readHostBinding(context, inputFile, now);
  need(actionName.test(submissionActionName ?? '') && typeof submissionWire === 'string' &&
    Buffer.byteLength(submissionWire) <= 65536, 'PROPOSAL_INVALID');
  let proposal;
  try { proposal = JSON.parse(submissionWire); } catch { throw Error('QUALIFICATION_AGENT_PROPOSAL_INVALID'); }
  need(proposal && Object.keys(proposal).sort().join(',') ===
    'dossier_sha256,frame_labels,preparation_action_name,reason,transcript_quote,verdict' &&
    actionName.test(proposal.preparation_action_name) && proposal.preparation_action_name !== submissionActionName,
  'PROPOSAL_INVALID');
  const inputArgs = [dossier.scope.video_id, audio];
  const requestSha = (kind, action_name, args) => sha(JSON.stringify({kind, action_name, args}));
  const submissionRequest = requestSha('qualify-submit', submissionActionName, [...inputArgs, submissionWire]);
  readToolReceipt(path.join(source.directory, submissionActionName + '.json'), source, submissionRequest,
    'unknown', 'SUBMISSION_RECEIPT');

  const preparationName = proposal.preparation_action_name;
  const preparationFile = path.join(source.directory, preparationName + '.json');
  const preparationRequest = requestSha('qualify-prepare', preparationName, inputArgs);
  const preparation = readToolReceipt(preparationFile, source, preparationRequest, 'terminal', 'PREPARATION_RECEIPT');
  let preparedOutput, stdout;
  try {
    stdout = protectedJson(preparationFile + '.stdout');
    const {response} = preparation;
    const output = stdout.value;
    if (response.state !== 'terminal' || response.exit_code !== 0 ||
        response.evidence_ref !== preparationFile || response.stdout_sha256 !== stdout.sha256 ||
        output.state !== 'terminal' || output.result?.exit_code !== 0 ||
        output.binding?.activity !== 'qualification' || output.binding.kind !== 'qualify-prepare' ||
        !isDeepStrictEqual(output.binding.args, inputArgs) ||
        !isDeepStrictEqual(output.binding.identity, context.tasks['102'])) throw Error('RECEIPT');
    preparedOutput = JSON.parse(output.result.stdout);
    if (preparedOutput.status !== 'prepared' || preparedOutput.dossier_sha256 !== dossierSha256) throw Error('RECEIPT');
    let receivedDossier = preparedOutput.dossier;
    if (preparedOutput.dossier_ref) {
      const file = dossierFile(context,dossier.scope.video_id);
      if (preparedOutput.dossier_ref.path !== file) throw Error('RECEIPT');
      const original = protectedJson(file);
      if (original.sha256 !== preparedOutput.dossier_ref.sha256) throw Error('RECEIPT');
      receivedDossier = original.value;
    }
    if (!isDeepStrictEqual(receivedDossier,dossier)) throw Error('RECEIPT');
  } catch { throw Error('QUALIFICATION_AGENT_PREPARATION_RECEIPT'); }

  need(proposal.dossier_sha256 === dossierSha256, 'DOSSIER_CHANGED');
  const {verdict, reason, transcript_quote, frame_labels} = proposal;
  need(['matched', 'rejected'].includes(verdict) && typeof reason === 'string' && reason.trim() &&
    reason.length <= 2000 && typeof transcript_quote === 'string' && transcript_quote.trim() &&
    transcript_quote.length <= 1000 && dossier.transcript.includes(transcript_quote) &&
    Array.isArray(frame_labels) && frame_labels.length > 0 && new Set(frame_labels).size === frame_labels.length &&
    frame_labels.every(label => typeof label === 'string' && dossier.visual.frames.some(frame => frame.label === label)),
  'PROPOSAL_EVIDENCE');
  return {
    decision: {verdict, reason, stage: 'activity_agent'},
    provenance: {
      source: 'activity_agent',
      authority: source.authority,
      dossier_sha256: dossierSha256,
      preparation: {action_name: preparationName, request_sha256: preparationRequest, stdout_sha256: stdout.sha256},
      submission: {action_name: submissionActionName, request_sha256: submissionRequest},
      evidence: {transcript_quote, frame_labels},
    },
  };
}

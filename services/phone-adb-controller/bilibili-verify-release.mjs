import { digest } from './runtime-definition.mjs';

export const BILIBILI_WORKFLOW = 'android_bilibili_verify_existing';
export const BILIBILI_OPERATION = 'verify_existing';
export const BILIBILI_TARGET = 'xian-m4';
export const BILIBILI_PROVIDER_PATH = 'services/phone-adb-controller/standalone-bilibili-verify.mjs';
export const BILIBILI_APPROVED = Object.freeze({
  bvid: 'BV1cLpG6cEHH',
  owner_uid: '3546824935738234',
  source_run_id: 'rpa-white-bili-uid-693d858279ad',
  profile: 'yueshengyun-work',
  serial: 'e6c7ef34',
  title: '傍晚的颜色，慢一点也很好',
  duration_seconds: 10,
  width: 1080,
  height: 2412,
});

const repo = 'perfectuser21/zenithjoy-workspace';
const gitSha = /^[a-f0-9]{40}$/;
const sha256 = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const BILIBILI_COMPONENT_PATHS = Object.freeze([
  BILIBILI_PROVIDER_PATH,
  'services/phone-adb-controller/bilibili-verify-release.mjs',
  'services/phone-adb-controller/bilibili-verify-native.mjs',
  'services/phone-adb-controller/bilibili-verify-worker.mjs',
  'scripts/phone-account-patrol/ocr.swift',
]);

function need(value, reason) {
  if (!value) throw Error('BILIBILI_WORKSPACE_' + reason);
}

function keys(value, names) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
}

function validRow(row, sourceCommit) {
  return row && uuid.test(row.id) && row.source_repo === repo && row.source_commit === sourceCommit
    && row.payload_sha256 === digest({
      source: { repo, path: row.source_path, commit: sourceCommit }, payload: row.payload,
    });
}

export function assertBilibiliFrozenWorkflow(workflow, activities, sourceCommit) {
  need(gitSha.test(sourceCommit) && validRow(workflow, sourceCommit) && uuid.test(workflow.workflow_id), 'WORKFLOW');
  const frozen = workflow.payload;
  const contract = frozen?.contract;
  need(frozen?.key === BILIBILI_WORKFLOW && contract?.source?.repo === repo
    && typeof contract.version === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(contract.version)
    && keys(contract.runtime, ['entrypoint', 'skill_id']) && uuid.test(contract.runtime.skill_id)
    && contract.runtime.entrypoint === BILIBILI_OPERATION
    && Array.isArray(frozen.activities) && frozen.activities.length === 1, 'WORKFLOW');
  const [ref] = frozen.activities;
  need(ref.slot_key === BILIBILI_OPERATION && uuid.test(ref.activity_id)
    && uuid.test(ref.activity_version_id) && uuid.test(ref.reference_id), 'ACTIVITY');
  const rows = activities.filter(row => row.id === ref.activity_version_id && row.activity_id === ref.activity_id);
  need(rows.length === 1, 'ACTIVITY');
  const [activity] = rows;
  need(validRow(activity, sourceCommit) && activity.payload?.activity_id === ref.activity_id
    && activity.payload.contract?.key === BILIBILI_OPERATION
    && Array.isArray(activity.payload.steps) && activity.payload.steps.length === 0, 'ACTIVITY');
  const bindings = activity.payload.implementation_bindings;
  need(Array.isArray(bindings) && bindings.length === BILIBILI_COMPONENT_PATHS.length
    && new Set(bindings.map(row => row.path)).size === bindings.length, 'COMPONENT');
  for (const row of bindings) {
    need(row.scope === 'activity' && row.status === 'verified' && row.kind === 'code'
      && row.repo === repo && row.revision === sourceCommit && BILIBILI_COMPONENT_PATHS.includes(row.path)
      && /^sha256:[a-f0-9]{64}$/.test(row.digest), 'COMPONENT');
  }
  need(bindings.some(row => row.path === BILIBILI_PROVIDER_PATH), 'COMPONENT');
  return { activity, ref, bindings };
}

export function assertBilibiliWorkspaceJob(job) {
  const scope = job?.input?.scope;
  const skill = job?.input?.skill;
  const definition = job?.definition;
  need(job?.machine_id === BILIBILI_TARGET && job.workflow_key === BILIBILI_WORKFLOW && uuid.test(job.task_id) && uuid.test(job.run_id)
    && definition && ['release_id', 'observation_id', 'workflow_id', 'workflow_definition_version_id'].every(key => uuid.test(definition[key]))
    && sha256.test(definition.snapshot_sha256) && sha256.test(definition.runtime_snapshot_sha256)
    && job.release_id === definition.release_id, 'JOB');
  need(keys(job.input, ['scope', 'skill'])
    && keys(scope, [...Object.keys(BILIBILI_APPROVED), 'workflow_key', 'operation', 'source_commit', 'limit', 'environment'])
    && Object.entries(BILIBILI_APPROVED).every(([key, value]) => scope[key] === value)
    && scope.workflow_key === BILIBILI_WORKFLOW && scope.operation === BILIBILI_OPERATION
    && gitSha.test(scope.source_commit) && scope.limit === 1
    && ['production', `staging:${scope.source_commit}`].includes(scope.environment), 'SCOPE');
  need(keys(skill, ['name', 'version', 'source_commit', 'path', 'sha256'])
    && skill.name === 'android-bilibili-verify-existing' && skill.path === BILIBILI_PROVIDER_PATH
    && skill.source_commit === scope.source_commit && sha256.test(skill.sha256)
    && typeof skill.version === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(skill.version), 'SKILL');
  need(Array.isArray(definition.expected_path) && definition.expected_path.length === 1, 'PATH');
  const [expected] = definition.expected_path;
  need(keys(expected, ['reference_id', 'activity_id', 'activity_definition_version_id', 'required'])
    && expected.required === true
    && ['reference_id', 'activity_id', 'activity_definition_version_id'].every(key => uuid.test(expected[key])), 'PATH');
  const fixed = {
    runId: job.run_id, owner: job.run_id, sourceRunId: scope.source_run_id, ownerUid: scope.owner_uid,
    bvid: scope.bvid, title: scope.title, profile: scope.profile, serial: scope.serial,
    durationSeconds: scope.duration_seconds, width: scope.width, height: scope.height,
  };
  return { scope: Object.freeze(fixed), skill: Object.freeze({ ...skill }), expected };
}

export function assertBilibiliRelease(release, job, readComponent) {
  const { expected, skill } = assertBilibiliWorkspaceJob(job);
  const { definition } = job;
  need(release?.id === definition.release_id && release.environment === job.input.scope.environment
    && release.target === BILIBILI_TARGET && release.payload?.verification?.status === 'verified'
    && release.manifest_sha256 === digest({ environment: release.environment, target: release.target, payload: release.payload }), 'RELEASE');
  const matches = release.payload.workflows.filter(row => row.payload?.key === BILIBILI_WORKFLOW);
  need(matches.length === 1, 'WORKFLOW');
  const [workflow] = matches;
  const fixed = assertBilibiliFrozenWorkflow(workflow, release.payload.activities, skill.source_commit);
  need(workflow.workflow_id === definition.workflow_id && workflow.id === definition.workflow_definition_version_id
    && workflow.payload_sha256 === definition.snapshot_sha256
    && definition.runtime_snapshot_sha256 === digest({ release_id: release.id, workflow_version_id: workflow.id })
    && workflow.payload.contract.version === skill.version
    && fixed.ref.reference_id === expected.reference_id && fixed.ref.activity_id === expected.activity_id
    && fixed.activity.id === expected.activity_definition_version_id, 'PATH');
  for (const binding of fixed.bindings) {
    const rows = release.payload.components.filter(row => row.path === binding.path);
    need(rows.length === 1, 'COMPONENT');
    const [component] = rows;
    need(['kind', 'repo', 'revision', 'path', 'digest'].every(key => component[key] === binding[key]), 'COMPONENT');
    const bytes = readComponent(component.path);
    need(Buffer.isBuffer(bytes) && 'sha256:' + digest(bytes) === component.digest, 'COMPONENT_BYTES');
  }
  need(fixed.bindings.find(row => row.path === BILIBILI_PROVIDER_PATH).digest === 'sha256:' + skill.sha256, 'SKILL_BYTES');
  return { workflow, ...fixed };
}

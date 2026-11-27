import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { digest } from '../runtime-definition.mjs';
import { bindingComponents, verifyTargetRelease } from '../deployment-targets.mjs';
import { WORKFLOWS } from '../deployment-preflight.mjs';
import {
  assertBilibiliRelease,
  assertBilibiliWorkspaceJob,
  resolveBilibiliHostPolicy,
  BILIBILI_APPROVED,
  BILIBILI_COMPONENT_PATHS,
  BILIBILI_PROVIDER_PATH,
  BILIBILI_WORKFLOW,
} from '../bilibili-verify-release.mjs';

const registeredPolicy = () => JSON.parse(readFileSync(new URL('../config/collection-phone-hosts.json', import.meta.url)));
const approvedPolicy = registry => registry.hosts.find(row => row.target === 'xian-m4'
  && row.profile === BILIBILI_APPROVED.profile && row.serial === BILIBILI_APPROVED.serial);
const localPolicy = ({ schema_version, host_id, transport, endpoint, adb_bin }) => ({
  schema_version, host_id, transport, endpoint, adb_bin,
});

test('the installed schema 1 host without a local ADB digest uses the exact registered binary pin', () => {
  const registered = registeredPolicy();
  const { policy } = approvedPolicy(registered);
  const local = localPolicy(policy);
  assert.deepEqual(resolveBilibiliHostPolicy(local, registered, BILIBILI_APPROVED), {
    ...local, port: 5037, adb_realpath: policy.adb_realpath, adb_sha256: policy.adb_sha256,
  });
  assert.equal(local.adb_sha256, undefined);
});

test('no policy from a sibling handset, an alternate binary or a conflicting local pin is accepted', () => {
  const registered = registeredPolicy();
  const row = approvedPolicy(registered);
  const local = localPolicy(row.policy);
  for (const invalid of [{ ...local, adb_bin: '/usr/local/bin/adb' }, { ...local, adb_sha256: '0'.repeat(64) }]) {
    assert.throws(() => resolveBilibiliHostPolicy(invalid, registered, BILIBILI_APPROVED), /BILIBILI_WORKSPACE_HOST_POLICY/);
  }
  row.serial = 'different-serial';
  assert.throws(() => resolveBilibiliHostPolicy(local, registered, BILIBILI_APPROVED), /BILIBILI_WORKSPACE_HOST_POLICY/);
});

function fixture() {
  const sourceCommit = 'c'.repeat(40);
  const repo = 'perfectuser21/zenithjoy-workspace';
  const code = Buffer.from('checked candidate code');
  const component = {
    kind: 'code', repo, path: BILIBILI_PROVIDER_PATH,
    revision: sourceCommit, digest: 'sha256:' + digest(code),
  };
  const components = BILIBILI_COMPONENT_PATHS.map(path => ({ ...component, path }));
  const slot_key = 'verify_existing';
  const ref = { slot_key, activity_id: randomUUID(), activity_version_id: randomUUID(), reference_id: randomUUID() };
  const step_id = randomUUID();
  const readback = { type: 'metric', key: 'private_playback_verified', expect: { op: '==', value: 1 } };
  const playbackStep = {
    step_id,
    locator: { activity_id: ref.activity_id, step_key: 'verify_private_playback' },
    contract: { key: 'verify_private_playback', dod: { mode: 'hard', readback } },
    registration: { id: step_id, source_sha256: 'a'.repeat(64), mode: 'hard', readback: structuredClone(readback) },
  };
  const activity = {
    id: ref.activity_version_id, activity_id: ref.activity_id, source_commit: sourceCommit,
    source_repo: repo, source_path: 'fixtures/activity.json',
    payload: {
      activity_id: ref.activity_id, steps: [playbackStep], contract: { key: slot_key },
      implementation_bindings: components.map(value => ({ ...value, scope: 'activity', status: 'verified' })),
    },
  };
  const workflow = {
    id: randomUUID(), workflow_id: randomUUID(), source_commit: sourceCommit,
    source_repo: repo, source_path: 'fixtures/workflow.json',
    payload: {
      key: BILIBILI_WORKFLOW, activities: [ref],
      contract: { source: { repo }, runtime: { skill_id: randomUUID(), entrypoint: slot_key }, version: '1.0.0' },
    },
  };
  const release = {
    id: randomUUID(), environment: 'production', target: 'xian-m4',
    payload: { workflows: [workflow], activities: [activity], components, verification: { status: 'verified' } },
  };
  function rehash() {
    for (const row of [workflow, activity]) {
      row.payload_sha256 = digest({ source: { repo: row.source_repo, path: row.source_path, commit: row.source_commit }, payload: row.payload });
    }
    release.manifest_sha256 = digest({ environment: release.environment, target: release.target, payload: release.payload });
  }
  rehash();
  const expectedActivity = { reference_id: ref.reference_id, activity_id: ref.activity_id, activity_definition_version_id: ref.activity_version_id, required: true };
  const definition = {
    release_id: release.id, observation_id: randomUUID(), workflow_id: workflow.workflow_id,
    workflow_definition_version_id: workflow.id, snapshot_sha256: workflow.payload_sha256,
    runtime_snapshot_sha256: digest({release_id: release.id, workflow_version_id: workflow.id}),
    expected_path: [expectedActivity, { ...expectedActivity, step_id: playbackStep.step_id }],
  };
  const job = {
    task_id: randomUUID(), run_id: randomUUID(), machine_id: 'xian-m4', release_id: release.id,
    workflow_key: BILIBILI_WORKFLOW,
    definition, input: {
      scope: { ...BILIBILI_APPROVED, workflow_key: BILIBILI_WORKFLOW, operation: slot_key, source_commit: sourceCommit, limit: 1, environment: 'production', step_id },
      skill: { name: 'android-bilibili-verify-existing', source_commit: sourceCommit, path: BILIBILI_PROVIDER_PATH, sha256: digest(code), version: '1.0.0' },
    },
  };
  return { job, release, workflow, activity, code, rehash, readComponent: path => BILIBILI_COMPONENT_PATHS.includes(path) ? code : null };
}

test('accepts one exact private work, its verified xian-m4 release and the pinned host bytes', () => {
  const f = fixture();
  assert.equal(assertBilibiliWorkspaceJob(f.job).scope.ownerUid, BILIBILI_APPROVED.owner_uid);
  assert.equal(assertBilibiliRelease(f.release, f.job, f.readComponent).workflow.id, f.workflow.id);
});

test('a staging job can execute only against its exactly derived staging environment', () => {
  const f = fixture();
  f.release.environment = 'staging:' + f.job.input.scope.source_commit;
  f.job.input.scope.environment = f.release.environment;
  f.rehash();
  assert.equal(assertBilibiliRelease(f.release, f.job, f.readComponent).workflow.id, f.workflow.id);
  f.release.environment = 'production';
  f.rehash();
  assert.throws(() => assertBilibiliRelease(f.release, f.job, f.readComponent), /BILIBILI_WORKSPACE_RELEASE/);
});

for (const [name, change] of [
  ['another staging commit', f => { f.job.input.scope.environment = 'staging:' + 'b'.repeat(40); }],
  ['cloud', f => { f.job.machine_id = 'mmv'; }],
  ['other handset', f => { f.job.input.scope.serial = 'another-phone'; }],
  ['other author', f => { f.job.input.scope.owner_uid = '3546824935738235'; }],
  ['other work', f => { f.job.input.scope.bvid = 'BV1ip1pzRETy'; }],
  ['an arbitrary tool', f => { f.job.input.scope.operation = 'shell'; }],
  ['an extra knob', f => { f.job.input.scope.argv = ['shell', 'input', 'tap']; }],
  ['the wrong code path', f => { f.job.input.skill.path = 'arbitrary.mjs'; }],
  ['a second expected activity', f => { f.job.definition.expected_path.push({ ...f.job.definition.expected_path[0] }); }],
  ['a playback Step under another activity', f => { f.job.definition.expected_path[1].activity_id = randomUUID(); }],
  ['only an Activity without its playback Step', f => { f.job.definition.expected_path.pop(); }],
  ['a Step scope that disagrees with the admitted path', f => { f.job.input.scope.step_id = randomUUID(); }],
]) {
  test(`rejects ${name} before touching a host`, () => {
    const f = fixture();
    change(f);
    assert.throws(() => assertBilibiliWorkspaceJob(f.job), /BILIBILI_WORKSPACE_/);
  });
}

for (const [name, change] of [
  ['different release target with a valid digest', f => { f.release.target = 'mmv'; f.rehash(); }],
  ['a publish stage with a valid digest', f => { f.workflow.payload.activities[0].slot_key = 'publish'; f.rehash(); }],
  ['runtime permits publish with a valid digest', f => { f.workflow.payload.contract.runtime.entrypoint = 'publish'; f.rehash(); }],
  ['a frozen publish Step with a valid digest', f => { f.activity.payload.steps[0].contract.key = 'publish'; f.rehash(); }],
  ['a second frozen Step with a valid digest', f => { f.activity.payload.steps.push(f.activity.payload.steps[0]); f.rehash(); }],
  ['a frozen Step with an invalid registration digest', f => { f.activity.payload.steps[0].registration.source_sha256 = 'invalid'; f.rehash(); }],
  ['a frozen Step that would accept unverified playback', f => { f.activity.payload.steps[0].contract.dod.readback.expect.value = 0; f.rehash(); }],
  ['a valid-looking but different Step in the task path', f => {
    f.job.input.scope.step_id = f.job.definition.expected_path[1].step_id = randomUUID();
  }],
  ['activity with an additional implementation', f => {
    f.activity.payload.implementation_bindings.push({ ...f.activity.payload.implementation_bindings[0], path: 'arbitrary.mjs' });
    f.rehash();
  }],
  ['code bytes with the wrong proof', f => { f.readComponent = () => Buffer.from('wrong'); }],
]) {
  test(`rejects ${name}`, () => {
    const f = fixture();
    change(f);
    assert.throws(() => assertBilibiliRelease(f.release, f.job, f.readComponent), /BILIBILI_WORKSPACE_/);
  });
}

test('the existing deploy gate admits this one addition only into the xian-m4 release', () => {
  const f = fixture();
  const sha = f.job.input.scope.source_commit;
  const repo = f.workflow.source_repo;
  function legacy(workflowKey, workflowId = randomUUID()) {
    const activity = {
      ...f.activity, activity_id: randomUUID(), id: randomUUID(),
      payload: { ...f.activity.payload, implementation_bindings: [{ scope: 'activity', status: 'verified',
        kind: 'code', repo, revision: sha, path: 'services/phone-adb-controller/old.mjs', digest: 'sha256:' + '0'.repeat(64) }] },
    };
    activity.payload.activity_id = activity.activity_id;
    const workflow = {
      ...f.workflow, id: randomUUID(), workflow_id: workflowId,
      payload: { key: workflowKey, activities: [{ activity_id: activity.activity_id, activity_version_id: activity.id }] },
    };
    for (const row of [workflow, activity]) {
      row.payload_sha256 = digest({ source: { repo, path: row.source_path, commit: sha }, payload: row.payload });
    }
    f.release.payload.workflows.push(workflow);
    f.release.payload.activities.push(activity);
  }
  for (const [index, id] of WORKFLOWS.entries()) legacy('legacy' + index, id);
  f.release.payload.components = bindingComponents(f.release.payload, sha);
  f.rehash();
  assert.equal(verifyTargetRelease(f.release, 'xian-m4', sha), f.release);
  f.release.target = 'mmv';
  for (const key of ['workflow_report.internal', 'workflow_commander.internal', 'douyin_video_publish.android']) legacy(key);
  f.release.payload.components = bindingComponents(f.release.payload, sha);
  f.rehash();
  assert.throws(() => verifyTargetRelease(f.release, 'mmv', sha), /只读B站不属于该目标闭包/);
});

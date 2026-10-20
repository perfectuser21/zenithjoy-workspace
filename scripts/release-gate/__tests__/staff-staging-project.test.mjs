import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';

// Execute the real SSH script. Docker's boundary models the existing HK
// container owned by project=deploy; a different project cannot adopt its name.
async function deploy(existingProject, {startingChecks=0} = {}) {
  const bin = await mkdtemp(join(tmpdir(), 'staff-staging-project-'));
  const commands = join(bin, 'commands');
  const candidate = 'a'.repeat(40);
  const workflow = JSON.parse(execFileSync('python3', ['-c',
    'import json,sys,yaml; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))',
    resolve('.github/workflows/deploy-staff-hub-staging.yml')], {encoding:'utf8'}));
  const step = workflow.jobs['deploy-staff-hub-staging'].steps.find(s => s.with?.script);
  let script = step.with.script;
  // ssh-action v1.0.3 uses drone-ssh 1.7.3. Model its actual scriptCommands
  // transformation, including status checks inside loops (plugin.go:224-247):
  // https://github.com/appleboy/drone-ssh/blob/v1.7.3/plugin.go#L224-L247
  if (step.with.script_stop) script = script.split('\n').map(s=>s.trim()).filter(Boolean)
    .flatMap(s=>s.endsWith('\\') ? [s] : [s,
      'DRONE_SSH_PREV_COMMAND_EXIT_CODE=$? ; if [ $DRONE_SSH_PREV_COMMAND_EXIT_CODE -ne 0 ]; then exit $DRONE_SSH_PREV_COMMAND_EXIT_CODE; fi;']).join('\n');
  await writeFile(join(bin,'health-count'),'0');
  await writeFile(join(bin, 'docker'), `#!/bin/bash
printf '%s\\n' "$*" >> "$COMMANDS"
if [[ "$1" == inspect ]]; then
  if [[ "$*" == *com.docker.compose.project* ]]; then
    [[ "$EXISTING_PROJECT" != missing ]] || exit 1
    printf '%s\\n' "$EXISTING_PROJECT"
  else
    count=$(cat "$HEALTH_COUNT")
    count=$((count + 1))
    printf '%s' "$count" > "$HEALTH_COUNT"
    if (( count <= STARTING_CHECKS )); then printf 'starting\\n'; else printf 'healthy\\n'; fi
  fi
elif [[ "$1" == compose ]]; then
  [[ "$2" == -p ]] || exit 90
  if [[ "$EXISTING_PROJECT" != missing && "$3" != "$EXISTING_PROJECT" ]]; then
    echo 'Conflict: container name staff-hub-staging already in use' >&2
    exit 1
  fi
elif [[ "$1" == rm ]]; then
  echo 'Existing container must not be deleted' >&2
  exit 91
fi
`, {mode:0o755});
  await writeFile(join(bin,'sleep'),'#!/bin/sh\nexit 0\n',{mode:0o755});
  await writeFile(join(bin, 'curl'), `#!/bin/bash
if [[ "$*" == *release-sha.json* ]]; then
  printf '{"sha":"%s"}\\n' "$DEPLOY_SHA"
else
  printf 200
fi
`, {mode:0o755});
  try {
    const result = spawnSync('bash', ['-c', script], {encoding:'utf8',
      env:{...process.env, PATH:`${bin}:${process.env.PATH}`, DEPLOY_SHA:candidate,
        EXISTING_PROJECT:existingProject, COMMANDS:commands, STARTING_CHECKS:String(startingChecks),
        HEALTH_COUNT:join(bin,'health-count')}});
    return {...result, commands:await readFile(commands, 'utf8'),
      healthChecks:Number(await readFile(join(bin,'health-count'),'utf8'))};
  } finally {await rm(bin, {recursive:true, force:true});}
}

test('Staff staging reuses the actual HK compose project without deleting the existing container', async () => {
  const result = await deploy('deploy');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.commands, /compose -p deploy -f .* up -d staff-hub-staging/);
  assert.doesNotMatch(result.commands, /^rm /m);
});

test('Staff staging uses its dedicated project when the container does not exist', async () => {
  const result = await deploy('missing');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.commands, /compose -p zenithjoy-staff-hub-staging -f .* up -d staff-hub-staging/);
});

test('Staff staging rejects an invalid existing project before changing containers', async () => {
  const result = await deploy('invalid project');
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.commands, /^(compose|restart|rm) /m);
});

test('Staff staging 在真实script_stop逐行检查下等待starting变healthy，不首轮误报失败', async () => {
  const result = await deploy('deploy',{startingChecks:2});
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.healthChecks,3);
  assert.match(result.stdout,/首页200 且 SHA=/);
});

test('Staff staging 一直未healthy时耗尽20次重试后失败', async () => {
  const result = await deploy('deploy',{startingChecks:100});
  assert.notEqual(result.status,0);
  assert.equal(result.healthChecks,20);
  assert.match(result.stdout,/容器未 healthy: starting/);
});

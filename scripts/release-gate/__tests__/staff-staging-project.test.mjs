import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';

// Execute the real SSH script. Docker's boundary models the existing HK
// container owned by project=deploy; a different project cannot adopt its name.
async function deploy(existingProject) {
  const bin = await mkdtemp(join(tmpdir(), 'staff-staging-project-'));
  const commands = join(bin, 'commands');
  const candidate = 'a'.repeat(40);
  const workflow = JSON.parse(execFileSync('python3', ['-c',
    'import json,sys,yaml; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))',
    resolve('.github/workflows/deploy-staff-hub-staging.yml')], {encoding:'utf8'}));
  const script = workflow.jobs['deploy-staff-hub-staging'].steps.find(s => s.with?.script).with.script;
  await writeFile(join(bin, 'docker'), `#!/bin/bash
printf '%s\\n' "$*" >> "$COMMANDS"
if [[ "$1" == inspect ]]; then
  if [[ "$*" == *com.docker.compose.project* ]]; then
    [[ "$EXISTING_PROJECT" != missing ]] || exit 1
    printf '%s\\n' "$EXISTING_PROJECT"
  else
    printf 'healthy\\n'
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
        EXISTING_PROJECT:existingProject, COMMANDS:commands}});
    return {...result, commands:await readFile(commands, 'utf8')};
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

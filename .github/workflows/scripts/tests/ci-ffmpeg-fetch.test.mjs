import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../../../..');
const helper = join(root, '.github/workflows/scripts/install-ci-ffmpeg.sh');
const workflow = join(root, '.github/workflows/ci-smoke-glob-runner.yml');
const real = (name) => execFileSync('/bin/bash', ['-c', 'command -v "$1"', '_', name], { encoding: 'utf8' }).trim();
const tools = { ffmpeg: real('ffmpeg'), ffprobe: real('ffprobe'), timeout: real('timeout') };

function scenario(mode) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-ffmpeg-test-'));
  const bin = join(dir, 'bin'); mkdirSync(bin);
  const script = (name, content) => writeFileSync(join(bin, name), '#!/bin/bash\nset -eu\n' + content + '\n', { mode: 0o755 });
  script('sudo', 'exec "$@"');
  // The real timeout utility fires on a sleeping acquisition child; no apt/dpkg process is touched.
  script('timeout', 'while [[ "$1" == --* ]]; do shift; done; shift; exec "$REAL_TIMEOUT" --kill-after=0.1s 0.15s "$@"');
  script('apt-get', `
printf '%s\\n' "$*" >> "$FIXTURE/apt.log"
fallback=0
for arg in "$@"; do
  if [[ "$arg" == Dir::Etc::sourcelist=* ]]; then
    fallback=1; cat "\${arg#*=}" > "$FIXTURE/official.sources"
  fi
done
if [[ "$*" == *--download-only* ]]; then
  if [[ "$MODE" == both-fail ]]; then exit 100; fi
  if [[ "$fallback" == 0 && "$MODE" == download-fail ]]; then exit 100; fi
  if [[ "$fallback" == 0 && "$MODE" == slow ]]; then sleep 2; fi
fi
if [[ "$*" == *install* && "$*" != *--download-only* ]]; then
  touch "$FIXTURE/installed"
  ln -sf "$REAL_FFMPEG" "$FIXTURE/bin/ffmpeg"
  if [[ "$MODE" != missing-probe ]]; then ln -sf "$REAL_FFPROBE" "$FIXTURE/bin/ffprobe"; fi
fi
`);
  script('lsb_release', 'printf "noble\\n"');
  script('uname', 'printf "Linux\\n"');
  if (mode === 'present' || mode === 'broken') {
    script('ffmpeg', mode === 'broken' ? 'exit 9' : 'exec "$REAL_FFMPEG" "$@"');
    script('ffprobe', 'exec "$REAL_FFPROBE" "$@"');
  }
  const text = readFileSync(workflow, 'utf8');
  const block = text.split('      - name: Install ffmpeg')[1].split('\n      - name:')[0].split('        run: |\n')[1];
  const command = existsSync(helper) ? ['/bin/bash', [helper]]
    : ['/bin/bash', ['-e', '-o', 'pipefail', '-c', block.split('\n').map((line) => line.slice(10)).join('\n')]];
  const env = { ...process.env, PATH: `${bin}:/usr/bin:/bin`, FIXTURE: dir, MODE: mode,
    REAL_TIMEOUT: tools.timeout, REAL_FFMPEG: tools.ffmpeg, REAL_FFPROBE: tools.ffprobe };
  const result = spawnSync(command[0], command[1], { cwd: root, env, encoding: 'utf8', timeout: 5000 });
  const log = existsSync(join(dir, 'apt.log')) ? readFileSync(join(dir, 'apt.log'), 'utf8') : '';
  const sources = existsSync(join(dir, 'official.sources')) ? readFileSync(join(dir, 'official.sources'), 'utf8') : '';
  const installed = existsSync(join(dir, 'installed'));
  rmSync(dir, { recursive: true, force: true });
  return { result, log, sources, installed };
}

for (const mode of ['download-fail', 'slow']) {
  test(`${mode}: bounded acquisition falls back once to signed official Ubuntu sources`, () => {
    const { result, log, sources } = scenario(mode);
    assert.equal(result.status, 0, result.stderr);
    assert.match(sources, /https:\/\/archive\.ubuntu\.com\/ubuntu/);
    assert.match(sources, /https:\/\/security\.ubuntu\.com\/ubuntu/);
    assert.match(sources, /signed-by=\/usr\/share\/keyrings\/ubuntu-archive-keyring\.gpg/);
    assert.match(log, /--download-only/);
    assert.match(log, /--no-download/);
    assert.match(log, /--no-install-recommends/);
    assert.equal(log.split('\n').filter((line) => line.includes('sourcelist=') && line.includes(' update')).length, 1);
    assert.doesNotMatch(log, /allow-unauthenticated|AllowInsecure|Verify-Peer=false|trusted=yes/);
  });
}
test('both acquisition sources fail: stop before installation', () => {
  const { result, installed } = scenario('both-fail');
  assert.notEqual(result.status, 0); assert.equal(installed, false);
});
test('ffmpeg without ffprobe fails closed', () => {
  const { result } = scenario('missing-probe'); assert.notEqual(result.status, 0);
});
test('both existing tools really execute without downloading', () => {
  const { result, log } = scenario('present'); assert.equal(result.status, 0, result.stderr); assert.equal(log, '');
});
test('an existing nonfunctional executable fails verification', () => {
  const { result } = scenario('broken'); assert.notEqual(result.status, 0);
});
test('successful acquisition installs without another network download', () => {
  const { result, log, sources } = scenario('normal');
  assert.equal(result.status, 0, result.stderr); assert.equal(sources, '');
  assert.match(log, /--download-only/); assert.match(log, /--no-download/);
});
test('workflow keeps the full smoke gate and 25-minute limit', () => {
  const text = readFileSync(workflow, 'utf8');
  assert.match(text, /timeout-minutes: 25/);
  assert.match(text, /bash \.github\/workflows\/scripts\/install-ci-ffmpeg\.sh/);
  assert.match(text, /Discover \+ run all CI-capable smoke scripts/);
});

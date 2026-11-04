#!/usr/bin/env node
import { readFileSync, openSync, closeSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

// Event SHAs, rather than moving branch refs or GitHub's capped diff API, define
// the review source. No PR title/body is evaluated by a shell.
function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function requireSHA(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value) || /^0+$/.test(value)) throw new Error('Invalid PR source SHA');
  git('cat-file', '-e', `${value}^{commit}`);
  return value;
}

let temporary;
try {
  if (!process.env.RUNNER_TEMP) throw new Error('RUNNER_TEMP is required');
  const output = join(process.env.RUNNER_TEMP, 'pr-review.diff');
  rmSync(output, { force: true }); // An admission failure must never reuse old input.
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') throw new Error('PR diff requires a pull_request event');
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const pr = event.pull_request;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository ?? '') || pr?.base?.repo?.full_name !== repository) throw new Error('PR base repository does not match this checkout');
  const origin = git('remote', 'get-url', 'origin');
  const expected = `${process.env.GITHUB_SERVER_URL}/${repository}`;
  if (!process.env.GITHUB_SERVER_URL?.startsWith('https://') || ![expected, `${expected}.git`].includes(origin)) throw new Error('Checkout origin does not match the event repository');
  if (process.env.PR_BASE_SHA !== pr?.base?.sha || process.env.PR_HEAD_SHA !== pr?.head?.sha) throw new Error('PR source SHAs differ from the triggering event');
  const base = requireSHA(process.env.PR_BASE_SHA);
  const head = requireSHA(process.env.PR_HEAD_SHA);
  if (git('rev-parse', 'HEAD') !== head) throw new Error('Checkout HEAD does not match the triggering PR head');
  const mergeBase = git('merge-base', base, head); // Missing/unrelated history fails closed.
  temporary = `${output}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  let result;
  try {
    result = spawnSync('git', ['diff', '--binary', '--full-index', '--no-ext-diff', '--no-textconv', '--no-color', '--no-relative', '--src-prefix=a/', '--dst-prefix=b/', '--find-renames', `${base}...${head}`, '--'], { stdio: ['ignore', fd, 'pipe'] });
  } finally { closeSync(fd); }
  if (result.error || result.status !== 0) throw new Error('Git could not produce the complete PR diff');
  renameSync(temporary, output);
  temporary = undefined;
  console.log(`PR diff source: ${repository} base=${base} head=${head} merge-base=${mergeBase}; complete local diff written`);
} catch (error) {
  if (temporary) rmSync(temporary, { force: true });
  console.error(`PR diff input failed: ${error.message}`);
  process.exitCode = 1;
}

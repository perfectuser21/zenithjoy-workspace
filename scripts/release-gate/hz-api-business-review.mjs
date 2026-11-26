import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { REPO } from './acceptance-record.mjs';

const environment = 'hangzhou-api-business-review';
const positiveId = /^[1-9][0-9]{0,15}$/;

export function validateApiBusinessReview(reviews, { sha, stageRun, stageAttempt, ownerId, attempt }) {
  if (attempt !== '1') throw new Error('Start a new production request instead of reusing an earlier review');
  if (!/^[a-f0-9]{40}$/.test(sha) || ![stageRun, stageAttempt, ownerId].every(value => positiveId.test(value))) {
    throw new Error('Invalid API business review coordinates');
  }
  const matches = reviews.filter(review => review.environments?.some(item => item.name === environment));
  const [review] = matches;
  if (matches.length !== 1 || review.state !== 'approved' || String(review.user?.id) !== ownerId) {
    throw new Error('Candidate-specific API business approval from the repository owner is required');
  }
  const [header, scope, readback, retry] = String(review.comment ?? '').trim().split(/\r?\n/);
  if (header !== `API ${sha} ${stageRun}/${stageAttempt}`
      || !/^Scope:\s*\S/.test(scope ?? '') || !/^Readback:\s*\S/.test(readback ?? '') || !/^Retry:\s*\S/.test(retry ?? '')) {
    throw new Error('Review must bind the SHA and staging attempt to the affected scope, readback and recovery evidence');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const env = process.env;
    if (!positiveId.test(env.GITHUB_RUN_ID ?? '')) throw new Error('Invalid production workflow run');
    const reviews = JSON.parse(execFileSync('gh', [
      'api', `repos/${REPO}/actions/runs/${env.GITHUB_RUN_ID}/approvals`,
    ], { encoding:'utf8', stdio:['ignore','pipe','pipe'], timeout:20_000 }));
    validateApiBusinessReview(reviews, {
      sha:env.STAGED_SHA, stageRun:env.STAGED_RUN, stageAttempt:env.STAGED_ATTEMPT,
      ownerId:env.REPOSITORY_OWNER_ID, attempt:env.GITHUB_RUN_ATTEMPT,
    });
    console.log('Candidate-specific API business review verified');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

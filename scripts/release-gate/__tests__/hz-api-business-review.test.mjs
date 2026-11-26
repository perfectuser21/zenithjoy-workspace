import assert from 'node:assert/strict';
import test from 'node:test';
import { validateApiBusinessReview } from '../hz-api-business-review.mjs';

const sha = 'a'.repeat(40);
const options = { sha, stageRun: '100', stageAttempt: '2', ownerId: '7', attempt: '1' };
const approved = {
  state: 'approved', user: { id: 7 },
  environments: [{ name: 'hangzhou-api-business-review' }],
  comment: `API ${sha} 100/2\nScope: affected operation\nReadback: observed result\nRetry: safe cancellation evidence`,
};

test('uses a repository owner approval tied to the affected business and the admitted image', () => {
  assert.doesNotThrow(() => validateApiBusinessReview([approved], options));
});

test('rejects missing or mismatched reviews and incomplete business evidence', () => {
  for (const reviews of [
    [], [approved, approved],
    [{ ...approved, state: 'rejected' }],
    [{ ...approved, user: { id: 8 } }],
    [{ ...approved, environments: [{ name: 'another-environment' }] }],
    [{ ...approved, comment: approved.comment.replace('100/2', '100/1') }],
    [{ ...approved, comment: approved.comment.replace(sha, 'b'.repeat(40)) }],
    [{ ...approved, comment: approved.comment.split('\n').slice(0, 3).join('\n') }],
  ]) assert.throws(() => validateApiBusinessReview(reviews, options));
});

test('requires a new production request on any rerun so prior review is never reused', () => {
  assert.throws(() => validateApiBusinessReview([approved], { ...options, attempt: '2' }), /new production request/);
});

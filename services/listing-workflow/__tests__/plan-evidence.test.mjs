import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { evaluatePlan } from '../plan-evidence.mjs';

const digest = data => createHash('sha256').update(data).digest('hex');
const now = '2026-10-31T12:00:00Z';
function fixture(t, edit = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'plan-evidence-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const request = { businessKey: 'task-1', target: { storeId: 'store-1', productId: 'product-1' },
    plan: { sku: ['book-a', 'book-b'], images: ['image-a', 'image-b'], prices: { group: 315 },
      promotions: [{ quantity: 2, rate: 0.95 }], stock: 1, dispatch: { hours: 48 }, services: ['course'] }, proofs: [] };
  const policy = { required: [{ kind: 'commercial', sourceRoles: ['supplier'], fields: ['sku', 'images', 'prices', 'promotions', 'stock', 'dispatch', 'services'] }], trustedDigests: [] };
  const document = { version: 1, kind: 'commercial', subject: { businessKey: 'task-1', storeId: 'store-1', productId: 'product-1' },
    source: { id: 'supplier-record-1', role: 'supplier' }, reviewedBy: 'reviewer-1',
    issuedAt: '2026-10-31T11:00:00Z', expiresAt: '2026-10-31T13:00:00Z', facts: structuredClone(request.plan), artifacts: [] };
  edit({ request, policy, document, root });
  const bytes = JSON.stringify(document); writeFileSync(join(root, 'review.json'), bytes);
  const sha256 = digest(bytes); request.proofs.push({ path: 'review.json', sha256 }); policy.trustedDigests.push(sha256);
  return { request, options: { evidenceRoot: root, policy, now } };
}

test('pinned current evidence can match a plan without authorizing publication', t => {
  const f = fixture(t); const r = evaluatePlan(f.request, f.options);
  assert.equal(r.status, 'matched'); assert.equal(r.publicationAuthorized, false);
  assert.equal(r.factsIndependentlyEstablished, false); assert.deepEqual(r.reasons, []);
});
test('self-declared verified status cannot replace a pinned evidence document', t => {
  const f = fixture(t); f.options.policy.trustedDigests = []; f.request.proofs[0].status = 'verified';
  assert.equal(evaluatePlan(f.request, f.options).status, 'unknown');
});
test('changing evidence bytes after review is rejected', t => {
  const f = fixture(t); writeFileSync(join(f.options.evidenceRoot, 'review.json'), '{}');
  assert.equal(evaluatePlan(f.request, f.options).status, 'rejected');
});
for (const [name, change] of [
  ['expired evidence', x => { x.document.expiresAt = now; }],
  ['future-dated evidence', x => { x.document.issuedAt = '2026-10-31T12:01:00Z'; }],
  ['evidence for another store', x => { x.document.subject.storeId = 'store-2'; }],
  ['evidence for another business operation', x => { x.document.subject.businessKey = 'other'; }],
  ['evidence for another product', x => { x.document.subject.productId = 'other'; }],
  ['unapproved source role', x => { x.document.source.role = 'customer_claim'; }],
]) test(`${name} cannot satisfy the plan`, t => {
  const f = fixture(t, change); assert.notEqual(evaluatePlan(f.request, f.options).status, 'matched');
});
for (const [field, value] of [['images', ['image-b', 'image-a']], ['sku', ['book-a']], ['prices', { group: 316 }],
  ['promotions', []], ['stock', 2], ['dispatch', { hours: 24 }], ['services', []]]) {
  test(`a ${field} mismatch is rejected with its field identified`, t => {
    const f = fixture(t); f.request.plan[field] = value;
    const r = evaluatePlan(f.request, f.options); assert.equal(r.status, 'rejected');
    assert.ok(r.reasons.some(x => x.code === 'FACT_MISMATCH' && x.field === field));
  });
}
test('missing required facts stay unknown', t => {
  const f = fixture(t, x => { delete x.document.facts.stock; });
  assert.equal(evaluatePlan(f.request, f.options).status, 'unknown');
});
test('artifact hashes bind visual reviews to actual captured bytes', t => {
  const f = fixture(t, x => {
    writeFileSync(join(x.root, 'capture.png'), 'capture-a');
    x.document.artifacts = [{ path: 'capture.png', sha256: digest('capture-a') }];
  });
  assert.equal(evaluatePlan(f.request, f.options).status, 'matched');
  writeFileSync(join(f.options.evidenceRoot, 'capture.png'), 'capture-b');
  assert.equal(evaluatePlan(f.request, f.options).status, 'rejected');
});
test('evidence paths cannot escape the configured evidence directory', t => {
  const f = fixture(t); f.request.proofs[0].path = '../review.json';
  assert.equal(evaluatePlan(f.request, f.options).status, 'rejected');
});
test('symlinks cannot substitute evidence outside the configured directory', t => {
  const f = fixture(t); symlinkSync('/etc/hosts', join(f.options.evidenceRoot, 'outside'));
  f.request.proofs[0].path = 'outside';
  assert.equal(evaluatePlan(f.request, f.options).status, 'rejected');
});
test('duplicate document kinds cannot silently override conflicting facts', t => {
  const f = fixture(t); f.request.proofs.push({ ...f.request.proofs[0] });
  assert.equal(evaluatePlan(f.request, f.options).status, 'rejected');
});

test('CLI evaluates files and leaves platform publication unauthorized', t => {
  const f = fixture(t), root = f.options.evidenceRoot;
  writeFileSync(join(root, 'request.json'), JSON.stringify(f.request));
  writeFileSync(join(root, 'policy.json'), JSON.stringify(f.options.policy));
  const child = spawnSync(process.execPath, [new URL('../plan-evidence-cli.mjs', import.meta.url).pathname,
    join(root, 'request.json'), root, join(root, 'policy.json'), now], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.status, 'matched'); assert.equal(result.publicationAuthorized, false);
});

test('CLI signals unknown evidence without approving publication', t => {
  const f = fixture(t), root = f.options.evidenceRoot; f.request.proofs = [];
  writeFileSync(join(root, 'request.json'), JSON.stringify(f.request));
  writeFileSync(join(root, 'policy.json'), JSON.stringify(f.options.policy));
  const child = spawnSync(process.execPath, [new URL('../plan-evidence-cli.mjs', import.meta.url).pathname,
    join(root, 'request.json'), root, join(root, 'policy.json'), now], { encoding: 'utf8' });
  assert.equal(child.status, 2, child.stderr);
  assert.equal(JSON.parse(child.stdout).status, 'unknown');
});

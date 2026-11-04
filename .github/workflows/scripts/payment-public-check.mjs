import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const STAGING_ORIGIN = 'https://staging-autopilot.zenjoymedia.media';
const SHA = /^[a-f0-9]{40}$/;
const MAX_RESPONSE_BYTES = 65536;

function result(state, reason, extra = {}) {
  return { state, reason, signature_rejection_verified: false, payment_business_verified: false, ...extra };
}

export function probeExitCode(receipt) {
  return receipt.state === 'verified' ? 0 : receipt.state === 'not_verified' ? 2 : 1;
}

async function requestJson(url, method, timeoutMs) {
  const response = await fetch(url, {
    method, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    headers: { 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: '{}' } : {}),
  });
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_RESPONSE_BYTES) throw new Error('response_too_large');
    chunks.push(chunk);
  }
  let body;
  if (/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* Invalid JSON cannot verify anything. */ }
  }
  return { status: response.status, body };
}

/** The transport also supports loopback HTTP for the local contract consumer. */
export async function runPaymentProbe({ baseUrl, expectedSha, timeoutMs = 15000 }) {
  if (!baseUrl?.trim() || !expectedSha?.trim()) return result('not_verified', 'missing_probe_configuration');
  if (!SHA.test(expectedSha)) return result('failed', 'invalid_expected_sha');
  let origin;
  try {
    const url = new URL(baseUrl);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
        !['https:', 'http:'].includes(url.protocol) ||
        (url.protocol === 'http:' && url.hostname !== '127.0.0.1')) throw new Error('invalid_origin');
    origin = url.origin;
  } catch { return result('failed', 'invalid_origin'); }

  const identity = { origin, expected_sha: expectedSha };
  try {
    const health = await requestJson(`${origin}/api/health`, 'GET', timeoutMs);
    if (health.status !== 200 || health.body?.status !== 'ok') return result('failed', 'health_not_ok', identity);
    if (health.body?.build?.sha !== expectedSha) return result('failed', 'staging_sha_mismatch', identity);
    if (health.body?.payment?.providerInitErrors?.some(error => error.provider === 'wechat')) {
      return result('failed', 'provider_initialization_failed', identity);
    }
    const callback = await requestJson(`${origin}/api/payment/callback/wechat`, 'POST', timeoutMs);
    if (callback.status === 404 && callback.body?.code === 'UNKNOWN_PROVIDER') {
      return result('not_verified', 'provider_not_enabled', { ...identity, sha: expectedSha });
    }
    if (callback.status !== 403 || callback.body?.code !== 'SIGNATURE_INVALID') {
      return result('failed', 'unexpected_callback_response', { ...identity, http_status: callback.status });
    }
    return result('verified', 'unsigned_callback_rejected', {
      ...identity, sha: expectedSha, signature_rejection_verified: true,
    });
  } catch {
    // Do not emit bodies, config values, headers or transport error details.
    return result('failed', 'request_failed', identity);
  }
}

export function writeProbeReceipt(receipt, env = process.env) {
  console.log(JSON.stringify(receipt));
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `payment_verification=${receipt.state}\n`);
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY,
      `### Payment callback public check\n\nState: **${receipt.state}** (${receipt.reason}).\n\n` +
      'This check does not verify payment creation, settlement or a real payment.\n');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const baseUrl = process.env.PAYMENT_SMOKE_BASE_URL;
  let receipt;
  // A production URL must never satisfy the post-staging deployment check.
  if (baseUrl && baseUrl !== STAGING_ORIGIN) receipt = result('failed', 'unexpected_staging_origin');
  else receipt = await runPaymentProbe({ baseUrl, expectedSha: process.env.DEPLOY_SHA });
  writeProbeReceipt(receipt);
  process.exitCode = probeExitCode(receipt);
}

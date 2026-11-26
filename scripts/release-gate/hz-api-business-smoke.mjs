import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { assertSafeDraft } from './dashboard-business-smoke.mjs';

const origin = 'https://staging-autopilot.zenjoymedia.media';
const email = 'ai-acceptance@zenithjoy.test';
const profilePath = '/api/company-profile';
const markerPrefix = 'release-acceptance-';
const fullSha = /^[a-f0-9]{40}$/;
const positiveInteger = /^[1-9][0-9]{0,14}$/;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

class SmokeFailure extends Error {}

function need(condition, message) {
  if (!condition) throw new SmokeFailure(message);
}

function inputsFromEnv(env) {
  need(fullSha.test(env.EXPECTED_API_SHA ?? ''), 'full API staging SHA required');
  need([env.API_STAGING_RUN_ID, env.API_STAGING_RUN_ATTEMPT].every(value => positiveInteger.test(value ?? '')),
    'API staging run ID and attempt required');
  need(env.STAGING_ACCEPTANCE_EMAIL === email && env.STAGING_ACCEPTANCE_PASSWORD,
    'dedicated staging account credentials required');
  need(uuid.test(env.STAGING_ACCEPTANCE_TENANT_ID ?? ''), 'dedicated staging acceptance tenant UUID required');
  return {
    staging: {
      sha: env.EXPECTED_API_SHA,
      run_id: Number(env.API_STAGING_RUN_ID),
      run_attempt: Number(env.API_STAGING_RUN_ATTEMPT),
    },
    password: env.STAGING_ACCEPTANCE_PASSWORD,
    tenantId: env.STAGING_ACCEPTANCE_TENANT_ID,
  };
}

function requestClient(fetchImpl) {
  return (path, { method = 'GET', data, cookie } = {}) => {
    const url = new URL(origin + path);
    if (method === 'GET') url.searchParams.set('release_probe', randomUUID());
    return fetchImpl(url, {
      method,
      headers: {
        accept: 'application/json',
        'cache-control': 'no-cache',
        ...(method === 'GET' ? {} : { origin, 'content-type': 'application/json' }),
        ...(cookie ? { cookie } : {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
  };
}

async function successData(response, label) {
  need(response.ok, label + ' returned HTTP ' + response.status);
  const payload = await response.json();
  need(payload?.success === true, label + ' did not return success');
  return payload.data;
}

async function signIn(request, password) {
  const response = await request('/api/auth/sign-in/email', { method: 'POST', data: { email, password } });
  need(response.ok, 'dedicated staging account login rejected');
  const tokens = response.headers.getSetCookie()
    .map(header => header.split(';', 1)[0])
    .filter(pair => /^(?:__Secure-)?better-auth\.session_token=[^\s;,]+$/.test(pair));
  need(tokens.length === 1, 'staging login did not return one session cookie');
  const [cookie] = tokens;
  const session = await request('/api/auth/get-session', { cookie });
  need(session.ok && (await session.json())?.user?.email === email, 'dedicated account session readback did not match');
  return cookie;
}

function matchesDraft(draft, baseline, owner, version) {
  const stableValues = ({ config_owner, config_version, updated_at, ...rest }) => rest;
  return draft.config_owner === owner && draft.config_version === version
    && isDeepStrictEqual(stableValues(draft), stableValues(baseline));
}

export async function runApiBusinessSmoke(env, { fetchImpl = fetch } = {}) {
  const { staging, password, tenantId } = inputsFromEnv(env);
  const request = requestClient(fetchImpl);
  const checkVersion = async () => {
    const response = await request('/api/version');
    need(response.ok && (await response.json())?.sha === staging.sha, 'live staging API SHA does not match the candidate');
  };
  await checkVersion();
  const anonymous = await request(profilePath);
  need(anonymous.status === 401 && (await anonymous.json())?.error?.code === 'UNAUTHORIZED',
    'anonymous company profile request did not return UNAUTHORIZED');
  const cookie = await signIn(request, password);
  const read = async () => {
    const draft = await successData(await request(profilePath, { cookie }), 'company draft read');
    assertSafeDraft(draft, tenantId);
    return draft;
  };
  const put = async (version, owner) => {
    await checkVersion();
    return request(profilePath, {
      method: 'PUT',
      cookie,
      data: { expected_version: version, config_owner: owner, config_status: 'draft' },
    });
  };
  const baseline = await read();
  need(!baseline.config_owner.startsWith(markerPrefix), 'previous acceptance marker needs cleanup');
  const [outreach, sourceSync, pacing] = await Promise.all([
    request(profilePath + '/outreach-settings', { cookie }).then(r => successData(r, 'outreach settings read')),
    request(profilePath + '/source-sync', { cookie }).then(r => successData(r, 'source sync state read')),
    request('/api/content-factory/topics/pacing/config', { cookie }).then(r => successData(r, 'topic pacing read')),
  ]);
  need(outreach === null, 'dedicated fixture must have no outreach settings');
  need(isDeepStrictEqual(sourceSync, { sources: [], state: {} }), 'dedicated fixture must have no configured source workspaces or sync state');
  need(Number.isSafeInteger(pacing?.daily_limit) && pacing.daily_limit >= 0, 'employee topic pacing returned an invalid limit');
  const marker = markerPrefix + randomUUID();
  const version = baseline.config_version;
  const owner = baseline.config_owner;
  let failure;
  try {
    await successData(await put(version, marker), 'company draft save');
    need(matchesDraft(await read(), baseline, marker, version + 1), 'saved draft did not match independent readback');
    const stale = await put(version, owner);
    need(stale.status === 409 && (await stale.json())?.error?.code === 'VERSION_CONFLICT',
      'stale draft retry did not return VERSION_CONFLICT');
    need(matchesDraft(await read(), baseline, marker, version + 1), 'stale retry changed the saved draft');
  } catch (error) {
    failure = error;
  }

  const current = await read();
  if (matchesDraft(current, baseline, marker, version + 1)) {
    await successData(await put(current.config_version, owner), 'company draft restoration');
    need(matchesDraft(await read(), baseline, owner, version + 2), 'restored draft did not match independent readback');
  } else {
    need(failure && matchesDraft(current, baseline, owner, version), 'draft cleanup refused because the fixture changed concurrently');
  }
  if (failure) throw failure;
  await checkVersion();
  return {
    schema: 1, target: 'api', origin, staging: { api: staging },
    checks: {
      anonymous_denied: true, login: true, outreach_settings_read: true, source_sync_state_read: true,
      topic_pacing_read: true, draft_write: true, independent_readback: true, stale_version_rejected: true,
      safe_retry_and_cleanup: true,
    },
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const main = async () => {
    const output = process.env.HZ_API_ACCEPTANCE_OUTPUT;
    need(isAbsolute(output ?? ''), 'absolute acceptance receipt path required');
    const receipt = await runApiBusinessSmoke(process.env);
    await writeFile(output, JSON.stringify(receipt) + '\n', { mode: 0o600, flag: 'wx' });
  };
  main().catch(error => {
    console.error(error instanceof SmokeFailure ? error.message : 'staging API acceptance failed');
    process.exitCode = 1;
  });
}

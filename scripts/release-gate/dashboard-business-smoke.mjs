import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const origin = 'https://staging-autopilot.zenjoymedia.media';
const acceptanceEmail = 'ai-acceptance@zenithjoy.test';
const profilePath = '/api/company-profile';
const fixtureKey = 'dashboard-release-acceptance';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

class SmokeFailure extends Error {}

function need(condition, message) {
  if (!condition) throw new SmokeFailure(message);
}

function stagingInputs(env, prefix, sha) {
  const runId = env[prefix + '_STAGING_RUN_ID'];
  const runAttempt = env[prefix + '_STAGING_RUN_ATTEMPT'];
  need(/^[a-f0-9]{40}$/.test(sha ?? ''), prefix + ' staging SHA required');
  need([runId, runAttempt].every(value => /^[1-9][0-9]{0,14}$/.test(value ?? '')), prefix + ' staging run and attempt required');
  return { sha, run_id: Number(runId), run_attempt: Number(runAttempt) };
}

export function smokeInputs(env) {
  need(env.STAGING_ACCEPTANCE_EMAIL === acceptanceEmail && env.STAGING_ACCEPTANCE_PASSWORD, 'dedicated staging account credentials required');
  need(uuid.test(env.STAGING_ACCEPTANCE_TENANT_ID ?? ''), 'dedicated staging acceptance tenant UUID required');
  need(isAbsolute(env.DASHBOARD_ACCEPTANCE_OUTPUT ?? ''), 'absolute acceptance receipt path required');
  return {
    staging: {
      dashboard: stagingInputs(env, 'DASHBOARD', env.EXPECTED_DASHBOARD_SHA),
      api: stagingInputs(env, 'API', env.EXPECTED_API_SHA),
    },
    tenantId: env.STAGING_ACCEPTANCE_TENANT_ID,
    password: env.STAGING_ACCEPTANCE_PASSWORD,
    output: env.DASHBOARD_ACCEPTANCE_OUTPUT,
  };
}

export function assertSafeDraft(profile, tenantId) {
  need(profile?.tenant_id === tenantId && uuid.test(profile.company_id ?? ''), 'company profile is outside the designated acceptance tenant');
  need(profile.company_key === fixtureKey && isDeepStrictEqual(profile.runtime_config, {}), 'dedicated company draft fixture without runtime bindings required');
  need(profile.config_status === 'draft' && typeof profile.config_owner === 'string'
    && Number.isSafeInteger(profile.config_version) && profile.config_version >= 0, 'existing company draft with reversible owner field required');
}

export function matchesOwnerChange(body, baseline, owner) {
  if (body?.expected_version !== baseline.config_version || body.config_owner !== owner || body.config_status !== 'draft') return false;
  const editable = new Set(['company_name', 'city', 'industry', 'description', 'products', 'key_advantages', 'customer_problem',
    'customer_portrait', 'qa_list', 'wiki', 'runtime_config', 'config_status', 'source_evidence']);
  return Object.entries(body).every(([field, value]) => field === 'config_owner' || field === 'expected_version'
    || (editable.has(field) && isDeepStrictEqual(value, baseline[field])));
}

export async function runDraftProbe(profile, tenantId, marker) {
  const original = await profile.read();
  assertSafeDraft(original, tenantId);
  need(!original.config_owner.startsWith('release-acceptance-'), 'previous acceptance marker needs cleanup');
  const afterMutation = observed => {
    assertSafeDraft(observed, tenantId);
    return observed.company_id === original.company_id && observed.config_version === original.config_version + 1
      && observed.config_owner === marker;
  };
  let failure;
  try {
    await profile.save(original, marker);
    need(afterMutation(await profile.read()), 'saved draft did not match independent readback');
  } catch (error) {
    failure = error;
  }
  const current = await profile.read().catch(() => { throw new SmokeFailure('draft cleanup refused: independent read unavailable'); });
  assertSafeDraft(current, tenantId);
  const neverChanged = current.company_id === original.company_id && current.config_owner === original.config_owner
    && current.config_version === original.config_version;
  if (!neverChanged) {
    need(afterMutation(current), 'draft cleanup refused: draft changed concurrently');
    await profile.restore(current, original.config_owner).catch(error => {
      if (error instanceof SmokeFailure) throw new SmokeFailure('draft cleanup failed: ' + error.message);
      throw new SmokeFailure('draft cleanup write did not return successfully');
    });
    const restored = await profile.read();
    assertSafeDraft(restored, tenantId);
    need(restored.company_id === original.company_id && restored.config_owner === original.config_owner
      && restored.config_version === current.config_version + 1, 'draft cleanup did not match independent readback');
  }
  if (failure) throw failure;
  need(!neverChanged, 'draft unexpectedly returned to its original state before cleanup');
}

async function observedSha(resource) {
  const response = await fetch(origin + resource + '?release_probe=' + randomUUID(), {
    redirect: 'error', cache: 'no-store', headers: {'cache-control': 'no-cache'}, signal: AbortSignal.timeout(15_000),
  });
  need(response.ok, 'staging version endpoint failed: ' + resource);
  return (await response.json()).sha;
}

async function readVersions(staging) {
  const [frontend, backend] = await Promise.all([observedSha('/release-sha.json'), observedSha('/api/version')]);
  need(frontend === staging.dashboard.sha && backend === staging.api.sha, 'live staging versions do not match the candidate deployment runs');
}

async function runBrowser(browser, inputs) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const anonymous = await context.request.get(origin + profilePath, { maxRedirects: 0, timeout: 10_000 });
  need(anonymous.status() === 401 || anonymous.status() === 403, 'anonymous company profile access was not rejected');
  let allowedSave;
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    const method = request.method();
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)
      || (method === 'POST' && url.pathname === '/api/auth/sign-in/email')) return route.continue();
    if (method === 'PUT' && url.pathname === profilePath && allowedSave) {
      try {
        if (matchesOwnerChange(request.postDataJSON(), allowedSave.baseline, allowedSave.owner)) {
          allowedSave = undefined;
          return route.continue();
        }
      } catch {
        return route.abort();
      }
    }
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto(origin + '/login', { waitUntil: 'domcontentloaded', timeout: 25_000 });
  need(new URL(page.url()).origin === origin, 'login left the staging origin');
  const email = page.locator('input[type=email]').first();
  const password = page.locator('input[type=password]').first();
  await email.fill(acceptanceEmail, { timeout: 10_000 });
  await password.fill(inputs.password, { timeout: 10_000 });
  await Promise.all([
    page.waitForURL(url => url.origin === origin && !url.pathname.startsWith('/login'), { timeout: 20_000 }),
    page.locator('button[type=submit]').first().click({ timeout: 10_000 }),
  ]);
  const session = await context.request.get(origin + '/api/auth/get-session', { maxRedirects: 0, timeout: 10_000 });
  need(session.ok() && (await session.json())?.user?.email === acceptanceEmail, 'dedicated staging user session not verified');

  const marker = 'release-acceptance-' + randomUUID();
  await runDraftProbe({
    async read() {
      const response = await context.request.get(origin + profilePath + '?release_probe=' + randomUUID(),
        { maxRedirects: 0, timeout: 10_000, headers: {'cache-control': 'no-cache'} });
      need(response.ok(), 'authenticated company profile read failed: HTTP ' + response.status());
      const payload = await response.json();
      need(payload?.success === true, 'authenticated company profile did not return success');
      return payload.data;
    },
    async restore(baseline, owner) {
      need(await observedSha('/api/version') === inputs.staging.api.sha, 'staging API changed before draft restoration');
      const response = await context.request.put(origin + profilePath, {
        maxRedirects: 0,
        timeout: 10_000,
        data: { expected_version: baseline.config_version, config_owner: owner, config_status: 'draft' },
      });
      need(response.ok() && (await response.json())?.success === true, 'original draft owner restoration rejected');
    },
    async save(baseline, owner) {
      await readVersions(inputs.staging);
      await page.goto(origin + '/company-profile', { waitUntil: 'domcontentloaded', timeout: 25_000 });
      await page.getByRole('tab', { name: '公司Wiki与配置', exact: true }).click({ timeout: 10_000 });
      const ownerInput = page.getByRole('textbox', { name: '配置负责人', exact: true });
      need(await ownerInput.inputValue({ timeout: 10_000 }) === baseline.config_owner, 'browser draft field and authenticated readback do not match');
      await ownerInput.fill(owner);
      allowedSave = { baseline, owner };
      try {
        const [response] = await Promise.all([
          page.waitForResponse(r => r.url() === origin + profilePath && r.request().method() === 'PUT', { timeout: 15_000 }),
          page.getByRole('button', { name: '保存配置', exact: true }).click({ timeout: 10_000 }),
        ]);
        need(response.ok() && (await response.json())?.success === true, 'company draft save rejected');
      } finally {
        allowedSave = undefined;
      }
    },
  }, inputs.tenantId, marker);
}

async function main(env) {
  const inputs = smokeInputs(env);
  await readVersions(inputs.staging);
  const { chromium } = await import('playwright');
  const localExecutable = env.DASHBOARD_ACCEPTANCE_CHROMIUM_EXECUTABLE;
  if (localExecutable) {
    need(env.GITHUB_ACTIONS !== 'true' && isAbsolute(localExecutable), 'browser override is only available to local tests with an absolute path');
  }
  const browser = await chromium.launch(localExecutable ? { executablePath: localExecutable } : {});
  try {
    await runBrowser(browser, inputs);
    await readVersions(inputs.staging);
    const receipt = {
      schema: 1, target: 'dashboard', origin, staging: inputs.staging,
      checks: { login: true, company_profile_navigation: true, draft_write: true, independent_readback: true, cleanup_readback: true },
    };
    await writeFile(inputs.output, JSON.stringify(receipt) + '\n', { mode: 0o600, flag: 'wx' });
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.env).catch(error => {
    console.error(error instanceof SmokeFailure ? error.message : 'staging browser acceptance failed');
    process.exitCode = 1;
  });
}

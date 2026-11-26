import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const origins = ['https://zenithjoy.tech', 'https://autopilot.zenjoymedia.media'];
const routes = [
  {
    endpoint: '/api/company-profile/outreach-settings',
    reference: '/outreach-settings',
  },
  {
    endpoint: '/api/company-profile/source-sync',
    reference: '/api/company-profile/source-sync',
  },
  {
    endpoint: '/api/topics',
    reference: '/api/topics',
    errorCode: 'SESSION_REQUIRED',
  },
  {
    endpoint: '/api/content-factory/topics',
    reference: '/api/content-factory/topics',
    errorCode: 'SESSION_REQUIRED',
  },
];
const dashboardSource = 'apps/dashboard/src';

function findRequiredRoutes(sha, cwd) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Dashboard candidate requires a full SHA');
  const git = (args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git(['cat-file', '-e', `${sha}^{commit}`]);
    if (git(['cat-file', '-t', `${sha}:${dashboardSource}`]).toString().trim() !== 'tree') {
      throw new Error('Dashboard source is not a tree');
    }
  } catch (error) {
    throw new Error(`Dashboard candidate ${sha} or its source tree is unavailable`, { cause: error });
  }
  return routes.filter(({ reference }) => {
    try {
      git([
        'grep', '-I', '-q', '-F', '-e', reference, sha,
        '--', dashboardSource,
        ':(exclude,glob)apps/dashboard/src/**/__tests__/**',
        ':(exclude,glob)apps/dashboard/src/**/*.test.*',
        ':(exclude,glob)apps/dashboard/src/**/*.spec.*',
      ]);
      return true;
    } catch (error) {
      if (error.status === 1) return false;
      throw new Error(`Cannot read Dashboard candidate routes at ${sha}`, { cause: error });
    }
  });
}

async function probe(origin, { endpoint, errorCode = 'UNAUTHORIZED' }, fetchImpl) {
  const url = new URL(endpoint, origin);
  const signal = AbortSignal.timeout(10000);
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal,
    });
  } catch {
    return { origin, endpoint, status: 'request failed', available: false };
  }
  const status = `HTTP ${response.status}`;
  const body = response.status === 401 && response.headers.get('content-type')?.startsWith('application/json')
    ? await response.json().catch(() => null)
    : null;
  const actualCode = body?.error?.code;
  const available = actualCode === errorCode;
  return { origin, endpoint, status: typeof actualCode === 'string' ? `${status} ${actualCode}` : status, available };
}

export async function verifyDashboardApiCompatibility({ sha, cwd = process.cwd(), fetchImpl = fetch }) {
  const requiredRoutes = findRequiredRoutes(sha, cwd);
  const observations = await Promise.all(origins.flatMap(origin =>
    requiredRoutes.map(endpoint => probe(origin, endpoint, fetchImpl))));
  const failures = observations.filter(({ available }) => !available);
  if (failures.length) {
    const details = failures.map(({ origin, endpoint, status }) => `${origin}${endpoint}: ${status}`).join(', ');
    throw new Error(`Dashboard candidate ${sha} needs protected production API routes: ${details}`);
  }
  return { sha, requiredRoutes: requiredRoutes.map(({ endpoint }) => endpoint), observations };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await verifyDashboardApiCompatibility({ sha: process.argv[2] })));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

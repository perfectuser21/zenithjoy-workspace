// This does not accept risk: callers must first verify the patched distributions.
// npm computes both reports against one immutable registry response snapshot.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

export const advisoryUrl = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
const bulkPath = '/-/npm/v1/security/advisories/bulk';
const maxBytes = 32 * 1024 * 1024;
const error = suffix => Error('PICOMATCH_AUDIT_' + suffix);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const severities = new Set(['info', 'low', 'moderate', 'high', 'critical']);

export function remediateBulk(report) {
  if (!object(report) || Object.hasOwn(report, 'error')) throw error('REPORT');
  const result = structuredClone(report);
  for (const [name, items] of Object.entries(result)) {
    if (!Array.isArray(items)) throw error('REPORT');
    for (const item of items) {
      if (!object(item) || !Number.isSafeInteger(item.id) || typeof item.url !== 'string'
          || !severities.has(item.severity) || typeof item.vulnerable_versions !== 'string') throw error('REPORT');
      if (item.url === advisoryUrl || item.id === 1247710) {
        if (name !== 'picomatch' || item.url !== advisoryUrl || item.id !== 1247710
            || item.severity !== 'high' || item.vulnerable_versions !== '<=4.0.7'
            || JSON.stringify(item.cwe) !== '["CWE-1333"]') throw error('ADVISORY_CHANGED');
      }
    }
  }
  if (result.picomatch) {
    result.picomatch = result.picomatch.filter(item => item.url !== advisoryUrl);
    if (!result.picomatch.length) delete result.picomatch;
  }
  return result;
}

async function readBounded(stream) {
  const chunks = []; let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > maxBytes) throw error('SIZE');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function publicRegistry({ method, path, body, accept }) {
  const response = await fetch('https://registry.npmjs.org' + path, {
    method, redirect: 'error', signal: AbortSignal.timeout(45000),
    headers: { accept, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
    ...(method === 'POST' ? { body } : {}),
  });
  if (!response.ok) throw error('REGISTRY_' + response.status);
  return JSON.parse((await readBounded(response.body)).toString('utf8'));
}

export async function startAuditSnapshot({ versions, upstream = publicRegistry }) {
  if (!Array.isArray(versions) || !versions.length || versions.some(v => !/^\d+\.\d+\.\d+$/.test(v))) throw error('SCOPE');
  const expected = [...new Set(versions)].sort();
  const snapshot = new Map(), pending = new Map(), failures = [];
  let phase = 'original', bulkSeen = false, removed = 0, closed = false, activeRequests = 0;
  const server = createServer(async (request, response) => {
    activeRequests++;
    const requestPhase = phase;
    try {
      if (closed) throw error('CLOSED');
      const match = /^\/(original|remediated)(\/[^?#]*)$/.exec(request.url || '');
      if (!match || match[1] !== requestPhase) throw error('PHASE');
      const path = match[2], method = request.method;
      if (method !== 'POST' && method !== 'GET') throw error('METHOD');
      if (method === 'POST' && path !== bulkPath) throw error('ENDPOINT');
      if (method === 'GET' && !/^\/(?:@[a-zA-Z0-9._~-]+\/)?[a-zA-Z0-9._~-]+$/.test(decodeURIComponent(path))) throw error('ENDPOINT');
      if (decodeURIComponent(path).split('/').some(part => part === '.' || part === '..')) throw error('ENDPOINT');
      let bytes = await readBounded(request);
      if (request.headers['content-encoding'] === 'gzip') bytes = gunzipSync(bytes, { maxOutputLength: maxBytes });
      else if (request.headers['content-encoding']) throw error('ENCODING');
      const body = bytes.toString('utf8');
      if (method === 'GET' && body) throw error('BODY');
      if (method === 'POST') {
        const packages = JSON.parse(body);
        if (!object(packages) || !Array.isArray(packages.picomatch)
            || JSON.stringify([...new Set(packages.picomatch)].sort()) !== JSON.stringify(expected)) throw error('VERSIONS');
        for (const list of Object.values(packages)) if (!Array.isArray(list) || list.some(v => typeof v !== 'string')) throw error('BODY');
      }
      const accept = String(request.headers.accept || 'application/json');
      if (accept.length > 256 || /[\r\n]/.test(accept)) throw error('ACCEPT');
      const key = method + ' ' + path + ' ' + digest(accept + '\n' + body);
      if (!snapshot.has(key)) {
        if (requestPhase !== 'original') throw error('SNAPSHOT_MISS');
        if (!pending.has(key)) pending.set(key, Promise.resolve(upstream({ method, path, body, accept })));
        const payload = await pending.get(key);
        if (!object(payload)) throw error('REPORT');
        if (method === 'POST') remediateBulk(payload); // validate; do not yet remove anything
        snapshot.set(key, structuredClone(payload));
      }
      const original = snapshot.get(key);
      if (method === 'POST') bulkSeen = true;
      let payload = original;
      if (method === 'POST' && requestPhase === 'remediated') {
        removed += (original.picomatch || []).filter(item => item.url === advisoryUrl).length;
        payload = remediateBulk(original);
      }
      response.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
      response.end(JSON.stringify(payload));
    } catch (cause) {
      failures.push(request.method + ' ' + request.url + ': ' + String(cause.message));
      response.writeHead(502, { 'content-type': 'application/json', connection: 'close' });
      response.end(JSON.stringify({ error: 'PICOMATCH_AUDIT_SNAPSHOT_FAILED' }));
    } finally {
      activeRequests--;
    }
  });
  server.requestTimeout = 60000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const assertHealthy = () => { if (failures.length) throw error('SNAPSHOT: ' + failures.join('; ')); };
  return Object.freeze({
    origin: `http://127.0.0.1:${server.address().port}`,
    assertHealthy,
    activateRemediation() {
      assertHealthy();
      if (!bulkSeen || phase !== 'original' || closed || activeRequests) throw error('SNAPSHOT');
      phase = 'remediated';
    },
    evidence() {
      return { phase, removed_advisories: removed, failures: [...failures],
        responses: [...snapshot].map(([key, payload]) => ({ key, sha256: digest(JSON.stringify(payload)) })),
        original_bulk: [...snapshot].filter(([key]) => key.startsWith('POST ')).map(([, payload]) => structuredClone(payload)) };
    },
    async close() {
      closed = true;
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  });
}

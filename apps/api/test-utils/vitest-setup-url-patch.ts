// Patch Node.js http.ClientRequest to encode non-ASCII characters in URL paths
// This is needed for Node.js 20+ which rejects unescaped characters in HTTP request paths
// Tests use Chinese characters in query strings (e.g. grade=高意向) which triggers ERR_UNESCAPED_CHARACTERS
import http from 'http';
import https from 'https';

const originalHttpRequest = http.request.bind(http);
const originalHttpsRequest = https.request.bind(https);

function encodeUrlPath(url: string | URL): string | URL {
  if (typeof url !== 'string') return url;
  // Split at '?' to preserve query params encoding separately
  const qIdx = url.indexOf('?');
  if (qIdx === -1) return url;
  const path = url.slice(0, qIdx);
  const query = url.slice(qIdx + 1);
  // Encode non-ASCII in query string
  const encodedQuery = query.replace(/[^\x00-\x7F]/g, (char) => encodeURIComponent(char));
  return `${path}?${encodedQuery}`;
}

function patchOptions(options: string | URL | http.RequestOptions): string | URL | http.RequestOptions {
  if (typeof options === 'string') {
    return encodeUrlPath(options) as string;
  }
  if (options instanceof URL) {
    return options;
  }
  if (options && typeof options === 'object' && 'path' in options && typeof options.path === 'string') {
    const encoded = encodeUrlPath(options.path);
    return { ...options, path: encoded as string };
  }
  return options;
}

// @ts-expect-error monkey-patch
http.request = function(options: string | URL | http.RequestOptions, ...args: unknown[]) {
  return originalHttpRequest(patchOptions(options) as Parameters<typeof originalHttpRequest>[0], ...args as Parameters<typeof originalHttpRequest>[1][]);
};
// @ts-expect-error monkey-patch
https.request = function(options: string | URL | https.RequestOptions, ...args: unknown[]) {
  return originalHttpsRequest(patchOptions(options) as Parameters<typeof originalHttpsRequest>[0], ...args as Parameters<typeof originalHttpsRequest>[1][]);
};

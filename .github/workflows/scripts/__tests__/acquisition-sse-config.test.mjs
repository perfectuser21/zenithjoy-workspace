import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// This deliberately asserts an exact location, which nginx gives precedence
// over prefix and regex locations. It does not simulate nginx's full matcher.
for (const name of ['nginx.conf', 'nginx.staging.conf']) test(`${name} has an exact long-lived unbuffered task stream location`, () => {
  const text = readFileSync(new URL(`../../../../deploy/${name}`, import.meta.url), 'utf8').replace(/#.*$/gm, '');
  const blocks = [...text.matchAll(/location\s*=\s*\/api\/acquisition\/agent\/task-stream\s*\{([^{}]*)\}/g)];
  assert.equal(blocks.length, 1);
  const body = blocks[0][1];
  assert.match(body, /proxy_buffering\s+off\s*;/);
  assert.match(body, /proxy_http_version\s+1\.1\s*;/);
  for (const directive of ['proxy_read_timeout', 'proxy_send_timeout']) {
    const seconds = Number(body.match(new RegExp(`${directive}\\s+(\\d+)s?\\s*;`))?.[1]);
    assert.ok(seconds >= 3600, `${directive} must be at least 3600 seconds`);
  }
});

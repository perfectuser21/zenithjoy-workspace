import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// Architectural allocation constraint only. Runtime screenshot lifecycle is a
// separate Android contract; JSON payloads/SQL values have Kotlin/API tests.
test('scan diagnostics reuse the existing ScreenCaptureService instead of constructing a competing session', () => {
  const text = readFileSync(new URL('../../../../services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/account/DeviceAccountScanService.kt', import.meta.url), 'utf8');
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/"(?:\\.|[^"\\])*"/g, '""');
  const declaration = code.indexOf('private fun captureFailureDiagnostics(');
  assert.ok(declaration >= 0, 'actual diagnostics function must exist');
  const begin = code.indexOf('{', declaration);
  let end = begin + 1, depth = 1;
  while (depth && end < code.length) { if (code[end] === '{') depth++; if (code[end] === '}') depth--; end++; }
  assert.equal(depth, 0, 'diagnostics function must be complete');
  const body = code.slice(begin, end);
  assert.match(body, /val\s+service\s*=\s*AgentService\.sharedScreenCaptureService\b/);
  assert.doesNotMatch(body, /\bScreenCaptureService\s*\(/);
  for (const key of ['EXTRA_SCREENSHOT_B64', 'EXTRA_TREE_DUMP']) assert.match(code, new RegExp(`putExtra\\(\\s*${key}\\s*,`));
});

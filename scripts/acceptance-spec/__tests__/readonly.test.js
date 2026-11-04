import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAndValidateSpec, renderHtml } from '../lib.mjs';
test('shared acceptance HTML is a complete read-only projection',async()=>{
 const {spec,errors}=await loadAndValidateSpec();assert.deepEqual(errors,[]);const html=renderHtml(spec);
 for(const step of spec.steps)assert.ok(html.includes(step.name));
 assert.doesNotMatch(html,/<select\b/i);assert.doesNotMatch(html,/暂时无法验证|Staff Hub/);
});

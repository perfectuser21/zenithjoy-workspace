import test from 'node:test';
import assert from 'node:assert/strict';
const host=await import('../official-child-host.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND'&&e.url===new URL('../official-child-host.mjs',import.meta.url).href)return {};throw e;});
test('公共official child宿主必须提供受控同进程RPC入口',()=>{assert.equal(typeof host.createPublicOfficialChildRpc,'function');});

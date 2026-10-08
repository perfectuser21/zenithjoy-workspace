import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hostname} from 'node:os';
import {deploymentTarget,assertRuntimeHost} from '../runtime-host.mjs';
test('部署与运行共享机器规范名，并以实际hostname同时核release和观测',()=>{
 assert.equal(deploymentTarget('M4-XIAN.local'),'xian-m4');assert.equal(deploymentTarget('m1-us.local'),'xian-m1');assert.equal(deploymentTarget('Worker.LOCAL'),'worker');
 const target=deploymentTarget(hostname());assert.equal(assertRuntimeHost({target},{target}),target);
 assert.throws(()=>assertRuntimeHost({target:'other-machine'},{target}),/实际机器/);
 assert.throws(()=>assertRuntimeHost({target},{target:'other-machine'}),/实际机器/);
});

test('中央登记MMV实际hostname规范为mmv，不能宽泛匹配相似机器',()=>{
 assert.equal(deploymentTarget('aad17-2'),'mmv');assert.equal(deploymentTarget('aad17-2.macminivault.com'),'mmv');
 assert.equal(deploymentTarget('aad17-20.macminivault.com'),'aad17-20');
});

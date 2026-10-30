import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'yaml';

const workflow=parse(readFileSync(new URL('../../ci-l4-e2e-smoke.yml',import.meta.url),'utf8'));

test('L4 Creator 使用固定 Python 而不请求可选 pip 缓存，完整安装与 pytest 仍必跑',()=>{
 const creator=workflow.jobs['python-creator-tests'];
 const setup=creator.steps.find(step=>step.uses?.startsWith('actions/setup-python@'));
 assert.equal(setup.with['python-version'],'3.12');
 assert.equal(setup.with.cache,undefined,'GitHub cache egress 限额不得阻断 pytest 前置');
 assert.equal(setup.with['cache-dependency-path'],undefined);
 assert.ok(creator.steps.some(step=>step.run==='pip install -r services/content-pipeline/requirements-ci.txt'));
 assert.ok(creator.steps.some(step=>step['working-directory']==='services/content-pipeline'&&step.run==='python3 -m pytest tests/ -v'));
});

test('L4 Worker 和汇总仍以 Creator 真实成功为必需依赖',()=>{
 const worker=workflow.jobs['smoke-e2e-worker'];
 const gate=workflow.jobs['l4-e2e-passed'];
 assert.deepEqual(worker.needs,['python-creator-tests','smoke-api-contract']);
 assert.ok(gate.needs.includes('python-creator-tests'));
 assert.ok(gate.needs.includes('smoke-e2e-worker'));
 assert.equal(gate.if,'always()');
 assert.match(gate.steps.find(step=>step.name==='Aggregate').run,/if \[ "\$RESULT" != "success" \]; then/);
});

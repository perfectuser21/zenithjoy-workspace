import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const fixture=new URL('./fixtures/collection-template-policy.mjs',import.meta.url).pathname;
for(const mode of ['101','101-work','102','102-work','pins','manifest','unknown-binding','frozen101','frozen102','explicit-wrong-endpoint'])test(`真实模板→manifest→默认scope ${mode}（仅证据目录元数据synthetic）`,()=>{const r=spawnSync(process.execPath,[fixture,mode],{encoding:'utf8',timeout:12000});assert.equal(r.status,0,r.stderr||r.stdout);});

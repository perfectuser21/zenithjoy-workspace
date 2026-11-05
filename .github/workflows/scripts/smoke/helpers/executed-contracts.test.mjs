import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const nodeRunner=fileURLToPath(new URL('./executed-node-contracts.mjs',import.meta.url));
const pythonRunner=fileURLToPath(new URL('./executed-python-contracts.py',import.meta.url));
const fixture=t=>{const root=mkdtempSync(join(tmpdir(),'executed-contract-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;};
for(const mode of ['passed','empty','skipped','todo','failed','import-error','one-empty-file'])test('actual Node child collection '+mode,t=>{
 const root=fixture(t),file=join(root,'contract.test.mjs');
 const code={passed:"test('real assertion',()=>assert.equal(2+2,4));",empty:'',skipped:"test.skip('must not pass',()=>{});",todo:"test.todo('not implemented');",failed:"test('actual failure',()=>assert.fail('failure witness'));",'import-error':"throw Error('import witness');",'one-empty-file':"test('first file',()=>assert.equal(1,1));"}[mode];
 writeFileSync(file,"import {test} from 'node:test';import assert from 'node:assert/strict';"+code);
 const files=[file];if(mode==='one-empty-file'){const empty=join(root,'empty.test.mjs');writeFileSync(empty,'');files.push(empty);}
 const r=spawnSync(process.execPath,[nodeRunner,...files],{encoding:'utf8',timeout:15000});
 if(mode==='passed')assert.equal(r.status,0,r.stdout+r.stderr);else {assert.notEqual(r.status,0);assert.match(r.stdout+r.stderr,/executed|assertion|import witness|failure witness/i);}
});
for(const mode of ['passed','empty','skipped','failed','import-error'])test('actual Python child collection '+mode,t=>{
 const root=fixture(t),folder=join(root,'suite');mkdirSync(folder);
 const code={passed:"import unittest\nclass Real(unittest.TestCase):\n def test_value(self):self.assertEqual(2+2,4)\n",empty:'',skipped:"import unittest\nclass Real(unittest.TestCase):\n @unittest.skip('must not pass')\n def test_skip(self):pass\n",failed:"import unittest\nclass Real(unittest.TestCase):\n def test_failure(self):self.fail('failure witness')\n",'import-error':"raise RuntimeError('import witness')\n"}[mode];
 writeFileSync(join(folder,'test_contract.py'),code);
 const r=spawnSync('python3',[pythonRunner,folder,'test_contract.py'],{encoding:'utf8',timeout:15000});
 if(mode==='passed')assert.equal(r.status,0,r.stdout+r.stderr);else {assert.notEqual(r.status,0);assert.match(r.stdout+r.stderr,/executed|failure witness|import witness/i);}
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../commander/wf-report.py', import.meta.url));
const fixture = String.raw`
import importlib.util,json,pathlib,tempfile
spec=importlib.util.spec_from_file_location('report',SCRIPT)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
request={'task_ids':['8606b2ab-9964-4c4d-9da5-eae484a8455f'],'release_ids':[], 'label':'中文\n换行 $(touch /tmp/never-run) '+chr(96)+'不执行'+chr(96), 'tags':[]}
calls=[]
def fetch(path):
 calls.append(path)
 return {'id':request['task_ids'][0],'status':'completed','title':'真实任务'}
with tempfile.TemporaryDirectory() as tmp:
 tmp=pathlib.Path(tmp).resolve()
 result=m.collect(request,tmp,fetch)
 assert result['status']=='completed'
 report=json.loads(pathlib.Path(result['outputs']['json_path']).read_text())
 assert report['input']==request
 assert len(calls)==1
 assert m.verify(request,pathlib.Path(tmp),fetch)['verdict']=='PASS'
 assert len(calls)==2, '核验必须重新读取来源'
 assert m.collect(request,tmp,fetch)==result, '同输入重入复用既有产物'
 report['rows'][0]['status']='failed'
 pathlib.Path(result['outputs']['json_path']).write_text(json.dumps(report))
 assert m.verify(request,pathlib.Path(tmp),fetch)['verdict']=='FAIL'
 try: m.collect(request,tmp,fetch)
 except ValueError: pass
 else: raise AssertionError('恢复不得覆盖旧失败证据')
with tempfile.TemporaryDirectory() as tmp:
 tmp=pathlib.Path(tmp).resolve()
 result=m.collect(request,tmp,fetch)
 def unavailable(path): raise OSError('来源离线')
 assert m.verify(request,tmp,unavailable)['verdict']=='INCONCLUSIVE'
for bad in [{'task_ids':['../../secret'],'release_ids':[]},{'task_ids':[],'release_ids':[]},{**request,'brain_url':'https://outside.invalid'}]:
 try: m.validate_input(bad)
 except ValueError: pass
 else: raise AssertionError('非法输入必须拒绝')
print('报告、独立读回、中文输入和损坏检测通过')
`;

test('非手机报告保留实际输入，独立核验重读来源并拒绝损坏产物', () => {
  const run = spawnSync('python3', ['-c', `SCRIPT=${JSON.stringify(script)}\n${fixture}`], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});

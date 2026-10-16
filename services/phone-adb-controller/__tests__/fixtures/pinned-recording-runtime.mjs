// 仅供完整CLI guard测试：替代“runtime能力已核”的外部边界。
// 真实guard、Popen、PID/argv/UID/readiness及停止逻辑全部仍执行生产代码。
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
export function pinnedRecordingRuntimeFixture(directory, runtimeHelper) {
 const root=join(directory,'runtime'),python=join(directory,'python-runtime-fixture');
 mkdirSync(root);
 writeFileSync(join(root,'scrcpy-server'),'test fixture server; no device upload');
 writeFileSync(python,`#!/usr/bin/python3
import argparse,hashlib,json,os,sys
from pathlib import Path
if len(sys.argv)>1 and sys.argv[1]==os.environ['RECORDING_FIXTURE_RUNTIME_HELPER']:
 p=argparse.ArgumentParser()
 p.add_argument('command',choices=['verify','stage-server'])
 p.add_argument('--runtime-kind',required=True,choices=['sdk33'])
 p.add_argument('--runtime-root',required=True)
 for key in ['adb-bin','adb-port','serial','owner','lock-dir','evidence-root','evidence-id','timeout']:
  p.add_argument('--'+key)
 a=p.parse_args(sys.argv[2:])
 assert a.runtime_root==os.environ['RECORDING_FIXTURE_RUNTIME_ROOT']
 policy=json.load(open(Path(sys.argv[1]).with_name('runtime-policy-sdk33.json')))
 result={key:policy[key] for key in ['schema','version','client_sha256','server_sha256']}
 result.update(verified=True,client_path=os.environ['RECORDING_FIXTURE_SCRCPY'],server_path=str(Path(a.runtime_root)/'scrcpy-server'))
 if a.command=='stage-server':
  assert a.owner and a.serial and Path(a.lock_dir,'owner').read_text().strip()==a.owner
  receipt=Path(a.evidence_root)/(a.evidence_id+'.server-stage.fixture.json')
  stage=dict(result,phase='verified',serial=a.serial,owner=a.owner,adb_port=int(a.adb_port),evidence_id=a.evidence_id,execution_stop_unknown=False,stage_receipt=str(receipt),fixture=True)
  with receipt.open('x') as f:json.dump(stage,f)
  result=dict(stage,stage_receipt_sha256=hashlib.sha256(receipt.read_bytes()).hexdigest())
 with open(os.environ['RECORDING_FIXTURE_RUNTIME_LOG'],'a') as f:f.write(json.dumps({'command':a.command,'kind':a.runtime_kind,'root':a.runtime_root})+'\\n')
 print(json.dumps(result));sys.exit(0)
os.execv('/usr/bin/python3',['/usr/bin/python3',*sys.argv[1:]])
`,{mode:0o755});
 return {DOUYIN_PYTHON_BIN:python,DOUYIN_SDK33_RUNTIME_ROOT:root,
  RECORDING_FIXTURE_RUNTIME_HELPER:runtimeHelper,RECORDING_FIXTURE_RUNTIME_ROOT:root,
  RECORDING_FIXTURE_SCRCPY:join(directory,'scrcpy'),RECORDING_FIXTURE_RUNTIME_LOG:join(directory,'runtime-calls.jsonl')};
}

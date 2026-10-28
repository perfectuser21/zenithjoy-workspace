import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const path=fileURLToPath(new URL('../qualification-maintenance-mmv.py',import.meta.url));
function run(code){const r=spawnSync('python3',['-B','-I','-c',`import importlib.util,sys\ns=importlib.util.spec_from_file_location('mmv',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\n${code}`,path],{encoding:'utf8',timeout:5000});assert.equal(r.status,0,r.stderr);}
test('MMV固定353 RPC原cwd/原tag/runid均属原域，不被Gateway inactive替代',()=>run(`
s={'runtime_root':'/home/u/.local/share/zenithjoy/phone-candidates/'+'3'*40+'/runtime','run_tag':'original_tag','run_id':'workflow-original_tag__a1','consumer_source':'3'*40}
assert m.classify_rpc('/opt/bin/node',['node','leadgen-rpc.mjs'],s['runtime_root'],s)=='related'
assert m.classify_rpc('/opt/bin/node',['node','other.mjs','original_tag'],'/tmp',s)=='related'
assert m.classify_rpc('/bin/ssh',['ssh','mmv','cd '+s['runtime_root']+' && node leadgen-rpc.mjs'],'/tmp',s)=='related'
assert m.classify_rpc('/opt/bin/node',['node','other.mjs'],'/different',s)=='outside_fixed_rpc_domain'
`));
test('可能RPC解释器cwd缺失/argv不可读不猜无活动；只输出摘要不原argv',()=>run(`
s={'runtime_root':'/fixed/runtime','run_tag':'original_tag','run_id':'workflow-original_tag__a1','consumer_source':'3'*40}
assert m.classify_rpc('/opt/bin/node',['node','leadgen-rpc.mjs'],None,s)=='unknown'
assert m.classify_rpc('/opt/bin/node',None,'/tmp',s)=='unknown'
assert m.classify_rpc('/System/App',['App'],None,s)=='outside_fixed_rpc_domain'
`));
test('cwd完整输出按PID解析，不接受没有路径/重复身份的半截',()=>run(`
assert m.parse_cwds('p123\\nn/tmp\\np124\\nn/home/u\\n')=={123:'/tmp',124:'/home/u'}
assert m.parse_cwds('p123\\nfcwd\\nn/tmp\\n')=={123:'/tmp'}
for raw in ['p123\\n','n/tmp\\n','p123\\nn/tmp\\nn/other\\n']:
 try:m.parse_cwds(raw)
 except ValueError:pass
 else:raise AssertionError('accepted')
`));
test('真实内核存活解释器原tag输入必被有限域观察捕获，不输出其argv正文',async()=>{
 const tag='qualification_mmv_scoped_fixture';
 const child=spawn('/opt/homebrew/bin/python3',['-B','-I','-c','import time;time.sleep(3)',tag],{stdio:'ignore'});
 const exit=new Promise(resolve=>child.once('exit',resolve));await new Promise(resolve=>child.once('spawn',resolve));
 try{const {readMmvRpcClosure}=await import('../qualification-maintenance-mmv.mjs');
  const result=readMmvRpcClosure({consumer_source:'353b910f11ce3852b2ef69c8ead5c37e97850b4a',run_tag:tag});
  assert.equal(result.status,'blocked');assert.ok(result.matches.some(x=>x.pid===child.pid));
  assert.ok(!JSON.stringify(result).includes('time.sleep'));assert.match(result.coverage_sha256,/^[a-f0-9]{64}$/);
 }finally{await exit;assert.equal(child.signalCode,null);}
});

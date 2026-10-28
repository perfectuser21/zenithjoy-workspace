import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const file=fileURLToPath(new URL('../qualification-maintenance-role-diagnostics.py',import.meta.url));
function call(name,input){const code='import importlib.util,json,sys\ns=importlib.util.spec_from_file_location("roles",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nx=json.loads(sys.stdin.read());print(json.dumps(getattr(m,sys.argv[2])(**x)))';
 const r=spawnSync('python3',['-B','-I','-c',code,file,name],{input:JSON.stringify(input),encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
test('lsof只解析精确所选PID的cwd，不把文件列表或其他PID混进归属',()=>{
 const result=call('parse_cwds',{raw:'p12\nn/Users/fixture\np13\nn/private/tmp/oldrun\n',pids:[12]});assert.deepEqual(result,{'12':'/Users/fixture'});
});
test('launchd列表只输出标签PID，plist的env/token或argv正文永不落输出',()=>{
 const result=call('parse_launchd_list',{raw:'PID\tStatus\tLabel\n12\t0\tcom.example.source\n-\t0\tcom.not.running\n13\t0\tcom.other\n',pids:[12]});
 assert.deepEqual(result,[{pid:12,label:'com.example.source'}]);
});
test('只读诊断schema不接受调用方sourceverified或跳guard声明',()=>{
 const result=call('diagnostic_input',{scope:{uid:501,host:'xian-m4',source_verified:true}});assert.equal(result.status,'blocked');
});

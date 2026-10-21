// 只执行deploy.sh真实配套安装段；完整准入另由原entry负向回归覆盖，绝不声明整包生产通过。
import {readFileSync,realpathSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {parseDeployArrays} from '../../deployment-write-set.mjs';
const root=realpathSync(process.argv[2]),deploy=resolve(process.argv[3]),service=dirname(deploy);
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const source=readFileSync(process.argv[4]||deploy,'utf8');
const payload=process.env.PAIR_INCLUDE_M4_PAYLOAD==='1';
const start=source.indexOf('for host in xian-m4; do',source.indexOf(payload?'echo "=== [3/3]':'echo "=== [4/4]'));
const end=source.indexOf('  for f in "${DEVICE_CTL_FILES[@]}"; do',start);
if(start<0||end<=start)throw Error('真实配套安装边界缺失，拒绝运行陈旧测试副本');
// 创建隔离真journal和原serial.guard owner。没有设备、Brain或生产路径。
const setup=String.raw`import importlib.util,json,hashlib,sys
from pathlib import Path
root,service=map(Path,sys.argv[1:]);home=(root/'remote').resolve()
def module(name):
 s=importlib.util.spec_from_file_location(name,service/('deployment-'+name+'.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
tx=module('transaction');maintenance=module('maintenance');identity={'target':'xian-m4','source_commit':'b'*40,'previous_source_commit':'a'*40,'release_id':'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','previous_release_id':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}
entries=[{'path':directory+'/'+name,'after':{'kind':'file','sha256':hashlib.sha256((service/name).read_bytes()).hexdigest(),'mode':0o755}} for directory in ['bin-harvest','.local/bin'] for name in ['douyin-phone-adb','text-input-focus.py']]
tx.prepare(home,'smoke-paired-transaction',entries,identity)
maintenance.acquire(home,'smoke-paired-transaction',home/'registry.tsv',home/'locks')
`;
execFileSync('python3',['-c',setup,root,service],{stdio:['ignore','pipe','pipe']});
let prefix='';
if(payload){
 const groups=parseDeployArrays(source);
 for(const name of ['DEVICE_SH_FILES','DEVICE_NODE_FILES','DEVICE_RPC_PROBE_FILES','DEVICE_PLAN_FILES','DEVICE_CTL_FILES','DEVICE_CTL_DIRS'])prefix+=name+'=('+groups[name].map(quote).join(' ')+')\n';
 for(const name of ['remote_md5','kickstart_if_changed']){
  const single=new RegExp('^'+name+'\\(\\) \\{[^\\n]*}$','m'),multi=new RegExp('^'+name+'\\(\\) \\{\\n[\\s\\S]*?^}','m');
  const match=source.match(single)||source.match(multi);if(!match)throw Error('真实部署函数缺失: '+name);prefix+=match[0]+'\n';
 }
 prefix+='source '+quote(service+'/deployment-functions.sh')+'\n';
}
const script='set -euo pipefail\nD='+quote(service)+'\nFAILED=0\nWF_PHONE_TRANSACTION=smoke-paired-transaction\n'+prefix+source.slice(start,end)+'done\n[[ "$FAILED" == 0 ]]\n';
const child=spawnSync('bash',['-c',script],{stdio:'inherit',env:{...process.env,PATH:root+':'+process.env.PATH}});
process.exitCode=child.status??1;

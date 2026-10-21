// 默认两个独立宿主目录+独立Python进程；显式SSH模式仅在两机隔离/tmp演练，绝不使用正式设备锁。
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {coordinateDeployment} from '../deployment-coordinator.mjs';
const ssh=process.env.PHONE_REHEARSAL_SSH==='1',rows=[];
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const modules=['transaction','maintenance','host'].map(name=>'deployment-'+name+'.py');
const files=Object.fromEntries(modules.map(name=>[name,readFileSync(new URL('../'+name,import.meta.url)).toString('base64')]));
const SETUP=String.raw`import json,base64,tempfile,hashlib,os
from pathlib import Path
x=json.load(__import__('sys').stdin);root=Path(tempfile.mkdtemp(prefix='zj-phone-recovery-rehearsal-',dir='/tmp')).resolve();home=root/'home';(home/'bin-harvest').mkdir(parents=True)
for n,b in x.items():(root/n).write_bytes(base64.b64decode(b))
(root/'checksums.json').write_text(json.dumps({n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in x}))
for n in ['a','b']:
 p=home/'bin-harvest'/n;p.write_bytes(('old-'+n).encode());p.chmod(0o755)
(home/'registry.tsv').write_text('profile\tserial\nfixture\tFIXTURE_ONLY\n');(home/'locks').mkdir();(home/'locks/FIXTURE_ONLY.guard').touch()
print(root)
`;
const EXECUTE=String.raw`import json,sys,hashlib,importlib.util,os
from pathlib import Path
root=Path(sys.argv[1]);assert root.is_absolute() and root.resolve()==root and root.parent==Path('/tmp').resolve() and root.name.startswith('zj-phone-recovery-rehearsal-')
for n,h in json.loads((root/'checksums.json').read_text()).items():assert not(root/n).is_symlink() and hashlib.sha256((root/n).read_bytes()).hexdigest()==h
x=json.load(sys.stdin);home=root/'home';transaction=x.get('transaction','rehearsal')
def module(name):
 s=importlib.util.spec_from_file_location(name,root/('deployment-'+name+'.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
tx=module('transaction');maintenance=module('maintenance');host=module('host')
identity={'target':x['host'],'source_commit':'b'*40,'previous_source_commit':'a'*40,'release_id':'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','previous_release_id':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}
entries=[{'path':'bin-harvest/'+n,'after':{'kind':'file','sha256':hashlib.sha256(('new-'+n).encode()).hexdigest(),'mode':0o755}} for n in ['a','b']]
op=x['op'];out=None
if op=='prepare':
 tx.prepare(home,transaction,entries,identity);maintenance.acquire(home,transaction,home/'registry.tsv',home/'locks')
elif op=='inspect':
 p=tx.transaction_directory(home,transaction)/'journal.json';out=tx.read_transaction(home,transaction) if p.exists() else None
elif op=='decision':
 out=host.record(home,transaction,'decision',x['value'],host.record(home,transaction,'decision')) if 'value' in x else host.record(home,transaction,'decision')
elif op=='install':
 tx.owned(home,transaction);maintenance.verify(home,transaction,home/'registry.tsv',home/'locks')
 for n in (['a'] if x.get('partial') else ['a','b']):tx.atomic_bytes(home/'bin-harvest'/n,('new-'+n).encode(),0o755)
elif op=='reacquire':
 r=tx.read_transaction(home,transaction)
 if r['phase']=='released':tx.reopen(home,transaction,'a'*40 if r['released_direction']=='restored' else 'b'*40)
 maintenance.acquire(home,transaction,home/'registry.tsv',home/'locks')
elif op=='restore':
 if x.get('crash') and not(root/'interrupted').exists():
  original=tx.restore_entry;count=[0]
  def interrupted(*args):
   count[0]+=1
   if count[0]==2:
    (root/'interrupted').write_text('actual process terminated during recovery');os._exit(86)
   return original(*args)
  tx.restore_entry=interrupted
 tx.rollback(home,transaction,explicit=x.get('explicit',False))
elif op=='verify':
 wanted=x['direction']
 for n in ['a','b']:assert(home/'bin-harvest'/n).read_bytes()==(wanted+'-'+n).encode()
 maintenance.verify(home,transaction,home/'registry.tsv',home/'locks')
 out={'verified_bytes':wanted,'device_barrier':'fixture-owned'}
elif op=='commit':tx.commit(home,transaction)
elif op=='release':
 r=tx.read_transaction(home,transaction);maintenance.release(home,transaction,home/'registry.tsv',home/'locks');tx.release(home,transaction,identity['previous_release_id' if r['phase']=='restored' else 'release_id'])
elif op=='evidence':
 r=tx.read_transaction(home,transaction);out={'phase':r['phase'],'released_direction':r.get('released_direction'),'files':{n:(home/'bin-harvest'/n).read_text() for n in ['a','b']},'active':tx.active_file(home).exists(),'locks':[p.name for p in (home/'locks').glob('*.lock')]}
else:raise ValueError('unknown rehearsal operation')
print(json.dumps(out))
`;
function execute(host,code,args,input){
 const command=ssh?'ssh':'python3';
 const argv=ssh?['-T','-o','BatchMode=yes','-o','ConnectTimeout=15',host,'python3 -c '+quote(code)+' '+args.map(quote).join(' ')]:['-c',code,...args];
 return execFileSync(command,argv,{input:JSON.stringify(input),encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
}
function fixture(name){
 const roots=Object.fromEntries(['xian-m4','mmv'].map(host=>[host,execute(host,SETUP,[],files)]));
 const calls=[],call=(host,op,extra={})=>{calls.push({host,op});return JSON.parse(execute(host,EXECUTE,[roots[host]],{host,op,transaction:name,...extra}));};
 const options={readDecision:async()=>call('mmv','decision'),writeDecision:async value=>call('mmv','decision',{value}),
  prepare:async host=>call(host,'prepare'),inspect:async host=>call(host,'inspect'),reacquire:async host=>call(host,'reacquire'),
  install:async()=>{for(const host of ['xian-m4','mmv'])call(host,'install');},verifyInstalled:async host=>call(host,'verify',{direction:'new'}),
  commit:async host=>call(host,'commit'),restore:async host=>call(host,'restore',{explicit:true}),
  verifyRestored:async host=>call(host,'verify',{direction:'old'}),release:async host=>call(host,'release')};
 const evidence=()=>Object.fromEntries(['xian-m4','mmv'].map(host=>[host,call(host,'evidence')]));
 return{roots,call,calls,options,evidence};
}
test('两个真实宿主文件树：中途安装失败恢复整个旧包与锁',async()=>{
 const f=fixture('partial');
 f.options.install=async()=>{f.call('xian-m4','install',{partial:true});throw Error('actual partial installation');};
 await assert.rejects(coordinateDeployment(f.options),/actual partial/);
 const evidence=f.evidence();for(const r of Object.values(evidence)){assert.deepEqual(r.files,{a:'old-a',b:'old-b'});assert.equal(r.phase,'released');assert.equal(r.active,false);assert.deepEqual(r.locks,[]);}
 rows.push({scenario:'partial_install',roots:f.roots,evidence});
});
test('持久commit后实际回执丢失：恢复只完成提交，再显式回退旧包',async()=>{
 const f=fixture('lost-commit-ack');let lost=false;
 const commit=f.options.commit;
 f.options.commit=async host=>{await commit(host);if(!lost){lost=true;throw Error('lost ACK after actual durable commit');}};
 await assert.rejects(coordinateDeployment(f.options),/lost ACK/);
 const held=f.evidence();assert.equal(held['xian-m4'].phase,'committed');assert.equal(held.mmv.phase,'prepared');
 for(const r of Object.values(held)){assert.deepEqual(r.files,{a:'new-a',b:'new-b'});assert.equal(r.active,true);assert.equal(r.locks.length,1);}
 await coordinateDeployment({...f.options,recover:true});
 const committed=f.evidence();for(const r of Object.values(committed)){assert.equal(r.released_direction,'committed');assert.equal(r.active,false);}
 await coordinateDeployment({...f.options,rollback:true});
 const restored=f.evidence();for(const r of Object.values(restored)){assert.deepEqual(r.files,{a:'old-a',b:'old-b'});assert.equal(r.released_direction,'restored');}
 rows.push({scenario:'commit_ack_loss_then_explicit_rollback',roots:f.roots,held,committed,restored});
});
test('恢复中真实Python进程退出86：保留屏障，重入后完成恢复',async()=>{
 const f=fixture('restore-process-loss');
 f.options.install=async()=>{for(const h of ['xian-m4','mmv'])f.call(h,'install');throw Error('fail after install');};
 f.options.restore=async host=>f.call(host,'restore',{explicit:true,crash:host==='xian-m4'});
 await assert.rejects(coordinateDeployment(f.options));
 const held=f.evidence();assert.equal(held['xian-m4'].phase,'restoring');for(const r of Object.values(held))assert.equal(r.active,true);
 await coordinateDeployment({...f.options,recover:true});
 const restored=f.evidence();for(const r of Object.values(restored)){assert.equal(r.phase,'released');assert.deepEqual(r.files,{a:'old-a',b:'old-b'});assert.equal(r.active,false);}
 rows.push({scenario:'recovery_process_exit_86',roots:f.roots,held,restored});
 if(process.env.PHONE_REHEARSAL_EVIDENCE)writeFileSync(process.env.PHONE_REHEARSAL_EVIDENCE,JSON.stringify({transport:ssh?'real_ssh':'local_process',observed_at:new Date().toISOString(),module_hashes:Object.fromEntries(Object.entries(files).map(([p,b])=>[p,createHash('sha256').update(Buffer.from(b,'base64')).digest('hex')])),scope:'隔离文件树/真实内核锁；不代表生产业务或Brain验收',scenarios:rows},null,2),{mode:0o600});
});

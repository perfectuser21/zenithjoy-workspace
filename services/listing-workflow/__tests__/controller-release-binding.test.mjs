import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createControllerBridge} from '../controller-bridge.mjs';
const commit='a'.repeat(40),release=`/Users/operator/.local/share/zenithjoy/phone-candidates/${commit}/runtime/douyin-phone-adb`;
const files={'douyin-phone-adb':'b'.repeat(64),'phone-lock-lib.sh':'c'.repeat(64),'phone-lock-helper.py':'d'.repeat(64),'text-input-focus.py':'e'.repeat(64)};
function binding(){return {serial:'SERIAL123',model:'fixture',width:1200,height:2664,route:['operator@host'],controllerPath:release,controllerSha256:files['douyin-phone-adb'],focusSha256:files['text-input-focus.py'],baseProfile:'base',authority:'reviewed',controllerReleaseCommit:commit,controllerBundleFiles:{...files}};}
function bridge(t,b){const root=mkdtempSync(join(tmpdir(),'release-binding-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return createControllerBridge({binding:b,root,runId:'test-release'},{remote:async()=>{throw Error('must not run remote');}});}
test('严格40位commit隔离release和固定四文件binding可接受且不可变',t=>{
 const b=bridge(t,binding());assert.equal(b.binding.controllerPath,release);
 assert.equal(Object.isFrozen(b.binding.controllerBundleFiles),true);
});
const host=new URL('../controller-host.py',import.meta.url).pathname;
function hostCheck(mode){
 const script=`import pathlib,tempfile,hashlib,json\nh={'__name__':'test'};exec(pathlib.Path(${JSON.stringify(host)}).read_text(),h)\nwith tempfile.TemporaryDirectory() as tmp:\n root=pathlib.Path(tmp).resolve();names=${JSON.stringify(Object.keys(files))};digests={}\n for name in names:\n  data=name.encode();(root/name).write_bytes(data);digests[name]=hashlib.sha256(data).hexdigest()\n virtual=${JSON.stringify(release)};b={'controllerPath':virtual,'controllerReleaseCommit':${JSON.stringify(commit)},'controllerBundleFiles':digests.copy(),'controllerSha256':digests['douyin-phone-adb'],'focusSha256':digests['text-input-focus.py']}\n h['Path']=lambda p:root/pathlib.Path(p).name if str(p).startswith('/Users/operator/.local/share/zenithjoy/phone-candidates/') else pathlib.Path(p)\n mode=${JSON.stringify(mode)}\n if mode.startswith('drift:'):(root/mode.split(':')[1]).write_text('changed')\n if mode=='symlink':\n  p=root/'phone-lock-helper.py';p.unlink();target=root/'outside';target.write_bytes(b'phone-lock-helper.py');p.symlink_to(target)\n if mode=='directory-symlink':\n  (root/'linked').symlink_to(root,target_is_directory=True);h['Path']=lambda p:root/'linked'/pathlib.Path(p).name\n if mode=='commit-mismatch':b['controllerReleaseCommit']='f'*40\n if mode=='traversal':b['controllerPath']=virtual.replace('/runtime/','/../runtime/')\n if mode=='extra':b['controllerBundleFiles']['../outside']='a'*64\n if mode=='missing':del b['controllerBundleFiles']['phone-lock-lib.sh']\n def check():\n  if mode.startswith('dispatch:'):\n   (root/'phone-lock-helper.py').write_text('drift');action=mode.split(':')[1];q={'action':action,'binding':b,'owner':'owner','profile':'private','jobId':'test','command':'lock-status'}\n   (root/'config.json').write_text(json.dumps(q));h['roots']=lambda q:root\n   h['subprocess'].run=lambda *a,**kw:(_ for _ in ()).throw(AssertionError('DEVICE_PROCESS_MUST_NOT_START'))\n   return h['dispatch'](q)\n  h['verify_files']({'binding':b})\n  if mode=='second-read':\n   (root/'phone-lock-lib.sh').write_text('drift');h['verify_files']({'binding':b})\n try:check();print(json.dumps({'ok':True}))\n except Exception as e:print(json.dumps({'error':str(e)}))`;
 const r=spawnSync('python3',['-c',script],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
}
test('真实host逐次核对四文件，helper/lib漂移不能被旧controller+focus哈希掩盖',()=>{
 assert.deepEqual(hostCheck('valid'),{ok:true});
 for(const name of Object.keys(files))assert.match(hostCheck('drift:'+name).error||'',/CONTROLLER_/);
});
const invalid=[
 ['missing-commit',b=>delete b.controllerReleaseCommit],['commit-mismatch',b=>b.controllerReleaseCommit='f'.repeat(40)],
 ['uppercase',b=>{b.controllerPath=b.controllerPath.replace(commit,'A'.repeat(40));b.controllerReleaseCommit='A'.repeat(40);}],
 ['traversal',b=>b.controllerPath=b.controllerPath.replace('/phone-candidates/','/phone-candidates/../phone-candidates/')],
 ['extra-level',b=>b.controllerPath=b.controllerPath.replace('/douyin-phone-adb','/extra/douyin-phone-adb')],
 ['parallel-release-tree',b=>b.controllerPath=`/Users/operator/bin-harvest/controller-releases/${commit}/douyin-phone-adb`],
 ['missing-runtime',b=>b.controllerPath=b.controllerPath.replace('/runtime/','/')],
 ['array-path',b=>b.controllerPath=[b.controllerPath]],
 ['other-location',b=>b.controllerPath='/tmp/'+commit+'/douyin-phone-adb'],
 ['missing-bundle',b=>delete b.controllerBundleFiles],['extra-file',b=>b.controllerBundleFiles['../outside']='f'.repeat(64)],
 ['missing-file',b=>delete b.controllerBundleFiles['phone-lock-lib.sh']],['bad-digest',b=>b.controllerBundleFiles['phone-lock-helper.py']='A'.repeat(64)],
 ['array-digest',b=>b.controllerBundleFiles['phone-lock-helper.py']=['f'.repeat(64)]],
 ['controller-conflict',b=>b.controllerBundleFiles['douyin-phone-adb']='f'.repeat(64)],['focus-conflict',b=>b.controllerBundleFiles['text-input-focus.py']='f'.repeat(64)],
 ['legacy-release-metadata',b=>b.controllerPath='/Users/operator/bin-harvest/douyin-phone-adb'],
];
for(const [name,mutate] of invalid)test('release binding拒绝 '+name,t=>{const b=binding();mutate(b);assert.throws(()=>bridge(t,b),/INVALID_CONTROLLER_BINDING/);});
for(const location of ['bin-harvest','.local/bin'])test('原入口保留且不接受任何release元数据 '+location,t=>{
 const b=binding();b.controllerPath=`/Users/operator/${location}/douyin-phone-adb`;delete b.controllerReleaseCommit;delete b.controllerBundleFiles;
 assert.equal(bridge(t,b).binding.controllerPath,b.controllerPath);
 b.controllerReleaseCommit=undefined;assert.throws(()=>bridge(t,b),/INVALID_CONTROLLER_BINDING/);
 delete b.controllerReleaseCommit;b.controllerBundleFiles=undefined;assert.throws(()=>bridge(t,b),/INVALID_CONTROLLER_BINDING/);
});
for(const mode of ['symlink','directory-symlink','commit-mismatch','traversal','extra','missing'])test('真实host拒绝release '+mode,()=>assert.match(hostCheck(mode).error||'',/CONTROLLER_/));

for(const mode of ['dispatch:inspect','dispatch:initialize','dispatch:controller','dispatch:observe','second-read'])test('真实host每个入口重新核四文件 '+mode,()=>assert.match(hostCheck(mode).error||'',/CONTROLLER_BUNDLE_HASH_CHANGED/));

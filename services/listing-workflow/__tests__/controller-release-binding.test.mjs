import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createControllerBridge} from '../controller-bridge.mjs';
const commit='a'.repeat(40),release=`/Users/operator/bin-harvest/controller-releases/${commit}/douyin-phone-adb`;
const files={'douyin-phone-adb':'b'.repeat(64),'phone-lock-lib.sh':'c'.repeat(64),'phone-lock-helper.py':'d'.repeat(64),'text-input-focus.py':'e'.repeat(64)};
function binding(){return {serial:'SERIAL123',model:'fixture',width:1200,height:2664,route:['operator@host'],controllerPath:release,controllerSha256:files['douyin-phone-adb'],focusSha256:files['text-input-focus.py'],baseProfile:'base',authority:'reviewed',controllerReleaseCommit:commit,controllerBundleFiles:{...files}};}
function bridge(t,b){const root=mkdtempSync(join(tmpdir(),'release-binding-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return createControllerBridge({binding:b,root,runId:'test-release'},{remote:async()=>{throw Error('must not run remote');}});}
test('严格40位commit隔离release和固定四文件binding可接受且不可变',t=>{
 const b=bridge(t,binding());assert.equal(b.binding.controllerPath,release);
 assert.equal(Object.isFrozen(b.binding.controllerBundleFiles),true);
});
const host=new URL('../controller-host.py',import.meta.url).pathname;
function hostCheck(mode){
 const script=`import pathlib,tempfile,hashlib,json\nh={'__name__':'test'};exec(pathlib.Path(${JSON.stringify(host)}).read_text(),h)\nwith tempfile.TemporaryDirectory() as tmp:\n root=pathlib.Path(tmp);names=${JSON.stringify(Object.keys(files))};digests={}\n for name in names:\n  data=name.encode();(root/name).write_bytes(data);digests[name]=hashlib.sha256(data).hexdigest()\n virtual=${JSON.stringify(release)};b={'controllerPath':virtual,'controllerReleaseCommit':${JSON.stringify(commit)},'controllerBundleFiles':digests.copy(),'controllerSha256':digests['douyin-phone-adb'],'focusSha256':digests['text-input-focus.py']}\n h['Path']=lambda p:root/pathlib.Path(p).name if str(p).startswith('/Users/operator/bin-harvest/controller-releases/') else pathlib.Path(p)\n mode=${JSON.stringify(mode)}\n if mode.startswith('drift:'):(root/mode.split(':')[1]).write_text('changed')\n if mode=='symlink':\n  p=root/'phone-lock-helper.py';p.unlink();target=root/'outside';target.write_bytes(b'phone-lock-helper.py');p.symlink_to(target)\n if mode=='extra':b['controllerBundleFiles']['../outside']='a'*64\n if mode=='missing':del b['controllerBundleFiles']['phone-lock-lib.sh']\n try:h['verify_files']({'binding':b});print(json.dumps({'ok':True}))\n except Exception as e:print(json.dumps({'error':str(e)}))`;
 const r=spawnSync('python3',['-c',script],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
}
test('真实host逐次核对四文件，helper/lib漂移不能被旧controller+focus哈希掩盖',()=>{
 assert.equal(hostCheck('valid').ok,true);
 for(const name of Object.keys(files))assert.match(hostCheck('drift:'+name).error||'',/CONTROLLER_/);
});

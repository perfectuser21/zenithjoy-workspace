import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const fixture=new URL('./fixtures/adb-host-terminal.py',import.meta.url).pathname;
function py(mode){const r=spawnSync('python3',[fixture,mode],{encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stderr||r.stdout);}
test('server使用官方tcp:5037监听spec，客户端仍loopback且无-a（synthetic parser）',()=>py('service'));
for(const mode of ['post-term','exit-window'])test(`Darwin真实child ${mode}已停独立wait证实`,{skip:process.platform!=='darwin'},()=>py('native:'+mode));
test('Darwin内核BSDInfo布局与真实child微秒birth一致',{skip:process.platform!=='darwin'},()=>py('native-kernel'));
for(const mode of ['valid','esrch','denied','short','zero-errno','wrong-pid','bad-usec'])test(`kernel边界 ${mode} 严格判读`,()=>py('kernel:'+mode));
for(const mode of ['gone','zombie','live-unreadable','reuse','new-zombie','unbound-zombie'])test(`终态绑定 ${mode} （synthetic kernel）`,()=>py('synthetic:'+mode));
for(const mode of ['missing','hash','symlink','path'])test(`observer模块真实manifest ${mode}拒绝`,()=>py('manifest:'+mode));

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const deploy=readFileSync(new URL('../deploy.sh',import.meta.url),'utf8');
const prefix=deploy.slice(deploy.indexOf('MMV_JS_FILES=('),deploy.indexOf('# 在任何SSH前'));
function files(name){return execFileSync('bash',['-c',prefix+`\nprintf '%s\\n' "\${${name}[@]}"`],{encoding:'utf8'}).trim().split('\n');}
test('正式部署必须在控制器双执行根和MMV包交付统一客户端及管理源码',()=>{
 const control=files('DEVICE_CTL_FILES'),all=files('MMV_RUNTIME_FILES');
 for(const name of ['adb-existing-route.py','adb-managed-client.py','adb-host-service.py','adb-host-maintenance.py','maintenance-task-authority.py','adb-process-observation.py']){
  assert.ok(control.includes(name),'双执行根缺 '+name);assert.ok(all.includes(name),'MMV正式包缺 '+name);
 }
 assert.ok(files('DEVICE_SH_FILES').includes('install-adb-host-service.sh'));
});
test('正常发布只能交付源码，不能未经维护锁直接激活宿主策略或重启ADB',()=>{
 const tail=deploy.slice(deploy.indexOf('# 在任何SSH前'));
 assert.doesNotMatch(tail,/install-adb-host-service\.sh(?:\s|["'])/);
 assert.doesNotMatch(tail,/adb-host-maintenance\.py[^\n]*\bapply\b/);
 assert.doesNotMatch(tail,/adb\s+(?:-P\s+\d+\s+)?(?:start-server|kill-server)/);
 assert.match(tail,/input-runtime-release\.py/,'保留原all-free设备barrier');
});
test('正式完整smoke永久执行新增ADB守卫，不以局部测试冒发布通过',()=>{
 const smoke=readFileSync(new URL('../../../scripts/smoke/leadgen-split-smoke.sh',import.meta.url),'utf8');
 for(const name of ['managed-adb-policy','managed-adb-client','adb-host-service','adb-host-maintenance','managed-adb-deployment']){
  assert.ok(smoke.includes('/'+name+'.test.mjs'),'正式smoke遗漏 '+name);
 }
});

test('collection phone能力及真实leaf producer必须进入设备和MMV正式冻结包',()=>{
 for(const name of ['collection-phone-scope.mjs','collection-leaf-producer.mjs'])for(const list of ['DEVICE_NODE_FILES','MMV_RUNTIME_FILES'])assert.ok(files(list).includes(name),list+'缺'+name);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {phoneLockFixtureEnv} from './helpers/phone-lock-fixture.mjs';
import {fixtureAdb} from './adb-existing-route.test.mjs';

const controller=fileURLToPath(new URL('../douyin-phone-adb',import.meta.url));
function fixture(t) {
 const dir=mkdtempSync(join(tmpdir(),'owner-swipe-cli-')),root=join(dir,'phone'),lock=join(root,'locks','SER1.lock');
 mkdirSync(lock,{recursive:true});
 const registry=join(dir,'profiles.tsv'),log=join(dir,'adb.jsonl'),adb=join(dir,'adb'),python=join(dir,'python');
 writeFileSync(registry,'private-profile\tSER1\tfixture\t1080\t1920\n');
 writeFileSync(join(lock,'owner'),'pdd-r21c-owner\n');
 writeFileSync(join(lock,'acquired_at'),String(Math.floor(Date.now()/1000))+'\n');
 writeFileSync(adb,`#!/usr/bin/python3
import os,sys,json,time
with open(os.environ['SWIPE_ADB_LOG'],'a') as f:f.write(json.dumps(sys.argv[1:])+'\\n')
if sys.argv[-1:] == ['get-state']:print('device')
if 'swipe' in sys.argv:time.sleep(float(os.environ.get('SWIPE_FAKE_DELAY','0')))
`,{mode:0o755});
 const fake=fixtureAdb(adb),port=new URL(process.env.ADB_SERVER_SOCKET).port;
 // Run the actual Python entrypoints, but make all real host ADB sockets unreachable.
 writeFileSync(python,`#!/usr/bin/python3
import sys,socket,runpy
original=socket.create_connection
def isolated(address,*a,**kw):
 if address != ('127.0.0.1',${port}):raise ConnectionRefusedError('isolated fixture')
 return original(address,*a,**kw)
socket.create_connection=isolated
script=sys.argv.pop(1)
runpy.run_path(script,run_name='__main__')
`,{mode:0o755});
 const env={...process.env,...phoneLockFixtureEnv(registry,root),HOME:dir,DOUYIN_PYTHON_BIN:python,DOUYIN_ADB_BIN:fake,SWIPE_ADB_LOG:log};
 for(const key of ['DOUYIN_LOCK_ROOT','DOUYIN_PHONE_LOCK_ROOT','DOUYIN_LOCK_GUARDED','DOUYIN_LOCK_GUARD_FD','ZJ_ADB_HOST_CONFIG','DOUYIN_DETAIL_PLAYBACK'])delete env[key];
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const argv=['--profile','private-profile','--lock-owner','pdd-r21c-owner','swipe','900','700','200','700','350'];
 return {dir,lock,env,argv,call:(args=argv,extra={})=>spawnSync('zsh',[controller,...args],{env:{...env,...extra},encoding:'utf8',timeout:10000}),calls:()=>existsSync(log)?readFileSync(log,'utf8').trim().split('\n').map(JSON.parse):[]};
}
test('实际owner swipe CLI在真实helper guard内恰好输入一次且保留原锁',t=>{
 const f=fixture(t),r=f.call();assert.equal(r.status,0,r.stderr);
 assert.deepEqual(f.calls().filter(a=>a.includes('swipe')),[['-s','SER1','shell','input','swipe','900','700','200','700','350']]);
 assert.equal(readFileSync(join(f.lock,'owner'),'utf8'),'pdd-r21c-owner\n');
});

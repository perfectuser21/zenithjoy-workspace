import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const service=new URL('../',import.meta.url).pathname;
const script=join(service,'input-runtime-release.py');
const run=(...args)=>spawnSync('python3',[script,...args],{encoding:'utf8'});
test('paired input deployment source provides verified component metadata before SSH',()=>{
 const r=run('source-info',join(service,'douyin-phone-adb'),join(service,'text-input-focus.py'));
 assert.equal(r.status,0,r.stderr);const info=JSON.parse(r.stdout);assert.equal(info.revision,4);assert.ok(info.function_sha256);assert.ok(info.helper_sha256);
});
const controller=readFileSync(join(service,'douyin-phone-adb'),'utf8'),helper=readFileSync(join(service,'text-input-focus.py'),'utf8');
function setup(){
 const dir=mkdtempSync(join(tmpdir(),'input-release-'));const source=join(dir,'source'),a=join(dir,'a'),b=join(dir,'b');for(const p of [source,a,b])mkdirSync(p);
 writeFileSync(join(source,'douyin-phone-adb'),controller);writeFileSync(join(source,'text-input-focus.py'),helper);
 const registry=join(dir,'registry.tsv'),locks=join(dir,'locks');mkdirSync(locks);writeFileSync(registry,'profile\tserial\tmodel\nlegacy\tSER1\tm\na\tSER2\tm\nb\tSER3\tm\nc\tSER4\tm\n');
 for(const serial of ['SER1','SER2','SER3','SER4'])writeFileSync(join(locks,serial+'.guard'),'');
 return {source,a,b,registry,locks,expected:join(dir,'expected.json')};
}
function snapshot(c){const r=run('capture',c.a,c.b);assert.equal(r.status,0,r.stderr);writeFileSync(c.expected,r.stdout);return r.stdout;}
const install=c=>run('install',join(c.source,'douyin-phone-adb'),join(c.source,'text-input-focus.py'),c.expected,c.registry,c.locks,c.a,c.b);
test('real dc3be59e old input plus live 38d helper is rejected before any replacement',()=>{
 const c=setup();const old=readFileSync(join(service,'__tests__/fixtures/input-runtime-legacy-dc3be59e-function.zsh'),'utf8'),live=readFileSync(join(service,'__tests__/fixtures/input-runtime-live-helper-38d341de.py'),'utf8');
 writeFileSync(join(c.source,'douyin-phone-adb'),old);writeFileSync(join(c.source,'text-input-focus.py'),live);snapshot(c);
 const r=install(c);assert.equal(r.status,2);assert.match(r.stderr,/missing or incompatible/);assert.equal(run('capture',c.a,c.b).stdout,readFileSync(c.expected,'utf8'));
});
test('safe paired deployment installs matching input/controller in both paths',()=>{
 const c=setup();snapshot(c);const r=install(c);assert.equal(r.status,0,r.stderr);
 for(const dir of [c.a,c.b]){assert.equal(readFileSync(join(dir,'douyin-phone-adb'),'utf8'),controller);assert.equal(readFileSync(join(dir,'text-input-focus.py'),'utf8'),helper);}
});
test('paused/viewport rest changes carry the same verified input component and remain deployable',()=>{
 const c=setup();snapshot(c);assert.equal(install(c).status,0);snapshot(c);
 const added=controller+'\n# independently reviewed paused/viewport changes outside text_input\n';writeFileSync(join(c.source,'douyin-phone-adb'),added);
 const r=install(c);assert.equal(r.status,0,r.stderr);assert.equal(readFileSync(join(c.a,'douyin-phone-adb'),'utf8'),added);
});
test('same revision input function mutation is rejected without clobbering paused/viewport',()=>{
 const c=setup();snapshot(c);assert.equal(install(c).status,0);snapshot(c);
 writeFileSync(join(c.source,'douyin-phone-adb'),controller.replace('  # INPUT_RUNTIME_REVISION=4','  # INPUT_RUNTIME_REVISION=4\n  # changed input semantics'));
 const r=install(c);assert.equal(r.status,2);assert.match(r.stderr,/regress or mutate/);assert.equal(run('capture',c.a,c.b).stdout,readFileSync(c.expected,'utf8'));
});
test('same revision helper mutation is rejected',()=>{
 const c=setup();snapshot(c);assert.equal(install(c).status,0);snapshot(c);writeFileSync(join(c.source,'text-input-focus.py'),helper+'\n# incompatible helper change\n');
 assert.equal(install(c).status,2);assert.equal(run('capture',c.a,c.b).stdout,readFileSync(c.expected,'utf8'));
});
test('paired higher revision can advance but lower paired revision cannot roll it back',()=>{
 const c=setup();writeFileSync(join(c.source,'douyin-phone-adb'),controller.replace('INPUT_RUNTIME_REVISION=4','INPUT_RUNTIME_REVISION=5'));writeFileSync(join(c.source,'text-input-focus.py'),helper.replace('INPUT_RUNTIME_REVISION = 4','INPUT_RUNTIME_REVISION = 5'));
 snapshot(c);assert.equal(install(c).status,0);snapshot(c);writeFileSync(join(c.source,'douyin-phone-adb'),controller);writeFileSync(join(c.source,'text-input-focus.py'),helper);
 const r=install(c);assert.equal(r.status,2);assert.match(r.stderr,/regress or mutate/);
});
test('mismatched controller/helper revisions reject the source',()=>{
 const c=setup();writeFileSync(join(c.source,'text-input-focus.py'),helper.replace('INPUT_RUNTIME_REVISION = 4','INPUT_RUNTIME_REVISION = 5'));snapshot(c);assert.equal(install(c).status,2);
});
test('race CAS rejects a changed target before any paired file is installed',()=>{
 const c=setup();snapshot(c);writeFileSync(join(c.b,'douyin-phone-adb'),controller+'\n# other deployment\n');const current=run('capture',c.a,c.b).stdout;
 const r=install(c);assert.equal(r.status,2);assert.match(r.stderr,/CAS mismatch/);assert.equal(run('capture',c.a,c.b).stdout,current);
});
test('two captured deployments: second stale snapshot loses CAS instead of overwriting first rest changes',()=>{
 const c=setup();snapshot(c);const old=readFileSync(c.expected,'utf8');assert.equal(install(c).status,0);writeFileSync(c.expected,old);
 writeFileSync(join(c.source,'douyin-phone-adb'),controller+'\n# another viewport update\n');const r=install(c);assert.equal(r.status,2);assert.match(r.stderr,/CAS mismatch/);assert.equal(readFileSync(join(c.a,'douyin-phone-adb'),'utf8'),controller);
});
test('unsafe syntax is rejected before replacing a runtime pair',()=>{
 const c=setup();snapshot(c);writeFileSync(join(c.source,'text-input-focus.py'),helper+'\nif broken:\n');assert.equal(install(c).status,2);
 assert.equal(run('capture',c.a,c.b).stdout,readFileSync(c.expected,'utf8'));
});
test('deploy manifest carries helper and all controller writes route through the guarded pair',()=>{
 const source=readFileSync(join(service,'deploy.sh'),'utf8');assert.match(source,/DEVICE_CTL_FILES=\([\s\S]*?text-input-focus\.py[\s\S]*?\)/);
 assert.ok(source.indexOf('source-info "$D/douyin-phone-adb"')<source.indexOf('echo "=== [1/3]'));
 assert.match(source,/input-runtime-release\.py install/);assert.match(source,/"\$f" != "douyin-phone-adb" && "\$f" != "text-input-focus.py"/);
});
for(const name of ['SER1','SER4','UNKNOWN'])test('any kernel owner (including malformed/unknown) blocks pair installation: '+name,()=>{
 const c=setup();snapshot(c);mkdirSync(join(c.locks,name+'.lock'));writeFileSync(join(c.locks,name+'.lock','owner'),'another-run\n');
 const r=install(c);assert.equal(r.status,2);assert.match(r.stderr,/owner exists/);assert.equal(run('capture',c.a,c.b).stdout,readFileSync(c.expected,'utf8'));assert.equal(readFileSync(join(c.locks,name+'.lock','owner'),'utf8'),'another-run\n');
});
test('busy kernel guard blocks installation even with no owner directory',()=>{
 const c=setup();snapshot(c);
 const code=`import fcntl,subprocess,sys\nf=open(sys.argv[1],'r+');fcntl.flock(f,fcntl.LOCK_EX)\nr=subprocess.run(sys.argv[2:],capture_output=True,text=True);print(r.stderr);sys.exit(r.returncode)`;
 const r=spawnSync('python3',['-c',code,join(c.locks,'SER2.guard'),'python3',script,'install',join(c.source,'douyin-phone-adb'),join(c.source,'text-input-focus.py'),c.expected,c.registry,c.locks,c.a,c.b],{encoding:'utf8'});
 assert.equal(r.status,2);assert.match(r.stdout,/kernel device guard is busy/);assert.equal(run('capture',c.a,c.b).stdout,readFileSync(c.expected,'utf8'));
});
test('missing registry safety proof refuses install rather than trusting a null Brain owner',()=>{
 const c=setup();snapshot(c);writeFileSync(c.registry,'');const r=install(c);assert.equal(r.status,2);assert.match(r.stderr,/safety is unknown/);
});
test('all four kernel guard descriptors stay held during pair install, blocking a new acquire race',()=>{
 const code=`import importlib.util,pathlib,sys,fcntl\ns=importlib.util.spec_from_file_location('guard',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nwith m.device_barrier(sys.argv[2],sys.argv[3]) as check:\n for serial in m.registry_serials(sys.argv[2]):\n  f=open(pathlib.Path(sys.argv[3])/(serial+'.guard'),'r+')\n  try: fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\n  except BlockingIOError: pass\n  else: raise AssertionError('guard unexpectedly free')\n check()\n`;
 const c=setup();const r=spawnSync('python3',['-c',code,script,c.registry,c.locks],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});
test('missing kernel guard is unknown and cannot be invented during installation',()=>{
 const c=setup();snapshot(c);unlinkSync(join(c.locks,'SER4.guard'));const r=install(c);assert.equal(r.status,2);assert.match(r.stderr,/No such file/);assert.equal(run('capture',c.a,c.b).stdout,readFileSync(c.expected,'utf8'));
});
test('registry change while holding guards invalidates the barrier',()=>{
 const c=setup();const code=`import importlib.util,pathlib,sys\ns=importlib.util.spec_from_file_location('guard',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\ntry:\n with m.device_barrier(sys.argv[2],sys.argv[3]) as check:\n  p=pathlib.Path(sys.argv[2]);p.write_text(p.read_text()+'new\\tSER5\\tm\\n');check()\nexcept ValueError as e: assert 'registry changed' in str(e)\nelse: raise AssertionError('registry race accepted')\n`;
 const r=spawnSync('python3',['-c',code,script,c.registry,c.locks],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});
for(const mode of ['source-change','staging-race','partial-replace-failure'])test('input pair installer preserves explicit failure boundary: '+mode,()=>{
 const c=setup();snapshot(c);
 const code=`import importlib.util,pathlib,sys,json\ns=importlib.util.spec_from_file_location('guard',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\ncontroller,helper,expected,registry,locks,a,b=sys.argv[3:]\nmode=sys.argv[2]\nif mode=='source-change':\n original=m.source_info\n def changed(*args):\n  p=pathlib.Path(controller);p.write_text(p.read_text()+'\\n# changed source bytes\\n');return original(*args)\n m.source_info=changed\nelif mode=='staging-race':\n original=m.capture;calls=[0]\n def changed(*args):\n  calls[0]+=1\n  if calls[0]==2: (pathlib.Path(b)/'douyin-phone-adb').write_text('# another writer\\n')\n  return original(*args)\n m.capture=changed\nelse:\n original=m.os.replace;calls=[0]\n def broken(*args):\n  calls[0]+=1\n  if calls[0]==2: raise OSError('injected second-file replace failure')\n  return original(*args)\n m.os.replace=broken\ntry: m.install(controller,helper,expected,registry,locks,[a,b])\nexcept (ValueError,OSError) as e:\n assert ('source changed' if mode=='source-change' else 'CAS mismatch after staging' if mode=='staging-race' else 'second-file replace failure') in str(e),str(e)\nelse: raise AssertionError('installer reported success despite failure')\nif mode=='partial-replace-failure':\n assert (pathlib.Path(a)/'text-input-focus.py').exists()\n assert not (pathlib.Path(a)/'douyin-phone-adb').exists()\nelse:\n assert not (pathlib.Path(a)/'text-input-focus.py').exists()\n assert not (pathlib.Path(a)/'douyin-phone-adb').exists()\nassert not list(pathlib.Path(a).glob('*.deploy-*'))\n`;
 const r=spawnSync('python3',['-c',code,script,mode,join(c.source,'douyin-phone-adb'),join(c.source,'text-input-focus.py'),c.expected,c.registry,c.locks,c.a,c.b],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});

test('real four-profile v2 registry header format resolves every kernel serial (account columns omitted)',()=>{
 const code=`import importlib.util,sys,json\ns=importlib.util.spec_from_file_location('guard',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps(m.registry_serials(sys.argv[2])))`;
 const r=spawnSync('python3',['-c',code,script,join(service,'__tests__/fixtures/input-runtime-real-registry-sanitized.tsv')],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),['ANGYVB4227006983','ANGYVB4311010223','ANGYVB4402004137','e6c7ef34']);
});
test('atomic registry replacement immediately after parse cannot bind old serials to a new hash',()=>{
 const c=setup();const code=`import importlib.util,pathlib,sys,os\ns=importlib.util.spec_from_file_location('guard',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nregistry=pathlib.Path(sys.argv[2]);original=m.registry_serials\ndef replace_after_parse(*args):\n serials=original(*args)\n replacement=registry.with_suffix('.new');replacement.write_bytes(registry.read_bytes()+b'new\\tSER5\\tm\\n');os.replace(replacement,registry)\n (pathlib.Path(sys.argv[3])/'SER5.guard').write_text('')\n return serials\nm.registry_serials=replace_after_parse\ntry:\n with m.device_barrier(registry,sys.argv[3]): pass\nexcept ValueError as e: assert 'registry changed' in str(e),str(e)\nelse: raise AssertionError('accepted old serials with replacement registry hash; SER5 was never guarded')\n`;
 const r=spawnSync('python3',['-c',code,script,c.registry,c.locks],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});

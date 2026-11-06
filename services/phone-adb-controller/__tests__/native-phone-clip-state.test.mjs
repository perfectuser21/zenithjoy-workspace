import test from 'node:test';import assert from 'node:assert/strict';
const implementation=await import('../native-phone-clip-state.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
test('原跨run clip nonce基线需要持久Code缓存入口',()=>assert.equal(typeof implementation.createNativePhoneClipState,'function'));
import {mkdtempSync,rmSync,realpathSync,mkdirSync,writeFileSync,readFileSync,lstatSync,chmodSync,symlinkSync,renameSync,readdirSync,linkSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const url='https://v.douyin.com/FixtureABC/',other='https://www.douyin.com/video/7617105883093603314';
function fixture(t){const home=realpathSync(mkdtempSync(join(tmpdir(),'native-clip-state-')));t.after(()=>rmSync(home,{recursive:true,force:true}));const directory=join(home,'.config','openclaw','locate-cache'),file=join(directory,'fixture-last-clip.txt');let guards=0,guard;const create=(profile='fixture')=>implementation.createNativePhoneClipState({home,profile,assertResources:async()=>{guards++;await guard?.(guards);}});return {home,directory,file,create,guards:()=>guards,onGuard:fn=>guard=fn,legacy:(text,mode=0o644)=>{mkdirSync(directory,{recursive:true,mode:0o700});writeFileSync(file,text,{mode});}};}
test('原路径真实跨实例保留上次link、不同profile隔离，并保留旧644读取',async t=>{
 const r=fixture(t),first=r.create();assert.equal(await first.read(),'');await first.write(url);assert.equal(await first.read(),url);assert.equal(readFileSync(r.file,'utf8'),url+'\n');assert.equal(lstatSync(r.file).mode&0o777,0o600);assert.equal(await r.create().read(),url);assert.equal(await r.create('other').read(),'');assert.equal(r.guards(),10);
 const legacy=fixture(t);legacy.legacy(other+'\n');assert.equal(lstatSync(legacy.file).mode&0o777,0o644);const reader=legacy.create();assert.equal(await reader.read(),other);await reader.write(url);assert.equal(lstatSync(legacy.file).mode&0o777,0o600);assert.equal(await legacy.create().read(),url);
});
test('原0字节或无文件返回空；非空脏文本保守触发nonce、不洗成首次',async t=>{
 const r=fixture(t);r.legacy('');assert.equal(await r.create().read(),'');writeFileSync(r.file,'\n');assert.notEqual(await r.create().read(),'');writeFileSync(r.file,'old unreadable legacy target\n');assert.equal(await r.create().read(),'old unreadable legacy target');
});
test('无资源guard授权不读写；guard后发生状态漂移会保持unknown禁止后续无nonce',async t=>{
 const r=fixture(t);r.legacy(url+'\n');let lost=true;r.onGuard(()=>{if(lost)throw Error('RESOURCE_LOST');});const state=r.create();await assert.rejects(state.read(),/RESOURCE_LOST/);lost=false;await assert.rejects(state.read(),/UNKNOWN/);assert.equal(state.snapshot().unknown,true);
 const raced=fixture(t);raced.legacy(url+'\n');raced.onGuard(count=>{if(count===2)writeFileSync(raced.file,other+'\n');});const instance=raced.create();await assert.rejects(instance.read(),/STATE_DRIFT/);await assert.rejects(instance.write(url),/UNKNOWN/);
});
test('同实例旧inode或内容被改变拒绝；不会覆盖其他run的新状态',async t=>{
 const r=fixture(t);r.legacy(url+'\n');const state=r.create();await state.read();const replace=join(r.directory,'replacement');writeFileSync(replace,other+'\n',{mode:0o600});renameSync(replace,r.file);await assert.rejects(state.write(url),/STATE_DRIFT/);assert.equal(readFileSync(r.file,'utf8'),other+'\n');await assert.rejects(state.read(),/UNKNOWN/);
 const absent=fixture(t),old=absent.create();await old.read();await absent.create().write(other);await assert.rejects(old.write(url),/STATE_DRIFT/);assert.equal(await absent.create().read(),other);
});
test('HOME/目录软链、foreign owner及可写他人目录不作为安全cache',async t=>{
 const r=fixture(t),alias=join(r.home,'alias');symlinkSync(r.home,alias);const linked=implementation.createNativePhoneClipState({home:alias,profile:'fixture',assertResources:async()=>{}});await assert.rejects(linked.read(),/DIRECTORY/);
 const foreign=implementation.createNativePhoneClipState({home:realpathSync(tmpdir()),profile:'fixture',assertResources:async()=>{}});if(lstatSync(realpathSync(tmpdir())).uid!==process.getuid())await assert.rejects(foreign.read(),/DIRECTORY/);
 const bad=fixture(t);bad.legacy(url);chmodSync(bad.directory,0o777);await assert.rejects(bad.create().read(),/DIRECTORY/);
 const chain=fixture(t);mkdirSync(join(chain.home,'else'),{mode:0o700});symlinkSync(join(chain.home,'else'),join(chain.home,'.config'));await assert.rejects(chain.create().write(url),/DIRECTORY/);assert.deepEqual(readdirSync(join(chain.home,'else')),[]);
});
test('cache软链、硬链、超过4KB或他人可写文件拒读且不返回空基线',async t=>{
 for(const kind of ['symlink','hardlink','oversize','world-write']){const r=fixture(t);r.legacy(url+'\n');if(kind==='symlink'){renameSync(r.file,r.file+'.target');symlinkSync(r.file+'.target',r.file);}if(kind==='hardlink')linkSync(r.file,r.file+'.alias');if(kind==='oversize')writeFileSync(r.file,Buffer.alloc(4097));if(kind==='world-write')chmodSync(r.file,0o666);const state=r.create();await assert.rejects(state.read(),/FILE|LIMIT/);assert.equal(state.snapshot().unknown,true);await assert.rejects(state.read(),/UNKNOWN/);}
});
test('写入后资源guard失败保unknown，即使磁盘已有URL也不得降级为空',async t=>{
 const r=fixture(t);r.onGuard(count=>{if(count===2)throw Error('OWNER_LOST_AFTER_WRITE');});const state=r.create();await assert.rejects(state.write(url),/OWNER_LOST_AFTER_WRITE/);assert.equal(readFileSync(r.file,'utf8'),url+'\n');assert.equal(state.snapshot().unknown,true);await assert.rejects(state.read(),/UNKNOWN/);await assert.rejects(state.write(other),/UNKNOWN/);assert.equal(readFileSync(r.file,'utf8'),url+'\n');
});
test('URL严格约束且没有Worker JSON入口；非法值不触碰guard或磁盘',async t=>{
 const r=fixture(t),state=r.create();for(const invalid of [{shared_url:url},'http://v.douyin.com/x/','https://v.douyin.com.evil/x/','https://user@v.douyin.com/x/','https://v.douyin.com:443/x/','https://v.douyin.com/x/\n','https://v.douyin.com/\\x/','file:///etc/passwd'])await assert.rejects(state.write(invalid),/URL/);assert.equal(r.guards(),0);assert.throws(()=>lstatSync(r.directory),/ENOENT/);assert.equal(state.snapshot().unknown,false);
});
test('同实例并发资源guard尚未返回时不能绕过读写串行权',async t=>{
 const r=fixture(t);let release,arrived;const held=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>arrived=resolve);r.onGuard(async count=>{if(count===1){arrived();await held;}});const state=r.create(),reading=state.read();await ready;await assert.rejects(state.write(url),/BUSY/);release();assert.equal(await reading,'');assert.equal(state.snapshot().pending,0);
});
test('原子写后被替换的实际bytes必须识别为unknown，不回滚或自报成功',async t=>{
 const r=fixture(t);r.onGuard(count=>{if(count===2)writeFileSync(r.file,other+'\n');});const state=r.create();await assert.rejects(state.write(url),/WRITE_UNVERIFIED/);assert.equal(state.snapshot().writes,0);assert.equal(state.snapshot().unknown,true);assert.equal(readFileSync(r.file,'utf8'),other+'\n');await assert.rejects(state.read(),/UNKNOWN/);
});
test('同实例已绑定cache目录被移走后不创建新空目录伪首次',async t=>{
 const r=fixture(t);r.legacy(url+'\n');const state=r.create();await state.read();renameSync(r.directory,r.directory+'.old');await assert.rejects(state.read(),/DIRECTORY_DRIFT/);assert.throws(()=>lstatSync(r.directory),/ENOENT/);await assert.rejects(state.write(other),/UNKNOWN/);assert.equal(readFileSync(join(r.directory+'.old','fixture-last-clip.txt'),'utf8'),url+'\n');
});
test('资源guard显式false也必须拒绝，刚好4KB旧文件可有限读回',async t=>{
 const r=fixture(t);r.legacy('x'.repeat(4096));assert.equal((await r.create().read()).length,4096);const state=implementation.createNativePhoneClipState({home:r.home,profile:'fixture',assertResources:async()=>false});await assert.rejects(state.read(),/RESOURCES/);assert.equal(state.snapshot().unknown,true);
});
test('前次写未决私有temp跨实例拒绝，不得当作无缓存首次且不影响其他profile',async t=>{
 const r=fixture(t);mkdirSync(r.directory,{recursive:true,mode:0o700});const pending=join(r.directory,'.fixture-last-clip.11111111-1111-4111-8111-111111111111.tmp');writeFileSync(pending,url+'\n',{mode:0o600});const next=r.create();await assert.rejects(next.read(),/PENDING/);assert.equal(next.snapshot().unknown,true);await assert.rejects(r.create().write(other),/PENDING/);assert.equal(readFileSync(pending,'utf8'),url+'\n');assert.throws(()=>lstatSync(r.file),/ENOENT/);assert.equal(await r.create('other').read(),'');
});

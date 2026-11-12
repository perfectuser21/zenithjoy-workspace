import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable,Readable} from 'node:stream';
import {randomBytes} from 'node:crypto';
import {brotliCompressSync} from 'node:zlib';
import {phonePeerEnvelope,verifyPhonePeerEnvelope} from '../official-phone-peer-protocol.mjs';
import {createFixedPhonePeerTransport,freezePhonePeerSsh} from '../official-phone-peer-transport.mjs';
import {runPhonePeerStdio} from '../official-phone-peer-host.mjs';
import * as wire from '../official-phone-peer-wire.mjs';
const key='local-regression-authentication-material-only';
const max=16*1024*1024;
const signed=()=>phonePeerEnvelope({protocol:'official-phone-peer-bootstrap/v1',padding:'中文证据'.repeat(700000)},key);
const wrap=raw=>({protocol:'official-phone-peer-wire/v1',encoding:'br',raw_length:Buffer.byteLength(raw),payload_base64:brotliCompressSync(Buffer.from(raw)).toString('base64')});
const hostOptions={environment:{KERNEL_FLEET_BRIDGE_TOKEN:key,BRAIN_URL:'https://invalid.test',BRAIN_INTERNAL_TOKEN:'fixture'}};
test('大签名bootstrap经正式transport在受限stdin预算内到达正式Host的原授权边界',async()=>{
 const frame=signed(),child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
 const input=new PassThrough();let bytes=0;
 const running=runPhonePeerStdio({...hostOptions,input,output:new PassThrough()}).catch(error=>{child.stdout.write(JSON.stringify({error:error.message})+'\n');});
 child.stdin=new Writable({write(chunk,encoding,done){bytes+=chunk.length;if(bytes>256*1024)return done(Error('wire budget exhausted'));input.end(chunk);done();},final(done){child.emit('close',0,null);done();}});
 const source='a'.repeat(40),transport=createFixedPhonePeerTransport({descriptor:{host:'xian-m4',runtime_root:`/Users/jinnuoshengyuan/.local/share/zenithjoy/phone-candidates/${source}/runtime`,deployment:{source_commit:source}},deadline_ms:Date.now()+10000,ssh:freezePhonePeerSsh(),spawnProcess:()=>child});
 assert.deepEqual(await transport.exchange(frame),{error:'OFFICIAL_PHONE_PEER_AUTHORITY'});
 await running;assert.ok(bytes<256*1024);assert.deepEqual(verifyPhonePeerEnvelope(wire.decodePhonePeerBootstrap(JSON.parse(wire.encodePhonePeerBootstrap(frame))),key),frame.message);
 await transport.close();
});
test('小plain和大bootstrap逐字节无损，签名仍是内层认证',async()=>{
 const small=phonePeerEnvelope({protocol:'official-phone-peer-bootstrap/v1'},key);assert.equal(wire.encodePhonePeerBootstrap(small),JSON.stringify(small));
 const frame=signed(),encoded=wire.encodePhonePeerBootstrap(frame);assert.equal(JSON.stringify(wire.decodePhonePeerBootstrap(JSON.parse(encoded))),JSON.stringify(frame));
 const damaged=structuredClone(frame);damaged.signature='0'.repeat(64);
 await assert.rejects(()=>runPhonePeerStdio({...hostOptions,input:Readable.from([JSON.stringify(wrap(JSON.stringify(damaged)))+'\n']),output:new PassThrough()}),/SIGNATURE/);
 assert.equal(wire.encodePhonePeerBootstrap({message:{protocol:'official-phone-peer-operation/v1',padding:'x'.repeat(100000)}}).includes('payload_base64'),false);
});
test('无压缩收益保留原有效plain，wire不能携带后续RPC',()=>{
 const frame=phonePeerEnvelope({protocol:'official-phone-peer-bootstrap/v1',padding:randomBytes(100000).toString('base64')},key);
 assert.equal(wire.encodePhonePeerBootstrap(frame),JSON.stringify(frame));
 assert.throws(()=>wire.decodePhonePeerBootstrap(wrap(JSON.stringify(phonePeerEnvelope({protocol:'official-phone-peer-operation/v1'},key)))));
});
test('正式Host在无换行帧超过上限时立即拒绝',async()=>{
 const input=new PassThrough(),running=runPhonePeerStdio({...hostOptions,input,output:new PassThrough()});
 const rejection=assert.rejects(running,/FRAME/);input.write(Buffer.alloc(max+1));await rejection;assert.equal(input.destroyed,true);
});
test('严格wire外壳、base64、长度、解压上限与nested拒绝',()=>{
 const good=wrap(JSON.stringify(signed()));
 for(const bad of [{...good,extra:1},{...good,encoding:'gzip'},{...good,protocol:'unknown'},{...good,raw_length:good.raw_length+1},{...good,payload_base64:'!!!'},{...good,payload_base64:good.payload_base64+'='},wrap(JSON.stringify(good)),{...wrap('x'.repeat(max+1)),raw_length:max}])assert.throws(()=>wire.decodePhonePeerBootstrap(bad));
 assert.throws(()=>wire.encodePhonePeerBootstrap(phonePeerEnvelope({protocol:'official-phone-peer-bootstrap/v1',padding:'x'.repeat(max)},key)));
});
test('按输入累计限制无换行超限，排队多行逐帧消费，UTF8跨chunk保真',async()=>{
 const read=wire.readPhonePeerLines;
 await assert.rejects(async()=>{for await(const line of read(Readable.from([Buffer.alloc(max),Buffer.from('x')]))){assert.fail(line);}},/FRAME/);
 for await(const line of read(Readable.from([Buffer.alloc(max,120),Buffer.from('\r'),Buffer.from('\n')]))){assert.equal(Buffer.byteLength(line),max);}
 const chunks=Buffer.from('中文\r\n\n尾帧');const result=[];
 for await(const line of read(Readable.from([...chunks].map(byte=>Buffer.from([byte])))))result.push(line);
 assert.deepEqual(result,['中文','','尾帧']);
 const queued=Readable.from([Buffer.from(('x'.repeat(1024)+'\n').repeat(18000))]);let count=0;for await(const line of read(queued)){assert.equal(line.length,1024);count++;}assert.equal(count,18000);
 const invalid=Readable.from([Buffer.from('{}\n'),Buffer.alloc(max+1)]);const iter=read(invalid);assert.equal((await iter.next()).value,'{}');await assert.rejects(iter.next(),/FRAME/);
});
test('编码耗时计入原deadline，失败不留下pending或写stdin',async t=>{
 const source='a'.repeat(40),child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();let writes=0;child.stdin=new Writable({write(c,e,d){writes++;d();},final(d){child.emit('close',0,null);d();}});
 const end=Date.now()+5000,transport=createFixedPhonePeerTransport({descriptor:{host:'xian-m4',runtime_root:`/Users/jinnuoshengyuan/.local/share/zenithjoy/phone-candidates/${source}/runtime`,deployment:{source_commit:source}},deadline_ms:end,ssh:freezePhonePeerSsh(),spawnProcess:()=>child});
 const cyclic={};cyclic.self=cyclic;await assert.rejects(transport.exchange(cyclic));assert.equal(transport.snapshot().pending,false);assert.equal(writes,0);
 const frame=phonePeerEnvelope({protocol:'official-phone-peer-bootstrap/v1'},key);frame.toJSON=()=>{t.mock.method(Date,'now',()=>end);return {message:{protocol:'official-phone-peer-bootstrap/v1'}};};
 await assert.rejects(transport.exchange(frame),/STATE|DEADLINE/);assert.equal(writes,0);assert.equal(transport.snapshot().pending,false);await transport.close();
});

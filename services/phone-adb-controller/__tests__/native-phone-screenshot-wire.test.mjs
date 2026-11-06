import test from 'node:test';import assert from 'node:assert/strict';
import {createShellV2Decoder} from '../adb-shell-v2-protocol.mjs';
const frame=(id,data)=>{const h=Buffer.alloc(5);h[0]=id;h.writeUInt32LE(data.length,1);return Buffer.concat([h,data]);};
function feed(decoder,size){for(let n=0;n<size;n+=65536)decoder.push(frame(1,Buffer.alloc(Math.min(65536,size-n),17)));decoder.push(frame(3,Buffer.from([0])));return decoder.finish();}
test('finite screenshot decoder preserves original 12MiB evidence allowance while ordinary commands keep 2MiB',()=>{
 assert.throws(()=>feed(createShellV2Decoder(),3*1024*1024),/ADB_SHELL_V2_PROTOCOL/);
 const image=feed(createShellV2Decoder({maxBytes:13*1024*1024}),12*1024*1024);assert.equal(image.stdout.length,12*1024*1024);assert.equal(image.exit_code,0);
 for(const value of [0,1.5,14*1024*1024,Infinity])assert.throws(()=>createShellV2Decoder({maxBytes:value}),/ADB_SHELL_V2_PROTOCOL/);
});

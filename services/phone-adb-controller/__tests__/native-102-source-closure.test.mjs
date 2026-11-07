import {pathToFileURL} from 'node:url';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {usingNative102PublicSource} from './fixtures/native-102-public-source-fixture.mjs';
test('native 102 Source cannot omit the Code history leaf before dynamically importing its composition',async t=>usingNative102PublicSource(t,async f=>{
 const native=await import(pathToFileURL(join(f.runtimeRoot,'native-phone-runtime.mjs'))),frozen=structuredClone(f.definition.frozen),name='native-collection-history-proof.mjs';
 frozen.files['runtime/'+name]=createHash('sha256').update(readFileSync(join(f.runtimeRoot,name))).digest('hex');
 assert.ok(native.nativePhoneSource(frozen).files.some(row=>row.path===name));
 delete frozen.files['runtime/'+name];assert.throws(()=>native.nativePhoneSource(frozen),/NATIVE_PHONE_SOURCE/);assert.equal(f.outerCalls(),0);
}));

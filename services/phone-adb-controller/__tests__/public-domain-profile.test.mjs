import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
const source=new URL('../public-domain-profile.mjs',import.meta.url);
test('public profile builder exists as a product entry rather than handwritten runtime configuration',async()=>{
 assert.ok(existsSync(source),'release/frozen public profile builder missing');
 const module=await import(source.href);assert.equal(typeof module.buildPublicDomainProfile,'function');
});
test('profile builder rejects missing original deployment and formal identities',async()=>{
 assert.ok(existsSync(source),'release/frozen public profile builder missing');
 const {buildPublicDomainProfile}=await import(source.href);
 assert.throws(()=>buildPublicDomainProfile({}),/PUBLIC_DOMAIN_PROFILE_/);
});

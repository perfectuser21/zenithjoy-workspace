import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';
const forbidden=['checker.mjs','cleanup-result.mjs','production-readback-local.mjs','native-readback.mjs','native_artifacts.py','outreach104/checker104.mjs','outreach104/preserved-checker.mjs','outreach104/native-checker.py','outreach104/native-checker.mjs'];
for(const id of ['101','102','103','104'])test('current '+id+' archive does not ship legacy business adjudicators',()=>{
 const doc=JSON.parse(fs.readFileSync(new URL('../leadgen-foundation/sources/'+id+'.json',import.meta.url)));
 for(const name of forbidden)assert.equal(doc.files[name],undefined,name);
 for(const [name,item]of Object.entries(doc.files))assert.doesNotMatch(item.source,/function evaluateNative|def risk\(ns\)|def bubbles\(ns,msg\)/,name);
});

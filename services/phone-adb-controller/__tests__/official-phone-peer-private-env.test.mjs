import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,chmodSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readPhonePeerPrivateEnvironment} from '../official-phone-peer-private-env.mjs';
test('M4私有供给只读固定600文件，不执行shell且拒绝ambient/local Brain路线',t=>{
 const home=realpathSync(mkdtempSync(join(tmpdir(),'peer-private-')));t.after(()=>rmSync(home,{recursive:true,force:true}));mkdirSync(join(home,'.credentials'),{mode:0o700});const path=join(home,'.credentials','official-phone-peer.env');
 const valid="BRAIN_URL='https://brain.example.test/'\nBRAIN_INTERNAL_TOKEN='unit-only'\nKERNEL_FLEET_BRIDGE_TOKEN='unit-fleet-material-at-least-32-characters'\n";
 assert.throws(()=>readPhonePeerPrivateEnvironment(home));writeFileSync(path,valid,{mode:0o600});assert.equal(readPhonePeerPrivateEnvironment(home).BRAIN_URL,'https://brain.example.test/');chmodSync(path,0o644);assert.throws(()=>readPhonePeerPrivateEnvironment(home));chmodSync(path,0o600);
 for(const value of [valid.replace('https://brain.example.test/','http://localhost:5221/'),valid+"NODE_OPTIONS='--eval=unsafe'\n",valid.replace('unit-only','$(echo nope)'),valid+"BRAIN_URL='https://other.example.test/'\n"]){writeFileSync(path,value);assert.throws(()=>readPhonePeerPrivateEnvironment(home));}
});

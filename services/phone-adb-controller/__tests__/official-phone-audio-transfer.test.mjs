import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createOfficialPhoneAudioTransfer} from '../official-phone-audio-transfer.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
test('资格transfer只接受M4真实冻结的原MMV控制路线，JSON不能提供自由scp入口',()=>{
 for(const route of [undefined,{ssh_bin:'/tmp/ssh',user:'administrator',port:22,hostname:'1.2.3.4',hostkey_alias:'1.2.3.4'},{ssh_bin:'/usr/bin/ssh',user:'root',port:22,hostname:'1.2.3.4',hostkey_alias:'1.2.3.4'},{ssh_bin:'/usr/bin/ssh',user:'administrator',port:2222,hostname:'1.2.3.4',hostkey_alias:'1.2.3.4'},{ssh_bin:'/usr/bin/ssh',user:'administrator',port:22,hostname:'localhost;echo unsafe',hostkey_alias:'1.2.3.4'}])assert.throws(()=>createOfficialPhoneAudioTransfer({root,env:{},frozen:{preflight_control_scope:{ssh:route}},descriptor:{},scope:()=>({}),assertAuthority:async()=>true}),/TRANSFER_UNKNOWN/);
});

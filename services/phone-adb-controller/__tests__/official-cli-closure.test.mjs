import test from 'node:test';
import assert from 'node:assert/strict';
import {execInput} from '../leadgen-client.mjs';
import * as client from '../leadgen-client.mjs';
const outer=(...a)=>{assert.equal(typeof client.executionOuterReturned,'function','CLI closure needs a live outer-close capability');return client.executionOuterReturned(...a);};
test('only the actual execInput close brands its exact immutable invocation',async()=>{const args=['-c','printf closed'],result=await execInput('/bin/sh',args,{env:{PATH:'/usr/bin:/bin'}});assert.equal(outer(result,'/bin/sh',args),true);assert.equal(outer({...result},'/bin/sh',args),false);assert.equal(outer(result,'/bin/sh',['-c','printf different']),false);assert.equal(outer(result,'/usr/bin/true',args),false);args[1]='changed';assert.equal(outer(result,'/bin/sh',args),false);});
test('execInput timeout and serialized exit zero cannot grant outer return authority',async()=>{const args=['-c','sleep 5'];let error;try{await execInput('/bin/sh',args,{timeoutMs:30,env:{PATH:'/usr/bin:/bin'}});}catch(e){error=e;}assert.ok(error);assert.equal(outer(error,'/bin/sh',args),false);assert.equal(outer({code:0,executionStopped:true},'/bin/sh',args),false);});

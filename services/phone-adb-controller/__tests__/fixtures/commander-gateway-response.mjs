import assert from 'node:assert/strict';
// Unit fixtures follow the real Gateway request nonce; deliberately conflicting
// terminal identities remain conflicting instead of being repaired by the fixture.
export function gatewayFixture(body,args){
 assert.deepEqual(args.slice(0,3),['gateway','call','agent']);
 const request=JSON.parse(args[args.indexOf('--params')+1]);
 assert.equal(request.modelRun,true);assert.equal(request.agentId,'work-commander');
 const copy=structuredClone(body),originalRun=copy.runId;
 copy.runId=request.idempotencyKey;copy.summary??='completed';
 const terminal=copy.result?.meta?.agentMeta?.terminalReceipt;
 if(terminal&&terminal.runId===originalRun)terminal.runId=copy.runId;
 return JSON.stringify(copy);
}
export function gatewayOwner(args){
 return args[0]==='gateway'?JSON.parse(args[args.indexOf('--params')+1]).sessionKey:args[args.indexOf('--session-key')+1];
}

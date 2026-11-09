import fs from 'node:fs';import assert from 'node:assert/strict';import {join} from 'node:path';
import {setup,cleanupSetupFailure} from './setup.mjs';import {prepareDiagnosticRecovery} from './diagnostic-recovery.mjs';import {digest} from '../../../device-epoch-fence-reference.mjs';
const artifact=join(process.env.TEST_PRIVATE_SESSION_ARTIFACT_DIR||'/tmp/private-session-recovery-dev','diagnostic-'+Date.now()+'-'+process.pid);let r;
try{
 r=await setup('diagnostic-recovery-positive');console.error('diagnostic native fixture setup');
 const p=await prepareDiagnosticRecovery(r);console.error('diagnostic native recovery apply');
 const result=await p.main.applyResumePlan({planPath:p.path},p.applyDeps);
 assert.equal(result.status,'fenced');assert.equal(result.original_execution_stopped,false);assert.equal(r.counts().releaseCalls,1);assert.equal(r.counts().signalCalls,p.baselineSignals);
 assert.equal(r.events().split('\n').filter(x=>x.includes('daemon-private-start')).length,3);assert.equal(r.events().split('\n').filter(x=>x.includes('host:connect:')).length,2);
 for(const [path,hash]of Object.entries(p.historyHashes))assert.equal(digest(fs.readFileSync(path)),hash,'historical bytes remain unchanged');
 assert.equal(fs.existsSync(join(p.plan.execution_directory,'stop-intent.json')),false);assert.equal(fs.existsSync(r.quarantine),false);
 console.log(JSON.stringify({scenario:'diagnostic-terminal-recovery-positive',status:result.status,actual_main:true,field_actions:0,original_execution_stopped:false,recovery_stop_signals:0,recovery_start_calls:1,recovery_connect_calls:1,source_commit:p.source.commit}));
}catch(error){console.error(error.stack);if(r){console.error('fixture root',r.root);console.error(r.events());}process.exitCode=1;}
finally{if(r){fs.mkdirSync(artifact,{recursive:true,mode:0o700});for(const name of ['resume-execution','continuation-execution','diagnostic-recovery-execution','resume-plan','continuation-plan','diagnostic-recovery-plan','ops','diagnostic-terminal.json']){const path=join(r.root,name);if(fs.existsSync(path))fs.cpSync(path,join(artifact,name),{recursive:true});}fs.writeFileSync(join(artifact,'adb-events.log'),r.events());console.error('diagnostic artifact',artifact);await r.close();}else await cleanupSetupFailure();}

const fs=require('node:fs'),path=require('node:path'),a=process.argv.slice(2),home=process.env.CASE_HOME,mode=process.env.CASE_MODE;
fs.appendFileSync(path.join(home,'calls.jsonl'),JSON.stringify(a)+'\n');
let p;try{p=JSON.parse(a[a.indexOf('--params')+1]);}catch{}
const proper=a[0]==='gateway'&&a[1]==='call'&&a[2]==='agent'&&a.includes('--expect-final')&&p?.modelRun===true;
if(mode==='signal'){process.kill(process.pid,'SIGTERM');}
else{
 const c=JSON.parse(fs.readFileSync(path.join(home,'contract.json')));
 if(proper){c.final.runId=p.idempotencyKey;c.final.result.meta.agentMeta.terminalReceipt.runId=p.idempotencyKey;}
 if(mode==='accepted')process.stdout.write(JSON.stringify(c.accepted));
 else if(mode==='timeout')process.stdout.write(JSON.stringify(c.timeout));
 else if(mode==='invalid')process.stdout.write('{not-json');
 else if(mode==='exit'){process.stderr.write('sensitive-sentinel raw args environment should never appear');process.exitCode=23;}
 else if(mode==='foreign-consistent'){c.final.runId='foreign-run';c.final.result.meta.agentMeta.terminalReceipt.runId='foreign-run';process.stdout.write(JSON.stringify(c.final));}
 else if(mode==='wrong-run'){c.final.runId='foreign-run';process.stdout.write(JSON.stringify(c.final));}
 else if(mode==='wrong-session'){c.final.result.meta.agentMeta.sessionId='foreign-session';process.stdout.write(JSON.stringify(c.final));}
 else if(!proper){process.stderr.write('MODEL_ONLY_NOT_REQUESTED');process.exitCode=2;}
 else process.stdout.write(JSON.stringify(c.final));
}

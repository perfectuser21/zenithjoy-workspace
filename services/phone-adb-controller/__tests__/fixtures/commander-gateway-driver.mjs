import {readFileSync,readdirSync}from'node:fs';
import{join}from'node:path';
const {openClawCommander,assertWorkflowOwnerAvailable,workflowCommanderSession}=await import(process.argv[2]);
const scope=JSON.parse(process.argv[3]),home=process.env.CASE_HOME,outputs=[];let error;
const commander=openClawCommander({home,...(process.env.CASE_MODEL?{model:process.env.CASE_MODEL}:{})});
for(let i=0;i<Number(process.argv[4]);i++)try{outputs.push(await commander({...scope,phase:i?'before':'after'}));}
catch(e){error={message:e.message,executionStopped:e.executionStopped,diagnostic:e.commanderDiagnostic};break;}
let available=true;try{assertWorkflowOwnerAvailable(scope,{home});}catch{available=false}
const calls=readFileSync(join(home,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
const directory=join(home,'.openclaw/leadgen-owner-turns'),diagnostics=readdirSync(directory).filter(n=>n.endsWith('.diagnostic.json')).map(n=>({name:n,value:JSON.parse(readFileSync(join(directory,n),'utf8'))}));
process.stdout.write(JSON.stringify({outputs,error,available,calls,owner:workflowCommanderSession(scope),diagnostics}));

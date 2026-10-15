// Public single Activity tool. Structured stdin; no shell, Workflow restart or SQL.
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {createConnection} from 'node:net';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export async function callActivityTool(path,op,body={}) {
 const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o777)!==0o600)throw Error('SKILL_REQUEST_NOT_PRIVATE');
 const r=JSON.parse(readFileSync(path,'utf8'));
 if(r.protocol!=='leadgen-activity-v1'||!/^\/[^\0\r\n]+\.sock$/.test(r.socket||''))throw Error('SKILL_REQUEST_INVALID');
 const q={...body,op,nonce:r.nonce,run_id:r.run_id,activity_key:r.activity_key};
 return new Promise((yes,no)=>{const c=createConnection(r.socket);let text='';
  c.setTimeout(Math.max(1,r.deadline_ms-Date.now()),()=>c.destroy(Error('SKILL_TOOL_TIMEOUT')));
  c.on('connect',()=>c.end(JSON.stringify(q)));c.on('data',data=>{text+=data;if(text.length>1024*1024)c.destroy(Error('SKILL_TOOL_OUTPUT_LIMIT'));});
  c.on('error',no);c.on('end',()=>{try{const out=JSON.parse(text);if(out.ok!==true)throw Error(out.error||'SKILL_TOOL_FAILED');yes(out);}catch(error){no(error);}});
 });
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [path,op]=process.argv.slice(2);const body=process.stdin.isTTY||op!=='phone'?{}:JSON.parse(readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(await callActivityTool(path,op,body))+'\n');}
 catch(error){process.stderr.write(String(error.message).slice(0,300)+'\n');process.exitCode=1;}
}

import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const c=JSON.parse(readFileSync(process.env.CANDIDATE_TRANSPORT_CONFIG)),args=process.argv.slice(2),host=args.at(-2),command=args.at(-1);
const presence=command.includes("' presence "),install=command.includes("' install ");
const input=readFileSync(0),home=join(c.top,'remote-'+host);mkdirSync(home,{recursive:true});
const archive=input.length>10000,collect=command.includes('deployment-manifest.mjs" collect'),manifest=command.includes('deployment-manifest.json.tmp');
appendFileSync(join(c.top,'transport.jsonl'),JSON.stringify({host,args,input_bytes:input.length,input_sha256:createHash('sha256').update(input).digest('hex'),archive,collect,manifest})+'\n');
const final=join(home,'.local/share/zenithjoy/phone-candidates',c.sha),lost=join(c.top,'lost-once');
if(presence&&c.mode==='bad-json'){process.stdout.write('{truncated');process.exit(0);}
if(presence&&c.mode==='unknown'){console.error('fixture permission/transport unknown');process.exit(75);}
if(install&&c.mode==='late-final'){mkdirSync(final,{recursive:true});writeFileSync(join(final,'foreign-writer'),'preserve');}
if(install&&c.mode==='late-pending')mkdirSync(join(home,'.local/share/zenithjoy/phone-candidates','.'+c.sha+'.late-writer'),{recursive:true});
if(collect&&c.mode==='late-drift')writeFileSync(join(final,'runtime/transport-payload.bin'),'drift after presence');
if(archive&&existsSync(final)&&c.mode==='recover'){console.error('fixture repeated archive transport unavailable');process.exit(75);}
const out=spawnSync('/bin/bash',['-c',command],{input,env:{...process.env,HOME:home},maxBuffer:8*1024*1024,timeout:15000});
if(out.status===0&&archive&&host==='xian-m4'&&c.mode==='lose-once'&&!existsSync(lost)){
 writeFileSync(lost,'committed-before-disconnect');console.error('fixture transport lost after remote commit');process.exit(75);
}
if(out.status===0&&collect){const value=JSON.parse(out.stdout);value.observed_hostname=host==='mmv'?'aad17-2.macminivault.com':'mac-mini-m4-xian';process.stdout.write(JSON.stringify(value));}
else {process.stdout.write(out.stdout||'');process.stderr.write(out.stderr||'');}
process.exit(out.status??1);

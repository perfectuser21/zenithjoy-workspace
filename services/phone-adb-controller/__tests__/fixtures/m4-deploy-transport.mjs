import {appendFileSync,copyFileSync,mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join,resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
const self=fileURLToPath(import.meta.url);
export function prepareTransport(root){
 const home=join(root,'remote');mkdirSync(join(home,'bin-harvest'),{recursive:true});mkdirSync(join(root,'bin'));
 for(const name of ['ssh','scp'])writeFileSync(join(root,'bin',name),`#!/bin/sh\nexec '${process.execPath}' '${self}' '${root}' '${name}' "$@"\n`,{mode:0o755});
 return {home,env:{...process.env,HOME:home,PATH:join(root,'bin')+':'+process.env.PATH}};
}
if(process.argv[1]&&resolve(process.argv[1])===self){
 const [root,kind,...args]=process.argv.slice(2),home=join(root,'remote');
 appendFileSync(join(root,'transport.jsonl'),JSON.stringify({kind,args})+'\n');
 try{
  if(kind==='scp'){
   const target=args.at(-1);if(!target.startsWith('xian-m4:'))throw Error('fixture rejects another host');
   const dest=target.slice('xian-m4:'.length).replace(/^~\//,home+'/');
   for(const source of args.slice(0,-1).filter(x=>!x.startsWith('-'))){
    const to=dest.endsWith('/')?join(dest,basename(source)):dest;copyFileSync(source,to);
   }
  }else{
   if(args[0]!=='xian-m4')throw Error('fixture rejects another host');
   let command=args[1].replaceAll('/opt/homebrew/bin/node',process.execPath)
    .replaceAll('/opt/homebrew/bin/python3','python3').replaceAll('/tmp/m4-payload-deploy.',root+'/m4-payload-deploy.');
   const r=spawnSync('bash',['-c',command],{encoding:'utf8',env:{...process.env,HOME:home}});
   process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exitCode=r.status??2;
  }
 }catch(error){process.stderr.write(error.message+'\n');process.exitCode=2;}
}

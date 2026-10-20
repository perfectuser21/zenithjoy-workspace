import {appendFileSync,copyFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join,resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
const self=fileURLToPath(import.meta.url);
export function prepareTransport(root){
 const home=join(root,'remote');mkdirSync(join(home,'bin-harvest'),{recursive:true});mkdirSync(join(root,'bin'),{recursive:true});
 for(const name of ['ssh','scp'])writeFileSync(join(root,'bin',name),`#!/bin/sh\nexec '${process.execPath}' '${self}' '${root}' '${name}' "$@"\n`,{mode:0o755});
 return {home,env:{...process.env,HOME:home,PATH:join(root,'bin')+':'+process.env.PATH}};
}
if(process.argv[1]&&resolve(process.argv[1])===self){
 const [root,kind,...args]=process.argv.slice(2),home=join(root,'remote');
 appendFileSync(join(root,'transport.jsonl'),JSON.stringify({kind,args})+'\n');
 try{
  if(kind==='scp'){
   if(process.env.FIXTURE_FAIL==='scp')process.exit(74);
   const target=args.at(-1);if(!target.startsWith('xian-m4:'))throw Error('fixture rejects another host');
   const dest=target.slice('xian-m4:'.length).replace(/^~\//,home+'/');
   for(const source of args.slice(0,-1).filter(x=>!x.startsWith('-'))){
    const to=dest.endsWith('/')?join(dest,basename(source)):dest;copyFileSync(source,to);
   }
  }else{
   if(args[0]!=='xian-m4')throw Error('fixture rejects another host');
   let command=args[1].replaceAll('/opt/homebrew/bin/node',process.execPath)
    .replaceAll('/opt/homebrew/bin/python3','python3').replaceAll('/tmp/m4-payload-deploy.',root+'/m4-payload-deploy.');
   if(process.env.FIXTURE_FAIL==='mkdir'&&command.startsWith('mktemp -d '))process.exit(72);
   // The SSH fixture maps the Mac-only interpreter location to this test host.
   // The staged production Python bytes execute unchanged, including real syntax subprocesses.
   const install=command.match(/^python3 (\S+\/deployment-m4-payload\.py) install (\S+) ([a-f0-9]{64}) (before|after) ([01])$/);
   const provider=`import os,runpy,subprocess,sys\noriginal=subprocess.run;node=sys.argv[1]\ndef run(args,*a,**k):\n if isinstance(args,list) and args[0]=='/opt/homebrew/bin/node':args=[node,*args[1:]]\n return original(args,*a,**k)\nsubprocess.run=run\nif os.environ.get('FIXTURE_FAIL')=='mv':\n def refuse(*a,**k):raise OSError('fixture atomic replace refused')\n os.replace=refuse\nscript=sys.argv[2];sys.argv=[script,*sys.argv[3:]]\nrunpy.run_path(script,run_name='__main__')\n`;
   const r=install?spawnSync('python3',['-c',provider,process.execPath,install[1],'install',...install.slice(2)],{encoding:'utf8',env:{...process.env,HOME:home}})
    :spawnSync('bash',['-c',command],{encoding:'utf8',env:{...process.env,HOME:home}});
   process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exitCode=r.status??2;
  }
 }catch(error){process.stderr.write(error.message+'\n');process.exitCode=2;}
}

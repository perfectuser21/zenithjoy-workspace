import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const target=join(root,'services/phone-adb-controller/common-runner');
const args=process.argv.slice(2),check=args.includes('--check');
const value=key=>args[args.indexOf(key)+1];
const source=args.includes('--source')?resolve(value('--source')):null;
const working=args.includes('--working-tree');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
if(check&&!source){
 const manifest=JSON.parse(readFileSync(join(target,'source.json'),'utf8'));
 if(manifest.repository!=='perfectuser21/cecelia'||!/^[a-f0-9]{40}$/.test(manifest.revision))throw Error('公共Runner来源未固定');
 const actual=readdirSync(target).filter(f=>f!=='source.json').sort();
 if(JSON.stringify(actual)!==JSON.stringify(Object.keys(manifest.files).sort()))throw Error('公共Runner依赖闭包不一致');
 for(const [file,expected]of Object.entries(manifest.files))if(sha(readFileSync(join(target,file)))!==expected)throw Error('公共Runner字节漂移: '+file);
 console.log('公共Runner固定来源与字节校验通过');
}else{
 if(!source)throw Error('需要 --source <cecelia checkout>');
 const revision=working?'working-tree':execFileSync('git',['-C',source,'rev-parse',args.includes('--revision')?value('--revision'):'HEAD'],{encoding:'utf8'}).trim();
 const sourcePath='packages/brain/src/orchestrator/';
 const read=file=>working?readFileSync(join(source,sourcePath,file)):execFileSync('git',['-C',source,'show',revision+':'+sourcePath+file]);
 const pending=['activity-runtime.js','runner-commander-bridge.js'],files={'package.json':Buffer.from('{"type":"module"}\n')};
 while(pending.length){const file=pending.pop();if(Object.hasOwn(files,file))continue;const bytes=read(file);files[file]=bytes;for(const match of bytes.toString().matchAll(/(?:from\s+|import\s*\()\s*['"]\.\/([^'"]+)['"]/g)){if(match[1].includes('/'))throw Error('公共Runner依赖越界');pending.push(match[1]);}}
 const manifest={repository:'perfectuser21/cecelia',revision,source_path:sourcePath,files:Object.fromEntries(Object.keys(files).sort().map(file=>[file,sha(files[file])]))};
 if(check){if(JSON.stringify(JSON.parse(readFileSync(join(target,'source.json'),'utf8')))!==JSON.stringify(manifest))throw Error('公共Runner来源清单漂移');for(const [file,bytes]of Object.entries(files))if(!readFileSync(join(target,file)).equals(bytes))throw Error('公共Runner来源字节漂移: '+file);}
 else{mkdirSync(target,{recursive:true});for(const [file,bytes]of Object.entries(files))writeFileSync(join(target,file),bytes);writeFileSync(join(target,'source.json'),JSON.stringify(manifest,null,2)+'\n');}
 console.log(check?'公共Runner与固定源一致':'已同步公共Runner依赖闭包');
}

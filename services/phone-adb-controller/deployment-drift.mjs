import {execFileSync} from 'node:child_process';
export function runDriftCheck(file,args,env){
 const output=execFileSync(file,args,{env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000,maxBuffer:8*1024*1024});
 if(!output.includes('DRIFT_CHECK OK'))throw Error('固定SHA drift-check缺真实成功回执');
 return output;
}

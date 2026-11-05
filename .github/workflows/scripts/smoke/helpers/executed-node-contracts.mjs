#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
export function runNodeContracts(files,{vmModules=false}={}){
 if(!files.length)throw Error('executed Node contract files are required');
 const expected=files.map(file=>realpathSync(file)),folder=mkdtempSync(path.join(tmpdir(),'executed-node-'));
 const report=path.join(folder,'report.json'),env={...process.env};delete env.NODE_TEST_CONTEXT;
 for(const key of Object.keys(env))if(/API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY/i.test(key))delete env[key];
 try{
  const reporter=fileURLToPath(new URL('./executed-node-reporter.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[...(vmModules?['--experimental-vm-modules']:[]),'--test','--test-reporter=tap','--test-reporter='+reporter,'--test-reporter-destination=stdout','--test-reporter-destination='+report,...expected],{env,encoding:'utf8',timeout:300000,maxBuffer:16*1024*1024});
  process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');
  if(result.error||result.signal||result.status!==0)throw Error('executed Node contract child failed');
  const data=JSON.parse(readFileSync(report,'utf8'));
  if(!Array.isArray(data.events)||data.events.some(e=>!e.passed||e.skipped||e.todo))throw Error('executed Node contracts contain failure/skip/todo');
  const named=data.events.filter(e=>e.file&&e.type!=='suite'&&path.resolve(e.name)!==path.resolve(e.file));
  for(const file of expected)if(!named.some(e=>realpathSync(e.file)===file))throw Error('executed Node contract missing named assertions: '+file);
  console.log(`executed Node contracts: files=${expected.length} tests=${named.length} skipped=0`);
  return {files:expected.length,tests:named.length};
 }finally{rmSync(folder,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const files=process.argv.slice(2),vmModules=files[0]==='--vm-modules';if(vmModules)files.shift();runNodeContracts(files,{vmModules});
}

#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import YAML from 'yaml';

try {
  let tier='pr', path='regression-contract.yaml';
  const args=process.argv.slice(2);
  while(args.length){
    const option=args.shift();
    if(!['--tier','--contract'].includes(option)||!args.length||args[0].startsWith('--'))throw Error(`Invalid argument: ${option}`);
    const value=args.shift();if(option==='--tier')tier=value;else path=value;
  }
  if(!['pr','release'].includes(tier))throw Error(`Invalid tier: ${tier}`);
  const contract=YAML.parse(readFileSync(path,'utf8'));
  if(!Array.isArray(contract?.golden_paths))throw Error('golden_paths must be an array');
  const ids=new Set();
  for(const entry of contract.golden_paths){
    if(typeof entry?.id!=='string'||!entry.id.trim()||ids.has(entry.id))throw Error('Missing or duplicate regression id');
    ids.add(entry.id);
    if(!Array.isArray(entry.trigger)||!entry.trigger.length||entry.trigger.some(t=>!['PR','Release'].includes(t)))throw Error(`Invalid trigger: ${entry.id}`);
    if(typeof entry.test_command!=='string'||!entry.test_command.trim())throw Error(`Missing executable command: ${entry.id}`);
  }
  const gate=tier==='pr'?'PR':'Release';
  const selected=contract.golden_paths.filter(entry=>entry.trigger.includes(gate));
  if(!selected.length)throw Error(`No regression selected for ${gate}`);
  let failed=false;
  for(const entry of selected){
    console.log(`=== [${entry.id}] ${entry.test_command} ===`);
    const result=spawnSync('bash',['--noprofile','--norc','-e','-o','pipefail','-c',entry.test_command],{stdio:'inherit'});
    if(result.error||result.status!==0){console.error(`FAIL: ${entry.id} (${result.error?.message||result.signal||result.status})`);failed=true;}
  }
  console.log(`=== core-regression ${failed?'FAIL':'PASS'} (tier=${tier}, offline regressions; not deployment acceptance) ===`);
  if(failed)process.exitCode=1;
} catch(error){console.error(`Core regression FAILED: ${error.message}`);process.exitCode=1;}

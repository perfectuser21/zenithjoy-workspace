#!/usr/bin/env node
import {readFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {verifyReport} from './media-contracts.mjs';
const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const results=JSON.parse(readFileSync(path.join(root,'docs/ci/round3-business-results.json'),'utf8'));
const paths=[...new Set(results.units.flatMap(u=>u.canonical_test_paths))];
const groups={api:'apps/api',dashboard:'apps/dashboard',staff:'apps/staff-hub',voice:'apps/api'};
const requested=process.argv.slice(2);if(!requested.length)requested.push('api','dashboard','staff');
const temp=mkdtempSync('/tmp/zj-business-unit-');
try{
 for(const group of requested){
  const cwd=groups[group];if(!cwd)throw new Error('Unknown business contract group: '+group);
  const files=group==='voice'?['src/routes/voice-outreach.test.ts']:paths.filter(p=>p.startsWith(cwd+'/')&&!p.includes('/tests/integration/')&&p!=='apps/api/src/routes/company-profile-scratch.test.ts'&&/\.test\.(ts|tsx)$/.test(p)).map(p=>p.slice(cwd.length+1));
  if(!files.length)throw new Error('Empty business contract group: '+group);
  for(const file of files)if(!existsSync(path.join(root,cwd,file)))throw new Error('Missing business contract: '+file);
  const local=path.join(root,cwd,'node_modules/vitest/vitest.mjs'),binary=existsSync(local)?local:path.join(root,'node_modules/vitest/vitest.mjs');
  const output=path.join(temp,group+'.json');const env={...process.env};for(const key of Object.keys(env))if(/(API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY)/i.test(key))delete env[key];
  const result=spawnSync(process.execPath,[binary,'run',...files,'--reporter=json','--outputFile='+output],{cwd:path.join(root,cwd),env,stdio:'inherit'});
  if(result.status!==0)throw new Error(`Business ${group} exited ${result.status}`);
  const report=JSON.parse(readFileSync(output,'utf8'));verifyReport(report,files);
  console.log(`business ${group}: executed files=${files.length} tests=${report.numPassedTests}, skipped=0`);
 }
}finally{rmSync(temp,{recursive:true,force:true});}

#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
node --test "$ROOT/services/phone-adb-controller/__tests__/company-config.test.mjs"
node --test "$ROOT/apps/api/scripts/company-wiki-import.test.mjs" "$ROOT/apps/api/scripts/company-projection-adapters.test.mjs" "$ROOT/services/phone-adb-controller/company-config-sync.test.js"
cd "$ROOT"
node --input-type=module <<'JS'
import {spawnSync} from 'node:child_process';
let scratch=process.env.COMPANY_CONFIG_SCRATCH_URL;
if(!scratch && process.env.GITHUB_ACTIONS==='true') {
  if(!process.env.DATABASE_URL)throw Error('CI缺Postgres连接');
  const {default:pg}=await import('pg');
  const client=new pg.Client({connectionString:process.env.DATABASE_URL});
  await client.connect();
  try {
    if(!(await client.query("SELECT 1 FROM pg_database WHERE datname='cecelia_scratch'")).rowCount)await client.query('CREATE DATABASE cecelia_scratch');
  } finally {await client.end();}
  const url=new URL(process.env.DATABASE_URL);url.pathname='/cecelia_scratch';scratch=url.toString();
}
if(scratch) {
 const result=spawnSync(process.execPath,['--test','services/phone-adb-controller/__tests__/company-config-postgres.test.mjs'],{stdio:'inherit',env:{...process.env,COMPANY_CONFIG_SCRATCH_URL:scratch}});
 if(result.status!==0)throw Error('公司配置Postgres集成验收失败');
 const api=spawnSync('npm',['test','--workspace','@zenithjoy/api','--','--run','src/routes/company-profile-scratch.test.ts'],{stdio:'inherit',env:{...process.env,COMPANY_CONFIG_SCRATCH_URL:scratch}});
 if(api.status!==0)throw Error('公司Wiki真实API/Postgres闭环失败');
} else console.log('本次为本地单元检查；真实Postgres需COMPANY_CONFIG_SCRATCH_URL（CI强制执行）');
JS

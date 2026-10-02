#!/usr/bin/env node
// 只读本地前置检查：不连PG，不请求网络，不输出任何凭据值。
import {createRequire} from 'node:module';
import {lstatSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire as requireFactory} from 'node:module';
const require=requireFactory(import.meta.url);
export function preflight({directory,envFile,lineKey}) {
 const {validateExecution}=require('./gateway-context.js');
 validateExecution({gateway:{host:'preflight',cwd:resolve(directory),node:process.execPath,env_file:envFile}});
 const stat=lstatSync(envFile);if(!stat.isFile()||(stat.mode&0o7777)!==0o600)throw Error('credentials_mirror_permissions');
 const values={};
 for(const row of readFileSync(envFile,'utf8').split(/\r?\n/)){
  if(!row.trim()||row.trim().startsWith('#'))continue;
  const match=/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=(.*)$/.exec(row);
  if(!match)throw Error('credentials_mirror_invalid');
  const value=match[2].trim(),quoted=/^'([^']*)'$/.exec(value)||/^"([^"\\]*)"$/.exec(value);
  if(quoted)values[match[1]]=quoted[1];else if(/^[^\s'"`$;\\]+$/.test(value))values[match[1]]=value;else throw Error('credentials_mirror_invalid');
 }
 const expected=require(join(resolve(directory),'line-routes.js')).routeOf(lineKey).account;
 if(values.FEISHU_ACCOUNT!==expected)throw Error('account_mismatch');
 const required=['FEISHU_APP_ID','FEISHU_APP_SECRET','OPENROUTER_API_KEY',...(values.DATABASE_URL?['DATABASE_URL']:['PGHOST','PGUSER','PGPASSWORD','PGDATABASE'])];
 if(required.some(key=>!values[key]))throw Error('credentials_missing_keys');
 const frozenRequire=createRequire(join(resolve(directory),'leadgen-db-connect.js'));
 const pg=frozenRequire('pg');if(typeof pg.Pool!=='function')throw Error('pg_dependency_invalid');
 return {status:'ready',node:process.execPath,cwd:resolve(directory),credentials_mode:'0600',account_matches:true,required_keys_present:true,pg_loadable:true};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [directory,envFile,lineKey]=process.argv.slice(2);process.stdout.write(JSON.stringify(preflight({directory,envFile,lineKey}))+'\n');}
 catch(error){process.stderr.write(error.code==='MODULE_NOT_FOUND'?'pg_dependency_missing\n':error.message+'\n');process.exitCode=1;}
}

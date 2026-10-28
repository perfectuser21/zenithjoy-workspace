import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,writeFileSync,chmodSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const api=await import('../qualification-maintenance-database.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
const need=()=>assert.equal(typeof api?.createBoundMaintenanceDatabase,'function','缺少每次借连接前核真实数据库身份的适配器');
function credentials(t,text) {
 const home=mkdtempSync(join(tmpdir(),'maintenance-database-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const dir=join(home,'.credentials');mkdirSync(dir,{mode:0o700});const file=join(dir,'zenithjoy-db.env');
 writeFileSync(file,text,{mode:0o600});return {home,file};
}
test('标准凭据显式解析，不取开发会话PG变量；文件权限/重复/歧义拒绝',t=>{
 assert.equal(typeof api?.readMaintenanceDatabaseConfig,'function');
 const f=credentials(t,"PGHOST=127.0.0.1\nPGPORT=5432\nPGUSER=fixture\nPGPASSWORD='fixture-password'\nPGDATABASE=zenithjoy\n");
 const original=process.env.PGHOST;process.env.PGHOST='unrelated-host';
 try{const c=api.readMaintenanceDatabaseConfig(f.home);assert.equal(c.host,'127.0.0.1');assert.equal(c.database,'zenithjoy');assert.equal(c.port,5432);assert.equal(c.ssl,false);assert.equal(c.password,'fixture-password');}
 finally{if(original===undefined)delete process.env.PGHOST;else process.env.PGHOST=original;}
 chmodSync(f.file,0o644);assert.throws(()=>api.readMaintenanceDatabaseConfig(f.home),/MAINTENANCE_DATABASE_/);chmodSync(f.file,0o600);
 writeFileSync(f.file,'PGHOST=one\nPGHOST=two\n');assert.throws(()=>api.readMaintenanceDatabaseConfig(f.home),/MAINTENANCE_DATABASE_/);
 writeFileSync(f.file,'DATABASE_URL=postgres://fixture:password@127.0.0.1/zenithjoy\nPGHOST=other\n');assert.throws(()=>api.readMaintenanceDatabaseConfig(f.home),/MAINTENANCE_DATABASE_/);
 rmSync(f.file);symlinkSync('/dev/null',f.file);assert.throws(()=>api.readMaintenanceDatabaseConfig(f.home),/MAINTENANCE_DATABASE_/);
});
test('URL凭据须完整指定身份，不让URL查询参数换目的端或库',t=>{
 assert.equal(typeof api?.readMaintenanceDatabaseConfig,'function');
 const f=credentials(t,'DATABASE_URL=postgres://fixture:encoded%40password@127.0.0.1:5432/zenithjoy\n');
 const c=api.readMaintenanceDatabaseConfig(f.home);assert.equal(c.user,'fixture');assert.equal(c.password,'encoded@password');assert.equal(c.host,'127.0.0.1');
 for(const value of ['postgres://fixture@127.0.0.1/zenithjoy','postgres://fixture:password@127.0.0.1/other','postgres://fixture:password@127.0.0.1/zenithjoy?host=other']) {
  writeFileSync(f.file,'DATABASE_URL='+value+'\n');assert.throws(()=>api.readMaintenanceDatabaseConfig(f.home),/MAINTENANCE_DATABASE_/);
 }
});
test('公开入口不接受scratch或调用者自传连接配置',async()=>{
 assert.equal(typeof api?.openMaintenanceDatabase,'function');
 await assert.rejects(api.openMaintenanceDatabase({scope:{original_evidence:{database_identity:{database:'cecelia_scratch'}}}}),/MAINTENANCE_DATABASE_/);
});
test('真实scratch：每次pool query借同backend核身份，事务不插入检查破坏ROLLBACK',
 {skip:process.env.ZJ_METRICS_PG_REQUIRED!=='1'},async t=>{
 const require=createRequire(import.meta.url),{Pool}=require('pg');
 const connection={host:process.env.PGHOST||'127.0.0.1',port:Number(process.env.PGPORT||5432),user:process.env.PGUSER||process.env.USER,
  password:process.env.PGPASSWORD||'local-scratch-fixture',database:process.env.PGDATABASE||'cecelia_scratch',ssl:false};
 const control=new Pool({...connection,max:1,connectionTimeoutMillis:2000});t.after(()=>control.end());
 const actual=(await control.query('SELECT current_database() AS database,current_user AS role,host(inet_server_addr()) AS server_addr,inet_server_port() AS server_port')).rows[0];
 assert.ok(['cecelia_scratch','zenithjoy_metrics_scratch'].includes(actual.database),'测试禁止连接非scratch库');
 need();const opened=[];t.after(async()=>{for(const db of opened)await db.close();});
 class ClientOnlyPool extends Pool {query(){throw Error('禁止未经绑定的raw pool.query');}}
 const open=async(expected=actual)=>{const db=await api.createBoundMaintenanceDatabase({Pool:ClientOnlyPool,connection,expected});opened.push(db);return db;};
 await t.test('真实identity回执与业务SELECT是同一backend，查询格式原样交给pg',async()=>{
  const db=await open();assert.ok(db.identity_receipts.length>=1);
  const r=await db.pool.query({text:'SELECT pg_backend_pid() AS backend_pid,42 AS answer'});
  assert.equal(r.rows[0].answer,42);assert.equal(r.rows[0].backend_pid,db.identity_receipts.at(-1).backend_pid);
  assert.equal(db.identity_receipts.at(-1).database,actual.database);
 });
 for(const [key,value]of [['database','different_database'],['role','different_role'],['server_addr','192.0.2.1'],['server_port',6543]]) {
  await t.test(key+'不符实际身份时，在交出连接前拒绝',async()=>{
   await assert.rejects(open({...actual,[key]:value}),/MAINTENANCE_DATABASE_/);
  });
 }
 await t.test('checkout后真实SET ROLE漂移不能污染下一次pool.query',async()=>{
  const db=await open(),c=await db.pool.connect(),old=c.processID;
  await c.query('SET ROLE pg_monitor');c.release();
  await assert.rejects(db.pool.query('SELECT 1 AS forbidden_unchecked_query'),/MAINTENANCE_DATABASE_/);
  const next=await db.pool.query('SELECT pg_backend_pid() AS backend_pid,current_user AS actor');
  assert.equal(next.rows[0].actor,actual.role);assert.notEqual(next.rows[0].backend_pid,old,'身份不符的连接必须销毁');
 });
 await t.test('事务报错后ROLLBACK可执行，release(true)保持真实连接销毁语义',async()=>{
  const db=await open(),c=await db.pool.connect(),old=c.processID;
  await c.query('BEGIN');await assert.rejects(c.query('SELECT 1/0'),e=>e.code==='22012');
  await c.query('ROLLBACK');assert.equal((await c.query('SELECT 7 AS n')).rows[0].n,7);c.release(true);
  const next=await db.pool.query('SELECT pg_backend_pid() AS backend_pid');assert.notEqual(next.rows[0].backend_pid,old);
 });
});

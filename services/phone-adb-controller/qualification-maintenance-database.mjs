import {openSync,closeSync,lstatSync,fstatSync,readFileSync,constants} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {isIP} from 'node:net';
import {createRequire} from 'node:module';
import {digest} from './runtime-definition.mjs';
const fail=()=>Error('MAINTENANCE_DATABASE_IDENTITY_UNPROVEN');
const need=value=>{if(!value)throw fail();};
const identitySql='SELECT current_database() AS database,current_user AS role,host(inet_server_addr()) AS server_addr,inet_server_port() AS server_port,pg_backend_pid() AS backend_pid';
const configKeys=new Set(['DATABASE_URL','PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE']);
function text(value){return typeof value==='string'&&value.length>0&&!value.includes('\0');}
function address(value) {
 need(text(value));const [ip,mask,...extra]=value.split('/'),version=isIP(ip);
 need(version&&extra.length===0&&(mask===undefined||mask===(version===4?'32':'128')));
 return version===6?new URL('http://['+ip+']/').hostname.slice(1,-1):ip;
}
function expectedIdentity(value) {
 need(value&&Object.keys(value).sort().join(',')==='database,role,server_addr,server_port'
  &&text(value.database)&&text(value.role)&&Number.isSafeInteger(value.server_port)&&value.server_port>0&&value.server_port<65536);
 return {...value,server_addr:address(value.server_addr)};
}
export function readMaintenanceDatabaseConfig(home=homedir()) {
 try {
  const directory=join(home,'.credentials'),ds=lstatSync(directory);
  need(ds.isDirectory()&&!ds.isSymbolicLink()&&ds.uid===process.getuid());
  const file=join(directory,'zenithjoy-db.env'),before=lstatSync(file);
  need(before.isFile()&&!before.isSymbolicLink()&&before.uid===process.getuid()&&(before.mode&0o777)===0o600&&before.size<=65536);
  const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);let raw;
  try{const a=fstatSync(fd);need(a.dev===before.dev&&a.ino===before.ino);raw=readFileSync(fd);const b=fstatSync(fd);
   need(raw.length<=65536&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ino===b.ino);
  }finally{closeSync(fd);}
  const values={};
  for(const line of raw.toString('utf8').split(/\r?\n/)) {
   const m=line.match(/^(?:export )?([A-Z_]+)=(.*)$/);if(!m||!configKeys.has(m[1]))continue;
   need(!Object.hasOwn(values,m[1]));values[m[1]]=m[2].trim().replace(/^(['"])(.*)\1$/,'$2');
  }
  let connection;
  if(values.DATABASE_URL) {
   need(Object.keys(values).length===1);const u=new URL(values.DATABASE_URL);
   need(['postgres:','postgresql:'].includes(u.protocol)&&u.pathname==='/zenithjoy'&&!u.hash
    &&u.hostname&&u.username&&u.password&&[...u.searchParams.keys()].every(k=>k==='sslmode'));
   const sslmode=u.searchParams.get('sslmode')||'disable';need(['disable','require','verify-ca','verify-full'].includes(sslmode));
   connection={host:u.hostname.replace(/^\[|\]$/g,''),port:Number(u.port||5432),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:'zenithjoy',ssl:sslmode==='disable'?false:{rejectUnauthorized:true}};
  }else connection={host:values.PGHOST,port:Number(values.PGPORT||5432),user:values.PGUSER,password:values.PGPASSWORD,database:values.PGDATABASE||'zenithjoy',ssl:false};
  need(text(connection.host)&&text(connection.user)&&text(connection.password)&&connection.database==='zenithjoy'
   &&Number.isSafeInteger(connection.port)&&connection.port>0&&connection.port<65536);
  return connection;
 }catch{throw fail();}
}
// 内部工厂供真实scratch验证。公开入口不接受连接或身份替身参数。
export async function createBoundMaintenanceDatabase({Pool,connection,expected}) {
 let rawPool;
 try {
  const bound=expectedIdentity(expected);
  need(typeof Pool==='function'&&connection&&text(connection.host)&&text(connection.user)&&text(connection.password)
   &&text(connection.database)&&Number.isSafeInteger(connection.port)&&connection.port>0&&connection.port<65536);
  rawPool=new Pool({host:connection.host,port:connection.port,user:connection.user,password:connection.password,
   database:connection.database,ssl:connection.ssl??false,options:'-c application_name=qualification-maintenance',
   application_name:'qualification-maintenance',fallback_application_name:'qualification-maintenance',
   max:2,connectionTimeoutMillis:5000,query_timeout:10000});
  let ended=false,poisoned=false,ending;const identity_receipts=[];
  rawPool.on('error',()=>{poisoned=true;});
  const acquire=async()=>{
   need(!ended&&!poisoned);let client;
   try {
    client=await rawPool.connect();
    const rows=(await client.query(identitySql)).rows,r=rows[0];
    need(rows.length===1&&r.database===bound.database&&r.role===bound.role&&address(r.server_addr)===bound.server_addr
     &&r.server_port===bound.server_port&&Number.isSafeInteger(r.backend_pid)&&r.backend_pid>1&&client.processID===r.backend_pid);
    identity_receipts.push({...r,observed_at_ms:Date.now()});return client;
   }catch{if(client)client.release(true);throw fail();}
  };
  const close=()=>{ended=true;return ending??=rawPool.end();};
  const pool={connect:acquire,query:async(...args)=>{
   const client=await acquire();try{return await client.query(...args);}finally{client.release();}
  },end:close};
  // 初始身份也必须已证，不能先向调用者返回一个尚未验证的池。
  const client=await acquire();client.release();return {pool,identity_receipts,close};
 }catch{if(rawPool)await rawPool.end().catch(()=>{});throw fail();}
}
export async function openMaintenanceDatabase(authority) {
 try {
  const s=authority?.scope,expected=s?.original_evidence?.database_identity;
  need(s&&authority.contract_sha256===digest(s)&&authority.original_task_id===s.original_task_id&&expected?.database==='zenithjoy');
  expectedIdentity(expected);const connection=readMaintenanceDatabaseConfig();let Pool;
  for(const base of [join(homedir(),'.openclaw/leadgen-scripts/package.json'),join(homedir(),'.openclaw/package.json'),import.meta.url]) {
   try{Pool=createRequire(base)('pg').Pool;break;}catch{}
  }
  need(Pool);return await createBoundMaintenanceDatabase({Pool,connection,expected});
 }catch{throw fail();}
}

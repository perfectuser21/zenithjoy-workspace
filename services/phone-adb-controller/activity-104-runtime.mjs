// Read-only local observation. Absence is unknown, never a fabricated zero.
import fs from 'node:fs';import path from 'node:path';
import {asset,need,canonical,verify104Context} from './activity-104-context.mjs';
const day=n=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date(n));
function directory(p){try{const s=fs.lstatSync(p);return s.isDirectory()&&!s.isSymbolicLink()&&fs.realpathSync(p)===path.resolve(p);}catch{return false;}}
function text(p){const s=fs.lstatSync(p);need(s.isFile()&&!s.isSymbolicLink(),'SOURCE_PATH');return fs.readFileSync(p,'utf8');}
export function observe104Runtime(c,{now=Date.now(),orders=[]}={}){
 verify104Context(c);const cfg=c.outreach_runtime,date=day(now),tag=date.replaceAll('-','');
 const r={observed_at:new Date(now).toISOString(),host:c.host,profile:c.profile,serial:c.serial,adb_serial:c.adb_serial,date,pause:false,halt:false,today_dm_attempts:0,current_run_dm_attempts:0,unparsed_ledger_rows:0,legacy_daily_count_file_exists:false,legacy_daily_count:null,state_directory_exists:directory(cfg.state_directory),ledger_base_exists:directory(cfg.evidence_base),profile_ledger_directory_exists:directory(path.join(cfg.evidence_base,c.profile)),account_day_coverage_complete:true,missing_sources:[]};
 if(!r.state_directory_exists)r.missing_sources.push('state_directory');if(!r.ledger_base_exists||!r.profile_ledger_directory_exists)r.missing_sources.push('ledger_directory');
 const history=cfg.history_assets.map(a=>JSON.parse(asset(a))),seen=new Set();
 for(const b of cfg.account_bindings){
  if(b.host===c.host&&b.profile===c.profile&&b.serial===c.adb_serial)continue;
  const key=canonical(b),matches=history.filter(x=>x.host===b.host&&x.profile===b.profile&&x.serial===b.serial&&x.sender_id===c.sender_id);
  const x=matches[0],age=x?now-Date.parse(x.observed_at):Infinity;
  if(seen.has(key)||matches.length!==1||!Number.isFinite(age)||typeof x.pause!=='boolean'||typeof x.halt!=='boolean'||age< -5000||age>120000||x.date!==date||x.complete!==true||!Number.isSafeInteger(x.today_dm_attempts)||x.today_dm_attempts<0||x.unparsed_ledger_rows!==0||x.unresolved_attempts!==0){r.account_day_coverage_complete=false;r.missing_sources.push('account_history:'+key);continue;}
  seen.add(key);r.today_dm_attempts+=x.today_dm_attempts;r.pause ||= x.pause===true;r.halt ||= x.halt===true;
 }
 if(r.state_directory_exists){
  r.pause ||= fs.existsSync(path.join(cfg.state_directory,'dm-paused-'+c.profile+'.flag'));r.halt ||= fs.existsSync(path.join(cfg.state_directory,'dm-halt-'+c.profile+'-'+tag+'.txt'));
  const p=path.join(cfg.state_directory,'dm-count-'+c.profile+'-'+tag+'.txt');r.legacy_daily_count_file_exists=fs.existsSync(p);if(r.legacy_daily_count_file_exists){const raw=text(p).trim();r.legacy_daily_count=/^\d+$/.test(raw)?Number(raw):null;if(!Number.isSafeInteger(r.legacy_daily_count))r.missing_sources.push('legacy_count');}
 }
 let localAttempts=0;
 if(r.ledger_base_exists)for(const d of fs.readdirSync(cfg.evidence_base,{withFileTypes:true})){
  if(d.isSymbolicLink()){r.missing_sources.push('ledger_symlink');continue;}if(!d.isDirectory())continue;
  for(const n of fs.readdirSync(path.join(cfg.evidence_base,d.name)).filter(n=>n.endsWith('-outward-ledger.jsonl'))){
   for(const line of text(path.join(cfg.evidence_base,d.name,n)).split('\n').filter(Boolean)){
    let e;try{e=JSON.parse(line);}catch{r.unparsed_ledger_rows++;continue;}
    if(e.profile!==c.profile&&e.serial!==c.adb_serial)continue;if(e.action!=='dm'||e.event!=='attempt')continue;
    if(e.profile!==c.profile||e.serial!==c.adb_serial||!Number.isFinite(e.at_epoch_ms)){r.unparsed_ledger_rows++;continue;}
    if(e.run_id===c.local_owner)r.current_run_dm_attempts++;if(day(e.at_epoch_ms)===date)localAttempts++;
   }
  }
 }
 r.today_dm_attempts+=Math.max(localAttempts,r.legacy_daily_count??0);
 const lock=path.join(cfg.lock_root,c.adb_serial+'.lock','owner');r.local_owner=directory(cfg.lock_root)&&fs.existsSync(lock)?text(lock).trim():null;
 need(Array.isArray(orders),'CONTEXT_ORDERS');
 const field=v=>Array.isArray(v)?v.map(x=>x.text||'').join(''):(v?.name??String(v??''));
 const profileNames=new Set(cfg.account_bindings.map(b=>b.profile)),task=c.tasks['104'];
 const sameSender=v=>v===c.sender_id||v.includes('('+c.sender_id+')')||profileNames.has(v);
 const ownSuffix=':'+task.run_tag+':'+(c.marker_source||c.source_commit)+']';
 r.unresolved_attempt_reservations=orders.filter(o=>{
  const mark=field(o.fields?.['回复结果']);
  if(!sameSender(field(o.fields?.['实际分发号']))||!/^\[104 (?:prepared|unknown):/.test(mark))return false;
  return !(o.record_id===c.verification['104'].record_id&&['prepared','unknown'].some(k=>mark.startsWith('[104 '+k+ownSuffix)));
 }).length;
 if(r.unresolved_attempt_reservations){r.today_dm_attempts+=r.unresolved_attempt_reservations;r.missing_sources.push('unresolved_prepared_or_unknown');}
 r.local_sources_complete=r.missing_sources.length===0&&r.unparsed_ledger_rows===0;r.verified=r.local_sources_complete&&r.account_day_coverage_complete;
 return r;
}

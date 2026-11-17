import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
export const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const need=(x,c)=>{if(!x)throw Error(c);};
const keys=['video_id','nickname','douyin_id','comment_body','profile_eid','video_eid','started_at_epoch_seconds','profile','returned','profile_receipt','video_identity'];
function asset(root,a,kind){need(a&&Object.keys(a).sort().join(',')==='path,sha256'&&path.isAbsolute(a.path),'ASSET_FIELDS');const f=fs.realpathSync(a.path),s=fs.lstatSync(a.path);need(s.isFile()&&!s.isSymbolicLink()&&path.dirname(f)===path.join(root,kind)&&s.size<=4*1024*1024,'ASSET_SCOPE');const bytes=fs.readFileSync(f);need(hash(bytes)===a.sha256,'ASSET_HASH');return {file:f,bytes,stat:s};}
function fields(stdout){const out={};for(const line of stdout.split('\n')){const m=line.match(/^([A-Za-z_][A-Za-z_0-9]*)=(.*)$/);if(m){need(!(m[1] in out),'NATIVE_DUPLICATE_FIELD');out[m[1]]=m[2];}}return out;}
function receipt(root,a,c,command){const r=JSON.parse(asset(root,a,'receipts').bytes);const b=r.binding,t=c.tasks['102'];need(r.state==='terminal'&&b?.kind==='phone'&&b.activity==='collection'&&['task_id','run_id','run_tag'].every(k=>b.identity?.[k]===t[k])&&b.args?.[0]===command&&Number.isFinite(r.started_at)&&Number.isFinite(r.ended_at)&&r.ended_at>=r.started_at,'RECEIPT_SCOPE');return r;}
export function validateInput(root,c,i){
 root=fs.realpathSync(root);need(i&&typeof i==='object'&&!Array.isArray(i)&&keys.every(k=>Object.hasOwn(i,k))&&Object.keys(i).every(k=>keys.includes(k)||k==='video_identity_scratch'),'INPUT_FIELDS');
 need(c.assigned_workflow==='102'&&c.tasks?.['102']&&c.verification?.['102']?.video_ids?.includes(i.video_id)&&/^\d{16,24}$/.test(i.video_id),'VIDEO_SCOPE');
 for(const k of ['nickname','douyin_id','comment_body'])need(typeof i[k]==='string'&&i[k].trim().length>0,'COMMENT_IDENTITY');
 need(/^[A-Za-z0-9_.-]+$/.test(i.douyin_id),'DOUYIN_ID');const run=c.tasks['102'].run_tag,prefix=run+'-v'+i.video_id+'-collection';
 const row=i.profile_eid.startsWith(prefix+'-person')?i.profile_eid.slice((prefix+'-person').length).match(/^([1-9][0-9]*)-t[123]$/):null;need(row&&Number(row[1])<=c.comment_limit&&i.video_eid===prefix+'-after-card'+row[1],'EID_PAIR');
 const pr=receipt(root,i.profile_receipt,c,'commenter-identity'),vr=receipt(root,i.video_identity,c,'current-video-link');
 need(pr.result?.exit_code===0&&pr.binding.args.length===5&&pr.binding.args[4]===i.profile_eid&&pr.binding.args[3]===Buffer.from(i.nickname).toString('base64'),'PROFILE_REQUEST');
 need(vr.binding.args.length===2&&vr.binding.args[1]===i.video_eid&&vr.started_at>=pr.ended_at,'VIDEO_REQUEST');
 need(Number.isSafeInteger(i.started_at_epoch_seconds)&&i.started_at_epoch_seconds===Math.floor(pr.started_at),'STARTED_TIME');
 const f=fields(pr.result.stdout);need(f.douyin_id===i.douyin_id,'PROFILE_OBSERVED_ID');
 const profile=asset(root,i.profile,'native'),returned=asset(root,i.returned,'native');
 for(const [name,a,field] of [['profile',profile,'profile_evidence'],['returned',returned,'return_evidence']])need(path.basename(a.file)===i.profile_eid+'-'+name+'.xml'&&path.basename(f[field]||'')===path.basename(a.file)&&a.stat.mtimeMs>=i.started_at_epoch_seconds*1000,'NATIVE_FILE_BINDING');
 if(i.video_identity_scratch)asset(root,i.video_identity_scratch,'native');
 return {root,c,i,videoId:i.video_id,profile,returned,profileReceipt:pr,videoReceipt:vr,run};
}

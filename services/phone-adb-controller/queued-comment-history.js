'use strict';
// 本批PG历史工件及消费证据；只读历史，不接收任意执行命令。
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {spawnSync}=require('child_process');
const {routeOf}=require('./line-routes.js');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const key=(oid,body)=>Buffer.from(JSON.stringify([oid,body])).toString('base64');
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
function load(file,root,scope){
 const st=fs.lstatSync(file);
 if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o777)!==0o600||st.size>4*1024*1024)throw Error('HISTORY_PRIVATE_FILE_INVALID');
 if(path.dirname(fs.realpathSync(file))!==fs.realpathSync(root))throw Error('HISTORY_OUTSIDE_RUN');
 const bytes=fs.readFileSync(file),r=JSON.parse(bytes);
 if(r.version!==1||!['verified','unknown'].includes(r.status)||r.line!==scope.line||r.line_key!==routeOf(scope.line).key||r.run!==scope.run||r.source_run!==scope.source_run||r.video_id!==scope.video_id||r.video_url!==scope.video_url||!Array.isArray(r.rows)||r.rows.length>100000)throw Error('HISTORY_SCOPE_INVALID');
 if(r.status==='unknown'&&r.rows.length)throw Error('HISTORY_UNKNOWN_WITH_ROWS');
 const rows=new Map(),ids=new Set();
 for(const v of r.rows){if(!uuid(v.id)||typeof v.douyin_id!=='string'||!v.douyin_id.trim()||typeof v.comment_body!=='string'||!v.comment_body||ids.has(v.id))throw Error('HISTORY_ROW_INVALID');
  if(v.source_video_url && v.source_video_url!==scope.video_url && (!Array.isArray(r.url_proofs)||r.url_proofs.filter(p=>p.source_video_url===v.source_video_url&&p.video_id===scope.video_id&&p.resolved_url===`https://www.douyin.com/video/${scope.video_id}`).length!==1))throw Error('HISTORY_URL_PROOF_INVALID');
  ids.add(v.id);const k=key(v.douyin_id,v.comment_body);if(rows.has(k))throw Error('HISTORY_IDENTITY_AMBIGUOUS');rows.set(k,v);}
 return {receipt:r,rows,sha256:digest(bytes)};
}
function proof(history,root,profileName,eid,id,oid,body,profile,returned,started){
 const v=history.rows.get(key(oid,body));if(history.receipt.status!=='verified'||!v||v.id!==id)throw Error('HISTORY_MATCH_INVALID');
 if(!/^[a-zA-Z0-9_-]+$/.test(eid))throw Error('HISTORY_EID_INVALID');
 if(!Number.isFinite(Number(started))||Number(started)<=0)throw Error('HISTORY_TIME_INVALID');
 if(!/^[a-zA-Z0-9_-]+$/.test(profileName))throw Error('HISTORY_PROFILE_INVALID');
 const phoneRoot=path.join(process.env.DOUYIN_PHONE_TMP_ROOT||'/private/tmp/openclaw-phone','evidence',profileName);
 const read=(file,suffix)=>{if(path.dirname(fs.realpathSync(file))!==fs.realpathSync(phoneRoot)||fs.lstatSync(file).isSymbolicLink()||path.basename(file)!==eid+suffix||!fs.lstatSync(file).isFile()||fs.statSync(file).mtimeMs<Number(started)*1000)throw Error('HISTORY_FRESH_PROOF_INVALID');return fs.readFileSync(file);};
 const p=read(profile,'-profile.xml'),r=read(returned,'-returned.xml');
 const parsed=spawnSync('python3',['-c',`import json,sys,xml.etree.ElementTree as E
p=json.load(sys.stdin);a=E.fromstring(p['profile']);b=E.fromstring(p['returned']);pkg='com.ss.android.ugc.aweme'
assert a.tag==b.tag=='hierarchy'
assert [n.get('text','')[len('抖音号：'):] for n in a.iter('node') if n.get('package')==pkg and n.get('text','').startswith('抖音号：')]==[p['oid']]
import re
assert any(n.get('package')==pkg and re.fullmatch(r'(评论 ?[0-9]+|[0-9万.]+ ?条评论|暂无评论)',n.get('text','')) for n in b.iter('node'))
assert any(n.get('package')==pkg and (n.get('class')=='android.widget.EditText' or n.get('content-desc','')=='放大评论区') for n in b.iter('node'))
assert all(n.get('package') in (None,'',pkg) for n in b.iter('node'))`],{input:JSON.stringify({profile:p.toString(),returned:r.toString(),oid}),encoding:'utf8',timeout:5000});
 if(parsed.status!==0)throw Error('HISTORY_IDENTITY_PROOF_INVALID');
 const controller=fs.readFileSync(path.join(__dirname,'douyin-phone-adb'),'utf8');
 const primitive=controller.match(/^comment_panel_open\(\) \{[\s\S]*?^\}/m)?.[0];
 if(!primitive)throw Error('HISTORY_PANEL_PRIMITIVE_MISSING');
 const panel=spawnSync('zsh',['-c',primitive+'\ncomment_panel_open "$1"','history-panel',returned],{encoding:'utf8',timeout:5000});
 if(panel.status!==0)throw Error('HISTORY_PANEL_NOT_RESTORED');
 const out={version:1,verified:true,video_id:history.receipt.video_id,id,douyin_id:oid,comment_body:body,identity_eid:eid,history_sha256:history.sha256,profile_sha256:digest(p),returned_sha256:digest(r),comment_context_verified:true};
 const target=path.join(root,eid+'-history-readback.json'),tmp=target+'.tmp-'+process.pid;
 fs.writeFileSync(tmp,JSON.stringify(out),{mode:0o600,flag:'wx'});fs.renameSync(tmp,target);return out;
}
if(require.main===module){try{
 const [op,file,root,line,run,source_run,video_id,video_url,...a]=process.argv.slice(2);
 if(op==='key'){console.log(key(file,root));}
 else {const h=load(file,root,{line,run,source_run:source_run||null,video_id,video_url});
  if(op==='load'){console.log(`META\t${h.receipt.status}\t${h.sha256}`);for(const [k,v] of h.rows)console.log(`ROW\t${v.id}\t${k}`);}
  else if(op==='proof'){proof(h,root,...a);}
  else throw Error('HISTORY_OPERATION_INVALID');}
 }catch{process.stderr.write('HISTORY_VALIDATION_FAILED\n');process.exitCode=8;}}
module.exports={load,key,proof};

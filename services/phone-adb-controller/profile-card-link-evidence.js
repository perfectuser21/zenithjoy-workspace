'use strict';
// Only the fixed host journal and its copied native artifact can attest a link.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const need=(x,c='PROFILE_CARD_EVIDENCE_UNVERIFIED')=>{if(!x)throw Error(c);};
function file(filename,root,expected){
 need(typeof filename==='string'&&path.isAbsolute(filename)&&path.dirname(fs.realpathSync(filename))===fs.realpathSync(root));
 const s=fs.lstatSync(filename);need(s.isFile()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&!(s.mode&0o022));const bytes=fs.readFileSync(filename);if(expected)need(hash(bytes)===expected);return bytes;
}
function verifyProfileCardLink(ref,expected,{root=process.env.LEADGEN_METADATA_RUN_ROOT}={}){need(root,'PROFILE_CARD_CONTEXT_REQUIRED');
 const c=JSON.parse(file(path.join(root,'context.json'),root)),target=c.recovery?.collection,identity=c.tasks?.['102'];
 need(target?.existing_comment_id&&target.expected_douyin_id&&target.expected_nickname_b64&&/^[a-f0-9]{64}$/.test(target.comment_body_sha256||'')&&/^[a-f0-9]{64}$/.test(target.recipient_evidence_sha256||'')&&typeof target.evidence_prefix==='string');
 need(c.assigned_workflow==='102'&&identity&&fs.realpathSync(c.runtime_root)===fs.realpathSync(__dirname)&&c.line===expected.line_key&&identity.run_tag===expected.run&&c.profile===expected.profile);
 if(target?.existing_comment_id)need(target.existing_comment_id===expected.comment_id&&target.expected_douyin_id===expected.douyin_id&&target.comment_body_sha256===expected.comment_body_sha256&&target.recipient_evidence_sha256===expected.recipient_evidence_sha256);
 need(ref&&typeof ref.action_name==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(ref.action_name)&&/^[a-f0-9]{64}$/.test(ref.sha256||''));
 const receiptRaw=file(path.join(root,'receipts',ref.action_name+'.json'),path.join(root,'receipts')),receipt=JSON.parse(receiptRaw);
 need(receipt.state==='terminal'&&receipt.result?.exit_code===0&&receipt.binding?.activity==='collection'&&receipt.binding.kind==='phone'&&['task_id','run_id','run_tag'].every(k=>receipt.binding.identity?.[k]===identity[k]));
 const proofRaw=file(ref.path,path.join(root,'native'),ref.sha256),proof=JSON.parse(proofRaw),s=proof.scope;
 need(s&&path.basename(ref.path)===s.evidence_id+'-profile-link-proof.json'&&s.evidence_id.startsWith(target.evidence_prefix+'-'));
 const args=['commenter-profile-card-link',expected.video_id,expected.douyin_id,Buffer.from(expected.nickname).toString('base64'),expected.comment_body_sha256,s.evidence_id];
 need(JSON.stringify(receipt.binding.args)===JSON.stringify(args));
 const fields=Object.fromEntries((receipt.result.stdout||'').split('\n').map(l=>l.match(/^([A-Za-z_][A-Za-z_0-9]*)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2]]));
 need(fields.profile_link_evidence_sha256===ref.sha256&&path.basename(fields.profile_link_evidence||'')===path.basename(ref.path)&&fields.profile_url===proof.profile_url);
 need(proof.controller_sha256===hash(fs.readFileSync(path.join(__dirname,'douyin-phone-adb')))&&proof.controller_sha256===c.phone_controller_sha256);
 need(proof.helper_sha256===hash(fs.readFileSync(path.join(__dirname,'profile-card-link.py')))&&proof.helper_sha256===c.verification?.runtime_sha256?.['profile-card-link.py']);
 for(const name of ['profile-card-link.py','profile-card-link.sh','profile-card-link-evidence.js','comment-compose-rows.py','adb-managed-client.py','phone-lock-helper.py'])need(hash(fs.readFileSync(path.join(__dirname,name)))===c.verification?.runtime_sha256?.[name]);
 need(hash(fs.readFileSync(c.adb_host_config))===c.adb_host_config_sha256);
 const action=proof.reopen_action;need(action?.serial===c.adb_serial&&action.argv?.[0]===path.join(__dirname,'adb-managed-client.py'));need(Number.isFinite(receipt.started_at)&&Number.isFinite(receipt.ended_at)&&action?.started_ns>=Math.floor(receipt.started_at*1e9)-1e9&&action.ended_ns<=Math.ceil(receipt.ended_at*1e9)+1e9);
 const python=c.verification?.artifact_checker?.command?.[0];need(typeof python==='string'&&path.isAbsolute(python)&&hash(fs.readFileSync(python))===c.verification.artifact_checker.sha256?.[python]);
 const r=spawnSync(python,[path.join(__dirname,'profile-card-link.py'),'verify'],{input:JSON.stringify({proof,expected}),encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
 need(r.status===0);const value=JSON.parse(r.stdout);need(value.profile_url===proof.profile_url);return {...value,command_receipt_sha256:hash(receiptRaw),native_proof_sha256:ref.sha256};
}
function recoveryProfileLinkEvidence(c,root){
 const t=c.recovery?.collection,i=c.tasks?.['102'];need(t?.existing_comment_id&&i);
 const expected=['commenter-profile-card-link',t.video_id||c.verification?.['102']?.video_ids?.[0],t.expected_douyin_id,t.expected_nickname_b64,t.comment_body_sha256,t.evidence_prefix+'-card'];
 const matches=[];
 for(const name of fs.readdirSync(path.join(root,'receipts'))){
  if(!/^[A-Za-z0-9_-]{1,100}\.json$/.test(name))continue;
  const r=JSON.parse(file(path.join(root,'receipts',name),path.join(root,'receipts')));
  if(r.state!=='terminal'||r.result?.exit_code!==0||r.binding?.kind!=='phone'||r.binding.activity!=='collection'||!['task_id','run_id','run_tag'].every(k=>r.binding.identity?.[k]===i[k])||JSON.stringify(r.binding.args)!==JSON.stringify(expected))continue;
  const fields=Object.fromEntries((r.result.stdout||'').split('\n').map(l=>l.match(/^([A-Za-z_][A-Za-z_0-9]*)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2]]));
  need(path.basename(fields.profile_link_evidence||'')===t.evidence_prefix+'-card-profile-link-proof.json');
  matches.push({path:path.join(root,'native',path.basename(fields.profile_link_evidence)),sha256:fields.profile_link_evidence_sha256,action_name:name.slice(0,-5)});
 }
 need(matches.length===1,'PROFILE_CARD_COMMAND_RECEIPT_REQUIRED');return matches[0];
}
module.exports={verifyProfileCardLink,recoveryProfileLinkEvidence};

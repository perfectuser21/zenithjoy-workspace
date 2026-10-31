'use strict';

const fields=['schema_version','record_id','comment_id','company_id','source_run','mark_run','target_douyin_id','line_key','run_tag','profile','serial'];
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,80}$/.test(v);
const record=v=>typeof v==='string'&&/^rec[A-Za-z0-9]{6,40}$/.test(v);

function validateOutreachScope(scope,expected={}){
 if(!scope||typeof scope!=='object'||Array.isArray(scope)||Object.keys(scope).length!==fields.length
  ||Object.keys(scope).some(k=>!fields.includes(k))||scope.schema_version!==1||!record(scope.record_id)
  ||fields.filter(k=>!['schema_version','record_id'].includes(k)).some(k=>!id(scope[k])))throw Error('OUTREACH_SCOPE_INVALID: 本轮精确订单身份缺失或非法');
 for(const [key,value] of Object.entries(expected))if(value!==undefined&&scope[key]!==value)throw Error(`OUTREACH_SCOPE_MISMATCH: ${key}`);
 return scope;
}

function matchesOutbox(scope,row){
 const p=row?.payload;
 return row?.line_key===scope.line_key&&row?.state==='confirmed'&&row?.qualification_status==='passed'
  &&row?.feishu_record_id===scope.record_id&&row?.comment_id===scope.comment_id
  &&row?.source_run===scope.source_run&&row?.run_tag===scope.mark_run
  &&p?.line_key===scope.line_key&&p?.comment_id===scope.comment_id&&p?.source_run===scope.source_run
  &&p?.comment_run===scope.source_run&&p?.run===scope.mark_run
  &&p?.qualification?.company_id===scope.company_id
  &&String(p?.target_douyin_id||'').toLowerCase()===scope.target_douyin_id.toLowerCase();
}

module.exports={validateOutreachScope,matchesOutbox};

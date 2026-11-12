'use strict';
// Only original frozen business descriptions are reference material, never admin labels.
const REFERENCE_MODE='frozen-fields-v1';
const BUSINESS_FIELDS=Object.freeze(['意向信号','人群描述','企业规模','决策岗位','决策阻力','客户行业','所在地区','核心痛点','画像名称','购买触发','常用搜索词']);
const text=value=>typeof value==='string'&&value.trim()?value:null;
const bounded=value=>typeof value==='string'&&value.trim().length>0&&value.length<=300;
const quoted=(value,original)=>typeof value==='string'&&value.trim().length>0&&value.length<=100&&typeof original==='string'&&original.includes(value);
function frozenPolicyReferences(rules){
 const audiences=Array.isArray(rules?.audiences)?rules.audiences:[];
 return {audiences:audiences.map(a=>({id:a.id,
   business_fields:Object.fromEntries(BUSINESS_FIELDS.filter(k=>text(a.fields?.[k])).map(k=>[k,a.fields[k]])),
   exclusion_signals:text(a.fields?.['排除信号'])?[a.fields['排除信号']]:[]})),
   unrelated_criterion:text(rules?.criteria?.['不相关'])};
}
function normalizeFrozenPolicyEvidence(proof,rules){
 if(!proof||typeof proof!=='object'||!bounded(proof.matched_rule))return {proof,normalization:null};
 const audiences=frozenPolicyReferences(rules).audiences.filter(a=>a.id===proof.audience_id);
 if(audiences.length!==1)return {proof,normalization:null};
 const fields=Object.entries(audiences[0].business_fields);
 if(fields.some(([,v])=>v.includes(proof.matched_rule)))return {proof,normalization:null};
 const candidates=fields.filter(([,v])=>v.trim().length>=8&&proof.matched_rule.includes(v)).sort((a,b)=>b[1].length-a[1].length);
 if(!candidates.length)return {proof,normalization:null};
 const [field,value]=candidates[0];
 return {proof:{...proof,matched_rule:value},normalization:{mode:'complete-frozen-field-extraction-v1',field,original_matched_rule:proof.matched_rule,canonical_matched_rule:value}};
}
function validateFrozenPolicyEvidence({grade,proof,rules,comment,video,requireQuotes=false}){
 if(!['A','B','C','不相关'].includes(grade))return 'grade_invalid';
 if(!proof||typeof proof!=='object'||Array.isArray(proof))return 'policy_evidence_missing';
 proof=normalizeFrozenPolicyEvidence(proof,rules).proof;
 if(!Object.hasOwn(proof,'exclusion_rule'))return 'missing_exclusion_rule';
 const refs=frozenPolicyReferences(rules),matches=refs.audiences.filter(a=>a.id===proof.audience_id),audience=matches.length===1?matches[0]:null;
 const nullAudience=grade==='不相关'&&proof.audience_id===null&&proof.matched_rule===null;
 if(!nullAudience){
  if(!audience)return 'audience_unknown';
  if(!bounded(proof.matched_rule))return 'matched_rule_invalid';
  if(!Object.values(audience.business_fields).some(value=>value.includes(proof.matched_rule)))return 'matched_rule_not_frozen';
 }
 const exclusion=proof.exclusion_rule;
 if(!(exclusion===null||bounded(exclusion)))return 'exclusion_rule_invalid';
 if(exclusion!==null){
  const exclusions=audience?audience.exclusion_signals:refs.audiences.flatMap(a=>a.exclusion_signals);
  if(grade==='不相关'&&refs.unrelated_criterion)exclusions.push(refs.unrelated_criterion);
  if(!exclusions.some(value=>value.includes(exclusion)))return 'exclusion_rule_not_frozen';
  if(grade!=='不相关')return 'exclusion_grade_mismatch';
 }
 if(nullAudience&&(exclusion===null||!quoted(proof.comment_signal,comment)))return 'policy_evidence_missing';
 if(typeof proof.reason!=='string'||!proof.reason.trim()||proof.reason.length>500)return 'reason_invalid';
 if(typeof comment==='string'&&comment.length>=8&&proof.reason.includes(comment))return 'reason_contains_comment';
 if(requireQuotes&&(!quoted(proof.comment_signal,comment)
   ||proof.video_signal!=null&&!quoted(proof.video_signal,video)
   ||grade==='A'&&!quoted(proof.video_signal,video)))return 'policy_evidence_missing';
 return null;
}
module.exports={normalizeFrozenPolicyEvidence,REFERENCE_MODE,BUSINESS_FIELDS,frozenPolicyReferences,validateFrozenPolicyEvidence};

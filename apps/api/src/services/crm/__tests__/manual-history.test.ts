import { describe, expect, it } from 'vitest';
import { parseManualAnalysis, validateManualMaterial, materialDigest, ManualHistoryError } from '../manual-history';
const text = '客户甲：预算5000元。\n同事乙：周五提供样品。';
const analysis = { summary:'预算和样品安排', needs:[],quotes:[{text:'预算5000元',evidence:'预算5000元',speaker:'客户甲',occurred_at:null}],commitments:[],next_actions:[],uncertainties:['日期未知'] };
describe('manual history material and grounded analysis',()=>{
 it('preserves raw text and unknown metadata without inventing event identity',()=>{
  const value=validateManualMaterial({source_type:'group',channel_name:'业务沟通',text});
  expect(value.text).toBe(text);expect(value.source_account).toBeNull();
  expect(parseManualAnalysis(analysis,text)).toEqual(analysis);
 });
 it('rejects blank, oversized, replacement characters and binary control characters',()=>{
  for(const raw of ['  ','x'.repeat(32769),'invalid\ufffd','abc\u0000def']){
   expect(()=>validateManualMaterial({source_type:'individual',channel_name:'客户甲',text:raw})).toThrow(ManualHistoryError);
  }
 });
 it('does not trust citations or timestamps fabricated by a model',()=>{
  expect(()=>parseManualAnalysis({...analysis,quotes:[{...analysis.quotes[0],evidence:'预算10万元'}]},text)).toThrow(ManualHistoryError);
  expect(()=>parseManualAnalysis({...analysis,quotes:[{...analysis.quotes[0],occurred_at:'2026-01-01'}]},text)).toThrow(ManualHistoryError);
 });
 it('uses exact material and channel metadata for deduplication, never nickname as stable identity',()=>{
  const a=validateManualMaterial({source_type:'group',channel_name:'业务沟通',text});
  expect(materialDigest(a)).toBe(materialDigest({...a}));
  expect(materialDigest({...a,channel_name:'另一个群'})).not.toBe(materialDigest(a));
 });
});

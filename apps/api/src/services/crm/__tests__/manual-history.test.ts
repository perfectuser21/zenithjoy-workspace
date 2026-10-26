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

describe('confirmed materials are shared in their target scope, request receipts remain per operator',()=>{
 it('returns the first confirmed row for another operator instead of replacing actor or analysis',async()=>{
  const {vi}=await import('vitest');
  const {ManualHistoryService}=await import('../manual-history');
  const {randomUUID}=await import('node:crypto');
  const previewId=randomUUID(),version=randomUUID();
  const existing={id:randomUUID(),customer_id:'1',created_by:'first-operator',analysis,created_at:new Date('2026-01-01T00:00:00Z')};
  const client={query:vi.fn(),release:vi.fn()};
  client.query.mockResolvedValueOnce({rows:[]}) // BEGIN
   .mockResolvedValueOnce({rows:[]}) // request lock
   .mockResolvedValueOnce({rows:[]}) // no request for this actor
   .mockResolvedValueOnce({rows:[{id:previewId,version,expires_at:new Date(Date.now()+60000),raw_text:text,source_type:'group',channel_name:'业务群',source_account:null,material_hash:'a'.repeat(64)}]})
   .mockResolvedValueOnce({rows:[]}) // another operator already confirmed same material
   .mockResolvedValueOnce({rows:[existing]})
   .mockResolvedValueOnce({rows:[]}) // receipt
   .mockResolvedValueOnce({rows:[]}); // COMMIT
  const db={query:vi.fn(),connect:vi.fn().mockResolvedValue(client)};
  const service=new ManualHistoryService(db as any);
  const result=await service.commit({tenantId:randomUUID(),csWechatId:'cs-a',customerId:'1',actor:'second-operator'},{preview_id:previewId,preview_version:version,request_id:randomUUID(),confirmed_result:analysis});
  expect(result.duplicate).toBe(true);expect(result.record.created_by).toBe('first-operator');expect(result.record.analysis).toEqual(analysis);
  expect(client.query.mock.calls[5][1]).not.toContain('second-operator');
  expect(client.query.mock.calls[6][1]).toContain('second-operator');
 });
});

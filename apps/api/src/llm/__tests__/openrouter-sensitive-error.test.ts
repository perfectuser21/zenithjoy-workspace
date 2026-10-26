import { afterEach,describe,expect,it,vi } from 'vitest';
const {query}=vi.hoisted(()=>({query:vi.fn().mockResolvedValue({rows:[]})}));
vi.mock('../../db/connection',()=>({default:{query}}));
import { callOpenRouter } from '../openrouter';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();query.mockClear();});
describe('sensitive material audit errors',()=>{
 it('sanitizes provider bodies only when caller opts in',async()=>{
  vi.stubEnv('OPENROUTER_API_KEY','fixture');vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:400,text:async()=>'PRIVATE_ORIGINAL_MARKER'}));
  await expect(callOpenRouter({prompt:'PRIVATE_ORIGINAL_MARKER',purpose:'crm_manual_history',sanitizedError:true})).rejects.toThrow('LLM_PROVIDER_FAILED');
  expect(JSON.stringify(query.mock.calls)).not.toContain('PRIVATE_ORIGINAL_MARKER');
 });
});

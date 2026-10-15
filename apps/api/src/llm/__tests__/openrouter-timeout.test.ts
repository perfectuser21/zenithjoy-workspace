import {it,expect,vi} from 'vitest';
vi.mock('../../db/connection',()=>({default:{query:vi.fn().mockResolvedValue({rows:[]})}}));
import {callOpenRouter} from '../openrouter';
it('指定timeout时fetch携带可中止signal',async()=>{
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({choices:[{message:{content:'ok'}}],usage:{}})});
 vi.stubGlobal('fetch',fetcher);
 try{
  await callOpenRouter({prompt:'test',purpose:'unit',apiKey:'fake',timeoutMs:25});
  expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
 }finally{vi.unstubAllGlobals();}
});

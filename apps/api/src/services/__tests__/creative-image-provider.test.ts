import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToApisImageProvider } from '../creative-image-provider';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('ToAPIs image provider',()=>{
  it('submits a documented async job and polls the result without revealing its key',async()=>{
    vi.stubEnv('TOAPI_API_KEY','private-test-key');
    const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({id:'task_123',status:'queued'}))).mockResolvedValueOnce(new Response(JSON.stringify({status:'completed',result:{data:[{url:'https://files.toapis.com/generated/a.jpg'}]}})));
    vi.stubGlobal('fetch',fetcher); const provider=new ToApisImageProvider();
    expect(await provider.submit('a chair')).toBe('task_123');
    expect(fetcher.mock.calls[0][0]).toBe('https://toapis.com/v1/images/generations');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({model:'gpt-image-2',prompt:'a chair',n:1});
    expect(await provider.poll('task_123')).toEqual({status:'succeeded',url:'https://files.toapis.com/generated/a.jpg'});
    expect(fetcher.mock.calls[1][0]).toBe('https://toapis.com/v1/images/generations/task_123');
  });
  it('refuses path injection before making a request',async()=>{vi.stubEnv('TOAPI_API_KEY','private-test-key');const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);await expect(new ToApisImageProvider().poll('../../secret')).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();});
});

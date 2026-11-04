import {afterEach,expect,it,vi} from 'vitest';
import {ToAPIClient} from './toapi.client';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('provider task IDs are one encoded path segment at the fixed origin and never follow redirects',async()=>{
 vi.stubEnv('TOAPI_API_KEY','synthetic-fixture-token');
 const fetchMock=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({id:'fixture',model:'veo',status:'queued'})));vi.stubGlobal('fetch',fetchMock);
 for(const id of ['task_abc-123','https://169.254.169.254/latest/meta-data','../other?query=x#fragment','//127.0.0.1/secret']){
  await new ToAPIClient().getTaskStatus(id);
  const [target,options]=fetchMock.mock.calls.at(-1)!;
  const url=new URL(String(target));expect(url.origin).toBe('https://toapis.com');expect(url.pathname).toBe('/v1/videos/generations/'+encodeURIComponent(id));expect(url.search).toBe('');expect(url.hash).toBe('');expect(options.redirect).toBe('error');expect(options.headers.Authorization).toBe('Bearer synthetic-fixture-token');
 }
});
it('empty and dot-only task IDs cannot select a different provider endpoint',async()=>{
 const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
 for(const id of ['', '.', '..'])await expect(new ToAPIClient().getTaskStatus(id)).rejects.toThrow('Invalid ToAPI task ID');
 expect(fetchMock).not.toHaveBeenCalled();
});

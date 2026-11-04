/** Real IPC listener and HTTP bodies; no publisher, account, or device is invoked. */
import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
const transport=vi.hoisted(()=>({port:''}));
vi.mock('http', async importOriginal=>{
  const actual=await importOriginal<typeof import('node:http')>();
  return {...actual,request:(options: import('node:http').RequestOptions, callback: (res:import('node:http').IncomingMessage)=>void)=>{
    if(options.hostname!=='127.0.0.1'||String(options.port)!==transport.port) throw Error('test refuses non-fixture HTTP transport');
    return actual.request(options,callback);
  }};
});
const timers: ReturnType<typeof setTimeout>[] = [];
afterEach(() => { timers.forEach(clearTimeout); timers.length=0; vi.restoreAllMocks(); vi.resetModules(); });
for (const nested of [false, true]) it(`shipped line02 ${nested ? 'nested config overrides top-level' : 'top-level config'} preserves exact task_id in actual HTTP reports`, async () => {
  const reports: unknown[] = [], requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url!); res.setHeader('content-type', 'application/json');
    if (req.method === 'GET') res.end(JSON.stringify({tasks: ['task-first','task-second'].map(task_id => ({task_id,tenant_id:'tenant-a',keywords:[]}))}));
    else { let body=''; req.on('data',chunk=>{body+=chunk;}); req.on('end',()=>{reports.push(JSON.parse(body));res.end('{}');}); }
  });
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  const endpoint=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  transport.port=String((server.address() as AddressInfo).port);
  let receive: ((message: unknown)=>void)|undefined;
  const realOn=process.on.bind(process);
  const sendReady=vi.spyOn(process,'send').mockReturnValue(true);
  vi.spyOn(process,'on').mockImplementation(((event:string, listener:(...args:unknown[])=>void)=>{
    if(event==='message'){receive=listener;return process;} return realOn(event,listener);
  }) as typeof process.on);
  const realTimeout=setTimeout;
  vi.spyOn(global,'setTimeout').mockImplementation(((fn:(...args:unknown[])=>void, delay?:number,...args:unknown[])=>{
    const timer=realTimeout(fn,delay,...args);timers.push(timer);return timer;
  }) as typeof setTimeout);
  try {
    await import('../index');
    expect(receive).toBeTypeOf('function');
    receive!({type:'config',agentId:'agent-real-contract',apiBase:nested?'http://127.0.0.1:1':endpoint,
      ...(nested?{config:{apiBase:endpoint,pollIntervalMs:10_000_000}}:{})});
    expect(sendReady).toHaveBeenCalledWith({type:'ready'});
    const schedule=vi.mocked(setTimeout).mock.calls.find(([,delay])=>delay===(nested?10_000_000:30_000));
    expect(schedule).toBeDefined();
    await (schedule![0] as ()=>Promise<void>)();
    expect(requests).toEqual(['/api/acquisition/pending-collect-tasks','/api/acquisition/collect/report-videos','/api/acquisition/collect/report-videos']);
    expect(reports).toEqual(['task-first','task-second'].map(task_id=>({task_id,videos:[],reason:{search_result:'empty'}})));
  } finally { timers.forEach(clearTimeout); await new Promise<void>(resolve=>server.close(()=>resolve())); }
});

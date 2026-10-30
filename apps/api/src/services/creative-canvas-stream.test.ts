import { afterEach, describe, expect, it } from 'vitest';
import http, { type Server } from 'node:http';
import { once } from 'node:events';
import { createCanvasGateway } from './creative-canvas-gateway';

const servers: Server[] = [];
async function listen(server: Server) {
  servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('bad address'); return address.port;
}
afterEach(async () => { await Promise.all(servers.splice(0).map(s => new Promise<void>(resolve => { s.closeAllConnections(); s.close(() => resolve()); }))); });
async function fixture(upstream: Server, timeout = 150) {
  const up = await listen(upstream);
  const g = createCanvasGateway({authenticate: async () => 'alice', instances: {alice:`http://127.0.0.1:${up}`}, allowedOrigins: ['http://canvas.test'], staticTimeoutMs:timeout});
  return `http://127.0.0.1:${await listen(http.createServer(g.handleHttp))}/api/creative-canvas/`;
}
function requestResult(url: string, duration = 1200): Promise<{status: number; outcome: string; body: string}> {
  return new Promise(resolve => {
    let settled=false, status=0, body='';
    const done=(outcome:string) => { if(settled)return; settled=true;clearTimeout(timer); req.destroy();resolve({status,outcome,body}); };
    const req=http.get(url, res => {status=res.statusCode || 0; res.on('data', d => {body+=String(d)});res.on('end',()=>done('end'));res.on('aborted',()=>done('aborted'));res.on('error',()=>done('error'));});
    req.on('error',()=>done('error'));
    const timer=setTimeout(()=>done('timeout'),duration);
  });
}
describe('canvas proxy stream recovery', () => {
  it('truncated upstream CSS promptly terminates downstream instead of hanging', async () => {
    const base=await fixture(http.createServer((_req,res)=>{res.writeHead(200,{'Content-Length':'10000'});res.write('partial');setTimeout(()=>res.socket?.destroy(),20)}));
    const result=await requestResult(base+'assets/test-abcdefgh.css');
    expect(result.status).toBe(200); expect(result.body).toBe('partial'); expect(['aborted','error']).toContain(result.outcome);
  });
  it('stalled static file before headers returns 504 while a slow API response is not limited', async () => {
    const base=await fixture(http.createServer((req,res)=>{if(req.url?.startsWith('/assets/')) return;setTimeout(()=>res.end('ok'),300)}));
    const [asset,api]=await Promise.all([requestResult(base+'assets/test-abcdefgh.js'),requestResult(base+'api/jobs')]);
    expect(asset.status).toBe(504);expect(asset.outcome).toBe('end');expect(api).toMatchObject({status:200,outcome:'end',body:'ok'});
  });
  it('stalled static response after headers terminates the incomplete response', async () => {
    const base=await fixture(http.createServer((_req,res)=>{res.writeHead(200,{'Content-Length':'10000'});res.write('partial')}));
    const result=await requestResult(base+'assets/test-abcdefgh.css');
    expect(result.status).toBe(200);expect(result.body).toBe('partial');expect(['aborted','error']).toContain(result.outcome);
  });
  it('allows a static response that keeps making progress beyond the inactivity limit', async () => {
    const base=await fixture(http.createServer((_req,res)=>{res.writeHead(200);res.write('1');let n=1;const timer=setInterval(()=>{res.write(String(++n));if(n===5){clearInterval(timer);res.end()}},80)}),150);
    const result=await requestResult(base+'assets/test-abcdefgh.js');
    expect(result).toMatchObject({status:200,outcome:'end',body:'12345'});
  });
  it('client disconnect cancels its upstream request without disrupting another stream', async () => {
    let resolveClosed!:()=>void; const closed=new Promise<void>(r=>{resolveClosed=r});
    const base=await fixture(http.createServer((req,res)=>{if(req.url?.includes('slow')){res.writeHead(200);res.write('first');res.on('close',resolveClosed)}else res.end('other okay')}),1000);
    const client=http.get(base+'assets/slow-abcdefgh.js',res=>res.once('data',()=>client.destroy()));client.on('error',()=>{});
    const other=await requestResult(base+'assets/good-abcdefgh.js');
    const outcome=await Promise.race([closed.then(()=>true),new Promise<boolean>(r=>setTimeout(()=>r(false),600))]);
    expect(other).toMatchObject({status:200,outcome:'end',body:'other okay'});expect(outcome).toBe(true);
  });
  it('streams a slow chunked upload beyond the static timeout and returns the complete body', async () => {
    let seen='';
    const base=await fixture(http.createServer((req,res)=>{
      if(req.url==='/upload/image'){
        req.on('data',chunk=>{seen+=String(chunk)});
        req.on('end',()=>res.end(`received:${seen}`));
      }else res.end('other okay');
    }),150);
    const start=Date.now();
    const uploaded = new Promise<{status:number; body:string}>((resolve,reject)=>{
      const req=http.request(base+'upload/image',{method:'POST',headers:{origin:'http://canvas.test'}},res=>{
        let body='';res.on('data',data=>{body+=String(data)});res.on('end',()=>resolve({status:res.statusCode || 0,body}));res.on('error',reject);
      });
      req.on('error',reject);
      const chunks=['part-a','part-b','part-c','part-d'];let index=0;
      req.write(chunks[index++]);
      const timer=setInterval(()=>{if(index<chunks.length)req.write(chunks[index++]);if(index===chunks.length){clearInterval(timer);req.end()}},240);
      req.on('error',()=>clearInterval(timer));
    });
    const [result,other]=await Promise.all([uploaded,requestResult(base+'assets/good-abcdefgh.js')]);
    expect(Date.now()-start).toBeGreaterThanOrEqual(650);
    expect(seen).toBe('part-apart-bpart-cpart-d');
    expect(result).toEqual({status:200,body:'received:part-apart-bpart-cpart-d'});
    expect(other).toMatchObject({status:200,outcome:'end',body:'other okay'});
  });
  it('cancels a partial upload upstream after the client disconnects without affecting a concurrent request', async () => {
    let markStarted!:()=>void, markAborted!:()=>void;
    const started=new Promise<void>(resolve=>{markStarted=resolve});
    const aborted=new Promise<void>(resolve=>{markAborted=resolve});
    const base=await fixture(http.createServer((req,res)=>{
      if(req.url==='/upload/image'){
        req.once('data',()=>markStarted());
        req.once('aborted',()=>markAborted());
      }else res.end('other okay');
    }),150);
    const client=http.request(base+'upload/image',{method:'POST',headers:{origin:'http://canvas.test'}});
    client.on('error',()=>{});client.write('partial-upload');
    const didStart=await Promise.race([started.then(()=>true),new Promise<boolean>(resolve=>setTimeout(()=>resolve(false),1000))]);
    expect(didStart).toBe(true);
    client.destroy();
    const [didAbort,other]=await Promise.all([
      Promise.race([aborted.then(()=>true),new Promise<boolean>(resolve=>setTimeout(()=>resolve(false),1000))]),
      requestResult(base+'assets/good-abcdefgh.js')
    ]);
    expect(didAbort).toBe(true);
    expect(other).toMatchObject({status:200,outcome:'end',body:'other okay'});
  });

});

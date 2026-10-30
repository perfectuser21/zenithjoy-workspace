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
  const g = createCanvasGateway({authenticate: async () => 'alice', instances: {alice:`http://127.0.0.1:${up}`}, allowedOrigins: [], staticTimeoutMs:timeout});
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
});

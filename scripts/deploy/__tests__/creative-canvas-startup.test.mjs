import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
async function waitForNginx(port) {
  let error;
  for (let attempt=0; attempt<40; attempt++) {
    try { await fetch(`http://127.0.0.1:${port}/`, {signal:AbortSignal.timeout(500)}); return; }
    catch (e) { error=e; await new Promise(resolve=>setTimeout(resolve,100)); }
  }
  throw error;
}

test('diagnostics identify only public official CDN assets and probe their actual path', async () => {
  const source=readFileSync('apps/dashboard/public/canvas-startup-diagnostic-v2.js','utf8');
  const listeners={}, sent=[];
  const window={addEventListener:(name,fn)=>{listeners[name]=fn},setTimeout:()=>{},location:{origin:'https://test.invalid'}};
  const document={getElementById:()=>null,querySelectorAll:()=>[]};
  const fetch=(url,opts)=>{sent.push([url,opts]);return Promise.resolve(url.includes('/__diag/')?{}:{status:200,headers:{get:()=> 'application/javascript'}})};
  vm.runInNewContext(source,{window,document,fetch,URL});
  const hash='593af1d79767cefc3587c862dd3b3d90ff00530c5f83071522f8f9807c175346';
  const path=`/assets/comfy/${hash}/assets/vendor-three-zoI3eWBk.js`;
  listeners.error({target:{src:`https://test.invalid${path}?secret=token`}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(sent.some(([url])=>url==='/api/creative-canvas/__diag/resource/vendor-three-zoI3eWBk.js'));
  assert.ok(sent.some(([url])=>url===path));
  assert.ok(sent.some(([url])=>url==='/api/creative-canvas/__diag/probe2xxjs/vendor-three-zoI3eWBk.js'));
  for(const [url] of sent)assert.doesNotMatch(url,/secret|token/);
});


test('resource errors do not suppress timed status and probes are bounded and sanitized', async () => {
  const source=readFileSync('apps/dashboard/public/canvas-startup-diagnostic-v2.js','utf8');
  const listeners={}, sent=[], timers=[];
  const window={addEventListener:(name,fn)=>{listeners[name]=fn},setTimeout:(fn,ms)=>{timers.push([ms,fn])},location:{origin:'https://test.invalid'}};
  const document={getElementById:()=>({}),querySelectorAll:()=>[],readyState:'loading'};
  const fetch=(url,opts)=>{sent.push([url,opts]);return Promise.resolve(url.includes('/__diag/')?{}:{status:401});};
  vm.runInNewContext(source,{window,document,fetch,URL});
  listeners.error({target:{href:'https://test.invalid/api/creative-canvas/assets/vendor-ABCdef12.js?secret=token'}});
  listeners.error({target:{href:'https://test.invalid/api/creative-canvas/assets/vendor-ABCdef12.js?other=private'}});
  listeners.error({target:{href:'https://test.invalid/api/creative-canvas/assets/main-ABCdef12.js?secret=1'}});
  listeners.error({target:{href:'https://test.invalid/api/creative-canvas/assets/third-ABCdef12.js'}});
  listeners.error({target:{href:'https://evil.invalid/api/creative-canvas/assets/other-ABCdef12.js?secret=1'}});
  for(let i=0;i<20;i++)listeners.error({message:'private',filename:'https://test.invalid/api/creative-canvas/assets/private-data.js'});
  for(const [,fn] of timers)fn();
  await new Promise(resolve=>setImmediate(resolve));
  const probes=sent.filter(([u])=>u.includes('/assets/'));
  assert.equal(probes.length,2);
  assert.deepEqual(probes.map(([u])=>u),['/api/creative-canvas/assets/vendor-ABCdef12.js','/api/creative-canvas/assets/main-ABCdef12.js']);
  for(const [,o] of probes){assert.equal(o.cache,'no-store');assert.equal(o.credentials,'same-origin');assert.equal(o.redirect,'manual');}
  const reports=sent.filter(([u])=>u.includes('/__diag/')).map(([u])=>u);
  for(const t of ['t10','t60','t120']) assert.ok(reports.some(u=>u.includes('/'+t+'/')),t+' was suppressed');
  assert.equal(reports.filter(u=>u.includes('/probe401/')).length,2);
  assert.ok(reports.length<=18);
  for(const url of reports)assert.doesNotMatch(url,/secret|private|token|evil/);
});

test('probes distinguish failed requests from HTML or Javascript responses without logging text', async () => {
  const source=readFileSync('apps/dashboard/public/canvas-startup-diagnostic-v2.js','utf8');
  const listeners={}, sent=[];let n=0;
  const window={addEventListener:(name,fn)=>{listeners[name]=fn},setTimeout:()=>{},location:{origin:'https://test.invalid'}};
  const document={getElementById:()=>null,querySelectorAll:()=>[]};
  const fetch=(url,opts)=>{sent.push([url,opts]);if(url.includes('/__diag/'))return Promise.resolve({});
    return ++n===1?Promise.resolve({status:200,headers:{get:()=> 'text/html; charset=utf-8'}}):Promise.reject(new Error('secret network text'));};
  vm.runInNewContext(source,{window,document,fetch,URL});
  listeners.error({target:{href:'https://test.invalid/api/creative-canvas/assets/first-ABCdef12.js'}});
  listeners.error({target:{href:'https://test.invalid/api/creative-canvas/assets/second-ABCdef12.js'}});
  await new Promise(resolve=>setImmediate(resolve));
  const reports=sent.filter(([u])=>u.includes('/__diag/')).map(([u])=>u);
  assert.ok(reports.some(u=>u.includes('/probe2xxhtml/')));
  assert.ok(reports.some(u=>u.includes('/probenetwork/')));
  for(const u of reports)assert.doesNotMatch(u,/secret|network text/);
});

test('a stalled asset probe times out and reports a bounded network result', async () => {
  const source=readFileSync('apps/dashboard/public/canvas-startup-diagnostic-v2.js','utf8');
  const listeners={}, sent=[], timers=[], cleared=[];
  class Controller { constructor(){this.signal={}} abort(){this.signal.onabort()}};
  const window={addEventListener:(name,fn)=>{listeners[name]=fn},setTimeout:(fn,ms)=>{timers.push([ms,fn]);return timers.length},clearTimeout:id=>cleared.push(id),AbortController:Controller,location:{origin:'https://test.invalid'}};
  const document={getElementById:()=>null,querySelectorAll:()=>[]};
  const fetch=(url,opts)=>{sent.push([url,opts]);if(url.includes('/__diag/'))return Promise.resolve({});return new Promise((_,reject)=>{opts.signal.onabort=()=>reject(new Error('aborted'))})};
  vm.runInNewContext(source,{window,document,fetch,URL});
  listeners.error({target:{href:'https://test.invalid/api/creative-canvas/assets/first-ABCdef12.js'}});
  assert.equal(timers.length,4);assert.equal(timers[3][0],10000);timers[3][1]();
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(sent.some(([u])=>u.includes('/probenetwork/')));assert.ok(cleared.includes(4));
});

test('nginx injects diagnostics only into the authenticated canvas document', async t => {
  const {mkdtempSync,rmSync,writeFileSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {execFileSync}=await import('node:child_process');
  const source=readFileSync('deploy/nginx.staging.conf','utf8');
  const block=source.match(/# BEGIN CANVAS STARTUP DIAGNOSTIC\n([\s\S]*?)# END CANVAS STARTUP DIAGNOSTIC/)?.[1];
  const map=source.match(/# BEGIN CANVAS STARTUP DIAGNOSTIC MAP\n([\s\S]*?)# END CANVAS STARTUP DIAGNOSTIC MAP/)?.[1];
  const assetsMap=source.match(/# BEGIN CANVAS OFFICIAL ASSETS MAP\n([\s\S]*?)# END CANVAS OFFICIAL ASSETS MAP/)?.[1];
  assert.ok(block && map,'canvas document proxy must install the diagnostic');
  const root=mkdtempSync(join(tmpdir(),'canvas-startup-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const location=block.replace('http://zenithjoy-api-staging:5200','http://127.0.0.1:8081');
  const conf=`events {} http { ${map} ${assetsMap} server { listen 8081; default_type text/html; if ($http_if_none_match != "") { return 304; } if ($http_cookie = "") { return 401; } return 200 '<html><head><title>Canvas</title></head><body>ok</body></html>'; } server { listen 8080; ${location} location / { proxy_pass http://127.0.0.1:8081; } } }`;
  writeFileSync(join(root,'nginx.conf'),conf);
  const id=execFileSync('docker',['run','-d','--rm','-p','127.0.0.1::8080','-v',`${root}/nginx.conf:/etc/nginx/nginx.conf:ro`,'nginx:alpine'],{encoding:'utf8'}).trim();
  t.after(()=>{try{execFileSync('docker',['rm','-f',id],{stdio:'ignore'})}catch{}});
  const port=execFileSync('docker',['port',id,'8080/tcp'],{encoding:'utf8'}).trim().split(':').at(-1);
  const base=`http://127.0.0.1:${port}`;
  await waitForNginx(port);
  const good=await fetch(base+'/api/creative-canvas/',{headers:{cookie:'session=fixture','accept-encoding':'gzip','if-none-match':'fixture'}});const html=await good.text();
  assert.equal(good.status,200);assert.match(html,/<head><script src="\/canvas-startup-diagnostic-v2.js\?v=3"><\/script>/);
  const denied=await fetch(base+'/api/creative-canvas/');assert.equal(denied.status,401);assert.doesNotMatch(await denied.text(),/canvas-startup-diagnostic-v2/);
  const other=await fetch(base+'/api/creative-canvas/api/features',{headers:{cookie:'session=fixture'}});assert.doesNotMatch(await other.text(),/canvas-startup-diagnostic-v2/);
});

test('diagnostic endpoint preserves authorization, status and original access log path', async t => {
  const {mkdtempSync,rmSync,writeFileSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {execFileSync}=await import('node:child_process');
  const source=readFileSync('deploy/nginx.staging.conf','utf8');
  const block=source.match(/# BEGIN CANVAS DIAGNOSTIC RESPONSE\n([\s\S]*?)# END CANVAS DIAGNOSTIC RESPONSE/)?.[1];
  assert.ok(block,'authenticated diagnostic response location must exist');
  const root=mkdtempSync(join(tmpdir(),'canvas-diag-response-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const location=block.replace('http://zenithjoy-api-staging:5200','http://127.0.0.1:8081');
  const conf=`events {} http { log_format diag '$request'; access_log /dev/stdout diag; server { listen 8081; location = /api/creative-canvas/status { add_header Cache-Control no-store always; if ($http_cookie = "") { return 401; } return 200 '{"available":true}'; } location / { return 418; } } server { listen 8080; location ^~ /api/creative-canvas/ { proxy_pass http://127.0.0.1:8081; ${location} } } }`;
  writeFileSync(join(root,'nginx.conf'),conf);
  const id=execFileSync('docker',['run','-d','--rm','-p','127.0.0.1::8080','-v',`${root}/nginx.conf:/etc/nginx/nginx.conf:ro`,'nginx:alpine'],{encoding:'utf8'}).trim();
  t.after(()=>{try{execFileSync('docker',['rm','-f',id],{stdio:'ignore'})}catch{}});
  const port=execFileSync('docker',['port',id,'8080/tcp'],{encoding:'utf8'}).trim().split(':').at(-1);
  const base=`http://127.0.0.1:${port}`;
  await waitForNginx(port);
  const path='/api/creative-canvas/__diag/probe401/vendor-ABCdef12.js';
  let authorized;
  for(let i=0;i<20;i++){try{authorized=await fetch(base+path,{headers:{cookie:'session=fixture'}});break}catch(error){if(i===19)throw error;await new Promise(resolve=>setTimeout(resolve,100));}}
  assert.equal(authorized.status,200);assert.match(authorized.headers.get('cache-control')||'',/no-store/);
  const denied=await fetch(base+path);assert.equal(denied.status,401);
  assert.equal((await fetch(base+path,{method:'POST',headers:{cookie:'session=fixture'}})).status,405);
  assert.equal((await fetch(base+'/api/creative-canvas/__diag/invalid/asset%3Fsecret',{headers:{cookie:'session=fixture'}})).status,418);
  assert.equal((await fetch(base+'/api/creative-canvas/api/system_stats',{headers:{cookie:'session=fixture'}})).status,418);
  const log=execFileSync('docker',['logs',id],{encoding:'utf8'});
  assert.match(log,/GET \/api\/creative-canvas\/__diag\/probe401\/vendor-ABCdef12\.js HTTP/);
});

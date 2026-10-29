import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('resource errors do not suppress timed status and probes are bounded and sanitized', async () => {
  const source=readFileSync('apps/dashboard/public/canvas-startup-diagnostic.js','utf8');
  const listeners={}, sent=[], timers=[];
  const window={addEventListener:(name,fn)=>{listeners[name]=fn},setTimeout:(fn,ms)=>{timers.push([ms,fn])},location:{origin:'https://test.invalid'}};
  const document={getElementById:()=>({}),querySelectorAll:()=>[],readyState:'loading'};
  const fetch=(url,opts)=>{sent.push([url,opts]);return Promise.resolve(opts.method==='GET'?{status:401}:{});};
  vm.runInNewContext(source,{window,document,fetch,URL});
  listeners.error({target:{href:'https://test.invalid/api/creative-canvas/assets/vendor-ABCdef12.js?secret=token'}});
  listeners.error({target:{href:'https://test.invalid/api/creative-canvas/assets/vendor-ABCdef12.js?other=private'}});
  listeners.error({target:{href:'https://test.invalid/api/creative-canvas/assets/main-ABCdef12.js?secret=1'}});
  listeners.error({target:{href:'https://test.invalid/api/creative-canvas/assets/third-ABCdef12.js'}});
  listeners.error({target:{href:'https://evil.invalid/api/creative-canvas/assets/other-ABCdef12.js?secret=1'}});
  for(let i=0;i<20;i++)listeners.error({message:'private',filename:'https://test.invalid/api/creative-canvas/assets/private-data.js'});
  for(const [,fn] of timers)fn();
  await new Promise(resolve=>setImmediate(resolve));
  const probes=sent.filter(([,o])=>o.method==='GET');
  assert.equal(probes.length,2);
  assert.deepEqual(probes.map(([u])=>u),['/api/creative-canvas/assets/vendor-ABCdef12.js','/api/creative-canvas/assets/main-ABCdef12.js']);
  for(const [,o] of probes){assert.equal(o.cache,'no-store');assert.equal(o.credentials,'same-origin');assert.equal(o.redirect,'manual');}
  const reports=sent.filter(([,o])=>o.method==='POST').map(([u])=>u);
  for(const t of ['t10','t60','t120']) assert.ok(reports.some(u=>u.includes('/'+t+'/')),t+' was suppressed');
  assert.equal(reports.filter(u=>u.includes('/probe401/')).length,2);
  assert.ok(reports.length<=18);
  for(const url of reports)assert.doesNotMatch(url,/secret|private|token|evil/);
});

test('probes distinguish failed requests from HTML or Javascript responses without logging text', async () => {
  const source=readFileSync('apps/dashboard/public/canvas-startup-diagnostic.js','utf8');
  const listeners={}, sent=[];let n=0;
  const window={addEventListener:(name,fn)=>{listeners[name]=fn},setTimeout:()=>{},location:{origin:'https://test.invalid'}};
  const document={getElementById:()=>null,querySelectorAll:()=>[]};
  const fetch=(url,opts)=>{sent.push([url,opts]);if(opts.method==='POST')return Promise.resolve({});
    return ++n===1?Promise.resolve({status:200,headers:{get:()=> 'text/html; charset=utf-8'}}):Promise.reject(new Error('secret network text'));};
  vm.runInNewContext(source,{window,document,fetch,URL});
  listeners.error({target:{href:'https://test.invalid/api/creative-canvas/assets/first-ABCdef12.js'}});
  listeners.error({target:{href:'https://test.invalid/api/creative-canvas/assets/second-ABCdef12.js'}});
  await new Promise(resolve=>setImmediate(resolve));
  const reports=sent.filter(([,o])=>o.method==='POST').map(([u])=>u);
  assert.ok(reports.some(u=>u.includes('/probe2xxhtml/')));
  assert.ok(reports.some(u=>u.includes('/probenetwork/')));
  for(const u of reports)assert.doesNotMatch(u,/secret|network text/);
});

test('nginx injects diagnostics only into the authenticated canvas document', async t => {
  const {mkdtempSync,rmSync,writeFileSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {execFileSync}=await import('node:child_process');
  const source=readFileSync('deploy/nginx.staging.conf','utf8');
  const block=source.match(/# BEGIN CANVAS STARTUP DIAGNOSTIC\n([\s\S]*?)# END CANVAS STARTUP DIAGNOSTIC/)?.[1];
  const map=source.match(/# BEGIN CANVAS STARTUP DIAGNOSTIC MAP\n([\s\S]*?)# END CANVAS STARTUP DIAGNOSTIC MAP/)?.[1];
  assert.ok(block && map,'canvas document proxy must install the diagnostic');
  const root=mkdtempSync(join(tmpdir(),'canvas-startup-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const location=block.replace('http://zenithjoy-api-staging:5200','http://127.0.0.1:8081');
  const conf=`events {} http { ${map} server { listen 8081; default_type text/html; if ($http_if_none_match != "") { return 304; } if ($http_cookie = "") { return 401; } return 200 '<html><head><title>Canvas</title></head><body>ok</body></html>'; } server { listen 8080; ${location} location / { proxy_pass http://127.0.0.1:8081; } } }`;
  writeFileSync(join(root,'nginx.conf'),conf);
  const id=execFileSync('docker',['run','-d','--rm','-p','127.0.0.1::8080','-v',`${root}/nginx.conf:/etc/nginx/nginx.conf:ro`,'nginx:alpine'],{encoding:'utf8'}).trim();
  t.after(()=>{try{execFileSync('docker',['rm','-f',id],{stdio:'ignore'})}catch{}});
  const port=execFileSync('docker',['port',id,'8080/tcp'],{encoding:'utf8'}).trim().split(':').at(-1);
  const base=`http://127.0.0.1:${port}`;
  const good=await fetch(base+'/api/creative-canvas/',{headers:{cookie:'session=fixture','accept-encoding':'gzip','if-none-match':'fixture'}});const html=await good.text();
  assert.equal(good.status,200);assert.match(html,/<head><script src="\/canvas-startup-diagnostic.js"><\/script>/);
  const denied=await fetch(base+'/api/creative-canvas/');assert.equal(denied.status,401);assert.doesNotMatch(await denied.text(),/canvas-startup-diagnostic/);
  const other=await fetch(base+'/api/creative-canvas/api/features',{headers:{cookie:'session=fixture'}});assert.doesNotMatch(await other.text(),/canvas-startup-diagnostic/);
});

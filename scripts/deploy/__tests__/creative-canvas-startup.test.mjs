import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('startup diagnostics report bounded categories without messages, URLs or user data', () => {
  const source=readFileSync('apps/dashboard/public/canvas-startup-diagnostic.js','utf8');
  const listeners={}, sent=[], timers=[];
  const window={addEventListener:(name,fn)=>{listeners[name]=fn},setTimeout:(fn,ms)=>{timers.push([ms,fn])}, location:{origin:'https://test.invalid'}};
  const document={getElementById:()=>({}),querySelectorAll:()=>[],readyState:'loading'};
  const fetch=(url,opts)=>{sent.push([url,opts]);return Promise.resolve()};
  vm.runInNewContext(source,{window,document,fetch,URL});
  listeners.error({message:'secret token unexpected token',filename:'https://test.invalid/api/creative-canvas/assets/index-ABCdef12.js?secret=1'});
  listeners.unhandledrejection({reason:{message:'https://private.example/user.jpg?token=secret'}});
  timers.find(x=>x[0]===10000)[1]();
  assert.equal(sent.length,4);assert.match(sent[0][0],/start\/ok/);
  for(const [url,opts] of sent){assert.match(url,/^\/api\/creative-canvas\/__diag\/[a-z0-9_-]+\/[a-zA-Z0-9_.-]+$/);assert.doesNotMatch(url,/secret|private|token|jpg/);assert.equal(opts.method,'POST');assert.equal(opts.credentials,'same-origin');}
  assert.match(sent[1][0],/syntax/);assert.match(sent[1][0],/index-ABCdef12.js/);
  listeners.error({target:{href:'https://test.invalid/api/creative-canvas/assets/vendor-ABCdef12.js'}});
  assert.match(sent.at(-1)[0],/resource\/vendor-ABCdef12.js/);
  for(let i=0;i<20;i++) listeners.error({message:'private',filename:'https://test.invalid/api/creative-canvas/assets/private-data.js'});
  assert.equal(sent.length,12);assert.doesNotMatch(sent.at(-1)[0],/private/);
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

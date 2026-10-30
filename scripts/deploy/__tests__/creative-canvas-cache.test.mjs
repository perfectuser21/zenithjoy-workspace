import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
async function waitForNginx(port) {
  let error;
  for (let attempt=0; attempt<40; attempt++) {
    try { await fetch(`http://127.0.0.1:${port}/`, {signal:AbortSignal.timeout(500)}); return; }
    catch (e) { error=e; await new Promise(resolve=>setTimeout(resolve,100)); }
  }
  throw error;
}


// Exercise the checked-in directives in a real nginx process and a fake,
// authenticated upstream; never touch the real service or staff data.
test('canvas static cache only applies to successful, fingerprinted assets and varies by identity', async t => {
  const source=readFileSync(resolve('deploy/nginx.staging.conf'),'utf8');
  const map=source.match(/# BEGIN CANVAS CACHE MAP\n([\s\S]*?)# END CANVAS CACHE MAP/)?.[1];
  const location=source.match(/# BEGIN CANVAS ASSET CACHE\n([\s\S]*?)# END CANVAS ASSET CACHE/)?.[1];
  assert.ok(map && location, 'cache directives must be part of staging nginx configuration');
  const root=mkdtempSync(join(tmpdir(),'canvas-nginx-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const nested=location.replace('http://zenithjoy-api-staging:5200', 'http://127.0.0.1:8081');
  const conf=`events {}\nhttp { ${map}\n server { listen 8081; add_header Cache-Control no-store always; add_header Vary Accept-Encoding always; default_type text/javascript; if ($http_cookie = "") { return 401; } if ($uri ~ missing) { return 404; } if ($uri ~ redirect) { return 302 /other; } if ($uri ~ forbidden) { return 403; } if ($uri ~ broken) { return 500; } if ($http_range != "") { return 206; } location ~ login { default_type text/html; add_header Cache-Control no-store always; return 200 '<html>login</html>'; } location / { return 200 'content'; } }\n server { listen 8080; location ^~ /api/creative-canvas/ { proxy_pass http://127.0.0.1:8081; ${nested} } } }`;
  writeFileSync(join(root,'nginx.conf'),conf);
  const id=execFileSync('docker',['run','-d','--rm','-p','127.0.0.1::8080','-v',`${root}/nginx.conf:/etc/nginx/nginx.conf:ro`,'nginx:alpine'],{encoding:'utf8'}).trim();
  t.after(()=>{try{execFileSync('docker',['rm','-f',id],{stdio:'ignore'})}catch{}});
  const port=execFileSync('docker',['port',id,'8080/tcp'],{encoding:'utf8'}).trim().split(':').at(-1);
  await waitForNginx(port);
  const get=(path,cookie='session=alice')=>fetch(`http://127.0.0.1:${port}/api/creative-canvas/${path}`,{headers:cookie?{cookie}:{},redirect:'manual'});
  const good=await get('assets/index-CqDKM-zt.js'); assert.equal(good.status,200); assert.equal(good.headers.get('cache-control'),'private, max-age=604800, immutable'); assert.match(good.headers.get('vary')||'',/cookie/i); assert.match(good.headers.get('vary')||'',/accept-encoding/i);
  for (const [path,cookie,status] of [['assets/index-CqDKM-zt.js','',401],['assets/login-CqDKM-zt.js','session=a',200],['assets/missing-CqDKM-zt.js','session=a',404],['assets/forbidden-CqDKM-zt.js','session=a',403],['assets/broken-CqDKM-zt.js','session=a',500],['assets/redirect-CqDKM-zt.js','session=a',302],['api/userdata/file-CqDKM-zt.js','session=a',200],['assets/plain.js','session=a',200]]) {
    const res=await get(path,cookie); assert.equal(res.status,status); assert.equal(res.headers.get('cache-control'),'no-store',path);
  }
  const range=await fetch(`http://127.0.0.1:${port}/api/creative-canvas/assets/index-CqDKM-zt.js`,{headers:{cookie:'session=alice',range:'bytes=0-1'}});
  assert.equal(range.status,206); assert.equal(range.headers.get('cache-control'),'no-store');
  const post=await fetch(`http://127.0.0.1:${port}/api/creative-canvas/assets/index-CqDKM-zt.js`,{method:'POST',headers:{cookie:'session=alice'}});
  assert.equal(post.headers.get('cache-control'),'no-store');
});

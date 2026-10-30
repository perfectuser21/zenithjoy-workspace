import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
async function waitForNginx(port) {
  let error;
  for (let attempt=0; attempt<40; attempt++) {
    try { await fetch(`http://127.0.0.1:${port}/`, {signal:AbortSignal.timeout(500)}); return; }
    catch (e) { error=e; await new Promise(resolve=>setTimeout(resolve,100)); }
  }
  throw error;
}


const sha='593af1d79767cefc3587c862dd3b3d90ff00530c5f83071522f8f9807c175346';
const names=['index-CqDKM-zt.js','rolldown-runtime-CM1DJQSe.js','vendor-datadog-CS-2l-KQ.js'];
const oldFragment='<script type="module" crossorigin src="./assets/'+names[0]+'"></script><link rel="modulepreload" crossorigin href="./assets/'+names[1]+'"><link rel="modulepreload" crossorigin href="./assets/'+names[2]+'">';

test('official wheel validation, path safety and complete release atomicity',()=>{
  execFileSync('python3',['scripts/deploy/__tests__/comfy-official-assets.test.py'],{stdio:'pipe'});
});

test('real nginx rewrites only matching authenticated HTML with a complete known release',async t=>{
  const source=readFileSync('deploy/nginx.staging.conf','utf8');
  const get=(begin,end)=>source.match(new RegExp(begin+'\\n([\\s\\S]*?)'+end))?.[1];
  const maps=get('# BEGIN CANVAS OFFICIAL ASSETS MAP','# END CANVAS OFFICIAL ASSETS MAP');
  const diag=get('# BEGIN CANVAS STARTUP DIAGNOSTIC MAP','# END CANVAS STARTUP DIAGNOSTIC MAP');
  const location=get('# BEGIN CANVAS STARTUP DIAGNOSTIC','# END CANVAS STARTUP DIAGNOSTIC');
  const assets=source.match(/    location \/assets \{([\s\S]*?)\n    \}/)?.[0];
  assert.ok(maps && diag && location && assets,'official asset directives must be present');
  const root=mkdtempSync(join(tmpdir(),'comfy-public-assets-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const shared=join(root,'shared'),release=join(shared,'assets/comfy',sha),folder=join(release,'assets');mkdirSync(folder,{recursive:true});
  for(const n of names)writeFileSync(join(folder,n),'public-static-'+n);
  writeFileSync(join(release,'manifest.json'),JSON.stringify({wheel_sha256:sha}));
  mkdirSync(join(release,'fonts'));for(const n of ['inter-latin-normal.woff2','inter-latin-italic.woff2','materialdesignicons-webfont.woff2'])writeFileSync(join(release,'fonts',n),'font-'+n);
  const testedLocation=location.replace('http://zenithjoy-api-staging:5200','http://127.0.0.1:8081').replaceAll('/usr/share/nginx/html/_shared_assets','/mnt/shared');
  const testedAssets=assets.replaceAll('/usr/share/nginx/html/_shared_assets','/mnt/shared');
  const oldHtml='<html><head>'+oldFragment+'</head><body>canvas</body></html>';
  const mismatchHtml=oldHtml.replace(names[0],'index-other-version.js');
  const conf=`events {} http { include /etc/nginx/mime.types; ${maps} ${diag} server { listen 8081; default_type text/html; add_header Content-Security-Policy "default-src 'self'; script-src 'self'" always; if ($http_cookie = "") { return 401; } if ($arg_version = mismatch) { return 200 '${mismatchHtml}'; } return 200 '${oldHtml}'; } server { listen 8080; ${testedLocation} ${testedAssets} location / { proxy_pass http://127.0.0.1:8081; } } }`;
  writeFileSync(join(root,'nginx.conf'),conf);
  const id=execFileSync('docker',['run','-d','--rm','-p','127.0.0.1::8080','-v',`${root}/nginx.conf:/etc/nginx/nginx.conf:ro`,'-v',`${shared}:/mnt/shared`,'nginx:alpine'],{encoding:'utf8'}).trim();
  t.after(()=>{try{execFileSync('docker',['rm','-f',id],{stdio:'ignore'})}catch{}});
  const port=execFileSync('docker',['port',id,'8080/tcp'],{encoding:'utf8'}).trim().split(':').at(-1),base=`http://127.0.0.1:${port}`;
  await waitForNginx(port);
  let response=await fetch(base+'/api/creative-canvas/');assert.equal(response.status,401);assert.doesNotMatch(await response.text(),/assets\/comfy/);
  response=await fetch(base+'/api/creative-canvas/',{headers:{cookie:'session=fixture'}});let html=await response.text();
  assert.equal(response.status,200);assert.match(response.headers.get('content-security-policy')||'',/script-src 'self'/);
  for(const n of names)assert.ok(html.includes(`/assets/comfy/${sha}/assets/${n}`),n);
  const entry=await fetch(base+`/assets/comfy/${sha}/assets/${names[0]}`);assert.equal(entry.status,200);assert.match(entry.headers.get('cache-control')||'',/public/);assert.equal(entry.headers.get('set-cookie'),null);assert.equal(await entry.text(),'public-static-'+names[0]);
  const font=await fetch(base+`/assets/comfy/${sha}/fonts/inter-latin-normal.woff2`);assert.equal(font.status,200);assert.equal(await font.text(),'font-inter-latin-normal.woff2');
  const absent=await fetch(base+`/assets/comfy/${sha}/assets/nope.js.map`);assert.equal(absent.status,404);assert.doesNotMatch(absent.headers.get('cache-control')||'',/public/);
  response=await fetch(base+'/api/creative-canvas/?version=mismatch',{headers:{cookie:'session=fixture'}});html=await response.text();assert.doesNotMatch(html,/assets\/comfy/);assert.ok(html.includes('./assets/'+names[1]));
  execFileSync('docker',['exec',id,'rm',`/mnt/shared/assets/comfy/${sha}/assets/${names[2]}`]);assert.equal((await fetch(base+`/assets/comfy/${sha}/assets/${names[2]}`)).status,404);response=await fetch(base+'/api/creative-canvas/',{headers:{cookie:'session=fixture'}});html=await response.text();assert.ok(html.includes(oldFragment),html);assert.doesNotMatch(html,/assets\/comfy/);
});

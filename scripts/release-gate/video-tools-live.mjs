import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const origin = 'https://staging-autopilot.zenjoymedia.media';
const candidate = process.argv[2];
assert.match(candidate, /^[a-f0-9]{40}$/);
const password = process.env.ZJ_STAGING_CANVAS_PASSWORD;
assert.ok(password, 'staging acceptance password is required');

async function verifyCandidate() {
  const response = await fetch(origin + '/api/health', {signal:AbortSignal.timeout(15000)});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).build?.sha, candidate, 'staging API does not match the candidate');
}

await verifyCandidate();
const anonymous = await fetch(origin + '/api/video-tools/config', {signal:AbortSignal.timeout(15000)});
assert.equal(anonymous.status, 401);

const browser = await chromium.launch({headless:true});
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const login = page.waitForResponse(r => r.url() === origin + '/api/auth/sign-in/email' && r.request().method() === 'POST');
  await page.goto(origin + '/login');
  await page.getByLabel('邮箱', {exact:true}).fill('ai-acceptance@zenithjoy.test');
  await page.getByLabel('密码', {exact:true}).fill(password);
  await page.getByRole('button', {name:'登录', exact:true}).click();
  assert.equal((await login).status(), 200);
  await page.waitForURL(url => url.pathname !== '/login', {timeout:15000});
  const status = await page.evaluate(async () => {
    const response = await fetch('/api/creative-canvas/status', {signal:AbortSignal.timeout(15000)});
    return {status:response.status, ...await response.json()};
  });
  assert.equal(status.status, 200);
  assert.equal(status.available, true);

  await page.goto(origin + '/creative-canvas');
  const open = page.getByRole('button', {name:'打开短视频分镜工作流'});
  await open.waitFor({timeout:120000});
  const [template] = await Promise.all([
    page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.origin === origin && url.pathname === '/api/creative-canvas/extensions/zenithjoy/short-video-wan.json';
    }, {timeout:120000}),
    open.click({timeout:120000}),
  ]);
  assert.equal(template.status(), 200);
  const frame = page.frames().find(child => child.url().startsWith(origin + '/api/creative-canvas/'));
  assert.ok(frame);
  const uploadLabel = '上传完整视频';
  await frame.waitForFunction(label =>
    window.app?.graph?._nodes?.some(node => node.widgets?.some(widget => widget.name === label)), uploadLabel, {timeout:45000});

  const responses = [];
  const uploadUrl = origin + '/api/video-tools/uploads';
  const isUpload = response => response.url() === uploadUrl && response.request().method() === 'POST';
  page.on('response', response => { if (isUpload(response)) responses.push(response.status()); });
  async function upload(name, bytes) {
    const chooser = page.waitForEvent('filechooser', {timeout:10000});
    await frame.evaluate(label => {
      const widget = window.app.graph._nodes.flatMap(node => node.widgets ?? []).find(w => w.name === label);
      widget.callback();
    }, uploadLabel);
    const response = page.waitForResponse(isUpload, {timeout:45000});
    await (await chooser).setFiles({name, mimeType:'video/mp4', buffer:bytes});
    return response;
  }

  const frameAssetId = () => frame.evaluate(() =>
    window.app.graph._nodes.flatMap(node => node.widgets ?? []).find(widget => widget.name === '原片视频ID')?.value);
  const before = await frameAssetId();
  const bad = await upload('invalid-release-smoke.mp4', Buffer.from('invalid video'));
  assert.equal(bad.status(), 400);
  assert.equal(typeof (await bad.json()).id, 'undefined');
  await frame.waitForFunction(previous =>
    window.app.graph._nodes.flatMap(node => node.widgets ?? []).find(widget => widget.name === '原片视频ID')?.value === previous,
  before, {timeout:15000});

  const clip = execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i','color=blue:s=160x90:r=24','-t','2',
    '-c:v','libx264','-pix_fmt','yuv420p','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1']);
  const good = await upload('release-canvas-upload.mp4', clip);
  assert.equal(good.status(), 200);
  const asset = await good.json();
  assert.equal(asset.kind, 'video');
  assert.match(asset.id, /^[a-f0-9-]{36}$/);
  await frame.waitForFunction(id =>
    window.app.graph._nodes.some(node => node.widgets?.some(widget => widget.name === '原片视频ID' && widget.value === id)),
  asset.id, {timeout:15000});
  assert.deepEqual(responses, [400, 200]);

  const signed = new URL(asset.url);
  assert.equal(signed.protocol, 'https:');
  assert.ok(signed.hostname.endsWith('.myqcloud.com'));
  const copy = await fetch(signed, {signal:AbortSignal.timeout(15000), redirect:'error'});
  assert.equal(copy.status, 200);
  assert.ok(Buffer.from(await copy.arrayBuffer()).equals(clip));
  signed.search = '';
  const publicProbe = await fetch(signed, {signal:AbortSignal.timeout(15000), redirect:'error'});
  assert.equal(publicProbe.status, 403);
  await verifyCandidate();

  console.log(JSON.stringify({candidate, login:200, anonymous:401, invalidUpload:400, upload:200,
    singleAsset:true, privateReadback:true, bytes:clip.length, sha256:createHash('sha256').update(clip).digest('hex')}));
} finally {
  await browser.close();
}

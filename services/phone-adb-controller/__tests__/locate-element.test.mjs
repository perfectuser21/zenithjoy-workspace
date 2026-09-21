// services/phone-adb-controller/__tests__/locate-element.test.mjs
//
// 视觉定位（截图 + 一句话 → 像素坐标）的守卫。此前这段逻辑内嵌在两个 shell 脚本里，
// 零测试覆盖；0921 晚它整条挂掉（模型配额耗尽）时，没有任何东西提前报警。
//
// 守三件：
//   · **提问必须用 UI-TARS 的官方 agent 协议**。实测：同一张图同一个元素，随意问
//     （"Output only the coordinate of X"）会把「商品」标签定到偏 925px 的地方；
//     换成 Thought/Action 协议后 8/8 全中。这个格式是死规矩，不是风格问题。
//   · **坐标解析取最后一个 (x,y)**——Thought 段里也可能出现数字对，动作在后面。
//   · **越界坐标一律判失败**。宁可这步报错走兜底，也不能盲点——RPA 里一次错点会让
//     后面每一步都在错的页面上继续错。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';

const SCRIPT = new URL('../locate-element.py', import.meta.url).pathname;
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** 起一个假模型服务，把收到的请求记下来，按预设内容回复 */
function startFakeModel(content) {
  const requests = [];
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        requests.push(JSON.parse(body || '{}'));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content } }] }));
      });
    });
    srv.listen(0, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${srv.address().port}`, requests, close: () => srv.close() });
    });
  });
}

// 必须异步：假模型服务与测试同进程，同步 spawn 会阻塞事件循环，
// 请求永远送不到服务端（wall-helpers 里踩过并写明了这条）。
function run(api, { desc = '「视频」标签', w = 1199, h = 2663 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'locate-'));
  const shot = join(dir, 's.png');
  writeFileSync(shot, TINY_PNG);
  return new Promise((resolve) => {
    const p = spawn('python3', [SCRIPT, shot, desc, String(w), String(h)], {
      env: { ...process.env, LOCATE_ENDPOINT: api.url, OPENROUTER_API_KEY: 'k-test' },
    });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}

test('从 UI-TARS 的 Action 里解析出坐标', async (t) => {
  const api = await startFakeModel("Thought: 我需要点击「视频」标签\nAction: click(start_box='<|box_start|>(313,347)<|box_end|>')");
  t.after(() => api.close());
  assert.equal((await run(api)).out, '313 347');
});

test('Thought 段里也有数字对时，取最后一个（动作在后面）', async (t) => {
  const api = await startFakeModel("Thought: 候选有 (10,20) 和 (30,40)，我选后者\nAction: click(start_box='<|box_start|>(500,600)<|box_end|>')");
  t.after(() => api.close());
  assert.equal((await run(api)).out, '500 600');
});

test('提问必须用 UI-TARS 官方 agent 协议——随意问会让它乱给坐标', async (t) => {
  const api = await startFakeModel("Action: click(start_box='<|box_start|>(1,2)<|box_end|>')");
  t.after(() => api.close());
  await run(api);
  const body = api.requests[0];
  const sys = body.messages.find((m) => m.role === 'system');
  assert.ok(sys, '没有 system 段——UI-TARS 要的是 agent 协议不是自由问答');
  assert.match(sys.content, /## Output Format/, 'system 里缺 Output Format');
  assert.match(sys.content, /Thought:/, 'system 里缺 Thought 约定');
  assert.match(sys.content, /click\(start_box=/, 'system 里缺 Action Space');
  const user = body.messages.find((m) => m.role === 'user');
  const text = user.content.find((c) => c.type === 'text').text;
  assert.match(text, /## User Instruction/, '用户段没按官方格式给指令');
  assert.match(text, /点击/, '指令要写成一个动作任务，不是光给个名词');
});

test('图片按 data:image/png;base64 传', async (t) => {
  const api = await startFakeModel("Action: click(start_box='<|box_start|>(1,2)<|box_end|>')");
  t.after(() => api.close());
  await run(api);
  const img = api.requests[0].messages.find((m) => m.role === 'user').content.find((c) => c.type === 'image_url');
  assert.match(img.image_url.url, /^data:image\/png;base64,/);
});

test('默认走 UI-TARS 模型', async (t) => {
  const api = await startFakeModel("Action: click(start_box='<|box_start|>(1,2)<|box_end|>')");
  t.after(() => api.close());
  await run(api);
  assert.match(api.requests[0].model, /ui-tars/i);
});

test('坐标落在屏幕外一律判失败，绝不拿去点', async (t) => {
  const api = await startFakeModel("Action: click(start_box='<|box_start|>(9999,5)<|box_end|>')");
  t.after(() => api.close());
  const r = await run(api);
  assert.notEqual(r.code, 0, '越界坐标居然成功了');
  assert.match(r.err, /out of range/);
});

test('模型没给坐标时判失败，不静默返回空坐标', async (t) => {
  const api = await startFakeModel('Thought: 我找不到这个元素\nAction: finished()');
  t.after(() => api.close());
  const r = await run(api);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /no coordinate/);
});

test('屏幕边界按 宽/高+1 算，贴边坐标算合法', async (t) => {
  const api = await startFakeModel("Action: click(start_box='<|box_start|>(1200,2664)<|box_end|>')");
  t.after(() => api.close());
  assert.equal((await run(api, { w: 1199, h: 2663 })).out, '1200 2664');
});

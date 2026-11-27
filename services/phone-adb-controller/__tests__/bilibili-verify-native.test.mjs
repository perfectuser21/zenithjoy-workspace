import test from 'node:test';
import assert from 'node:assert/strict';
import { createBilibiliNativeDevice, createBilibiliNativeReader, findBilibiliAuthorEditor, findBilibiliOwnEditor } from '../bilibili-verify-native.mjs';

const title = '傍晚的颜色，慢一点也很好';
const app = 'tv.danmaku.bili';
const main = app + '/tv.danmaku.bili.MainActivityV2';
const account = app + '/tv.danmaku.bili.ui.personinfo.PersonInfoActivity';
const text = (value, x, y, confidence = 1) => ({ text: value, confidence, box: [x, y, 0.05, 0.01] });

test('the manuscript manager OCR picks the exact original work as the list changes without trusting a row index', () => {
  const row = [
    text('稿件管理', 0.16, 0.06),
    text('新的作品', 0.49, 0.33),
    text('编辑', 0.69, 0.52),
    text('分享', 0.36, 0.78),
    text(title, 0.49, 0.60),
    text('数据', 0.49, 0.78),
    text('编辑', 0.69, 0.78),
    text('更多', 0.87, 0.78),
  ];
  assert.deepEqual(findBilibiliOwnEditor(row), [772, 1893]);
  assert.throws(() => findBilibiliOwnEditor(row.filter(item => item.text !== title)), /WORK_TITLE/);
  assert.throws(() => findBilibiliOwnEditor([...row, text('编辑', 0.69, 0.79)]), /WORK_EDIT/);
  assert.throws(() => findBilibiliOwnEditor(row.filter(item => item.text !== '数据')), /WORK_CONTROLS/);
});

test('author screen OCR can select the private editing affordance only against the exact account label', () => {
  const rows = [text('企业Ai员工智能体', 0.03, 0.31), text('编辑资料', 0.62, 0.26), text('分享', 0.85, 0.25)];
  assert.deepEqual(findBilibiliAuthorEditor(rows), [696, 639]);
  assert.throws(() => findBilibiliAuthorEditor(rows.slice(1)), /AUTHOR/);
});

test('device navigation binds the exact proprietary app and rejects a fabricated or stale capture without tapping', async () => {
  let focus = main;
  let time = 100;
  let screenshot = Buffer.from('screenshot');
  const calls = [];
  const device = createBilibiliNativeDevice({
    now: () => time,
    contentHash: bytes => bytes.toString(),
    ocr: () => [],
    pause: () => {},
    adb: async argv => {
      calls.push(argv);
      const command = argv.join(' ');
      if (command === 'shell dumpsys window') return Buffer.from('  mCurrentFocus=Window{123 u0 ' + focus + '}\n');
      if (command.startsWith('shell cmd package resolve-activity ')) return Buffer.from(app + '/.Main\n');
      if (command === 'exec-out screencap -p') return screenshot;
      if (command === 'exec-out uiautomator dump /dev/tty') {
        return Buffer.from('<?xml version="1.0"?><hierarchy></hierarchy>\nUI hierchary dumped to: /dev/tty');
      }
      return Buffer.alloc(0);
    },
  });
  await device.launchBilibili();
  assert.deepEqual(calls[1], ['shell', 'am', 'start', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', '-n', app + '/.Main']);
  await assert.rejects(device.openApprovedVideo(), /VIDEO_ROUTE/);
  focus = account;
  await device.openApprovedVideo();
  assert.deepEqual(calls.at(-1), ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d',
    'https://www.bilibili.com/video/BV1cLpG6cEHH', '-p', app]);
  await assert.rejects(device.navigationTap({ image: {}, x: 781, y: 1272 }), /TAP_STALE/);
  const first = await device.capture();
  time += 30001;
  await assert.rejects(device.navigationTap({ image: first, x: 781, y: 1272 }), /TAP_STALE/);
  const second = await device.capture();
  screenshot = Buffer.from('different window');
  await assert.rejects(device.navigationTap({ image: second, x: 781, y: 1272, requireSamePixels: true }), /TAP_PIXELS/);
  const third = await device.capture();
  await device.navigationTap({ image: third, x: 781, y: 1272, requireSamePixels: true });
  assert.deepEqual(calls.filter(args => args.slice(0, 3).join(' ') === 'shell input tap'),
    [['shell', 'input', 'tap', '781', '1272']]);
  await assert.rejects(device.navigationTap({ image: third, x: 781, y: 1272 }), /TAP_STALE/);
  assert.equal(Object.hasOwn(device, 'shell'), false);
});

test('the native reader refuses publish and unrelated queries before any app navigation', async () => {
  let uses = 0;
  const read = createBilibiliNativeReader({ launchBilibili: () => { uses += 1; } });
  for (const operation of ['publish', 'shell', 'verify_existing']) {
    await assert.rejects(read({ operation }), /BILIBILI_NATIVE_SCOPE/);
  }
  assert.equal(uses, 0);
});

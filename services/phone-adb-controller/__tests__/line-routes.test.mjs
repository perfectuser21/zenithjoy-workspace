// services/phone-adb-controller/__tests__/line-routes.test.mjs
//
// 回填路由：一批采收的产出该写进谁的飞书表。
//
// 0922 主理人定的模型：**隔离点在「活」上，不在「机器」上**。
//   「其实我们不应该绑手机⋯⋯只是回填数据的时候看用哪一套信号走。
//     生产要求你生产回填哪，研发要求你研发回填哪，这两个不一样。」
//
// 原实现按 profile（手机）路由，两个后果：
//   1. 一台手机只能服务一个租户——生产排满了想拿研发机顶上，做不到；
//   2. **认不出的 profile 一律兜底倒进金诺**（ROUTES[0]），美其名曰"避免静默丢数据"，
//      实际是静默污染别人的库。小彩(xiaolongxia)就不在任何 route 里，
//      它一旦开跑，悦升研发机的数据会全部写进金诺生产表。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { routeOf, isFallback, ROUTES } = require_('../line-routes.js');

test('按业务线名路由（活自己带的标记）', () => {
  assert.equal(routeOf('AI人工智能训练师').key, 'jinuo');
  assert.equal(routeOf('悦升云端').key, 'yuesheng');
});

test('按 key 路由', () => {
  assert.equal(routeOf('jinuo').key, 'jinuo');
  assert.equal(routeOf('yuesheng').key, 'yuesheng');
});

test('历史用法：按 profile 名路由仍然认（夜批还在这么传）', () => {
  // 不能一刀切断——夜批 batch2.sh 现在传的就是 profile 名。
  assert.equal(routeOf('jinoshengyuan-work').key, 'jinuo');
  assert.equal(routeOf('yueshengyun-work').key, 'yuesheng');
});

test('认不出的标记必须拒收，不能兜底倒进金诺', () => {
  // 这是本次要改的核心：旧实现 return ROUTES[0]，把认不出的数据全塞给金诺。
  // 「避免静默丢数据」的初衷是对的，但代价是静默污染别人的库——
  // 抛错更安全：数据不会丢（脚本会红、人看得见），也不会写错地方。
  assert.throws(() => routeOf('xiaolongxia'), /未配路由|unknown route/,
    'xiaolongxia 不在任何 route 里，却被兜底倒进金诺——悦升研发机会污染金诺生产表');
  assert.throws(() => routeOf('某个没见过的标记'), /未配路由|unknown route/);
});

test('空标记也拒收，不猜', () => {
  assert.throws(() => routeOf(''), /未配路由|unknown route/);
  assert.throws(() => routeOf(undefined), /未配路由|unknown route/);
});

test('研发活单独一条路由，落测试 base，绝不碰生产表', () => {
  const dev = routeOf('dev');
  assert.equal(dev.key, 'dev');
  assert.notEqual(dev.base, ROUTES.find((r) => r.key === 'jinuo').base, '研发路由指向了金诺的 base');
  assert.notEqual(dev.base, ROUTES.find((r) => r.key === 'yuesheng').base, '研发路由指向了悦升的 base');
});

test('研发路由是可识别的——调用方要能据此决定「不真发私信」', () => {
  assert.equal(routeOf('dev').isDev, true);
  assert.ok(!routeOf('AI人工智能训练师').isDev);
  assert.ok(!routeOf('悦升云端').isDev);
});

test('isFallback 退场：不再有 fallback 这回事', () => {
  // 保留导出以免调用方炸，但语义改成"永远 false"——因为已经不存在兜底了。
  assert.equal(isFallback('xiaolongxia'), false);
  assert.equal(isFallback('AI人工智能训练师'), false);
});

'use strict';
/**
 * CDPClient 单元测试
 *
 * 使用 Node.js 内置 test runner（无额外依赖，Node 18+）
 * 通过依赖注入 MockWs 替代真实 WebSocket，无需浏览器连接
 *
 * 运行：node --test packages/workflows/skills/weibo-publisher/scripts/__tests__/cdp-client.test.cjs
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { CDPClient } = require('../cdp-client.cjs');

// ============================================================
// 辅助：创建可控的 MockWs
// ============================================================
function createMockWs() {
  const handlers = {};
  const sent = [];

  const ws = {
    handlers,
    sent,
    on(event, cb) { handlers[event] = cb; },
    send(data) { sent.push(data); },
    close() { ws.closed = true; },
    closed: false,
    // 触发事件的辅助方法（测试用）
    emit(event, ...args) { if (handlers[event]) handlers[event](...args); },
  };

  return ws;
}

function createMockWsClass(ws) {
  return function MockWsClass(url) {
    MockWsClass.lastUrl = url;
    return ws;
  };
}

// ============================================================
// 构造器
// ============================================================
describe('CDPClient 构造器', () => {
  test('正确保存 wsUrl', () => {
    const client = new CDPClient('ws://localhost:9222', () => {});
    assert.equal(client.wsUrl, 'ws://localhost:9222');
  });

  test('初始状态：ws 为 null，msgId 为 0', () => {
    const client = new CDPClient('ws://test', () => {});
    assert.equal(client.ws, null);
    assert.equal(client.msgId, 0);
  });

  test('初始状态：callbacks 和 events 为空对象', () => {
    const client = new CDPClient('ws://test', () => {});
    assert.deepEqual(client.callbacks, {});
    assert.deepEqual(client.events, {});
  });
});

// ============================================================
// connect()
// ============================================================
describe('connect()', () => {
  test('使用注入的 WsClass 创建连接，传入正确 URL', async () => {
    const mockWs = createMockWs();
    const MockWsClass = createMockWsClass(mockWs);

    const client = new CDPClient('ws://localhost:19227', MockWsClass);
    const connectPromise = client.connect();

    // 触发 open 事件
    mockWs.emit('open');
    await connectPromise;

    assert.equal(MockWsClass.lastUrl, 'ws://localhost:19227');
    assert.equal(client.ws, mockWs);
  });

  test('open 事件触发时 Promise resolve', async () => {
    const mockWs = createMockWs();
    const client = new CDPClient('ws://test', createMockWsClass(mockWs));

    const connectPromise = client.connect();
    mockWs.emit('open');

    await assert.doesNotReject(connectPromise);
  });

  test('error 事件触发时 Promise reject', async () => {
    const mockWs = createMockWs();
    const client = new CDPClient('ws://test', createMockWsClass(mockWs));

    const connectPromise = client.connect();
    mockWs.emit('error', new Error('connection refused'));

    await assert.rejects(connectPromise, /connection refused/);
  });
});

// ============================================================
// send()
// ============================================================
describe('send()', () => {
  test('发送格式正确的 JSON 消息', async () => {
    const mockWs = createMockWs();
    const client = new CDPClient('ws://test', createMockWsClass(mockWs));
    const connectPromise = client.connect();
    mockWs.emit('open');
    await connectPromise;

    const sendPromise = client.send('Page.enable', { key: 'val' });

    // 模拟收到 CDP 响应
    const sentMsg = JSON.parse(mockWs.sent[0]);
    mockWs.emit('message', JSON.stringify({ id: sentMsg.id, result: { ok: true } }));

    const result = await sendPromise;
    assert.deepEqual(result, { ok: true });

    // 验证发送的格式
    assert.equal(sentMsg.method, 'Page.enable');
    assert.deepEqual(sentMsg.params, { key: 'val' });
    assert.ok(sentMsg.id > 0);
  });

  test('CDP 错误响应触发 reject', async () => {
    const mockWs = createMockWs();
    const client = new CDPClient('ws://test', createMockWsClass(mockWs));
    const connectPromise = client.connect();
    mockWs.emit('open');
    await connectPromise;

    const sendPromise = client.send('DOM.getDocument');
    const sentMsg = JSON.parse(mockWs.sent[0]);
    mockWs.emit('message', JSON.stringify({
      id: sentMsg.id,
      error: { message: 'DOM not enabled' }
    }));

    await assert.rejects(sendPromise, /DOM not enabled/);
  });

  test('msgId 每次调用递增', async () => {
    const mockWs = createMockWs();
    const client = new CDPClient('ws://test', createMockWsClass(mockWs));
    const connectPromise = client.connect();
    mockWs.emit('open');
    await connectPromise;

    const p1 = client.send('Page.enable');
    const p2 = client.send('Runtime.enable');

    const msgs = mockWs.sent.map(s => JSON.parse(s));
    assert.equal(msgs[0].id, 1);
    assert.equal(msgs[1].id, 2);

    // 响应两个请求，取消 60s 超时计时器，避免测试结束后产生孤儿 Promise
    mockWs.emit('message', JSON.stringify({ id: msgs[0].id, result: {} }));
    mockWs.emit('message', JSON.stringify({ id: msgs[1].id, result: {} }));
    await Promise.all([p1, p2]);
  });

  test('回调消费后从 callbacks 中移除', async () => {
    const mockWs = createMockWs();
    const client = new CDPClient('ws://test', createMockWsClass(mockWs));
    const connectPromise = client.connect();
    mockWs.emit('open');
    await connectPromise;

    const sendPromise = client.send('Page.enable');
    const sentMsg = JSON.parse(mockWs.sent[0]);
    mockWs.emit('message', JSON.stringify({ id: sentMsg.id, result: {} }));
    await sendPromise;

    // 回调已被消费并删除
    assert.equal(Object.keys(client.callbacks).length, 0);
  });
});

// ============================================================
// on() - 事件订阅
// ============================================================
describe('on()', () => {
  test('注册事件处理器并在消息到来时触发', async () => {
    const mockWs = createMockWs();
    const client = new CDPClient('ws://test', createMockWsClass(mockWs));
    const connectPromise = client.connect();
    mockWs.emit('open');
    await connectPromise;

    const receivedParams = [];
    client.on('Page.loadEventFired', params => receivedParams.push(params));

    // 模拟收到 CDP 事件
    mockWs.emit('message', JSON.stringify({
      method: 'Page.loadEventFired',
      params: { timestamp: 12345 }
    }));

    assert.equal(receivedParams.length, 1);
    assert.deepEqual(receivedParams[0], { timestamp: 12345 });
  });

  test('同一事件可注册多个处理器', async () => {
    const mockWs = createMockWs();
    const client = new CDPClient('ws://test', createMockWsClass(mockWs));
    const connectPromise = client.connect();
    mockWs.emit('open');
    await connectPromise;

    const calls = [];
    client.on('Network.requestWillBeSent', () => calls.push(1));
    client.on('Network.requestWillBeSent', () => calls.push(2));

    mockWs.emit('message', JSON.stringify({
      method: 'Network.requestWillBeSent',
      params: {}
    }));

    assert.equal(calls.length, 2);
  });
});

// ============================================================
// close()
// ============================================================
describe('close()', () => {
  test('关闭 WebSocket 连接', async () => {
    const mockWs = createMockWs();
    const client = new CDPClient('ws://test', createMockWsClass(mockWs));
    const connectPromise = client.connect();
    mockWs.emit('open');
    await connectPromise;

    client.close();

    assert.ok(mockWs.closed);
  });

  test('ws 为 null 时 close() 不抛出错误', () => {
    const client = new CDPClient('ws://test', () => {});
    assert.doesNotThrow(() => client.close());
  });
});

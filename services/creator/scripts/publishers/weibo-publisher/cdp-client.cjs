'use strict';
/**
 * CDP 客户端 - Chrome DevTools Protocol WebSocket 客户端
 *
 * 依赖注入设计：通过构造器参数传入 WebSocket 实现，便于单元测试
 */

/**
 * CDPClient - 封装 CDP WebSocket 通信
 *
 * @param {string} wsUrl - WebSocket 调试地址
 * @param {Function} [WsClass] - WebSocket 构造器（可注入用于测试，默认使用 ws 库）
 */
class CDPClient {
  constructor(wsUrl, WsClass) {
    this.wsUrl = wsUrl;
    this.WsClass = WsClass || require('ws');
    this.ws = null;
    this.msgId = 0;
    this.callbacks = {};
    this.events = {};
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new this.WsClass(this.wsUrl);
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
      this.ws.on('message', data => {
        const msg = JSON.parse(data);
        if (msg.id && this.callbacks[msg.id]) {
          this.callbacks[msg.id](msg);
          delete this.callbacks[msg.id];
        }
        if (msg.method && this.events[msg.method]) {
          this.events[msg.method].forEach(cb => cb(msg.params));
        }
      });
    });
  }

  on(event, callback) {
    if (!this.events[event]) this.events[event] = [];
    this.events[event].push(callback);
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      const timer = setTimeout(() => {
        if (this.callbacks[id]) {
          delete this.callbacks[id];
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 60000);
      this.callbacks[id] = msg => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      };
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

module.exports = { CDPClient };

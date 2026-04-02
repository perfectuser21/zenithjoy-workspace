#!/usr/bin/env node
/**
 * 快手会话状态检查脚本
 *
 * 功能：通过 CDP 连接 Windows PC 浏览器，检查快手创作者中心会话是否有效。
 *       不进行任何发布操作，纯检查。
 *
 * 用法：
 *   NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
 *     node check-kuaishou-session.cjs
 *
 * 退出码：
 *   0 - 会话有效 [SESSION_OK]
 *   1 - CDP 连接失败 [CDP_ERROR] 或页面超时 [TIMEOUT]
 *   2 - 会话已过期 [SESSION_EXPIRED]
 *
 * 环境要求：
 *   NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules
 */

'use strict';

const WebSocket = require('ws');
const http = require('http');

const { isLoginRedirect, isPublishPageReached, PUBLISH_URLS, formatSessionStatus } = require('./utils.cjs');

const CDP_PORT = 19223;
const WINDOWS_IP = '100.97.242.124';
const CHECK_URL = PUBLISH_URLS[0];
const TIMEOUT_MS = 10000;

function cdpGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://${WINDOWS_IP}:${CDP_PORT}${path}`, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON 解析失败: ${e.message}`));
        }
      });
    });
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error('TIMEOUT'));
    });
    req.on('error', reject);
  });
}

async function connectCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let msgId = 0;
    const callbacks = {};

    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('TIMEOUT'));
    }, TIMEOUT_MS);

    ws.on('open', () => {
      clearTimeout(timer);
      resolve({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const id = ++msgId;
            callbacks[id] = msg => {
              if (msg.error) rej(new Error(msg.error.message));
              else res(msg.result);
            };
            ws.send(JSON.stringify({ id, method, params }));
            setTimeout(() => {
              if (callbacks[id]) {
                delete callbacks[id];
                rej(new Error(`CDP timeout: ${method}`));
              }
            }, TIMEOUT_MS);
          });
        },
        close() { ws.close(); },
      });
    });
    ws.on('error', err => { clearTimeout(timer); reject(err); });
    ws.on('message', data => {
      const msg = JSON.parse(data);
      if (msg.id && callbacks[msg.id]) {
        callbacks[msg.id](msg);
        delete callbacks[msg.id];
      }
    });
  });
}

async function checkSession() {
  let cdp = null;

  try {
    // 1. 获取页面列表
    let pages;
    try {
      pages = await cdpGet('/json');
    } catch (err) {
      const s = formatSessionStatus('cdp_error');
      console.error(`\n${s.tag} ${s.message}`);
      if (err.message === 'TIMEOUT') {
        const t = formatSessionStatus('timeout');
        console.error(`${t.tag} ${t.message}`);
        process.exit(t.exitCode);
      }
      process.exit(s.exitCode);
    }

    // 2. 选择快手页面（优先），否则选第一个页面
    const page = pages.find(p => p.type === 'page' && p.url.includes('kuaishou.com'))
      || pages.find(p => p.type === 'page');

    if (!page) {
      const s = formatSessionStatus('cdp_error');
      console.error(`\n${s.tag} 未找到任何浏览器页面`);
      process.exit(s.exitCode);
    }

    // 3. 连接 CDP
    cdp = await connectCDP(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // 4. 导航到创作者中心发布页
    await cdp.send('Page.navigate', { url: CHECK_URL });

    // 等待页面加载（最多 8 秒）
    await new Promise(r => setTimeout(r, 5000));

    // 5. 读取当前 URL
    const urlResult = await cdp.send('Runtime.evaluate', {
      expression: 'window.location.href',
      returnByValue: true,
    });
    const currentUrl = urlResult.result.value;

    // 6. 判断状态
    if (isLoginRedirect(currentUrl)) {
      const s = formatSessionStatus('expired', currentUrl);
      console.error(`\n${s.tag} ${s.message}`);
      cdp.close();
      process.exit(s.exitCode);
    }

    if (isPublishPageReached(currentUrl, CHECK_URL)) {
      const s = formatSessionStatus('ok', currentUrl);
      console.log(`\n${s.tag} ${s.message}`);
      cdp.close();
      process.exit(s.exitCode);
    }

    // URL 落在 kuaishou.com 但非发布页，也不是登录页 → 仍视为 OK
    if (currentUrl.includes('cp.kuaishou.com')) {
      const s = formatSessionStatus('ok', currentUrl);
      console.log(`\n${s.tag} ${s.message}`);
      cdp.close();
      process.exit(s.exitCode);
    }

    // 未知状态
    const s = formatSessionStatus('expired', currentUrl);
    console.error(`\n${s.tag} ${s.message}`);
    cdp.close();
    process.exit(s.exitCode);

  } catch (err) {
    if (cdp) cdp.close();
    if (err.message === 'TIMEOUT') {
      const s = formatSessionStatus('timeout');
      console.error(`\n${s.tag} ${s.message}`);
      process.exit(s.exitCode);
    }
    const s = formatSessionStatus('cdp_error');
    console.error(`\n${s.tag} ${s.message}: ${err.message}`);
    process.exit(s.exitCode);
  }
}

checkSession();

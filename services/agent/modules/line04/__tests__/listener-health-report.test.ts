// modules/line04/__tests__/listener-health-report.test.ts
//
// Sprint 06221906 — agent 自愈件 4：自检上报增强（line04 模块侧）。
//
// listen_chat 把扫描诊断写到本地健康文件（found_window / 最近一次成功送达）。
// line04 模块读它 + 自己持有的 child 进程存活态，合成 listen_chat 真实健康，
// 通过 IPC {type:'status', ...} 上报给 core → 随心跳 module_status 上报中台。

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectListenerHealth, buildHealthStatusMessage } from '../handlers/wechat-rpa';

describe('collectListenerHealth — 合成 listen_chat 真实健康', () => {
  function mkHealthFile(content: unknown): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-lh-'));
    const p = path.join(dir, 'zj-listener-health.json');
    fs.writeFileSync(p, JSON.stringify(content));
    return p;
  }

  it('进程存活 + 健康文件含 found_window/last_delivery → 合成完整健康', () => {
    const p = mkHealthFile({
      found_window: true,
      login_present: true,
      last_delivery_ts: 1750000000000,
      sessions_seen: 5,
    });
    const h = collectListenerHealth({ healthFile: p, listenerAlive: true });
    expect(h.listener_alive).toBe(true);
    expect(h.found_window).toBe(true);
    expect(h.last_delivery_ts).toBe(1750000000000);
    expect(h.ok).toBe(true);
  });

  it('进程不在 → ok:false, listener_alive:false（不管健康文件多新）', () => {
    const p = mkHealthFile({ found_window: true });
    const h = collectListenerHealth({ healthFile: p, listenerAlive: false });
    expect(h.listener_alive).toBe(false);
    expect(h.ok).toBe(false);
    expect(h.reason).toMatch(/listen_chat|进程/);
  });

  it('进程在但 found_window=false（微信窗口没找到）→ ok:false 但 listener_alive:true', () => {
    const p = mkHealthFile({ found_window: false, login_present: false });
    const h = collectListenerHealth({ healthFile: p, listenerAlive: true });
    expect(h.listener_alive).toBe(true);
    expect(h.found_window).toBe(false);
    expect(h.ok).toBe(false);
  });

  it('健康文件不存在 → 不抛，按进程存活态给保守结论', () => {
    const h = collectListenerHealth({ healthFile: '/no/such/file.json', listenerAlive: true });
    expect(h.listener_alive).toBe(true);
    // 没诊断文件时 found_window 未知 → undefined，不谎报 true
    expect(h.found_window).toBeUndefined();
  });

  it('buildHealthStatusMessage 产出 IPC status 消息（type:status + 健康字段）', () => {
    const msg = buildHealthStatusMessage({
      ok: true,
      listener_alive: true,
      found_window: true,
      last_delivery_ts: 1750000000000,
    });
    expect(msg.type).toBe('status');
    expect(msg.ok).toBe(true);
    expect(msg.listener_alive).toBe(true);
    expect(msg.found_window).toBe(true);
    expect(msg.last_delivery_ts).toBe(1750000000000);
  });
});

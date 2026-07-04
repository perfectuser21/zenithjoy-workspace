// modules/line04/__tests__/watchdog-bom-health.test.ts
//
// Bug 6 — watchdog BOM 污染（staging 7bugs / 1.0.108）
//
// 根因：健康文件 zj-listener-health.json 由 Python（Windows）写入，
// 可能是 utf-8-sig 格式（含 BOM：0xEF 0xBB 0xBF）。
// fs.readFileSync(file, 'utf-8') 后直接 JSON.parse 遇 BOM 会失败，
// 导致 watchdog 误判监听器为不健康（catch → 按保守结论，found_window 未知）。
//
// 修法：collectListenerHealth 读取健康文件时，先去除 BOM（﻿）再 parse。
// 本文件是永久 regression test。

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectListenerHealth } from '../handlers/wechat-rpa';

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zj-bom-test-'));
}

describe('Bug 6: watchdog BOM 容忍', () => {
  it('健康文件含 UTF-8 BOM 时仍能正确解析（不误判为不健康）', () => {
    const dir = mkTmpDir();
    const file = path.join(dir, 'zj-listener-health.json');

    // Python utf-8-sig 写入的 JSON 文件会在开头加 BOM（﻿）
    const payload = { found_window: true, login_present: true, last_delivery_ts: 1750000000000, sessions_seen: 3 };
    const jsonStr = JSON.stringify(payload);
    // 写入含 BOM 的文件（模拟 Python utf-8-sig 写入）
    fs.writeFileSync(file, '﻿' + jsonStr, 'utf-8');

    const h = collectListenerHealth({ healthFile: file, listenerAlive: true });

    // 有 BOM 但内容正确，必须解析成功，not 误判为不健康
    expect(h.found_window).toBe(true);
    expect(h.login_present).toBe(true);
    expect(h.last_delivery_ts).toBe(1750000000000);
    expect(h.ok).toBe(true);
  });

  it('健康文件含 CRLF 行尾时仍能正确解析（Windows Python 写入场景）', () => {
    const dir = mkTmpDir();
    const file = path.join(dir, 'zj-listener-health.json');

    // Windows 环境 Python 可能写入 CRLF 行尾的 JSON
    const payload = { found_window: true, login_present: true, sessions_seen: 5 };
    // 手动构造含 CRLF 的 JSON 字符串
    const jsonWithCrlf = '{\r\n  "found_window": true,\r\n  "login_present": true,\r\n  "sessions_seen": 5\r\n}';
    fs.writeFileSync(file, jsonWithCrlf, 'utf-8');

    const h = collectListenerHealth({ healthFile: file, listenerAlive: true });

    expect(h.found_window).toBe(true);
    expect(h.login_present).toBe(true);
    expect(h.sessions_seen).toBe(5);
  });

  it('健康文件同时含 BOM + CRLF 时仍能解析（最坏情况）', () => {
    const dir = mkTmpDir();
    const file = path.join(dir, 'zj-listener-health.json');

    const jsonWithBomAndCrlf = '﻿{\r\n  "found_window": true,\r\n  "last_delivery_ts": 1750000000001\r\n}';
    fs.writeFileSync(file, jsonWithBomAndCrlf, 'utf-8');

    const h = collectListenerHealth({ healthFile: file, listenerAlive: true });

    expect(h.found_window).toBe(true);
    expect(h.last_delivery_ts).toBe(1750000000001);
    expect(h.ok).toBe(true);
  });

  it('正常 UTF-8 无 BOM 文件仍正常工作（不退化）', () => {
    const dir = mkTmpDir();
    const file = path.join(dir, 'zj-listener-health.json');

    fs.writeFileSync(file, JSON.stringify({
      found_window: true,
      login_present: true,
      last_delivery_ts: 1750000000002,
      sessions_seen: 7,
    }), 'utf-8');

    const h = collectListenerHealth({ healthFile: file, listenerAlive: true });

    expect(h.found_window).toBe(true);
    expect(h.ok).toBe(true);
    expect(h.sessions_seen).toBe(7);
  });

  it('BOM 文件 + 进程不在时 ok 仍为 false（进程挂是决定性因素）', () => {
    const dir = mkTmpDir();
    const file = path.join(dir, 'zj-listener-health.json');

    fs.writeFileSync(file, '﻿' + JSON.stringify({ found_window: true }), 'utf-8');

    const h = collectListenerHealth({ healthFile: file, listenerAlive: false });

    // 即使 BOM 被正确处理、健康文件正常，进程不在 → ok 仍为 false
    expect(h.listener_alive).toBe(false);
    expect(h.ok).toBe(false);
  });
});

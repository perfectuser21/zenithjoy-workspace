/**
 * ws1 Agent wechat-rpa handler 端到端测试。
 *
 * 真 spawn services/agent/wechat-rpa/qr_bind.py --dryrun 子进程，校验：
 *   1) handler 调用 child_process.spawn 启 python qr_bind.py
 *   2) 子进程 dryrun 模式输出 JSON {ok:true, dryRun:true, wechat_id, nickname}
 *   3) handler 把 receipt 经 emit() 回报
 *
 * 注：本测试需要系统装 Python 3 + qr_bind.py 存在；ws1 commit 2 写最简 stub 让它通过。
 * ws2 会重写完整 qr_bind.py。
 */

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const QR_BIND_PY = path.join(
  REPO_ROOT,
  'services',
  'agent',
  'wechat-rpa',
  'qr_bind.py',
);
const HANDLER_TS = path.join(
  REPO_ROOT,
  'services',
  'agent',
  'src',
  'handlers',
  'wechat-rpa.ts',
);

describe('ws1 wechat-rpa handler — ARTIFACT 校验', () => {
  it('services/agent/src/handlers/wechat-rpa.ts 存在', () => {
    expect(fs.existsSync(HANDLER_TS)).toBe(true);
  });

  it('handler 含 import { spawn } from child_process', () => {
    const src = fs.readFileSync(HANDLER_TS, 'utf-8');
    expect(src).toMatch(/import\s*\{\s*spawn\s*\}\s*from\s+['"]child_process['"]/);
  });

  it('handler 含 spawn(...python.*qr_bind.py...) 调用', () => {
    const src = fs.readFileSync(HANDLER_TS, 'utf-8');
    // 任何形式 spawn(<python>, [..., qr_bind.py, ...]) 都行
    expect(src).toMatch(/spawn\s*\(/);
    expect(src).toMatch(/qr_bind\.py/);
  });

  it('handler 注册 4 类 task type（wechat_qr_bind/listen_start/send_chat/send_moment）', () => {
    const src = fs.readFileSync(HANDLER_TS, 'utf-8');
    expect(src).toMatch(/wechat_qr_bind/);
    expect(src).toMatch(/wechat_listen_start/);
    expect(src).toMatch(/wechat_send_chat/);
    expect(src).toMatch(/wechat_send_moment/);
  });
});

describe('ws1 qr_bind.py --dryrun（端到端 spawn Python）', () => {
  it('services/agent/wechat-rpa/qr_bind.py 存在', () => {
    expect(fs.existsSync(QR_BIND_PY)).toBe(true);
  });

  it('python3 qr_bind.py --dryrun → JSON {ok:true, dryRun:true, wechat_id, nickname}', () => {
    const result = spawnSync('python3', [QR_BIND_PY, '--dryrun'], {
      encoding: 'utf-8',
      timeout: 10000,
    });
    expect(result.status).toBe(0);
    // stdout 最后一行应该是 JSON
    const lines = result.stdout.trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const lastLine = lines[lines.length - 1];
    let json: any;
    expect(() => {
      json = JSON.parse(lastLine);
    }).not.toThrow();
    expect(json.ok).toBe(true);
    expect(json.dryRun).toBe(true);
    expect(typeof json.wechat_id).toBe('string');
    expect(json.wechat_id.length).toBeGreaterThan(0);
    expect(typeof json.nickname).toBe('string');
  });
});

describe('ws1 handler dispatch — 真调 handler 端到端', () => {
  it('handleWechatRpa({type:wechat_qr_bind, dryrun:true}) → emit task_result ok:true 含 wechat_id', async () => {
    // 动态 import handler；避免 vitest 顶层 esbuild 解析时找不到模块
    const handlerPath = path.relative(__dirname, HANDLER_TS).replace(/\.ts$/, '');
    const mod: any = await import(handlerPath);
    expect(typeof mod.handleWechatRpa).toBe('function');

    const emitted: any[] = [];
    const emit = (m: any) => emitted.push(m);
    const makeMsg = (type: string, payload: any, taskId?: string) => ({
      type,
      payload,
      taskId,
    });

    await mod.handleWechatRpa(
      'task-test-1',
      { type: 'wechat_qr_bind', dryrun: true },
      emit,
      makeMsg,
    );

    // 至少有一个 task_result 消息
    const results = emitted.filter((m) => m.type === 'task_result');
    expect(results.length).toBeGreaterThanOrEqual(1);
    const last = results[results.length - 1];
    expect(last.payload.ok).toBe(true);
    expect(last.payload.wechat_id).toBeTruthy();
  });
});

/**
 * Path 4 Sprint 1 ws5 — send_moment.py / send_chat.py REAL_PUBLISH=0 dryrun（合同 RED）。
 *
 * 真 spawn Python 子进程校验：
 *   1) send_moment.py 含 REAL_PUBLISH 字面量 + unittest.mock.MagicMock 字符串（mock 路径存在）
 *   2) REAL_PUBLISH=0 + stdin JSON → exit 0 + stdout 末尾 JSON {ok:true, dryRun:true, sent_at:ISO}
 *   3) python -m trace --trace 验证 REAL_PUBLISH=0 时 pyautogui.click/write/press/hotkey 调用次数 = 0
 *   4) send_chat.py 同上结构（含 REAL_PUBLISH + dryRun 输出）
 *
 * 注：tests/ws5/** 在 vitest.config.ts 里被 exclude，不会进 CI vitest 集；
 * 这里作为合同 RED 验证文件，由 sprint-evaluator 在合同验证阶段 spawn python 校验。
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const RPA_DIR = path.join(REPO_ROOT, 'services', 'agent', 'wechat-rpa');
const SEND_MOMENT = path.join(RPA_DIR, 'send_moment.py');
const SEND_CHAT = path.join(RPA_DIR, 'send_chat.py');

describe('ws5 send_moment.py — 文件存在 + REAL_PUBLISH 字面量 + MagicMock 路径', () => {
  it('文件存在', () => {
    expect(fs.existsSync(SEND_MOMENT)).toBe(true);
  });

  it('源文件含 REAL_PUBLISH 字面量', () => {
    const src = fs.readFileSync(SEND_MOMENT, 'utf-8');
    expect(src).toMatch(/REAL_PUBLISH/);
  });

  it('源文件含 unittest.mock.MagicMock 或 MagicMock 字面量（dryrun 路径）', () => {
    const src = fs.readFileSync(SEND_MOMENT, 'utf-8');
    expect(src).toMatch(/MagicMock|unittest\.mock/);
  });

  it('源文件含 visible_group 字段读取（朋友圈分组）', () => {
    const src = fs.readFileSync(SEND_MOMENT, 'utf-8');
    expect(src).toMatch(/visible_group/);
  });
});

describe('ws5 send_moment.py REAL_PUBLISH=0 dryrun（spawn python3）', () => {
  it('REAL_PUBLISH=0 + stdin {content,visible_group} → exit 0 + JSON {ok:true, dryRun:true}', () => {
    const stdin = JSON.stringify({
      content: '测试朋友圈',
      visible_group: 'AI 测试',
    });
    const r = spawnSync('python3', [SEND_MOMENT], {
      encoding: 'utf-8',
      timeout: 10_000,
      input: stdin,
      env: {
        ...process.env,
        REAL_PUBLISH: '0',
      },
    });
    expect(r.status).toBe(0);
    const stdout = r.stdout || '';
    const lines = stdout.trim().split('\n');
    const lastLine = lines[lines.length - 1];
    const parsed = JSON.parse(lastLine);
    expect(parsed.ok).toBe(true);
    expect(parsed.dryRun).toBe(true);
    expect(typeof parsed.sent_at).toBe('string');
    expect(parsed.sent_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('REAL_PUBLISH=0 时 pyautogui.click/write/press/hotkey 调用次数 = 0（trace 验证）', () => {
    const traceFile = `/tmp/ws5-send-moment-trace-${Date.now()}.txt`;
    const stdin = JSON.stringify({
      content: '测试 trace',
      visible_group: 'AI 测试',
    });
    const r = spawnSync(
      'python3',
      ['-m', 'trace', '--trace', SEND_MOMENT],
      {
        encoding: 'utf-8',
        timeout: 15_000,
        input: stdin,
        env: { ...process.env, REAL_PUBLISH: '0' },
      },
    );
    fs.writeFileSync(traceFile, r.stdout || '');
    const trace = (r.stdout || '') + (r.stderr || '');
    // 检查 trace 输出里 pyautogui.click / write / press / hotkey 出现次数
    const matches = trace.match(/pyautogui\.(click|write|press|hotkey)\b/g) || [];
    expect(matches.length).toBe(0);
  });
});

describe('ws5 send_chat.py — 文件存在 + REAL_PUBLISH 字面量', () => {
  it('文件存在', () => {
    expect(fs.existsSync(SEND_CHAT)).toBe(true);
  });

  it('源文件含 REAL_PUBLISH 字面量', () => {
    const src = fs.readFileSync(SEND_CHAT, 'utf-8');
    expect(src).toMatch(/REAL_PUBLISH/);
  });

  it('源文件含 wechat_id 字段读取', () => {
    const src = fs.readFileSync(SEND_CHAT, 'utf-8');
    expect(src).toMatch(/wechat_id/);
  });

  it('REAL_PUBLISH=0 + stdin {target,wechat_id,message} → exit 0 + dryRun:true', () => {
    const stdin = JSON.stringify({
      target: '客户A',
      wechat_id: 'test_a',
      message: '嗨',
    });
    const r = spawnSync('python3', [SEND_CHAT], {
      encoding: 'utf-8',
      timeout: 10_000,
      input: stdin,
      env: { ...process.env, REAL_PUBLISH: '0' },
    });
    expect(r.status).toBe(0);
    const stdout = r.stdout || '';
    const lines = stdout.trim().split('\n');
    const lastLine = lines[lines.length - 1];
    const parsed = JSON.parse(lastLine);
    expect(parsed.ok).toBe(true);
    expect(parsed.dryRun).toBe(true);
  });
});

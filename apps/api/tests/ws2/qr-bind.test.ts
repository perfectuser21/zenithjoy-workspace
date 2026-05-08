/**
 * Path 4 Sprint 1 ws2 — qr_bind.py + __init__.py + 全套 wechat-rpa 模块 stub。
 *
 * 真 spawn Python 子进程校验：
 *   1) qr_bind.py --dryrun → JSON {ok:true, dryRun:true, wechat_id, nickname}
 *   2) qr_bind.py --simulate-no-wechat → JSON {ok:false, reason:'wechat_not_running'}
 *   3) qr_bind.py --print-version → stderr 含 "wxauto4 version" 或 macOS 友好降级
 *   4) services/agent/wechat-rpa/__init__.py 含严格 __all__ 白名单（6 个名字）
 *   5) ws3-5 占位 stub 文件全部存在（listen_chat / send_chat / send_moment / rate_limiter / find_weixin）
 *   6) requirements.txt 列出 wxauto4 + pyautogui + pyperclip + pywin32 + requests
 *
 * 注：tests/ws[1-5]/** 在 vitest.config.ts 里被 exclude，不会进 CI vitest 集；
 * 这里作为合同 RED 验证文件，由 sprint-evaluator 在合同验证阶段直接 spawn python 校验。
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const RPA_DIR = path.join(REPO_ROOT, 'services', 'agent', 'wechat-rpa');
const QR_BIND = path.join(RPA_DIR, 'qr_bind.py');
const INIT_PY = path.join(RPA_DIR, '__init__.py');
const REQS = path.join(RPA_DIR, 'requirements.txt');

describe('ws2 qr_bind.py — argparse 完整性', () => {
  it('文件存在', () => {
    expect(fs.existsSync(QR_BIND)).toBe(true);
  });

  it('源文件 import argparse + 含 --dryrun + --simulate-no-wechat + --print-version', () => {
    const src = fs.readFileSync(QR_BIND, 'utf-8');
    expect(src).toMatch(/import\s+argparse|from\s+argparse/);
    expect(src).toMatch(/--dryrun/);
    expect(src).toMatch(/--simulate-no-wechat/);
    expect(src).toMatch(/--print-version/);
  });
});

describe('ws2 qr_bind.py --dryrun（spawn python3）', () => {
  it('--dryrun → exit 0 + stdout JSON {ok:true, dryRun:true, wechat_id, nickname}', () => {
    const r = spawnSync('python3', [QR_BIND, '--dryrun'], {
      encoding: 'utf-8',
      timeout: 10_000,
    });
    expect(r.status).toBe(0);
    const lines = r.stdout.trim().split('\n').filter(Boolean);
    const lastLine = lines[lines.length - 1];
    const json = JSON.parse(lastLine);
    expect(json.ok).toBe(true);
    expect(json.dryRun).toBe(true);
    expect(typeof json.wechat_id).toBe('string');
    expect(json.wechat_id.length).toBeGreaterThan(0);
    expect(typeof json.nickname).toBe('string');
  });

  it('--simulate-no-wechat → JSON {ok:false, reason:"wechat_not_running"}', () => {
    const r = spawnSync('python3', [QR_BIND, '--simulate-no-wechat'], {
      encoding: 'utf-8',
      timeout: 10_000,
    });
    expect(r.status).toBe(0);
    const lines = r.stdout.trim().split('\n').filter(Boolean);
    const json = JSON.parse(lines[lines.length - 1]);
    expect(json.ok).toBe(false);
    expect(json.reason).toBe('wechat_not_running');
  });

  it('--print-version → stderr 含 wxauto4 version 或 macOS 降级文案', () => {
    const r = spawnSync('python3', [QR_BIND, '--print-version'], {
      encoding: 'utf-8',
      timeout: 10_000,
    });
    expect(r.status).toBe(0);
    const stderr = r.stderr || '';
    expect(stderr).toMatch(/wxauto4 version:|wxauto4 not available on macOS/);
  });
});

describe('ws2 wechat-rpa __init__.py — 严格 __all__ 白名单', () => {
  it('__init__.py 文件存在', () => {
    expect(fs.existsSync(INIT_PY)).toBe(true);
  });

  it('源文件含 __all__ 白名单 6 个名字（qr_bind/listen_chat/send_chat/send_moment/rate_limiter/find_weixin）', () => {
    const src = fs.readFileSync(INIT_PY, 'utf-8');
    expect(src).toMatch(/__all__/);
    expect(src).toMatch(/qr_bind/);
    expect(src).toMatch(/listen_chat/);
    expect(src).toMatch(/send_chat/);
    expect(src).toMatch(/send_moment/);
    expect(src).toMatch(/rate_limiter/);
    expect(src).toMatch(/find_weixin/);
  });
});

describe('ws2 wechat-rpa ws3-5 占位 stub 文件存在', () => {
  it.each(['listen_chat.py', 'send_chat.py', 'send_moment.py', 'rate_limiter.py', 'find_weixin.py'])(
    '%s 占位 stub 存在',
    (name) => {
      const p = path.join(RPA_DIR, name);
      expect(fs.existsSync(p)).toBe(true);
      const src = fs.readFileSync(p, 'utf-8');
      // ws2 阶段 stub：仅函数签名 + raise NotImplementedError
      expect(src).toMatch(/NotImplementedError|def\s+\w+/);
    },
  );
});

describe('ws2 requirements.txt — 5 个依赖', () => {
  it('文件存在', () => {
    expect(fs.existsSync(REQS)).toBe(true);
  });

  it.each(['wxauto4', 'pyautogui', 'pyperclip', 'pywin32', 'requests'])(
    '依赖 %s 已锁',
    (pkg) => {
      const txt = fs.readFileSync(REQS, 'utf-8');
      expect(txt).toMatch(new RegExp(`(?:^|\\n)${pkg}\\b`));
    },
  );
});

/**
 * Path 4 Sprint 1 ws3 — listen_chat.py 完整版（合同 RED）。
 *
 * 真 spawn Python 子进程校验：
 *   1) listen_chat.py 源文件含 `import wxauto4`（真 import，不是 mock 字符串）
 *   2) 含 `wxauto4.__version__` 取版本号写到 stderr
 *   3) --dryrun-print-version → exit 0 + stderr 含 "wxauto4 version" 或 "wxauto4 not available on macOS"
 *   4) --dryrun --inject-message='{"sender":"客户A",...}' → exit 0 + stdout 含 "draft_generated"（mock 中台调用日志）
 *   5) --dryrun --inject-message 名单外 sender 仍 exit 0（行为差异通过 stdout 判定）
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
const LISTEN_CHAT = path.join(RPA_DIR, 'listen_chat.py');

describe('ws3 listen_chat.py — 真 import wxauto4 + 版本号', () => {
  it('文件存在', () => {
    expect(fs.existsSync(LISTEN_CHAT)).toBe(true);
  });

  it('源文件含 `import wxauto4`（真 import 语句，含可能的缩进）', () => {
    const src = fs.readFileSync(LISTEN_CHAT, 'utf-8');
    // 行首允许任意缩进（try/except 块内 import 也算），匹配 `import wxauto4` 或 `from wxauto4`
    expect(src).toMatch(/^[\s]*(?:import|from)\s+wxauto4\b/m);
  });

  it('源文件含 wxauto4.__version__ 取版本号语句', () => {
    const src = fs.readFileSync(LISTEN_CHAT, 'utf-8');
    expect(src).toMatch(/wxauto4\.__version__/);
  });

  it('源文件含 --dryrun + --inject-message + --dryrun-print-version 参数', () => {
    const src = fs.readFileSync(LISTEN_CHAT, 'utf-8');
    expect(src).toMatch(/--dryrun\b/);
    expect(src).toMatch(/--inject-message/);
    expect(src).toMatch(/--dryrun-print-version/);
  });
});

describe('ws3 listen_chat.py --dryrun-print-version（spawn python3）', () => {
  it('--dryrun-print-version → exit 0 + stderr 含 "wxauto4 version" 或 macOS 友好降级文案', () => {
    const r = spawnSync('python3', [LISTEN_CHAT, '--dryrun-print-version'], {
      encoding: 'utf-8',
      timeout: 10_000,
    });
    expect(r.status).toBe(0);
    const stderr = r.stderr || '';
    expect(stderr).toMatch(/wxauto4 version:|wxauto4 not available on macOS/);
  });
});

describe('ws3 listen_chat.py --dryrun --inject-message（spawn python3）', () => {
  it('名单内客户消息 → exit 0 + stdout 末尾 JSON ok:true 或含 draft_generated', () => {
    const inject = JSON.stringify({
      sender: '客户A',
      wechat_id: 'test_a',
      content: '在吗',
    });
    const r = spawnSync(
      'python3',
      [LISTEN_CHAT, '--dryrun', `--inject-message=${inject}`],
      {
        encoding: 'utf-8',
        timeout: 10_000,
        env: { ...process.env, WECHAT_DRAFT_API_DRYRUN: '1' },
      },
    );
    expect(r.status).toBe(0);
    // dryrun 模式下：要么 stdout 末尾打 JSON 含 draft_generated，
    // 要么至少包含 "draft" 关键字（具体由实现决定，但要有可观测证据）
    const stdout = r.stdout || '';
    expect(stdout.length).toBeGreaterThan(0);
    expect(stdout).toMatch(/draft_generated|"ok":\s*true/);
  });

  it('--dryrun 缺 --inject-message → exit 0 但不调中台（无 draft_generated 输出）', () => {
    const r = spawnSync('python3', [LISTEN_CHAT, '--dryrun'], {
      encoding: 'utf-8',
      timeout: 5_000,
    });
    expect(r.status).toBe(0);
    const stdout = r.stdout || '';
    // 没注入 message 时不应触发 draft_generated（避免误调中台）
    expect(stdout).not.toMatch(/draft_generated/);
  });
});

/**
 * Path 4 Sprint 1 ws5 — feishu-poll.ts 静态契约（合同 RED）。
 *
 * 校验：
 *   1) services/feishu-poll.ts 存在 + export pollOnce / startFeishuPoll / stopFeishuPoll
 *   2) 含 30s 轮询周期（cron */30 / setInterval(30000) / 30 * 1000）
 *   3) UPDATE wechat_publish_task 写 approval_source='feishu_user'（A 路线护栏）
 *   4) 频控超限 UPDATE approval_status='rate_limited' + next_allowed_at
 *   5) 整合到 routes/wechat.ts /draft-review-poll 端点（POST 触发 pollOnce）
 *   6) 整合到 services/scheduler.ts 启动时 startFeishuPoll
 *
 * 注：tests/ws5/** 在 vitest.config.ts 里被 exclude，不会进 CI vitest 集；
 * 这里作为合同 RED 验证文件，由 sprint-evaluator 在合同验证阶段执行。
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const POLL_SERVICE = path.join(REPO_ROOT, 'apps', 'api', 'src', 'services', 'feishu-poll.ts');
const SCHEDULER_SERVICE = path.join(REPO_ROOT, 'apps', 'api', 'src', 'services', 'scheduler.ts');
const WECHAT_ROUTE = path.join(REPO_ROOT, 'apps', 'api', 'src', 'routes', 'wechat.ts');

describe('ws5 feishu-poll.ts — 文件 + export', () => {
  it('文件存在', () => {
    expect(fs.existsSync(POLL_SERVICE)).toBe(true);
  });

  it('export pollOnce / startFeishuPoll / stopFeishuPoll', () => {
    const src = fs.readFileSync(POLL_SERVICE, 'utf-8');
    expect(src).toMatch(
      /export\s+(async\s+)?function\s+pollOnce\b|export\s+\{[^}]*pollOnce[^}]*\}/,
    );
    expect(src).toMatch(
      /export\s+function\s+startFeishuPoll\b|export\s+\{[^}]*startFeishuPoll[^}]*\}/,
    );
    expect(src).toMatch(
      /export\s+function\s+stopFeishuPoll\b|export\s+\{[^}]*stopFeishuPoll[^}]*\}/,
    );
  });

  it('含 30s 轮询周期（30000 ms / 30 * 1000 / cron */30）', () => {
    const src = fs.readFileSync(POLL_SERVICE, 'utf-8');
    expect(src).toMatch(/30[_]?000|30\s*\*\s*1000|cron.*\*\/30|interval.*30/i);
  });

  it('UPDATE wechat_publish_task 写 approval_source=\'feishu_user\'（A 路线护栏 enforce）', () => {
    const src = fs.readFileSync(POLL_SERVICE, 'utf-8');
    expect(src).toMatch(/UPDATE\s+wechat_publish_task/i);
    expect(src).toMatch(/feishu_user/);
  });

  it('频控超限 UPDATE approval_status=\'rate_limited\' + next_allowed_at', () => {
    const src = fs.readFileSync(POLL_SERVICE, 'utf-8');
    expect(src).toMatch(/rate_limited/);
    expect(src).toMatch(/next_allowed_at/);
  });

  it('调用 dispatchTask（派发到 zenithjoy-agent）', () => {
    const src = fs.readFileSync(POLL_SERVICE, 'utf-8');
    expect(src).toMatch(/dispatchTask\b/);
  });

  it('禁止 approval_source=\'system\' 或 \'auto\'（A 路线护栏 enforce）', () => {
    const src = fs.readFileSync(POLL_SERVICE, 'utf-8');
    expect(src).not.toMatch(/approval_source\s*[:=]\s*['"]system['"]/);
    expect(src).not.toMatch(/approval_source\s*[:=]\s*['"]auto['"]/);
  });
});

describe('ws5 — scheduler.ts 启动 startFeishuPoll', () => {
  it('scheduler.ts 含 startFeishuPoll 调用（启动时挂 30s 轮询）', () => {
    const src = fs.readFileSync(SCHEDULER_SERVICE, 'utf-8');
    expect(src).toMatch(/startFeishuPoll\b/);
  });
});

describe('ws5 — routes/wechat.ts /draft-review-poll 触发 pollOnce', () => {
  it('routes/wechat.ts 含 /draft-review-poll 路由', () => {
    const src = fs.readFileSync(WECHAT_ROUTE, 'utf-8');
    expect(src).toMatch(/['"`]\/draft-review-poll['"`]/);
  });

  it('routes/wechat.ts 调用 pollOnce（POST 触发飞书轮询）', () => {
    const src = fs.readFileSync(WECHAT_ROUTE, 'utf-8');
    expect(src).toMatch(/pollOnce\b/);
  });
});

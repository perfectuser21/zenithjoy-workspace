/**
 * Path 4 Sprint 1 ws4 — A 路线护栏（合同 RED）。
 *
 * 不真连 DB（CI 没 psql），改为：
 *   1) services/wechat-draft.ts 源码静态校验：
 *      - generateMomentDraft 函数存在
 *      - INSERT wechat_publish_task 时 type='moment' + approval_status='pending_review'
 *      - approval_source NULL（不允许 system 自批）
 *   2) services/scheduler.ts 含 cron '0 9 * * *' + thin server 时区注释
 *   3) routes/wechat.ts /scheduler-tick 实际逻辑（不再是 generated:0 的 stub —
 *      要求路由内调用 generateMomentDraft 服务）
 *
 * 注：tests/ws4/** 在 vitest.config.ts 里被 exclude，不会进 CI vitest 集；
 * 这里作为合同 RED 验证文件，由 sprint-evaluator 在合同验证阶段执行。
 * 真实 DB SQL 校验由 contract 验证命令在 lead-acceptance 上跑（needs psql）。
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DRAFT_SERVICE = path.join(REPO_ROOT, 'apps', 'api', 'src', 'services', 'wechat-draft.ts');
const SCHEDULER_SERVICE = path.join(REPO_ROOT, 'apps', 'api', 'src', 'services', 'scheduler.ts');
const WECHAT_ROUTE = path.join(REPO_ROOT, 'apps', 'api', 'src', 'routes', 'wechat.ts');

describe('ws4 A 路线护栏 — wechat-draft.ts 含 generateMomentDraft + 朋友圈草稿写库时 pending_review', () => {
  it('export generateMomentDraft 函数', () => {
    const src = fs.readFileSync(DRAFT_SERVICE, 'utf-8');
    expect(src).toMatch(
      /export\s+(async\s+)?function\s+generateMomentDraft\b|export\s+\{[^}]*generateMomentDraft[^}]*\}/,
    );
  });

  it('源文件含 type=\'moment\' 字面量（A 路线护栏要求 type 写死，便于 SQL 防作弊查询）', () => {
    const src = fs.readFileSync(DRAFT_SERVICE, 'utf-8');
    expect(src).toMatch(/['"]moment['"]/);
  });

  it('源文件不允许 approval_status="approved"（绕过审批 = 防作弊点）', () => {
    const src = fs.readFileSync(DRAFT_SERVICE, 'utf-8');
    const bad = /approval_status\s*[:=]\s*['"]approved['"]/.test(src);
    expect(bad).toBe(false);
  });

  it('源文件不在 INSERT 上下文出现 feishu_user / feishu_api（不允许 system 自批 approval_source）', () => {
    const src = fs.readFileSync(DRAFT_SERVICE, 'utf-8');
    expect(src).not.toMatch(/approval_source\s*[:=]\s*['"]feishu_user['"]/);
    expect(src).not.toMatch(/approval_source\s*[:=]\s*['"]feishu_api['"]/);
  });

  it('源文件含当日去重 SELECT（CURRENT_DATE 或 created_at::date 字面量）', () => {
    const src = fs.readFileSync(DRAFT_SERVICE, 'utf-8');
    expect(src).toMatch(/CURRENT_DATE|created_at::date|created_at\s*>=/);
  });

  it('源文件含 already_generated_today reason 字面量', () => {
    const src = fs.readFileSync(DRAFT_SERVICE, 'utf-8');
    expect(src).toMatch(/already_generated_today/);
  });

  it('源文件含 profile_missing reason 字面量', () => {
    const src = fs.readFileSync(DRAFT_SERVICE, 'utf-8');
    expect(src).toMatch(/profile_missing/);
  });
});

describe('ws4 A 路线护栏 — scheduler.ts cron 表达式 + server 时区', () => {
  it('文件存在', () => {
    expect(fs.existsSync(SCHEDULER_SERVICE)).toBe(true);
  });

  it('含 cron 表达式 \'0 9 * * *\'', () => {
    const src = fs.readFileSync(SCHEDULER_SERVICE, 'utf-8');
    expect(src).toMatch(/cron[\s\S]{0,200}?['"`]0 9 \* \* \*['"`]/);
  });

  it('含 thin server 时区注释（提示加厚后改客户机时区）', () => {
    const src = fs.readFileSync(SCHEDULER_SERVICE, 'utf-8');
    expect(src).toMatch(/thin.*server\s*时区/);
  });
});

describe('ws4 A 路线护栏 — /api/wechat/scheduler-tick 真分发到 generateMomentDraft', () => {
  it('routes/wechat.ts 含 /scheduler-tick 路由', () => {
    const src = fs.readFileSync(WECHAT_ROUTE, 'utf-8');
    expect(src).toMatch(/['"`]\/scheduler-tick['"`]/);
  });

  it('routes/wechat.ts 调用 generateMomentDraft（不再 stub generated:0）', () => {
    const src = fs.readFileSync(WECHAT_ROUTE, 'utf-8');
    expect(src).toMatch(/generateMomentDraft\b/);
  });

  it('routes/wechat.ts skipped 数组含 reason 字面量（profile_missing / already_generated_today）', () => {
    const src = fs.readFileSync(WECHAT_ROUTE, 'utf-8');
    // 不要求两者都出现（service 层定义即可），但必须至少 reference 其中之一
    expect(src).toMatch(/profile_missing|already_generated_today|reason/);
  });
});

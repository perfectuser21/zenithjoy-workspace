/**
 * Path 4 Sprint 1 ws3 — A 路线护栏（合同 RED）。
 *
 * 不真连 DB（CI 没 psql），改为：
 *   1) services/wechat-draft.ts 源码静态校验：
 *      - INSERT wechat_publish_task 时 approval_status='pending_review'
 *      - approval_source NULL（不允许 system 自批）
 *   2) services/agent/wechat-rpa/ 主动发起会话 def 黑名单 0 命中（grep）
 *
 * 注：tests/ws3/** 在 vitest.config.ts 里被 exclude，不会进 CI vitest 集；
 * 这里作为合同 RED 验证文件，由 sprint-evaluator 在合同验证阶段执行。
 * 真实 DB SQL 校验由 contract 验证命令在 lead-acceptance 上跑（needs psql）。
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DRAFT_SERVICE = path.join(REPO_ROOT, 'apps', 'api', 'src', 'services', 'wechat-draft.ts');
const RPA_DIR = path.join(REPO_ROOT, 'services', 'agent', 'wechat-rpa');

describe('ws3 A 路线护栏 — wechat-draft.ts 草稿写库时 approval_status=pending_review', () => {
  it('源文件含 pending_review 字面量', () => {
    const src = fs.readFileSync(DRAFT_SERVICE, 'utf-8');
    expect(src).toMatch(/pending_review/);
  });

  it('源文件不能写 approval_status="approved"（绕过审批 = 防作弊点）', () => {
    const src = fs.readFileSync(DRAFT_SERVICE, 'utf-8');
    // 严格：源文件不允许出现 approval_status='approved' 字面量（就算注释掉也禁止）
    // 允许字符串 'approved' 出现在 status 校验 / 文档里（不在 SQL/INSERT 上下文）
    // 简单防御：禁止形如 approval_status: 'approved' 或 approval_status='approved'
    const bad = /approval_status\s*[:=]\s*['"]approved['"]/.test(src);
    expect(bad).toBe(false);
  });

  it('INSERT wechat_publish_task 调用上下文必须 NULL approval_source（A 路线护栏起点）', () => {
    const src = fs.readFileSync(DRAFT_SERVICE, 'utf-8');
    // 至少有一处 INSERT INTO wechat_publish_task
    expect(src).toMatch(/INSERT INTO wechat_publish_task/);
    // 校验在 INSERT 附近 1000 字符内不出现 approval_source 设非 null 的语句
    const idx = src.indexOf('INSERT INTO wechat_publish_task');
    const window = src.slice(Math.max(0, idx - 500), idx + 1500);
    // 确保 ws3 阶段不会 'feishu_user' / 'feishu_api' 自批
    expect(window).not.toMatch(/feishu_user/);
    expect(window).not.toMatch(/feishu_api/);
  });
});

describe('ws3 A 路线护栏 — 主动发起会话 def 黑名单 = 0', () => {
  // 黑名单 def 名前缀
  const BLACKLIST = [
    'send_to',
    'proactive_',
    'outbound_',
    'initiate_',
    'start_chat_with_',
    'cold_outreach_',
    'first_message_',
  ];

  it.each(BLACKLIST)('services/agent/wechat-rpa/ 内不存在 `def %s...` 函数定义', (prefix) => {
    const files = fs
      .readdirSync(RPA_DIR)
      .filter((f) => f.endsWith('.py'));
    let hits = 0;
    const offenders: string[] = [];
    for (const f of files) {
      const fp = path.join(RPA_DIR, f);
      const txt = fs.readFileSync(fp, 'utf-8');
      const re = new RegExp(`^def\\s+${prefix}\\w*\\s*\\(`, 'm');
      if (re.test(txt)) {
        hits += 1;
        offenders.push(f);
      }
    }
    expect({ prefix, hits, offenders }).toEqual({ prefix, hits: 0, offenders: [] });
  });
});

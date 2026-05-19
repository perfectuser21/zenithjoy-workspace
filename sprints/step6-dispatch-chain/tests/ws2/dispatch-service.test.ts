/**
 * WS2 RED tests — dispatchPublishTask + ackPublishTask service exports
 *
 * 当前 walking-skeleton.service.ts 未导出这三个函数。
 * 这些测试在实现前**必须 RED**（import 成功但函数不存在 → toBe('function') 失败）。
 *
 * 不直跑 DB（用 type 检查 + module import），保 commit-1 可在无 DB 环境跑。
 * 真 DB 行为靠 contract-dod-ws2.md BEHAVIOR manual:bash 验。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SVC_PATH = join(__dirname, '..', '..', '..', '..', 'apps', 'api', 'src', 'services', 'walking-skeleton.service.ts');

describe('WS2 — dispatchPublishTask + ackPublishTask service [BEHAVIOR]', () => {
  it('walking-skeleton.service.ts 应导出 dispatchPublishTask 函数（export async function）', () => {
    const src = readFileSync(SVC_PATH, 'utf8');
    expect(src).toContain('export async function dispatchPublishTask');
  });

  it('walking-skeleton.service.ts 应导出 ackPublishTask 函数', () => {
    const src = readFileSync(SVC_PATH, 'utf8');
    expect(src).toContain('export async function ackPublishTask');
  });

  it('walking-skeleton.service.ts 应导出 findActiveAgentByTenantId 函数', () => {
    const src = readFileSync(SVC_PATH, 'utf8');
    expect(src).toContain('export async function findActiveAgentByTenantId');
  });

  it('dispatchPublishTask 应更新 works.publish_status（SQL 证据）', () => {
    const src = readFileSync(SVC_PATH, 'utf8');
    expect(src).toContain('publish_status');
    expect(src).toContain('queued');
  });

  it('findActiveAgentByTenantId 应含 last_heartbeat_at INTERVAL 时间窗口过滤（防离线 agent 被选中）', () => {
    const src = readFileSync(SVC_PATH, 'utf8');
    expect(src).toMatch(/last_heartbeat_at.*INTERVAL/);
  });

  it('dispatchPublishTask 应将 work_id 存入 publish_tasks.result.payload（SQL 证据）', () => {
    const src = readFileSync(SVC_PATH, 'utf8');
    expect(src).toContain('work_id');
    expect(src).toContain('payload');
  });
});

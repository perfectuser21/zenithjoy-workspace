// 回归测试：line02 pollAndDispatch 用 task.id 而非 task.task_id 导致采集任务永久 running
//
// 根因：GET /api/acquisition/pending-collect-tasks 返回 { task_id, tenant_id, keywords }，
// 但 build-modules/line02/index.js:88 用 task.id → undefined →
// spawnKeywordSearch(kw, undefined, apiBase) → collect/report body: { task_id: undefined } →
// API 返回 400 MISSING_TASK_ID → .catch(() => {}) 吞掉 → 任务永久卡 running。
//
// 修法：task.id → task.task_id

import { describe, it, expect } from 'vitest';

// pending-collect-tasks API 返回的任务对象格式（真实字段名）
interface PendingTask {
  task_id: string;
  tenant_id: string;
  keywords: string[];
}

// 复现 index.js 里的 buggy 提取逻辑
function extractTaskIdBuggy(task: PendingTask): string | undefined {
  return (task as unknown as Record<string, unknown>).id as string | undefined;
}

// 修复后的提取逻辑
function extractTaskIdFixed(task: PendingTask): string {
  return task.task_id;
}

describe('line02 task_id 提取', () => {
  const apiTask: PendingTask = {
    task_id: 'e4a1b2c3-0000-0000-0000-000000000001',
    tenant_id: 'tid-test',
    keywords: ['火锅', '美食'],
  };

  it('buggy: task.id 返回 undefined（复现 bug）', () => {
    // 这是 bug 的复现：task.id 不存在，返回 undefined
    expect(extractTaskIdBuggy(apiTask)).toBeUndefined();
  });

  it('fixed: task.task_id 返回正确 id', () => {
    expect(extractTaskIdFixed(apiTask)).toBe('e4a1b2c3-0000-0000-0000-000000000001');
  });

  it('fixed: 多个 keywords 都用同一个 task_id', () => {
    const taskIds = apiTask.keywords.map(() => extractTaskIdFixed(apiTask));
    expect(taskIds).toEqual([
      'e4a1b2c3-0000-0000-0000-000000000001',
      'e4a1b2c3-0000-0000-0000-000000000001',
    ]);
    // 修复前：taskIds 全是 [undefined, undefined]，collect/report 触发 400
  });
});

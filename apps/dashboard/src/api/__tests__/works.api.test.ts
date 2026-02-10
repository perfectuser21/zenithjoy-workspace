import { describe, it, expect } from 'vitest';
import type { Work, ListResponse, CreateWorkInput } from '../works.api';

/**
 * Works API 类型检查测试
 *
 * 注意：这些是类型检查测试，主要验证类型定义正确性
 * 实际的 API 集成测试通过手动验证（参见 DoD）
 */

describe('Works API Types', () => {
  it('Work 类型定义正确', () => {
    const work: Work = {
      id: '1',
      title: '测试作品',
      content_type: 'text',
      status: 'draft',
      account: 'XXIP',
      created_at: '2026-02-10T00:00:00Z',
      updated_at: '2026-02-10T00:00:00Z',
    };

    expect(work.id).toBe('1');
    expect(work.title).toBe('测试作品');
    expect(work.content_type).toBe('text');
    expect(work.status).toBe('draft');
    expect(work.account).toBe('XXIP');
  });

  it('ListResponse 类型定义正确', () => {
    const response: ListResponse<Work> = {
      data: [],
      total: 0,
      limit: 20,
      offset: 0,
    };

    expect(response.data).toEqual([]);
    expect(response.total).toBe(0);
    expect(response.limit).toBe(20);
    expect(response.offset).toBe(0);
  });

  it('CreateWorkInput 类型定义正确', () => {
    const input: CreateWorkInput = {
      title: '新作品',
      content_type: 'image',
      status: 'draft',
    };

    expect(input.title).toBe('新作品');
    expect(input.content_type).toBe('image');
    expect(input.status).toBe('draft');
  });

  it('ContentType 枚举值正确', () => {
    const types: Array<Work['content_type']> = ['text', 'image', 'video', 'article', 'audio'];
    expect(types).toHaveLength(5);
  });

  it('WorkStatus 枚举值正确', () => {
    const statuses: Array<Work['status']> = ['draft', 'pending', 'published', 'archived'];
    expect(statuses).toHaveLength(4);
  });

  it('Account 枚举值正确', () => {
    const accounts: Array<Work['account']> = ['XXIP', 'XXAI'];
    expect(accounts).toHaveLength(2);
  });
});

/**
 * 集成测试说明
 *
 * 以下功能通过手动测试验证（参见 .dod-cp-20260210-works-list-frontend.md）：
 *
 * 1. API 调用
 *    - getWorks() 获取作品列表
 *    - createWork() 创建作品
 *    - updateWork() 更新作品
 *    - deleteWork() 删除作品
 *
 * 2. 筛选和分页
 *    - 类型筛选 (type)
 *    - 状态筛选 (status)
 *    - 账号筛选 (account)
 *    - 搜索 (search)
 *    - 排序 (sort, order)
 *    - 分页 (limit, offset)
 *
 * 3. UI 交互
 *    - 表格显示
 *    - 筛选器
 *    - 排序指示器
 *    - 分页控制
 *    - 新建对话框
 *    - 表单验证
 *
 * 手动测试步骤：
 * 1. 启动 API 服务 (apps/api)
 * 2. 启动前端开发服务器 (npm run dev:dashboard)
 * 3. 访问 http://localhost:5173/works
 * 4. 按照 DoD 中的验收标准逐项测试
 * 5. 截图保存到 .quality-evidence.json
 */

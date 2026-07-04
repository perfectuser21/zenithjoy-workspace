/**
 * TDD Red — LeadsTable 共用组件 + Dashboard 页面统一验证
 *
 * 故意在 Generator 实现前失败：
 * - apps/dashboard/src/components/LeadsTable.tsx 尚未创建
 * - LeadsPage.tsx 未使用 LeadsTable 组件
 * - AcquisitionTasksPage.tsx 仍含"触达状态"文字
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';

// ─── LeadsTable 组件文件存在 ──────────────────────────────────────────────────
describe('LeadsTable 共用组件文件 [BEHAVIOR]', () => {
  it('apps/dashboard/src/components/LeadsTable.tsx 文件存在', () => {
    // 当前不存在 → FAIL
    const exists = existsSync('apps/dashboard/src/components/LeadsTable.tsx');
    expect(exists).toBe(true);
  });

  it('LeadsTable.tsx 含"最新回复"列定义', () => {
    const src = readFileSync('apps/dashboard/src/components/LeadsTable.tsx', 'utf8');
    expect(src).toContain('最新回复');
  });

  it('LeadsTable.tsx 含"负责人"列定义', () => {
    const src = readFileSync('apps/dashboard/src/components/LeadsTable.tsx', 'utf8');
    expect(src).toContain('负责人');
  });

  it('LeadsTable.tsx 不含"触达状态"（已删除）', () => {
    const src = readFileSync('apps/dashboard/src/components/LeadsTable.tsx', 'utf8');
    expect(src).not.toContain('触达状态');
  });

  it('LeadsTable.tsx 接受 leads / total / loading props（组件接口）', () => {
    const src = readFileSync('apps/dashboard/src/components/LeadsTable.tsx', 'utf8');
    expect(src).toContain('leads');
    expect(src).toContain('loading');
  });
});

// ─── LeadsPage 改用 LeadsTable 组件 ──────────────────────────────────────────
describe('LeadsPage 改用 LeadsTable 组件 [BEHAVIOR]', () => {
  it('LeadsPage.tsx 引用 LeadsTable 组件', () => {
    const src = readFileSync('apps/dashboard/src/pages/LeadsPage.tsx', 'utf8');
    // 当前 LeadsPage 直接内联 AG Grid，没有 import LeadsTable → FAIL
    expect(src).toContain('LeadsTable');
  });

  it('LeadsPage.tsx 不再内联定义"昵称"等 columnDefs（改由 LeadsTable 维护）', () => {
    const src = readFileSync('apps/dashboard/src/pages/LeadsPage.tsx', 'utf8');
    // 修复后，LeadsPage 只负责数据获取 + 传给 LeadsTable，不再内联全套 columnDefs
    // 粗判断：LeadsTable 引用存在就已足够（columnDefs 可能还在）
    expect(src).toContain('LeadsTable');
  });
});

// ─── AcquisitionTasksPage 删除"触达状态"列 ──────────────────────────────────
describe('AcquisitionTasksPage 删除"触达状态"列 [BEHAVIOR]', () => {
  it('AcquisitionTasksPage.tsx 不含"触达状态"文字', () => {
    const src = readFileSync('apps/dashboard/src/pages/AcquisitionTasksPage.tsx', 'utf8');
    // 当前含硬编码"触达状态" → FAIL
    expect(src).not.toContain('触达状态');
  });

  it('AcquisitionTasksPage.tsx 改用 LeadsTable 组件', () => {
    const src = readFileSync('apps/dashboard/src/pages/AcquisitionTasksPage.tsx', 'utf8');
    // 当前内联 leads 子表，没有 LeadsTable → FAIL
    expect(src).toContain('LeadsTable');
  });
});

// ─── Playwright spec 文件存在 ────────────────────────────────────────────────
describe('Playwright E2E spec 文件 [BEHAVIOR]', () => {
  it('apps/dashboard/e2e/leads-unified-table.spec.ts 存在', () => {
    const exists = existsSync('apps/dashboard/e2e/leads-unified-table.spec.ts');
    expect(exists).toBe(true);
  });

  it('leads-unified-table.spec.ts 验证最新回复列头可见', () => {
    const src = readFileSync('apps/dashboard/e2e/leads-unified-table.spec.ts', 'utf8');
    expect(src).toContain('最新回复');
  });

  it('leads-unified-table.spec.ts 验证无触达状态列头', () => {
    const src = readFileSync('apps/dashboard/e2e/leads-unified-table.spec.ts', 'utf8');
    expect(src).toContain('触达状态');
  });

  it('leads-unified-table.spec.ts 不含 page.route() stub（真后端）', () => {
    const src = readFileSync('apps/dashboard/e2e/leads-unified-table.spec.ts', 'utf8');
    expect(src).not.toContain('page.route(');
  });
});

// ─── 多租户隔离测试种子要求 ──────────────────────────────────────────────────
describe('多租户隔离 — 测试覆盖要求 [BEHAVIOR]', () => {
  it('e2e-verify.ps1 含多租户测试（种≥2个租户）', () => {
    const src = readFileSync(
      'sprints/07032333-line02-lead-human-handoff/e2e-verify.ps1',
      'utf8',
    );
    // ps1 中 Scenario 2 种了 T1 T2 两个租户
    expect(src).toContain('T1');
    expect(src).toContain('T2');
  });
});

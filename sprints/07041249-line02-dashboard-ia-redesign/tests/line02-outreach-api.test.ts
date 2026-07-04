/**
 * TDD Red — Line02 Dashboard IA 重做（文件系统级验证）
 *
 * 这些测试当前应该全部 FAIL（实现不存在或含旧代码）：
 * - GET /api/acquisition/outreach-history 路由未注册 → 端点代码不存在
 * - fetchOutreachHistory 函数未实现
 * - AcquisitionOutreachPage.tsx 不存在
 * - Hub MODULES 仍含 comingSoon: true
 * - 账号管理页仍含"抖音昵称"列头
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');

// ─────────────────────────────────────────────────────────────────────────
// 测试 A: 后端路由文件含 outreach-history 端点
// ─────────────────────────────────────────────────────────────────────────

describe('GET /api/acquisition/outreach-history — 端点注册', () => {
  const routeFile = path.join(ROOT, 'apps/api/src/routes/acquisition-dispatch.ts');

  it('acquisition-dispatch.ts 包含 outreach-history 路由注册', () => {
    const content = fs.readFileSync(routeFile, 'utf-8');
    // 当前文件无此端点 → FAIL（Red 证据）
    expect(content).toContain('outreach-history');
  });

  it('outreach-history 路由含 tenant_id 过滤（租户隔离铁律）', () => {
    const content = fs.readFileSync(routeFile, 'utf-8');
    // 端点实现后必须 WHERE a.tenant_id = $1
    const segment = content.match(/outreach-history[\s\S]{0,3000}/)?.[0] ?? '';
    expect(segment).toMatch(/tenant_id/);
  });

  it('outreach-history 路由返回 items 字段（不用 plan / records / history）', () => {
    const content = fs.readFileSync(routeFile, 'utf-8');
    const segment = content.match(/outreach-history[\s\S]{0,3000}/)?.[0] ?? '';
    // schema 字段值断言：items（PRD 字面名）
    expect(segment).toContain('items');
    // 禁用字段反向断言
    expect(segment).not.toMatch(/\bplan:\s*r\b/);   // 不用 plan 替代 items
    expect(segment).not.toMatch(/\brecords:\s*r\b/);
  });

  it('outreach-history 路由返回 total 字段', () => {
    const content = fs.readFileSync(routeFile, 'utf-8');
    const segment = content.match(/outreach-history[\s\S]{0,3000}/)?.[0] ?? '';
    expect(segment).toContain('total');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 测试 B: 前端 API 函数 fetchOutreachHistory
// ─────────────────────────────────────────────────────────────────────────

describe('fetchOutreachHistory — 前端 API 函数', () => {
  const apiFile = path.join(ROOT, 'apps/dashboard/src/api/acquisition-dispatch.api.ts');

  it('acquisition-dispatch.api.ts 包含 outreach-history 路径', () => {
    const content = fs.readFileSync(apiFile, 'utf-8');
    // 当前文件无此函数 → FAIL（Red 证据）
    expect(content).toContain('outreach-history');
  });

  it('包含 fetchOutreachHistory 函数名', () => {
    const content = fs.readFileSync(apiFile, 'utf-8');
    expect(content).toContain('fetchOutreachHistory');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 测试 C: AcquisitionOutreachPage.tsx 存在且含空状态
// ─────────────────────────────────────────────────────────────────────────

describe('AcquisitionOutreachPage — 文件存在与内容', () => {
  const outreachPage = path.join(ROOT, 'apps/dashboard/src/pages/AcquisitionOutreachPage.tsx');

  it('AcquisitionOutreachPage.tsx 文件存在', () => {
    // 当前文件不存在 → FAIL（Red 证据）
    expect(fs.existsSync(outreachPage)).toBe(true);
  });

  it('含"暂无触达记录"空状态文字', () => {
    if (!fs.existsSync(outreachPage)) return; // 文件不存在时跳过（由上一条 FAIL）
    const content = fs.readFileSync(outreachPage, 'utf-8');
    expect(content).toContain('暂无触达记录');
  });

  it('含错误处理代码（catch 或 error state）', () => {
    if (!fs.existsSync(outreachPage)) return;
    const content = fs.readFileSync(outreachPage, 'utf-8');
    expect(content).toMatch(/catch|setError|setErr/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 测试 D: Hub MODULES 已更新（无 comingSoon，含 GP 卡片）
// ─────────────────────────────────────────────────────────────────────────

describe('AcquisitionHubPage — MODULES 无 comingSoon', () => {
  const hubFile = path.join(ROOT, 'apps/dashboard/src/pages/AcquisitionHubPage.tsx');

  it('MODULES 数组不含 comingSoon: true（当前有 → Red）', () => {
    const content = fs.readFileSync(hubFile, 'utf-8');
    // 当前源码 comingSoon: true 存在 → FAIL（Red 证据）
    expect(content).not.toContain('comingSoon: true');
  });

  it('不含"即将上线"文字', () => {
    const content = fs.readFileSync(hubFile, 'utf-8');
    expect(content).not.toContain('即将上线');
  });

  it('含 GP 卡片：绑抖音小号 / 看线索 / 触达记录', () => {
    const content = fs.readFileSync(hubFile, 'utf-8');
    expect(content).toContain('绑抖音小号');
    expect(content).toContain('看线索');
    expect(content).toContain('触达记录');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 测试 E: 账号管理页无"抖音昵称"列头
// ─────────────────────────────────────────────────────────────────────────

describe('AcquisitionAccountsPage — 无抖音昵称列', () => {
  const accountsFile = path.join(ROOT, 'apps/dashboard/src/pages/AcquisitionAccountsPage.tsx');

  it('不含"抖音昵称"列头渲染代码（当前有 → Red）', () => {
    const content = fs.readFileSync(accountsFile, 'utf-8');
    // 当前行 123/133 含抖音昵称 → FAIL（Red 证据）
    expect(content).not.toContain('抖音昵称');
  });

  it('保留 machine-hostname-cell（回归约束）', () => {
    const content = fs.readFileSync(accountsFile, 'utf-8');
    expect(content).toContain('machine-hostname-cell');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 测试 F: navigation.config 注册新路由
// ─────────────────────────────────────────────────────────────────────────

describe('navigation.config — 新路由注册', () => {
  const navFile = path.join(ROOT, 'apps/dashboard/src/config/navigation.config.ts');

  it('注册了 /area/acquisition/leads（当前无 → Red）', () => {
    const content = fs.readFileSync(navFile, 'utf-8');
    expect(content).toContain('/area/acquisition/leads');
  });

  it('注册了 /area/acquisition/outreach（当前无 → Red）', () => {
    const content = fs.readFileSync(navFile, 'utf-8');
    expect(content).toContain('/area/acquisition/outreach');
  });

  it('保留旧路由 /dashboard/leads（兼容性约束）', () => {
    const content = fs.readFileSync(navFile, 'utf-8');
    expect(content).toContain('/dashboard/leads');
  });
});

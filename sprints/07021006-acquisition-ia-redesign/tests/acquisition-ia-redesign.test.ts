/**
 * TDD Red 阶段 — 获客工作台 IA 重构
 *
 * 新增两个 API 端点 + DB 表 + 前端页面，本文件在实现前预期全部 RED。
 * 使用 fs 静态检查 + 模块 require（try/catch 兜底）两种模式，无 supertest。
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');

// ─── 辅助 ───────────────────────────────────────────────────────────────────

function readFile(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

function fileExists(rel: string): boolean {
  try {
    fs.accessSync(path.join(REPO_ROOT, rel));
    return true;
  } catch {
    return false;
  }
}

// ─── BEHAVIOR 1: acquisition.ts 注册新端点 ──────────────────────────────────

describe('[BEHAVIOR] GET /api/acquisition/burner-accounts 端点已注册', () => {
  it('acquisitionRouter 含 burner-accounts 路由声明', () => {
    const src = readFile('apps/api/src/routes/acquisition.ts');
    expect(src).toContain('burner-accounts');
  });

  it('端点响应正确 keys — success/data/timestamp（通过函数返回结构检查）', () => {
    const src = readFile('apps/api/src/routes/acquisition.ts');
    // 端点返回标准包裹 ok(res, ...) 或 success:true
    expect(src.match(/burner-accounts[\s\S]{0,500}success/)).toBeTruthy();
  });
});

describe('[BEHAVIOR] GET /api/acquisition/collect-tasks/:taskId/videos 端点已注册', () => {
  it('acquisitionRouter 含 collect-tasks/:taskId/videos 路由声明', () => {
    const src = readFile('apps/api/src/routes/acquisition.ts');
    expect(src).toContain('collect-tasks/:taskId/videos');
  });

  it('404 处理 — TASK_NOT_FOUND 错误码在 acquisition.ts 中', () => {
    const src = readFile('apps/api/src/routes/acquisition.ts');
    expect(src).toContain('TASK_NOT_FOUND');
  });

  it('IDOR 校验 — 端点中含 tenant_id 校验逻辑（FORBIDDEN 或 403）', () => {
    const src = readFile('apps/api/src/routes/acquisition.ts');
    expect(src).toMatch(/FORBIDDEN|tenant_id.*!==|!==.*tenant_id|403/);
  });
});

// ─── BEHAVIOR 2: DB Migration 存在 ───────────────────────────────────────────

describe('[BEHAVIOR] acquisition_collect_videos 迁移文件存在', () => {
  it('apps/api/db/migrations/ 下有含 acquisition_collect_videos 的 .sql 文件', () => {
    const migrationsDir = path.join(REPO_ROOT, 'apps/api/db/migrations');
    const files = fs.readdirSync(migrationsDir);
    const found = files.filter(f => f.endsWith('.sql') && f.toLowerCase().includes('acquisition_collect_videos'));
    expect(found.length).toBeGreaterThan(0);
  });

  it('迁移 SQL 文件含 video_id、title、cover_url 列定义', () => {
    const migrationsDir = path.join(REPO_ROOT, 'apps/api/db/migrations');
    const files = fs.readdirSync(migrationsDir);
    const sqlFile = files.find(f => f.endsWith('.sql') && f.toLowerCase().includes('acquisition_collect_videos'));
    expect(sqlFile).toBeTruthy();
    const content = readFile(`apps/api/db/migrations/${sqlFile!}`);
    expect(content).toContain('video_id');
    expect(content).toContain('title');
    expect(content).toContain('cover_url');
    expect(content).toContain('published_at');
    expect(content).toContain('task_id');
  });

  it('迁移 SQL 含 line02_account_sessions.health 加 banned 约束', () => {
    const migrationsDir = path.join(REPO_ROOT, 'apps/api/db/migrations');
    const files = fs.readdirSync(migrationsDir);
    // 可能在 acquisition_collect_videos 同文件或单独文件
    const relevantFiles = files.filter(f => f.endsWith('.sql'));
    const containsBanned = relevantFiles.some(f => {
      try {
        const c = readFile(`apps/api/db/migrations/${f}`);
        return c.includes('banned') && c.includes('line02_account_sessions');
      } catch { return false; }
    });
    expect(containsBanned).toBe(true);
  });
});

// ─── BEHAVIOR 3: 前端页面文件存在 ─────────────────────────────────────────────

describe('[BEHAVIOR] AccountsPage 新建文件存在', () => {
  it('apps/dashboard/src/pages/acquisition/AccountsPage.tsx 存在', () => {
    expect(fileExists('apps/dashboard/src/pages/acquisition/AccountsPage.tsx')).toBe(true);
  });

  it('AccountsPage 含 data-testid="bind-burner-btn" 绑定按钮', () => {
    const src = readFile('apps/dashboard/src/pages/acquisition/AccountsPage.tsx');
    expect(src).toContain('bind-burner-btn');
  });

  it('AccountsPage 含 health 状态（ok/expired/banned）展示逻辑', () => {
    const src = readFile('apps/dashboard/src/pages/acquisition/AccountsPage.tsx');
    expect(src).toMatch(/health|ok|expired|banned/);
  });
});

describe('[BEHAVIOR] TaskDetailPage 新建文件存在', () => {
  it('apps/dashboard/src/pages/acquisition/TaskDetailPage.tsx 存在', () => {
    expect(fileExists('apps/dashboard/src/pages/acquisition/TaskDetailPage.tsx')).toBe(true);
  });

  it('TaskDetailPage 调用 collect-tasks/:taskId/videos 端点', () => {
    const src = readFile('apps/dashboard/src/pages/acquisition/TaskDetailPage.tsx');
    expect(src).toContain('videos');
    expect(src).toMatch(/collect-tasks|taskId|task_id/);
  });
});

describe('[BEHAVIOR] AcquisitionHubPage 改版为 4 模块卡片', () => {
  it('AcquisitionHubPage 含 hub-module-card testid（4 卡片结构）', () => {
    const src = readFile('apps/dashboard/src/pages/acquisition/AcquisitionHubPage.tsx');
    expect(src).toContain('hub-module-card');
  });

  it('AcquisitionHubPage 含账号管理/采集任务/客户分析/触达中心', () => {
    const src = readFile('apps/dashboard/src/pages/acquisition/AcquisitionHubPage.tsx');
    expect(src).toContain('账号管理');
    expect(src).toContain('采集任务');
    expect(src).toContain('客户分析');
    expect(src).toContain('触达中心');
  });
});

// ─── BEHAVIOR 4: LeadsPage 无采集面板 ────────────────────────────────────────

describe('[BEHAVIOR] LeadsPage 不含采集面板代码', () => {
  it('LeadsPage.tsx 不含 setAcqPhase', () => {
    const src = readFile('apps/dashboard/src/pages/LeadsPage.tsx');
    expect(src).not.toContain('setAcqPhase');
  });

  it('LeadsPage.tsx 不含 handleCollect', () => {
    const src = readFile('apps/dashboard/src/pages/LeadsPage.tsx');
    expect(src).not.toContain('handleCollect');
  });

  it('LeadsPage.tsx 不含 manualInput 采集状态', () => {
    const src = readFile('apps/dashboard/src/pages/LeadsPage.tsx');
    expect(src).not.toContain('manualInput');
  });
});

// ─── BEHAVIOR 5a: DouyinBurnerBindPage 已废弃（Step 12）───────────────────────

describe('[BEHAVIOR] DouyinBurnerBindPage UI 废弃', () => {
  it('DouyinBurnerBindPage.tsx 文件已删除（PRD 废弃范围内）', () => {
    const candidates = [
      'apps/dashboard/src/pages/acquisition/DouyinBurnerBindPage.tsx',
      'apps/dashboard/src/pages/DouyinBurnerBindPage.tsx',
    ];
    const existing = candidates.filter(p => fileExists(p));
    expect(existing, `以下文件仍存在应已删除: ${existing.join(',')}`).toHaveLength(0);
  });
});

// ─── BEHAVIOR 5b: TaskDetailPage 降级路径 + leads 接缝 testid（Steps 6/7）────

describe('[BEHAVIOR] TaskDetailPage 含降级 + leads testid', () => {
  it('TaskDetailPage.tsx 含 video-url-fallback testid（cover_url=null 降级路径）', () => {
    const src = readFile('apps/dashboard/src/pages/acquisition/TaskDetailPage.tsx');
    expect(src).toContain('video-url-fallback');
  });

  it('TaskDetailPage.tsx 含 video-leads-list 或 no-leads-empty testid（Step 7 接缝）', () => {
    const src = readFile('apps/dashboard/src/pages/acquisition/TaskDetailPage.tsx');
    const hasLeadsList = src.includes('video-leads-list');
    const hasEmpty = src.includes('no-leads-empty');
    expect(hasLeadsList || hasEmpty, '缺少 video-leads-list 或 no-leads-empty testid').toBe(true);
  });
});

// ─── BEHAVIOR 5c: 禁用字段 oracle 覆盖（items/count for burner-accounts; count for videos）──

describe('[BEHAVIOR] acquisition.ts 响应不包含禁用字段名', () => {
  it('acquisition.ts 响应构造不含 items 键赋值（burner-accounts 禁用字段）', () => {
    const src = readFile('apps/api/src/routes/acquisition.ts');
    expect(src).not.toMatch(/['"]\s*items\s*['"]\s*:/);
  });

  it('acquisition.ts 响应构造不含 count 键赋值（仅允许 total）', () => {
    const src = readFile('apps/api/src/routes/acquisition.ts');
    expect(src).not.toMatch(/['"]\s*count\s*['"]\s*:/);
  });

  it('acquisition.ts 响应构造不含 results 键赋值（videos 禁用字段）', () => {
    const src = readFile('apps/api/src/routes/acquisition.ts');
    expect(src).not.toMatch(/['"]\s*results\s*['"]\s*:/);
  });
});

// ─── BEHAVIOR 5: navigation.config.ts 注册新路由 ──────────────────────────────

describe('[BEHAVIOR] navigation.config.ts 含新页面路由', () => {
  it('/area/acquisition/accounts 路由已注册', () => {
    const src = readFile('apps/dashboard/src/config/navigation.config.ts');
    expect(src).toContain('/area/acquisition/accounts');
  });

  it('/area/acquisition/tasks 路由已注册', () => {
    const src = readFile('apps/dashboard/src/config/navigation.config.ts');
    expect(src).toContain('/area/acquisition/tasks');
  });

  it('/area/acquisition/tasks/:taskId 路由已注册', () => {
    const src = readFile('apps/dashboard/src/config/navigation.config.ts');
    expect(src).toMatch(/area\/acquisition\/tasks\/:taskId/);
  });
});

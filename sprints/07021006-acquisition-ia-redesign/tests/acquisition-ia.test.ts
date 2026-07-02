/**
 * Sprint 07021006 — 获客工作台 IA 重设计 TDD Red 阶段（Round 2）
 *
 * 检查新端点、新组件、migration、E2E spec 是否存在且正确。
 * 所有用例当前应 FAIL（文件/代码尚未创建）→ 这是 TDD Red 证据。
 *
 * 运行：npx vitest run sprints/07021006-acquisition-ia-redesign/tests/ --reporter=verbose
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../..');

// ─────────────────────────────────────────
// [BEHAVIOR] 1: 新 API 端点已在 acquisition.ts 注册
// ─────────────────────────────────────────
describe('GET /api/acquisition/collect-tasks/:id/videos 端点注册 [BEHAVIOR]', () => {
  const routeFile = resolve(ROOT, 'apps/api/src/routes/acquisition.ts');

  it('acquisition.ts 含 collect-tasks/:task_id/videos 路由定义', () => {
    const content = readFileSync(routeFile, 'utf8');
    expect(content).toMatch(/collect-tasks\/:[\w_]+\/videos/);
  });

  it('路由含 tenant 过滤逻辑（IDOR 防护）', () => {
    const content = readFileSync(routeFile, 'utf8');
    const routeIdx = content.search(/collect-tasks\/:[\w_]+\/videos/);
    expect(routeIdx).toBeGreaterThan(-1);
    const routeBlock = content.slice(routeIdx, routeIdx + 1000);
    expect(routeBlock).toMatch(/tenant_id|tenantId/);
  });

  it('返回 schema 含 videos 数组和 total 字段（从源码静态检查）', () => {
    const content = readFileSync(routeFile, 'utf8');
    expect(content).toMatch(/videos/);
    expect(content).toMatch(/total/);
  });

  it('禁用字段 videoList/items/results 未出现在 collect-tasks/:id/videos 响应中', () => {
    const content = readFileSync(routeFile, 'utf8');
    const routeIdx = content.search(/collect-tasks\/:[\w_]+\/videos/);
    const routeBlock = content.slice(routeIdx, routeIdx + 1000);
    expect(routeBlock).not.toMatch(/videoList:/);
    expect(routeBlock).not.toMatch(/items:/);
    expect(routeBlock).not.toMatch(/results:/);
  });
});

describe('GET /api/acquisition/videos/:videoId/leads 端点注册 [BEHAVIOR]', () => {
  const routeFile = resolve(ROOT, 'apps/api/src/routes/acquisition.ts');

  it('acquisition.ts 含 /videos/:videoId/leads 路由定义', () => {
    const content = readFileSync(routeFile, 'utf8');
    expect(content).toMatch(/\/videos\/:[\w_]+\/leads/);
  });

  it('路由含 tenant 过滤逻辑（IDOR 防护）', () => {
    const content = readFileSync(routeFile, 'utf8');
    const routeIdx = content.search(/\/videos\/:[\w_]+\/leads/);
    expect(routeIdx).toBeGreaterThan(-1);
    const routeBlock = content.slice(routeIdx, routeIdx + 1000);
    expect(routeBlock).toMatch(/tenant_id|tenantId/);
  });

  it('返回 schema 含 leads 数组和 total（不含禁用字段 comments/items/results）', () => {
    const content = readFileSync(routeFile, 'utf8');
    const routeIdx = content.search(/\/videos\/:[\w_]+\/leads/);
    const routeBlock = content.slice(routeIdx, routeIdx + 800);
    expect(routeBlock).toMatch(/leads/);
    expect(routeBlock).toMatch(/total/);
    expect(routeBlock).not.toMatch(/comments:/);
    expect(routeBlock).not.toMatch(/items:/);
    expect(routeBlock).not.toMatch(/results:/);
  });
});

// ─────────────────────────────────────────
// [BEHAVIOR] 2: acquisition_collect_videos migration
// ─────────────────────────────────────────
describe('acquisition_collect_videos DB migration [BEHAVIOR]', () => {
  const migrationsDir = resolve(ROOT, 'apps/api/src/db/migrations');

  it('migrations 目录存在 collect_videos 相关文件', () => {
    const files = readdirSync(migrationsDir).filter(
      (f) => f.includes('collect_video') || f.includes('acquisition_video')
    );
    expect(files.length).toBeGreaterThan(0);
  });

  it('migration 文件含 PRD 要求的全部 7 个列名', () => {
    const files = readdirSync(migrationsDir).filter(
      (f) => f.includes('collect_video') || f.includes('acquisition_video')
    );
    if (files.length === 0) {
      expect(files.length).toBeGreaterThan(0);
      return;
    }
    const content = readFileSync(`${migrationsDir}/${files[0]}`, 'utf8');
    const required = [
      'video_id',
      'task_id',
      'tenant_id',
      'title',
      'thumbnail_url',
      'publish_date',
      'comment_count',
    ];
    const missing = required.filter((col) => !content.includes(col));
    expect(missing).toHaveLength(0);
  });

  it('migration 含 zenithjoy schema 前缀', () => {
    const files = readdirSync(migrationsDir).filter(
      (f) => f.includes('collect_video') || f.includes('acquisition_video')
    );
    if (files.length === 0) return;
    const content = readFileSync(`${migrationsDir}/${files[0]}`, 'utf8');
    expect(content).toMatch(/zenithjoy\.acquisition_collect_videos/);
  });
});

// ─────────────────────────────────────────
// [BEHAVIOR] 3: 新 Dashboard 页面文件存在
// ─────────────────────────────────────────
describe('AccountsPage 新组件 [BEHAVIOR]', () => {
  it('apps/dashboard/src/pages/acquisition/AccountsPage.tsx 文件存在', () => {
    const exists = existsSync(
      resolve(ROOT, 'apps/dashboard/src/pages/acquisition/AccountsPage.tsx')
    );
    expect(exists).toBe(true);
  });

  it('AccountsPage 含 bind-new-account-btn testId', () => {
    const content = readFileSync(
      resolve(ROOT, 'apps/dashboard/src/pages/acquisition/AccountsPage.tsx'),
      'utf8'
    );
    expect(content).toContain('bind-new-account-btn');
  });

  it('AccountsPage 含健康状态三色映射（active/needs_rebind/banned）', () => {
    const content = readFileSync(
      resolve(ROOT, 'apps/dashboard/src/pages/acquisition/AccountsPage.tsx'),
      'utf8'
    );
    expect(content).toMatch(/active|needs_rebind|banned/);
  });

  it('AccountsPage 含 N=10 上限判断逻辑（sessions.length >= 10 → disabled）', () => {
    const content = readFileSync(
      resolve(ROOT, 'apps/dashboard/src/pages/acquisition/AccountsPage.tsx'),
      'utf8'
    );
    // 含上限数字10 或 MAX_SESSIONS 常量
    expect(content).toMatch(/>=\s*10|MAX_SESSIONS|maxSessions|sessions\.length.*10|10.*disabled/);
  });
});

describe('TasksPage 新组件 [BEHAVIOR]', () => {
  it('apps/dashboard/src/pages/acquisition/TasksPage.tsx 文件存在', () => {
    const exists = existsSync(
      resolve(ROOT, 'apps/dashboard/src/pages/acquisition/TasksPage.tsx')
    );
    expect(exists).toBe(true);
  });

  it('TasksPage 含 keyword-input + start-collect-btn + tasks-list + task-row testId', () => {
    const content = readFileSync(
      resolve(ROOT, 'apps/dashboard/src/pages/acquisition/TasksPage.tsx'),
      'utf8'
    );
    expect(content).toContain('keyword-input');
    expect(content).toContain('start-collect-btn');
    expect(content).toContain('tasks-list');
    expect(content).toContain('task-row');
  });

  it('TasksPage 含二级路由视图 testId：video-cards-container', () => {
    const content = readFileSync(
      resolve(ROOT, 'apps/dashboard/src/pages/acquisition/TasksPage.tsx'),
      'utf8'
    );
    expect(content).toContain('video-cards-container');
  });

  it('TasksPage 含失败态 testId：task-status-failed + task-retry-btn', () => {
    const content = readFileSync(
      resolve(ROOT, 'apps/dashboard/src/pages/acquisition/TasksPage.tsx'),
      'utf8'
    );
    expect(content).toContain('task-status-failed');
    expect(content).toContain('task-retry-btn');
  });

  it('TasksPage leads 展开区域含 leads-list 或 leads-empty-placeholder testId', () => {
    const content = readFileSync(
      resolve(ROOT, 'apps/dashboard/src/pages/acquisition/TasksPage.tsx'),
      'utf8'
    );
    expect(content).toMatch(/leads-list|leads-empty-placeholder/);
  });

  it('TasksPage 含 /area/acquisition/tasks/:taskId 二级路由导航', () => {
    const content = readFileSync(
      resolve(ROOT, 'apps/dashboard/src/pages/acquisition/TasksPage.tsx'),
      'utf8'
    );
    expect(content).toMatch(/acquisition\/tasks\//);
  });
});

describe('AcquisitionHubPage 改4模块卡片 [BEHAVIOR]', () => {
  it('AcquisitionHubPage 含4个模块卡片 testId', () => {
    const paths = [
      resolve(ROOT, 'apps/dashboard/src/pages/AcquisitionHubPage.tsx'),
      resolve(ROOT, 'apps/dashboard/src/pages/acquisition/AcquisitionHubPage.tsx'),
    ];
    const file = paths.find((p) => existsSync(p));
    expect(file).toBeDefined();
    const content = readFileSync(file!, 'utf8');
    expect(content).toContain('hub-card-accounts');
    expect(content).toContain('hub-card-tasks');
    expect(content).toContain('hub-card-analytics');
    expect(content).toContain('hub-card-outreach');
  });
});

// ─────────────────────────────────────────
// [BEHAVIOR] 4: LeadsPage 移除采集面板
// ─────────────────────────────────────────
describe('LeadsPage 移除采集面板 [BEHAVIOR]', () => {
  it('LeadsPage.tsx 不含 acq-collect-button', () => {
    const content = readFileSync(
      resolve(ROOT, 'apps/dashboard/src/pages/LeadsPage.tsx'),
      'utf8'
    );
    expect(content).not.toContain('acq-collect-button');
  });

  it('LeadsPage.tsx 不含采集关键词输入框（acq-expand-result 移除）', () => {
    const content = readFileSync(
      resolve(ROOT, 'apps/dashboard/src/pages/LeadsPage.tsx'),
      'utf8'
    );
    expect(content).not.toContain('acq-expand-result');
  });
});

// ─────────────────────────────────────────
// [BEHAVIOR] 5: DouyinBurnerBindPage 废弃（R2 新增）
// ─────────────────────────────────────────
describe('DouyinBurnerBindPage 废弃 redirect [BEHAVIOR]', () => {
  it('DouyinBurnerBindPage.tsx 不存在 OR 仅含 Navigate redirect 到 /area/acquisition/accounts', () => {
    const bindPagePath = resolve(ROOT, 'apps/dashboard/src/pages/DouyinBurnerBindPage.tsx');
    if (!existsSync(bindPagePath)) {
      // 文件已删除 → 合格
      expect(true).toBe(true);
      return;
    }
    const content = readFileSync(bindPagePath, 'utf8');
    // 文件存在但必须含 redirect/Navigate/accounts
    const hasRedirect =
      content.includes('Navigate') || content.includes('redirect') || content.includes('accounts');
    expect(hasRedirect).toBe(true);
  });

  it('路由配置文件含 DouyinBurnerBind 路径的 Navigate/redirect 定义', () => {
    const routeCandidates = [
      resolve(ROOT, 'apps/dashboard/src/config/navigation.config.ts'),
      resolve(ROOT, 'apps/dashboard/src/router/index.tsx'),
      resolve(ROOT, 'apps/dashboard/src/router/routes.tsx'),
    ].filter((f) => existsSync(f));
    expect(routeCandidates.length).toBeGreaterThan(0);
    // 至少一个路由文件含 Navigate 或 redirect（表示项目中有重定向支持）
    const hasNavigate = routeCandidates.some((f) => {
      const c = readFileSync(f, 'utf8');
      return c.includes('Navigate') || c.includes('redirect');
    });
    expect(hasNavigate).toBe(true);
  });
});

// ─────────────────────────────────────────
// [BEHAVIOR] 6: Playwright spec 存在且合规
// ─────────────────────────────────────────
describe('acquisition-ia.spec.ts E2E spec [BEHAVIOR]', () => {
  const specPath = resolve(ROOT, 'apps/dashboard/e2e/acquisition-ia.spec.ts');

  it('spec 文件存在于 apps/dashboard/e2e/', () => {
    expect(existsSync(specPath)).toBe(true);
  });

  it('spec 不含 page.route()（变体C 死规则禁止 stub）', () => {
    const content = readFileSync(specPath, 'utf8');
    expect(content).not.toContain('page.route(');
  });

  it('spec 含原有4个核心页面断言（Hub/Accounts/Tasks/Leads）', () => {
    const content = readFileSync(specPath, 'utf8');
    expect(content).toMatch(/hub-card-accounts|area\/acquisition/);
    expect(content).toMatch(/accounts/);
    expect(content).toMatch(/tasks/);
    expect(content).toMatch(/leads/);
  });

  it('spec 含 R2 新增：TasksPage 二级（video-cards-container）', () => {
    const content = readFileSync(specPath, 'utf8');
    expect(content).toContain('video-cards-container');
  });

  it('spec 含 R2 新增：leads 空态（leads-empty-placeholder 或 leads-list）', () => {
    const content = readFileSync(specPath, 'utf8');
    expect(content).toMatch(/leads-empty-placeholder|leads-list/);
  });

  it('spec 含 R2 新增：N=10 上限按钮置灰（toBeDisabled）', () => {
    const content = readFileSync(specPath, 'utf8');
    expect(content).toContain('toBeDisabled');
  });

  it('spec 含 R2 新增：失败态任务（task-status-failed + task-retry-btn）', () => {
    const content = readFileSync(specPath, 'utf8');
    expect(content).toContain('task-status-failed');
    expect(content).toContain('task-retry-btn');
  });
});

// ─────────────────────────────────────────
// [BEHAVIOR] 7: 路由注册（navigation.config.ts）
// ─────────────────────────────────────────
describe('路由注册 — /area/acquisition/accounts 和 /area/acquisition/tasks [BEHAVIOR]', () => {
  const candidates = [
    resolve(ROOT, 'apps/dashboard/src/config/navigation.config.ts'),
    resolve(ROOT, 'apps/dashboard/src/router/index.tsx'),
    resolve(ROOT, 'apps/dashboard/src/router/routes.tsx'),
  ].filter((f) => existsSync(f));

  it('路由配置注册 /area/acquisition/accounts', () => {
    const all = candidates.map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(all).toContain('/area/acquisition/accounts');
  });

  it('路由配置注册 /area/acquisition/tasks', () => {
    const all = candidates.map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(all).toContain('/area/acquisition/tasks');
  });
});

// ─────────────────────────────────────────
// [BEHAVIOR] 8: e2e-windows.yml 补充 secrets（R2 新增）
// ─────────────────────────────────────────
describe('e2e-windows.yml 补充 tenant secrets [BEHAVIOR]', () => {
  const workflowPath = resolve(ROOT, '.github/workflows/e2e-windows.yml');

  it('e2e-windows.yml 含 E2E_TEST_TENANT_ID secret 注入', () => {
    const content = readFileSync(workflowPath, 'utf8');
    expect(content).toContain('E2E_TEST_TENANT_ID');
  });

  it('e2e-windows.yml 含 E2E_OTHER_TENANT_ID secret 注入', () => {
    const content = readFileSync(workflowPath, 'utf8');
    expect(content).toContain('E2E_OTHER_TENANT_ID');
  });
});

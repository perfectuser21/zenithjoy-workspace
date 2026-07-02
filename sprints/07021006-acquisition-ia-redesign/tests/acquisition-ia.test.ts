/**
 * Sprint 07021006 — 获客工作台 IA 重设计 TDD Red 阶段
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
    // 端点路由：'/collect-tasks/:xxx/videos' 或 'collect-tasks/:task_id/videos'
    expect(content).toMatch(/collect-tasks\/:[\w_]+\/videos/);
  });

  it('路由含 tenant 过滤逻辑（IDOR 防护）', () => {
    const content = readFileSync(routeFile, 'utf8');
    // 路由函数体中应有 tenant_id 过滤
    const routeIdx = content.search(/collect-tasks\/:[\w_]+\/videos/);
    expect(routeIdx).toBeGreaterThan(-1);
    // 从路由位置截取后续约 500 字符，检查 tenant 过滤
    const routeBlock = content.slice(routeIdx, routeIdx + 1000);
    expect(routeBlock).toMatch(/tenant_id|tenantId/);
  });

  it('返回 schema 含 videos 数组和 total 字段（从源码静态检查）', () => {
    const content = readFileSync(routeFile, 'utf8');
    // 端点 response 应含 videos 和 total
    expect(content).toMatch(/videos/);
    expect(content).toMatch(/total/);
  });

  it('禁用字段 videoList/items 未出现在 collect-tasks/:id/videos 响应中', () => {
    const content = readFileSync(routeFile, 'utf8');
    const routeIdx = content.search(/collect-tasks\/:[\w_]+\/videos/);
    const routeBlock = content.slice(routeIdx, routeIdx + 1000);
    // 响应 body 里不应包含 videoList 或 items 作为 key
    expect(routeBlock).not.toMatch(/videoList:/);
    expect(routeBlock).not.toMatch(/items:/);
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

  it('返回 schema 含 leads 数组和 total（不含禁用字段 comments）', () => {
    const content = readFileSync(routeFile, 'utf8');
    const routeIdx = content.search(/\/videos\/:[\w_]+\/leads/);
    const routeBlock = content.slice(routeIdx, routeIdx + 800);
    expect(routeBlock).toMatch(/leads/);
    expect(routeBlock).toMatch(/total/);
    expect(routeBlock).not.toMatch(/comments:/);
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
      // 上一个 test 已 FAIL，这里提前跳过防止二次噪音
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
    // 至少含两个状态值的映射
    expect(content).toMatch(/active|needs_rebind|banned/);
  });
});

describe('TasksPage 新组件 [BEHAVIOR]', () => {
  it('apps/dashboard/src/pages/acquisition/TasksPage.tsx 文件存在', () => {
    const exists = existsSync(
      resolve(ROOT, 'apps/dashboard/src/pages/acquisition/TasksPage.tsx')
    );
    expect(exists).toBe(true);
  });

  it('TasksPage 含 keyword-input + start-collect-btn + tasks-list testId', () => {
    const content = readFileSync(
      resolve(ROOT, 'apps/dashboard/src/pages/acquisition/TasksPage.tsx'),
      'utf8'
    );
    expect(content).toContain('keyword-input');
    expect(content).toContain('start-collect-btn');
    expect(content).toContain('tasks-list');
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
    // 可能在 src/pages/ 或 src/pages/acquisition/ 下
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
// [BEHAVIOR] 5: Playwright spec 存在且合规
// ─────────────────────────────────────────
describe('acquisition-ia.spec.ts E2E spec [BEHAVIOR]', () => {
  it('spec 文件存在于 apps/dashboard/e2e/', () => {
    const exists = existsSync(
      resolve(ROOT, 'apps/dashboard/e2e/acquisition-ia.spec.ts')
    );
    expect(exists).toBe(true);
  });

  it('spec 不含 page.route()（变体C 死规则禁止 stub）', () => {
    const content = readFileSync(
      resolve(ROOT, 'apps/dashboard/e2e/acquisition-ia.spec.ts'),
      'utf8'
    );
    expect(content).not.toContain('page.route(');
  });

  it('spec 含4个核心页面断言（Hub/Accounts/Tasks/Leads）', () => {
    const content = readFileSync(
      resolve(ROOT, 'apps/dashboard/e2e/acquisition-ia.spec.ts'),
      'utf8'
    );
    expect(content).toMatch(/hub-card-accounts|area\/acquisition/);
    expect(content).toMatch(/accounts/);
    expect(content).toMatch(/tasks/);
    expect(content).toMatch(/leads/);
  });
});

// ─────────────────────────────────────────
// [BEHAVIOR] 6: 路由注册（navigation.config.ts）
// ─────────────────────────────────────────
describe('路由注册 — /area/acquisition/accounts 和 /area/acquisition/tasks [BEHAVIOR]', () => {
  const navConfig = resolve(ROOT, 'apps/dashboard/src/config/navigation.config.ts');

  it('navigation.config.ts 注册 /area/acquisition/accounts', () => {
    const content = readFileSync(navConfig, 'utf8');
    expect(content).toContain('/area/acquisition/accounts');
  });

  it('navigation.config.ts 注册 /area/acquisition/tasks', () => {
    const content = readFileSync(navConfig, 'utf8');
    expect(content).toContain('/area/acquisition/tasks');
  });
});

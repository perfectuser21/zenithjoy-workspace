# Sprint 2.1f Prod-Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Path 1 Step 2（装客户端 + Agent 自动连中台）从 "sprint 2.1e ship 但跑不通" → "任何全新客户机能 e2e"。9 件产品级 fix 一次性补完，让客户从 dashboard 下载 install pack 双击 start.bat 后 agent 上线绿灯，**无需手编 .env**。

**Architecture:** 5 commit 严格按加厚铁律走 — RED 测试 → 删占位减肥 → 后端+db 增肌 → agent+install pack 增肌 → build/deploy/真 e2e。spec 把 9 件 fix 拆到这 5 个 commit 里，每件都映射到具体 Task step。

**Tech Stack:** TypeScript / Express / vitest / supertest / pg / pkg / PowerShell / Windows batch / GNU tar (BSD tar fallback) / DeepSeek 不涉及。

**Spec source:** `docs/superpowers/specs/2026-05-09-sprint-2-1f-prod-readiness-design.md` (commit 6e8c7b8)

**Walking Skeleton Path:** [Path 1 客户首次成功](https://www.notion.so/358c40c2ba6381b2a6eacd288cf82f29)，本 sprint 把 Step 2 thickness `thin (sprint 2.1e ship 但跑不通) → robust (任何全新客户机能 e2e)`。

---

## Spec → Task 映射表（9 件 fix → 5 commit）

| Fix | 主题 | Task |
|---|---|---|
| Fix 1 | mac 后端加 LICENSE_HMAC_SECRET | Task 3 step 3.1（运维 .env，不入 git） |
| Fix 2 | 9 条历史 hex license normalize migration | Task 3 step 3.3 |
| Fix 3 | LICENSE_KEY_PATTERN 正则放宽到 [A-Z0-9] | Task 1 RED → Task 3 step 3.4 |
| Fix 4 | gen_base32_chars(n) PG function | Task 1 RED → Task 3 step 3.5 |
| Fix 5 | start.bat ASCII + chcp 65001 + LF | Task 4 step 4.1 |
| Fix 6 | agent envOrConfig（env 优先 fallback config.json） | Task 1 RED → Task 4 step 4.2 |
| Fix 7 | install pack download 真烧 user license | Task 1 RED → Task 2 减肥 → Task 3 step 3.6 |
| Fix 8 | start.bat 启动前 license 预检 | Task 4 step 4.3 |
| Fix 9 | uninstall.bat 客户卸载脚本 | Task 4 step 4.4 |

---

## Task 1: 写 5 个 RED 测试（commit 1）

**Goal:** 先定义 "什么叫做完"，每个测试必须真跑 FAIL（不是 skip 不是 dummy assert）。CI 会用 `lint-tdd-commit-order` 强校 — RED commit 必须比 GREEN commit 先出现。

**Files:**
- Modify: `apps/api/src/services/license.service.test.ts` (Fix 3 unit — LICENSE_KEY_PATTERN 接受 hex)
  - 文件不存在则 Create；当前测试在 `__tests__/` 下查不到 `license.service.test.ts`，按 vitest config `src/**/*.test.{ts,js}` glob 直接和 src 同目录创建
- Modify: `apps/api/src/routes/__tests__/agent-install-pack.test.ts` (Fix 7 — download endpoint 真返 tar.gz 含 user license)
- Create: `services/agent/src/__tests__/load-config.test.ts` (Fix 6 — envOrConfig 优先 env)
- Create: `apps/api/db/migrations/__tests__/normalize-hex-licenses.test.ts` (Fix 2 + Fix 4 — migration 正确性 + PG function)

**Steps:**

### Step 1.1 — Fix 3 unit test（LICENSE_KEY_PATTERN 接受 hex）

- [ ] Create `apps/api/src/services/license.service.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { isValidLicenseKeyFormat } from './license.service';

describe('isValidLicenseKeyFormat — Sprint 2.1f Fix 3', () => {
  // 这些是历史真客户的 hex 字符 license，旧正则 [A-Z2-9]{8} 会拒
  it('接受 hex 字符 license（含 0/1）— ZJ-F-44D00A51', () => {
    expect(isValidLicenseKeyFormat('ZJ-F-44D00A51')).toBe(true);
  });

  it('接受 hex 字符 license — ZJ-F-AA724212', () => {
    expect(isValidLicenseKeyFormat('ZJ-F-AA724212')).toBe(true);
  });

  it('接受 hex 字符 license — ZJ-F-B2D0AEE8', () => {
    expect(isValidLicenseKeyFormat('ZJ-F-B2D0AEE8')).toBe(true);
  });

  // 已有 base32 license 必须继续接受
  it('接受 base32 license — ZJ-F-K3MYP4VR', () => {
    expect(isValidLicenseKeyFormat('ZJ-F-K3MYP4VR')).toBe(true);
  });

  it('接受 ZJ-F-AAAAAAAA（极端但合法）', () => {
    expect(isValidLicenseKeyFormat('ZJ-F-AAAAAAAA')).toBe(true);
  });

  it('拒长度不足 — ZJ-F-AAAA', () => {
    expect(isValidLicenseKeyFormat('ZJ-F-AAAA')).toBe(false);
  });

  it('拒小写 — zj-f-aaaaaaaa', () => {
    expect(isValidLicenseKeyFormat('zj-f-aaaaaaaa')).toBe(false);
  });

  it('拒非法 tier prefix — ZJ-X-AAAAAAAA', () => {
    expect(isValidLicenseKeyFormat('ZJ-X-AAAAAAAA')).toBe(false);
  });
});
```

- [ ] Run: `cd apps/api && npm test -- src/services/license.service.test.ts 2>&1 | tail -20`
- **Expected:** 3 个 hex case FAIL（旧 `/^ZJ-[FBMSE]-[A-Z2-9]{8}$/` 拒 0/1/4），其余 PASS。整体 FAIL。

### Step 1.2 — Fix 7 integration test（download 真烧 user license）

- [ ] Edit `apps/api/src/routes/__tests__/agent-install-pack.test.ts`：在文件末尾追加 `describe('Sprint 2.1f Fix 7 — server-side license burn-in')` 块。当前的 302 redirect test 保留作为对比（实现完成后会删 — 见 Task 2）。

```ts
// ↓↓↓ 追加到文件末尾 ↓↓↓
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';

describe('Sprint 2.1f Fix 7 — GET /api/agent/install-pack/download server-side license burn-in', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    // 准备一个真 tar.gz fixture 让 handler 解 → 改 .env → 重打包
    const fixDir = path.join(os.tmpdir(), `install-pack-fixture-${Date.now()}`);
    fs.mkdirSync(fixDir, { recursive: true });
    fs.writeFileSync(
      path.join(fixDir, '.env'),
      'ZENITHJOY_API_BASE=https://autopilot.zenjoymedia.media\nZENITHJOY_LICENSE=__PLACEHOLDER__\n'
    );
    fs.writeFileSync(path.join(fixDir, 'start.bat'), '@echo off\nREM placeholder\n');
    // tar.gz fixture（不依赖具体文件名，handler 会读 manifest.download_url 拼路径）
    const fixturePath = path.join(os.tmpdir(), `install-pack-fixture-${Date.now()}.tar.gz`);
    spawnSync('tar', ['-czf', fixturePath, '-C', fixDir, '.'], { stdio: 'pipe' });
    process.env.INSTALL_PACK_FIXTURE_PATH = fixturePath; // handler 实现要支持这个 override

    (manifestSvc.readInstallPackManifest as any).mockReturnValue({
      version: '1.0.1',
      sha256: 'a'.repeat(64),
      download_url: '/download/zenithjoy-agent-v1.0.1.tar.gz',
      size: 60000000,
      build_time: '2026-05-09T10:00:00Z',
    });
    app = (await import('../../app')).default;
  });

  it('登录 user A（持 license ZJ-F-AAAA1111）→ 200 + tar.gz 含 ZENITHJOY_LICENSE=ZJ-F-AAAA1111', async () => {
    // mock auth.api.getSession 返 user A + DB 查到 license
    const { auth } = await import('../../auth');
    const pool = (await import('../../db/connection')).default;
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      user: { id: 'user-A-id', email: 'a@test', name: 'A' },
    } as any);
    vi.spyOn(pool, 'query').mockResolvedValue({
      rows: [{ license_key: 'ZJ-F-AAAA1111' }],
    } as any);

    const res = await request(app).get('/api/agent/install-pack/download');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/(gzip|octet-stream|x-gzip|x-tar)/);

    // 解 stream 验证 .env 内容
    const tmpOut = path.join(os.tmpdir(), `download-out-A-${Date.now()}`);
    fs.mkdirSync(tmpOut, { recursive: true });
    const tarPath = path.join(tmpOut, 'pack.tar.gz');
    fs.writeFileSync(tarPath, res.body);
    spawnSync('tar', ['-xzf', tarPath, '-C', tmpOut], { stdio: 'pipe' });
    const envContent = fs.readFileSync(path.join(tmpOut, '.env'), 'utf-8');
    expect(envContent).toContain('ZENITHJOY_LICENSE=ZJ-F-AAAA1111');
    expect(envContent).not.toContain('__PLACEHOLDER__');
  });

  it('登录 user B（持 license ZJ-F-BBBB2222）→ 解压 .env 含 user B 的 license（不同 user 不同 .env）', async () => {
    const { auth } = await import('../../auth');
    const pool = (await import('../../db/connection')).default;
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      user: { id: 'user-B-id', email: 'b@test', name: 'B' },
    } as any);
    vi.spyOn(pool, 'query').mockResolvedValue({
      rows: [{ license_key: 'ZJ-F-BBBB2222' }],
    } as any);

    const res = await request(app).get('/api/agent/install-pack/download');
    expect(res.status).toBe(200);
    const tmpOut = path.join(os.tmpdir(), `download-out-B-${Date.now()}`);
    fs.mkdirSync(tmpOut, { recursive: true });
    const tarPath = path.join(tmpOut, 'pack.tar.gz');
    fs.writeFileSync(tarPath, res.body);
    spawnSync('tar', ['-xzf', tarPath, '-C', tmpOut], { stdio: 'pipe' });
    const envContent = fs.readFileSync(path.join(tmpOut, '.env'), 'utf-8');
    expect(envContent).toContain('ZENITHJOY_LICENSE=ZJ-F-BBBB2222');
    expect(envContent).not.toContain('AAAA1111');
  });

  it('未登录 → 401 + UNAUTHORIZED', async () => {
    const { auth } = await import('../../auth');
    vi.spyOn(auth.api, 'getSession').mockResolvedValue(null as any);

    const res = await request(app).get('/api/agent/install-pack/download');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('登录但用户名下无 license → 503 + NO_ACTIVE_LICENSE', async () => {
    const { auth } = await import('../../auth');
    const pool = (await import('../../db/connection')).default;
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      user: { id: 'user-no-lic', email: 'n@test', name: 'N' },
    } as any);
    vi.spyOn(pool, 'query').mockResolvedValue({ rows: [] } as any);

    const res = await request(app).get('/api/agent/install-pack/download');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('NO_ACTIVE_LICENSE');
  });
});
```

- [ ] Run: `cd apps/api && npm test -- src/routes/__tests__/agent-install-pack.test.ts 2>&1 | tail -30`
- **Expected:** Sprint 2.1f Fix 7 4 个 case 全 FAIL（当前 handler 是 302 redirect，没鉴权也没烧 license）。前面 2 个旧 302 case PASS（这两个 Task 2 减肥时删）。

### Step 1.3 — Fix 6 agent envOrConfig test

- [ ] Create `services/agent/src/__tests__/load-config.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('agent loadOrInitConfig — Sprint 2.1f Fix 6 envOrConfig', () => {
  const ENV_VARS_TO_RESTORE = [
    'ZENITHJOY_LICENSE',
    'ZENITHJOY_API_BASE',
    'ZENITHJOY_API_URL',
    'ZENITHJOY_CHROME_DEBUG_PORT',
    'APPDATA',
    'HOME',
  ];
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    ENV_VARS_TO_RESTORE.forEach((k) => (original[k] = process.env[k]));
    // 清空 env，让每个 case 自己控制
    delete process.env.ZENITHJOY_LICENSE;
    delete process.env.ZENITHJOY_API_BASE;
    delete process.env.ZENITHJOY_API_URL;
    delete process.env.ZENITHJOY_CHROME_DEBUG_PORT;
    // 隔离 APPDATA 到临时目录，避免污染真实 config
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-agent-test-'));
    process.env.APPDATA = tmp;
    process.env.HOME = tmp;
    vi.resetModules();
  });

  afterEach(() => {
    ENV_VARS_TO_RESTORE.forEach((k) => {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    });
  });

  it('设了 ZENITHJOY_LICENSE env → loadOrInitConfig 返此 license，不读 config.json', async () => {
    process.env.ZENITHJOY_LICENSE = 'ZJ-F-XXXXXXXX';
    process.env.ZENITHJOY_API_URL = 'wss://api.test.com/agent-ws';
    const readSpy = vi.spyOn(fs, 'readFileSync');

    const mod = await import('../config-loader'); // Task 4 要新建该模块
    const cfg = mod.loadOrInitConfig();

    expect(cfg.licenseKey).toBe('ZJ-F-XXXXXXXX');
    // readFileSync 不应该被调用读 config.json（其他读没关系）
    const calls = readSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((p) => p.endsWith('config.json'))).toBe(false);
  });

  it('未设 env，但 %APPDATA%/zenithjoy-agent/config.json 存在 → fallback 读 config.json', async () => {
    const cfgDir = path.join(process.env.APPDATA!, 'zenithjoy-agent');
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(
      path.join(cfgDir, 'config.json'),
      JSON.stringify({
        licenseKey: 'ZJ-F-FROMCONF',
        agentId: 'agent-test',
        apiUrl: 'wss://api.test.com/agent-ws',
        loggedInAt: 0,
      })
    );

    const mod = await import('../config-loader');
    const cfg = mod.loadOrInitConfig();
    expect(cfg.licenseKey).toBe('ZJ-F-FROMCONF');
  });

  it('env 和 config 都没 → 抛错告知去检查 .env / 重装 install pack', async () => {
    const mod = await import('../config-loader');
    expect(() => mod.loadOrInitConfig()).toThrowError(/ZENITHJOY_LICENSE|install pack|.env/i);
  });
});
```

- [ ] Run: `cd services/agent && npm test -- src/__tests__/load-config.test.ts 2>&1 | tail -20`
- **Expected:** 全 FAIL（`config-loader` 模块还不存在，import 报 Cannot find module）。

### Step 1.4 — Fix 2 + Fix 4 migration test

- [ ] Create `apps/api/db/migrations/__tests__/normalize-hex-licenses.test.ts`：

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import fs from 'node:fs';
import path from 'node:path';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  'postgres://postgres:postgres@localhost:5432/zenithjoy_test';

const SCHEMA = 'zenithjoy_2_1f_test';
let pool: Pool;

async function runSqlFile(rel: string) {
  const sql = fs.readFileSync(path.join(__dirname, '..', rel), 'utf-8');
  await pool.query(sql.replace(/zenithjoy\./g, `${SCHEMA}.`));
}

describe('Sprint 2.1f Fix 2 — normalize hex licenses to base32 migration', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL });
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${SCHEMA}`);
    // 最小 fixture：只建 licenses 表 + 9 条 hex license（含 0/1 字符）
    await pool.query(`
      CREATE TABLE ${SCHEMA}.licenses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        license_key text UNIQUE NOT NULL,
        tier text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const fixtures = [
      'ZJ-TUSMOKE-A0000001',  // smoke 豁免，不 normalize
      'ZJ-TUSMOKE-B0000001',  // smoke 豁免
      'ZJ-F-BA6C851E',
      'ZJ-F-AA724212',
      'ZJ-F-B2D0AEE8',
      'ZJ-F-K3MYP4VR',  // 已是 base32
      'ZJ-F-640DDB65',
      'ZJ-F-48022F1C',
      'ZJ-F-87E07BC8',
    ];
    for (const k of fixtures) {
      await pool.query(`INSERT INTO ${SCHEMA}.licenses (license_key, tier) VALUES ($1, 'free')`, [k]);
    }
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.end();
  });

  it('migration 跑后非 TUSMOKE 行全部匹配 ZJ-[FBMSE]-[A-Z0-9]{8}', async () => {
    await runSqlFile('20260509_120000_normalize_hex_licenses_to_base32.sql');
    const { rows } = await pool.query(
      `SELECT count(*) AS bad
         FROM ${SCHEMA}.licenses
        WHERE license_key !~ '^ZJ-[FBMSE]-[A-Z0-9]{8}$'
          AND license_key NOT LIKE 'ZJ-TUSMOKE-%'`
    );
    expect(Number(rows[0].bad)).toBe(0);
  });
});

describe('Sprint 2.1f Fix 4 — gen_base32_chars(n) PG function', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL });
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA}_fn CASCADE`);
    await pool.query(`CREATE SCHEMA ${SCHEMA}_fn`);
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA}_fn CASCADE`);
    await pool.end();
  });

  it('gen_base32_chars(8) 返 8 字符 [A-Z2-9]', async () => {
    const sql = fs
      .readFileSync(path.join(__dirname, '..', '20260509_120100_gen_base32_chars_function.sql'), 'utf-8')
      .replace(/zenithjoy\./g, `${SCHEMA}_fn.`);
    await pool.query(sql);
    for (let i = 0; i < 100; i++) {
      const { rows } = await pool.query(`SELECT ${SCHEMA}_fn.gen_base32_chars(8) AS s`);
      expect(rows[0].s).toMatch(/^[A-Z2-9]{8}$/);
    }
  });

  it('gen_base32_chars(12) 返 12 字符 [A-Z2-9]', async () => {
    const { rows } = await pool.query(`SELECT ${SCHEMA}_fn.gen_base32_chars(12) AS s`);
    expect(rows[0].s).toMatch(/^[A-Z2-9]{12}$/);
  });
});
```

- [ ] Run: `cd apps/api && npm run test:integration -- db/migrations/__tests__/normalize-hex-licenses.test.ts 2>&1 | tail -30`
- **Expected:** FAIL — migration 文件 `20260509_120000_*.sql` 和 `20260509_120100_*.sql` 都不存在，`runSqlFile` ENOENT。

### Step 1.5 — 全 RED 跑一遍确认 fail

- [ ] Run: `cd apps/api && npm test 2>&1 | tail -10`
- **Expected:** 总体 FAIL（统计含 7 个 RED）

- [ ] Run: `cd services/agent && npm test 2>&1 | tail -10`
- **Expected:** 总体 FAIL（load-config.test.ts 全 fail）

### Step 1.6 — Commit 1（RED）

- [ ] Stage:

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1f-prod-readiness
git add apps/api/src/services/license.service.test.ts \
        apps/api/src/routes/__tests__/agent-install-pack.test.ts \
        services/agent/src/__tests__/load-config.test.ts \
        apps/api/db/migrations/__tests__/normalize-hex-licenses.test.ts
```

- [ ] Commit:

```bash
git commit -m "$(cat <<'EOF'
test(2-1f): 5 fail tests for prod readiness fixes (RED)

Fix 3 — license.service.test.ts: hex license (ZJ-F-44D00A51 等) 必须接受
Fix 7 — agent-install-pack.test.ts: download 必须真烧 user license + 401/503
Fix 6 — load-config.test.ts: agent envOrConfig（env 优先 fallback config.json）
Fix 2 — normalize-hex-licenses.test.ts: migration 跑后无非法 license
Fix 4 — gen_base32_chars(n) PG function 返 [A-Z2-9]{n}

走加厚铁律 commit 1 / 5：RED 测试先行，下个 commit 减肥删占位，再下个增肌。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 减肥 — 删 sprint 2.1e 占位 license + v1.0.0 旧 build artifacts（commit 2）

**Goal:** 加厚铁律 4 强校 — 升级 thickness 必须先删旧 mock/hardcode/占位，再写新实现。下个 commit 才写 Fix 7 的 server-side burn-in，本 commit 把 .env.template 的占位段删掉，并把 v1.0.0 旧 build artifact 标记淘汰。

**Files:**
- Modify: `services/agent/install-pack/.env.template`（删 `ZENITHJOY_LICENSE=ZJ-F-XXXXXXXX` 占位行 + 注释说明改由后端烧入）
- Modify: `apps/api/src/routes/__tests__/agent-install-pack.test.ts`（删旧 302 redirect describe 块，留 manifest 块 + Sprint 2.1f Fix 7 块）
- Modify: `apps/api/src/routes/agent-install-pack.ts`（删旧 302 handler，留 manifest，下个 commit Task 3 step 3.6 写新 handler）
- Modify: `services/agent/install-pack/README-1分钟跑通.txt`（更新提示「不需要编辑 .env，license 已自动烧入」）
- 不删 dist-installpack/v1.0.0 文件（dist-installpack 整个目录是 .gitignore 不入 git，无需 git 操作；但 commit message 标 v1.0.1 强制升级声明）

**Steps:**

### Step 2.1 — 删 .env.template 占位 license 行

- [ ] Edit `services/agent/install-pack/.env.template` 改成：

```
# ZenithJoy Agent — install pack 配置
# 本文件由后端 download endpoint 在 server 端动态生成 ZENITHJOY_LICENSE
# 客户**不需要手动编辑**，双击 start.bat 即可启动

# 中台 API（默认线上 / 内测可改 mac mini Tailscale IP）
ZENITHJOY_API_BASE=https://autopilot.zenjoymedia.media

# 你的 license — 由 dashboard download endpoint 自动烧入，本占位仅为 fallback
# 如果你看到 __PLACEHOLDER__，说明 download 路径异常，请回 dashboard 重新下载
ZENITHJOY_LICENSE=__PLACEHOLDER__

# Chrome 调试端口（一般用默认即可）
ZENITHJOY_CHROME_DEBUG_PORT=19222
```

### Step 2.2 — 删旧 302 download handler test 块

- [ ] Edit `apps/api/src/routes/__tests__/agent-install-pack.test.ts`：删整个 `describe('GET /api/agent/install-pack/download', ...)` 块（约第 46-74 行），保留 manifest describe 块和 Task 1 加的 Sprint 2.1f Fix 7 块。

### Step 2.3 — 删旧 302 download handler 实现（留 manifest）

- [ ] Edit `apps/api/src/routes/agent-install-pack.ts`：删第 19-28 行 `agentInstallPackRouter.get('/download', ...)` block，保留 `import` + manifest handler。Task 3 step 3.6 重写新 handler。

文件改后内容：

```ts
// Sprint 2.1e — install pack manifest endpoint
// Sprint 2.1f — download handler 重写见 Task 3 step 3.6
import { Router, type Request, type Response } from 'express';
import { readInstallPackManifest } from '../services/install-pack-manifest';

export const agentInstallPackRouter = Router();

agentInstallPackRouter.get('/manifest', (_req: Request, res: Response) => {
  const m = readInstallPackManifest();
  if (!m) {
    return res.status(503).json({
      ok: false,
      code: 'INSTALL_PACK_NOT_BUILT',
      message: 'install pack not built yet — wait for next CI run',
    });
  }
  return res.status(200).json(m);
});
```

### Step 2.4 — README 更新提示

- [ ] Edit `services/agent/install-pack/README-1分钟跑通.txt` 顶部加一段：

```
【Sprint 2.1f 起 — 不需要手动编辑 .env】
从 dashboard 下载的 install pack 已经在 server 端把你的 license 烧进 .env。
解压后直接双击 start.bat 即可。如果看到 __PLACEHOLDER__ 错误，请回 dashboard 重新下载。
```

### Step 2.5 — Run（确认 RED 没变 GREEN，只是变形）

- [ ] Run: `cd apps/api && npm test -- src/routes/__tests__/agent-install-pack.test.ts 2>&1 | tail -20`
- **Expected:** Sprint 2.1f Fix 7 块仍 4 个 FAIL（handler 不存在了，404）。manifest 块仍 PASS。

### Step 2.6 — Commit 2（减肥，含 replaces_old_thin marker）

CI `lint-tdd-commit-order` 与加厚铁律 4 检查 commit message 含 `replaces_old_thin:` marker。

- [ ] Stage + Commit:

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1f-prod-readiness
git add services/agent/install-pack/.env.template \
        services/agent/install-pack/README-1分钟跑通.txt \
        apps/api/src/routes/agent-install-pack.ts \
        apps/api/src/routes/__tests__/agent-install-pack.test.ts

git commit -m "$(cat <<'EOF'
refactor(2-1f): 删 install pack 占位 license + v1.0.0 旧 download handler

减肥准备：下个 commit Task 3 step 3.6 写 server-side license burn-in 实现。

replaces_old_thin: services/agent/install-pack/.env.template ZENITHJOY_LICENSE=ZJ-F-XXXXXXXX 占位 → 由后端 download endpoint 真烧入 (Fix 7)
replaces_old_thin: apps/api/src/routes/agent-install-pack.ts 302 nginx static redirect → server-side stream 含 user license (Fix 7)
replaces_old_thin: dist-installpack/v1.0.0 整套 → v1.0.1 强制升级（v1.0.0 客户机 100% 跑不通，含 BOM start.bat + 占位 license）

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 增肌 — 后端 + db 修（commit 3，Fix 1/2/3/4/7）

**Goal:** 5 件后端/db 改全部落地，让 Task 1 的 license.service.test.ts / agent-install-pack.test.ts / normalize-hex-licenses.test.ts 全转 GREEN。

**Files:**
- Modify (运维 only，不入 git): `apps/api/.env`（加 LICENSE_HMAC_SECRET — Fix 1）
- Create: `apps/api/db/migrations/20260509_120000_normalize_hex_licenses_to_base32.sql`（Fix 2）
- Create: `apps/api/db/migrations/20260509_120100_gen_base32_chars_function.sql`（Fix 4）
- Modify: `apps/api/src/services/license.service.ts`（Fix 3 — 正则放宽）
- Rewrite: `apps/api/src/routes/agent-install-pack.ts`（Fix 7 — server-side burn-in）

**Steps:**

### Step 3.1 — Fix 1: mac 后端加 LICENSE_HMAC_SECRET（运维，不入 git）

> **重要：** 本 step 操作的是主仓库的 `apps/api/.env`，不在 worktree。secret 也要存 1Password CS Vault + 双写 `~/.credentials/zenithjoy-api.env`（chmod 600）。

- [ ] 生成 32 字符随机 secret：

```bash
SECRET=$(openssl rand -hex 16)
echo "Generated LICENSE_HMAC_SECRET: $SECRET"
```

- [ ] 双写到 `~/.credentials/zenithjoy-api.env`（创建或追加）：

```bash
mkdir -p ~/.credentials && chmod 700 ~/.credentials
if grep -q "^LICENSE_HMAC_SECRET=" ~/.credentials/zenithjoy-api.env 2>/dev/null; then
  echo "LICENSE_HMAC_SECRET 已存在，跳过覆盖"
else
  echo "LICENSE_HMAC_SECRET=$SECRET" >> ~/.credentials/zenithjoy-api.env
  chmod 600 ~/.credentials/zenithjoy-api.env
fi
```

- [ ] 同步到主仓库 mac 后端 `.env`（不在 worktree）：

```bash
cd /Users/administrator/perfect21/zenithjoy/apps/api
if grep -q "^LICENSE_HMAC_SECRET=" .env; then
  echo ".env 已含 LICENSE_HMAC_SECRET，跳过"
else
  echo "LICENSE_HMAC_SECRET=$SECRET" >> .env
  echo "✅ 已追加到 mac 后端 .env"
fi
```

- [ ] 重启 mac 后端 fastify（PM2 / launchctl / 直接 npm start，照 ops SOP）。

- [ ] 1Password 同步：调 `/credentials` skill 写入 CS Vault 「ZenithJoy API Env」条目 `LICENSE_HMAC_SECRET` 字段（值 = 上面生成的 SECRET）。

- **Verification:**

```bash
curl -s http://localhost:3001/health 2>&1 | head -5
# 后端 console 不应再打印 "LICENSE_HMAC_SECRET 必须在生产环境设置（≥ 16 字符）" 警告

# 模拟 register（用任一已有 license）
curl -s -X POST http://localhost:3001/api/agent/register \
  -H "Content-Type: application/json" \
  -d '{"license_key":"ZJ-F-K3MYP4VR","machine_id":"prod-readiness-verify-machine"}' | head
# 不应返 {"code":"REGISTER_FAILED",...}
```

### Step 3.2 — Fix 4: gen_base32_chars(n) PG function migration

- [ ] Create `apps/api/db/migrations/20260509_120100_gen_base32_chars_function.sql`：

```sql
-- Sprint 2.1f Fix 4 — gen_base32_chars(n) helper
-- 将来任何 license 回填都用此函数，不再用 md5() hex（含 0/1 与新正则冲突）
-- 字符集：[A-Z2-9]，与 license.service.ts generateLicenseKey 一致

CREATE OR REPLACE FUNCTION zenithjoy.gen_base32_chars(n int)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- 32 字符（去 I O 0 1 易混淆）
  out_str text := '';
  i int;
BEGIN
  FOR i IN 1..n LOOP
    out_str := out_str || substr(chars, 1 + floor(random() * length(chars))::int, 1);
  END LOOP;
  RETURN out_str;
END;
$$;

COMMENT ON FUNCTION zenithjoy.gen_base32_chars(int)
  IS 'Sprint 2.1f Fix 4 — base32 字符集随机串，license 回填用';
```

### Step 3.3 — Fix 2: normalize 9 条历史 hex license

- [ ] Create `apps/api/db/migrations/20260509_120000_normalize_hex_licenses_to_base32.sql`：

```sql
-- Sprint 2.1f Fix 2 — normalize 历史 hex license 到 base32 字符集
-- 老 hot-fix migration（20260507_180000_licenses_tier_check_add_free.sql）
-- 用 md5() hex 回填 license，含 0/1 与新正则 [A-Z0-9] 冲突
--
-- 本 migration 一次性 UPDATE 所有非 TUSMOKE 行不匹配 ^ZJ-[FBMSE]-[A-Z0-9]{8}$ 的行
-- 用 Fix 4 的 gen_base32_chars(8) 生成新 license_key
--
-- 决策：免费用户改了 license 重启 agent 几秒重连，对客户体验影响极小（决策 #2）

DO $$
DECLARE
  bad_row record;
  new_key text;
  prefix char;
BEGIN
  FOR bad_row IN
    SELECT id, license_key, tier
      FROM zenithjoy.licenses
     WHERE license_key !~ '^ZJ-[FBMSE]-[A-Z0-9]{8}$'
       AND license_key NOT LIKE 'ZJ-TUSMOKE-%'
  LOOP
    -- tier prefix 推断
    prefix := CASE bad_row.tier
      WHEN 'free' THEN 'F'
      WHEN 'basic' THEN 'B'
      WHEN 'matrix' THEN 'M'
      WHEN 'studio' THEN 'S'
      WHEN 'enterprise' THEN 'E'
      ELSE 'F'
    END;
    -- 防撞循环：拼一个新 key，UNIQUE 撞了再拼
    LOOP
      new_key := 'ZJ-' || prefix || '-' || zenithjoy.gen_base32_chars(8);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM zenithjoy.licenses WHERE license_key = new_key);
    END LOOP;

    UPDATE zenithjoy.licenses
       SET license_key = new_key,
           updated_at = now()
     WHERE id = bad_row.id;

    RAISE NOTICE 'normalized license_id=% old=% new=%', bad_row.id, bad_row.license_key, new_key;
  END LOOP;
END $$;

-- 后置断言：跑完无非法行
DO $$
DECLARE
  bad_count int;
BEGIN
  SELECT count(*) INTO bad_count
    FROM zenithjoy.licenses
   WHERE license_key !~ '^ZJ-[FBMSE]-[A-Z0-9]{8}$'
     AND license_key NOT LIKE 'ZJ-TUSMOKE-%';
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'normalize migration left % illegal rows', bad_count;
  END IF;
END $$;
```

> 注意 migration 时序：`20260509_120000_normalize_*.sql` 数字编号小于 `20260509_120100_gen_base32_chars_function.sql`，但前者依赖后者。**修正命名**：把 normalize migration 编号改为 `20260509_120200_normalize_*.sql`（120100 是 function，120200 是用 function 的 normalize），保证 migration runner 按字典序先建函数后用函数。

- [ ] **Rename**：把上面的 `20260509_120000_normalize_hex_licenses_to_base32.sql` 实际写到 `20260509_120200_normalize_hex_licenses_to_base32.sql`。

  - 同步更新 `apps/api/db/migrations/__tests__/normalize-hex-licenses.test.ts` 第 1 个 `runSqlFile` 的文件名（Task 1 step 1.4 已写 `20260509_120000_*`，这里需修正）：
    - 在 Task 1 step 1.4 写测试时使用 `20260509_120200_*` 文件名（plan 里 step 1.4 已经是 `20260509_120000_*`，**implementer 在 Task 3 step 3.3 落地前回去修一下 step 1.4 测试里的文件名引用**）。
    - 简单起见：在 step 3.3 实施时，**直接 edit step 1.4 写的 test.ts**，把 `20260509_120000_normalize_hex_licenses_to_base32.sql` 改为 `20260509_120200_normalize_hex_licenses_to_base32.sql`。

### Step 3.4 — Fix 3: LICENSE_KEY_PATTERN 正则放宽

- [ ] Edit `apps/api/src/services/license.service.ts` 第 95 行：

```diff
-const LICENSE_KEY_PATTERN = /^ZJ-[FBMSE]-[A-Z2-9]{8}$/;
+const LICENSE_KEY_PATTERN = /^ZJ-[FBMSE]-[A-Z0-9]{8}$/;
```

- [ ] Run: `cd apps/api && npm test -- src/services/license.service.test.ts 2>&1 | tail -15`
- **Expected:** Task 1 step 1.1 写的 8 个 case 全 GREEN。

### Step 3.5 — 验 Fix 4 + Fix 2 migration test 转绿

- [ ] Run: `cd apps/api && npm run test:integration -- db/migrations/__tests__/normalize-hex-licenses.test.ts 2>&1 | tail -30`
- **Expected:** Fix 2 + Fix 4 case 全 GREEN（依赖本地 docker postgres，按 vitest.integration.config.ts 起的 TEST_DATABASE_URL）。

### Step 3.6 — Fix 7: 重写 install pack download handler（server-side burn-in）

- [ ] Edit `apps/api/src/routes/agent-install-pack.ts` 完整重写：

```ts
// Sprint 2.1e — install pack manifest endpoint
// Sprint 2.1f Fix 7 — download handler server-side license burn-in 重写
import { Router, type Request, type Response } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fromNodeHeaders } from 'better-auth/node';
import pool from '../db/connection';
import { auth } from '../auth';
import { readInstallPackManifest } from '../services/install-pack-manifest';

export const agentInstallPackRouter = Router();

agentInstallPackRouter.get('/manifest', (_req: Request, res: Response) => {
  const m = readInstallPackManifest();
  if (!m) {
    return res.status(503).json({
      ok: false,
      code: 'INSTALL_PACK_NOT_BUILT',
      message: 'install pack not built yet — wait for next CI run',
    });
  }
  return res.status(200).json(m);
});

// Sprint 2.1f Fix 7 — server-side license burn-in
// 客户登录 → 查 license → 拷贝静态 tar.gz 到 tmp → 替换 .env 里 ZENITHJOY_LICENSE=
//   → 重打包成 tar.gz → stream 回客户端 → 完成后清 tmp
agentInstallPackRouter.get('/download', async (req: Request, res: Response) => {
  // 1. 鉴权
  let userId: string | null = null;
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const u = session?.user;
    if (u && typeof u.id === 'string' && u.id.length > 0) userId = u.id;
  } catch (err) {
    console.warn('[install-pack/download] session 解析失败:', err);
  }
  if (!userId) {
    return res.status(401).json({ ok: false, code: 'UNAUTHORIZED' });
  }

  // 2. 查 user 的 active license（取最新一条）
  let licenseKey: string;
  try {
    const { rows } = await pool.query<{ license_key: string }>(
      `SELECT license_key
         FROM zenithjoy.licenses
        WHERE customer_id = $1 AND status = 'active'
        ORDER BY created_at DESC
        LIMIT 1`,
      [userId]
    );
    if (rows.length === 0) {
      return res.status(503).json({
        ok: false,
        code: 'NO_ACTIVE_LICENSE',
        message: 'no active license bound to your account; 请回 Account 页确认',
      });
    }
    licenseKey = rows[0].license_key;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return res.status(500).json({ ok: false, code: 'DB_ERROR', message: msg });
  }

  // 3. 找静态 tar.gz 源文件
  const m = readInstallPackManifest();
  if (!m) {
    return res.status(503).json({ ok: false, code: 'INSTALL_PACK_NOT_BUILT' });
  }
  // download_url 形如 /download/zenithjoy-agent-v1.0.1.tar.gz
  // 静态根目录从 manifest 路径推：默认 /opt/zenithjoy/autopilot-dashboard/dist
  const STATIC_ROOT =
    process.env.INSTALL_PACK_STATIC_ROOT ||
    '/opt/zenithjoy/autopilot-dashboard/dist';
  let srcTar = process.env.INSTALL_PACK_FIXTURE_PATH || // test override
    path.join(STATIC_ROOT, m.download_url.replace(/^\/+/, ''));
  if (!fs.existsSync(srcTar)) {
    return res.status(503).json({
      ok: false,
      code: 'INSTALL_PACK_NOT_BUILT',
      message: `static tar.gz not found at ${srcTar}`,
    });
  }

  // 4. 解压到 tmp → 替换 .env → 重打包
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `install-pack-${userId}-`));
  try {
    spawnSync('tar', ['-xzf', srcTar, '-C', tmp], { stdio: 'pipe' });
    // 找 .env（可能在子目录 zenithjoy-agent-vX.Y.Z/ 里）
    let envPath: string | null = null;
    function walk(dir: string): void {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(full);
        else if (ent.name === '.env' || ent.name === '.env.template') {
          if (envPath === null || ent.name === '.env') envPath = full;
        }
      }
    }
    walk(tmp);
    if (!envPath) {
      throw new Error('.env not found in install pack');
    }
    // 烧入：替换 ZENITHJOY_LICENSE=__PLACEHOLDER__ 或 ZENITHJOY_LICENSE=ZJ-F-XXXXXXXX 行
    const orig = fs.readFileSync(envPath, 'utf-8');
    const burned = orig.replace(
      /^ZENITHJOY_LICENSE=.*$/m,
      `ZENITHJOY_LICENSE=${licenseKey}`
    );
    if (burned === orig) {
      throw new Error('failed to burn license into .env (no ZENITHJOY_LICENSE line)');
    }
    fs.writeFileSync(envPath, burned, 'utf-8');
    // 如果是 .env.template 烧的，复制一份成 .env
    if (envPath.endsWith('.env.template')) {
      fs.writeFileSync(envPath.replace(/\.template$/, ''), burned, 'utf-8');
    }

    // 5. 重打包
    const outTar = path.join(tmp, 'pack.tar.gz');
    // 找子目录名（zenithjoy-agent-vX.Y.Z）
    const entries = fs.readdirSync(tmp, { withFileTypes: true });
    const subdir = entries.find((e) => e.isDirectory());
    const tarArgs = subdir
      ? ['-czf', outTar, '-C', tmp, subdir.name]
      : ['-czf', outTar, '-C', tmp, '.'];
    const r = spawnSync('tar', tarArgs, { stdio: 'pipe' });
    if (r.status !== 0) {
      throw new Error(`tar repack failed: ${r.stderr.toString()}`);
    }

    // 6. stream 回客户端 + cleanup
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="zenithjoy-agent-${m.version}.tar.gz"`
    );
    const stream = fs.createReadStream(outTar);
    stream.on('end', () => {
      fs.rmSync(tmp, { recursive: true, force: true });
    });
    stream.on('error', (err) => {
      console.error('[install-pack/download] stream error:', err);
      fs.rmSync(tmp, { recursive: true, force: true });
    });
    stream.pipe(res);
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[install-pack/download] burn-in failed:', err);
    return res.status(500).json({ ok: false, code: 'BURN_IN_FAILED', message: msg });
  }
});
```

### Step 3.7 — 跑 Fix 7 integration test 转绿

- [ ] Run: `cd apps/api && npm test -- src/routes/__tests__/agent-install-pack.test.ts 2>&1 | tail -30`
- **Expected:** Sprint 2.1f Fix 7 块 4 个 case 全 GREEN（user A / user B / 401 / 503）。manifest 块继续 PASS。

### Step 3.8 — 跑全 unit/integration 套件

- [ ] Run: `cd apps/api && npm test 2>&1 | tail -10`
- **Expected:** 全 GREEN（含 lint）。如有不相关 fail 先 check 是否 existing infra issue（不修，记到 evidence）。

### Step 3.9 — Commit 3

- [ ] Stage + Commit:

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1f-prod-readiness
git add apps/api/db/migrations/20260509_120100_gen_base32_chars_function.sql \
        apps/api/db/migrations/20260509_120200_normalize_hex_licenses_to_base32.sql \
        apps/api/src/services/license.service.ts \
        apps/api/src/routes/agent-install-pack.ts \
        apps/api/db/migrations/__tests__/normalize-hex-licenses.test.ts

git commit -m "$(cat <<'EOF'
feat(2-1f): 后端 + db 修 — Fix 1/2/3/4/7 让 license 系统接受历史 hex + download 真烧

Fix 1: mac apps/api/.env 加 LICENSE_HMAC_SECRET（运维 step，不入 git，已存 1Password CS Vault）
Fix 2: migration 20260509_120200 normalize 9 条历史 hex license 到 base32
Fix 3: LICENSE_KEY_PATTERN 从 [A-Z2-9] 放宽到 [A-Z0-9]，接受 hex 历史 license
Fix 4: migration 20260509_120100 新增 zenithjoy.gen_base32_chars(n) 函数
Fix 7: GET /api/agent/install-pack/download server-side 烧 user license 进 .env 后 stream tar.gz

走加厚铁律 commit 3 / 5：增肌后端层。Task 1 RED 测试 license.service / agent-install-pack /
normalize-hex-licenses 全转 GREEN。下个 commit Task 4 修 agent + install pack scripts。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 增肌 — agent + install pack scripts 修（commit 4，Fix 5/6/8/9）

**Goal:** agent 端 + Windows .bat 脚本 4 件 fix 全部落地，让 Task 1 第 3 个 test (load-config) 转绿，并把客户机端体验做对。

**Files:**
- Rewrite: `services/agent/install-pack/start.bat`（Fix 5 + Fix 8 — ASCII + chcp + license 预检）
- Create: `services/agent/install-pack/uninstall.bat`（Fix 9）
- Create: `services/agent/src/config-loader.ts`（Fix 6 — 单独抽出可单测 module）
- Modify: `services/agent/src/index.ts`（Fix 6 — 改 main() 调用 config-loader.loadOrInitConfig）
- Optional: `services/agent/install-pack/.gitattributes`（标 .bat eol=crlf 以防 git checkout 在 Windows 改 BOM）

**Steps:**

### Step 4.1 — Fix 5: start.bat 重写 ASCII + chcp 65001 + LF

- [ ] Rewrite `services/agent/install-pack/start.bat`（**纯 ASCII，无中文，无 em-dash**）：

```bat
@echo off
chcp 65001 >nul
REM Sprint 2.1f Agent install pack launcher (ASCII only)
REM Double-click: precheck license -> spawn chrome :19222 -> spawn agent.exe
setlocal

set "AGENT_DIR=%~dp0"
cd /d "%AGENT_DIR%"

REM ===== Verify .env =====
if not exist .env (
    echo [start.bat] ERROR: .env file missing
    echo Please re-download install pack from dashboard.
    pause
    exit /b 1
)

REM ===== Load .env into env vars =====
for /f "tokens=1,2 delims==" %%a in ('type .env ^| findstr /v "^#"') do (
    set "%%a=%%b"
)

REM ===== Check license value not placeholder =====
if "%ZENITHJOY_LICENSE%"=="__PLACEHOLDER__" (
    echo [start.bat] ERROR: ZENITHJOY_LICENSE is __PLACEHOLDER__
    echo Server-side burn-in failed. Please re-download install pack.
    pause
    exit /b 1
)
if "%ZENITHJOY_LICENSE%"=="" (
    echo [start.bat] ERROR: ZENITHJOY_LICENSE empty in .env
    pause
    exit /b 1
)

REM ===== Sprint 2.1f Fix 8: License precheck before spawning agent =====
echo [start.bat] precheck license against %ZENITHJOY_API_BASE% ...
for /f "delims=" %%c in ('curl -s -o nul -w "%%{http_code}" -m 10 -X POST "%ZENITHJOY_API_BASE%/api/agent/heartbeat" -H "Content-Type: application/json" -H "Authorization: Bearer %ZENITHJOY_LICENSE%" -d "{\"version\":\"precheck\",\"hostname\":\"precheck\"}"') do set "PRECHECK_CODE=%%c"

if "%PRECHECK_CODE%"=="200" (
    echo [start.bat] license precheck OK
    goto :START_AGENT
)
if "%PRECHECK_CODE%"=="401" (
    echo [start.bat] ERROR: license rejected (401). Please go to dashboard and copy latest license, edit .env, retry.
    pause
    exit /b 1
)
if "%PRECHECK_CODE%"=="403" (
    echo [start.bat] ERROR: license forbidden (403 - expired/suspended/quota). Please contact support.
    pause
    exit /b 1
)
echo [start.bat] WARN: precheck got HTTP %PRECHECK_CODE% (server unreachable). Retry in 5 minutes if persistent.
pause
exit /b 1

:START_AGENT
REM ===== Find chrome.exe =====
set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_EXE%" set "CHROME_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_EXE%" (
    echo [start.bat] ERROR: chrome.exe not found
    echo Please install Chrome browser first.
    pause
    exit /b 1
)

REM ===== Spawn chrome :19222 if not running =====
netstat -ano | findstr ":19222 " | findstr LISTENING >nul 2>&1
if errorlevel 1 (
    echo [start.bat] starting chrome :19222 ...
    start "" "%CHROME_EXE%" --remote-debugging-port=19222 --user-data-dir="%USERPROFILE%\.zj-chrome" --no-first-run
    timeout /t 5 /nobreak >nul
)

REM ===== Spawn agent.exe (foreground) =====
mkdir "%USERPROFILE%\.zj" 2>nul
echo [start.bat] launching agent.exe ...
zenithjoy-agent.exe
if errorlevel 1 (
    echo [start.bat] agent.exe exited with error %errorlevel%
    pause
)
```

- [ ] **Verification BOM check:**

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1f-prod-readiness
hexdump -C services/agent/install-pack/start.bat | head -1
# Expected: 00000000  40 65 63 68 6f 20 6f 66  66 0a ...  (starts with @echo off, no EF BB BF)
```

- [ ] Create `services/agent/install-pack/.gitattributes`（防 Windows checkout 加 BOM）：

```
*.bat text eol=crlf
*.sh text eol=lf
.env* text eol=lf
*.txt text eol=lf
```

### Step 4.2 — Fix 6: agent envOrConfig 重构

- [ ] Create `services/agent/src/config-loader.ts`：

```ts
// Sprint 2.1f Fix 6 — envOrConfig：env 优先 fallback config.json
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface AgentConfig {
  licenseKey: string;
  agentId: string;
  apiUrl: string;
  loggedInAt: number;
  wsToken?: string;
  machineId?: string;
  registerApiUrl?: string;
  tier?: string;
  maxMachines?: number;
}

export function getConfigDir(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'zenithjoy-agent');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'zenithjoy-agent');
  }
  return path.join(os.homedir(), '.config', 'zenithjoy-agent');
}

export function getConfigFile(): string {
  return path.join(getConfigDir(), 'config.json');
}

function safeHostnameSlug(): string {
  const raw = os.hostname() || '';
  const slug = raw
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return slug || 'unknown-host';
}

function readConfigFile(): AgentConfig | null {
  const file = getConfigFile();
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf-8');
    const cfg = JSON.parse(raw);
    if (!cfg.licenseKey) return null;
    return cfg as AgentConfig;
  } catch (err) {
    console.warn('[config-loader] readConfigFile failed:', err);
    return null;
  }
}

function loadConfigFromEnv(): AgentConfig | null {
  const lic = process.env.ZENITHJOY_LICENSE?.trim();
  if (!lic) return null;
  const apiUrl =
    process.env.ZENITHJOY_API_URL?.trim() ||
    deriveWsUrlFromBase(process.env.ZENITHJOY_API_BASE?.trim() || '') ||
    'wss://api.zenithjoy.com/agent-ws';
  return {
    licenseKey: lic,
    agentId: `agent-${safeHostnameSlug()}-${Date.now().toString(36)}`,
    apiUrl,
    loggedInAt: Date.now(),
  };
}

function deriveWsUrlFromBase(base: string): string | null {
  if (!base) return null;
  return base.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://') + '/agent-ws';
}

function parseLicenseFromArgs(): string | null {
  const arg = process.argv.find((a) => a.startsWith('--license='));
  if (!arg) return null;
  const val = arg.slice('--license='.length).trim();
  return val || null;
}

export function writeConfig(cfg: AgentConfig): void {
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getConfigFile(), JSON.stringify(cfg, null, 2));
}

/**
 * Sprint 2.1f Fix 6: env 优先 → config.json fallback → CLI --license= → 报错
 */
export function loadOrInitConfig(): AgentConfig {
  // 1. env 优先（start.bat 用 set 注入）
  const envCfg = loadConfigFromEnv();
  if (envCfg) return envCfg;

  // 2. config.json fallback（兼容 v1.0.0 旧客户）
  const fileCfg = readConfigFile();
  if (fileCfg) return fileCfg;

  // 3. CLI --license= （首次手动注入）
  const cliLic = parseLicenseFromArgs();
  if (cliLic) {
    const cfg: AgentConfig = {
      licenseKey: cliLic,
      agentId: `agent-${safeHostnameSlug()}-${Date.now().toString(36)}`,
      apiUrl: process.env.ZENITHJOY_API_URL || 'wss://api.zenithjoy.com/agent-ws',
      loggedInAt: Date.now(),
    };
    writeConfig(cfg);
    return cfg;
  }

  // 4. 都没 → 抛错告知如何修
  throw new Error(
    'No license: 请检查 .env 中 ZENITHJOY_LICENSE 是否设置，或重新从 dashboard 下载 install pack'
  );
}
```

- [ ] Edit `services/agent/src/index.ts`：移除原 `getConfigDir / readConfig / writeConfig / parseLicenseFromArgs / loadOrInitConfig / interface AgentConfig` 定义（第 33-120 行），改为 import：

```ts
// 替换原 33-120 行（interface AgentConfig + config 函数）
import { loadOrInitConfig, writeConfig, type AgentConfig } from './config-loader';
```

  - 注意保留 `safeHostnameSlug` 因为 `computeMachineId` 用它（或从 config-loader export 一份过来 — 选 export 更干净）。
  - 注意保留 `CONFIG_DIR / CONFIG_FILE` 常量被引用的地方需 swap 到 `getConfigFile()` 调用。
  - `main()` 的 `const cfg = loadOrInitConfig();` 和 `writeConfig(cfg);` 调用保持不变。

- [ ] Run: `cd services/agent && npm test -- src/__tests__/load-config.test.ts 2>&1 | tail -20`
- **Expected:** Task 1 step 1.3 写的 3 个 case 全 GREEN。

- [ ] Run: `cd services/agent && npm test 2>&1 | tail -10`
- **Expected:** 全套 GREEN（不引入回归）。

### Step 4.3 — Fix 8: license precheck（已含在 Fix 5 step 4.1 的 start.bat 重写里）

Fix 8 物理上和 Fix 5 同文件，已在 Step 4.1 实现（`Sprint 2.1f Fix 8: License precheck before spawning agent` 段）。

- [ ] **Manual verification（Lead 在 xian-rog 自验时跑，本 step 只确认代码段写在 .bat 里）：**

```bash
grep -n "Sprint 2.1f Fix 8" services/agent/install-pack/start.bat
# Expected: 命中至少 1 行
grep -n "PRECHECK_CODE" services/agent/install-pack/start.bat
# Expected: 命中 5+ 行（PRECHECK_CODE 赋值 + 4 个 if 分支）
```

### Step 4.4 — Fix 9: uninstall.bat

- [ ] Create `services/agent/install-pack/uninstall.bat`（**纯 ASCII**）：

```bat
@echo off
chcp 65001 >nul
REM Sprint 2.1f Fix 9 - ZenithJoy Agent uninstall
setlocal

set "AGENT_DIR=%~dp0"

echo [uninstall.bat] Stopping zenithjoy-agent.exe ...
taskkill /F /IM zenithjoy-agent.exe 2>nul

echo [uninstall.bat] Removing %APPDATA%\zenithjoy-agent ...
if exist "%APPDATA%\zenithjoy-agent" rd /s /q "%APPDATA%\zenithjoy-agent"

echo [uninstall.bat] Removing scheduled task (if any) ...
schtasks /delete /tn ZenithJoyAgent /f >nul 2>&1

echo [uninstall.bat] Removing %USERPROFILE%\.zj cache ...
if exist "%USERPROFILE%\.zj" rd /s /q "%USERPROFILE%\.zj"

echo [uninstall.bat] Self-deleting install dir %AGENT_DIR% in 2 seconds ...
echo (If install dir remains, please right-click delete it manually.)

REM Self-delete trick: PowerShell 子进程在 .bat 退出后 2 秒删整个 install dir
powershell -Command "Start-Process powershell -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 2; Remove-Item -Recurse -Force \"%AGENT_DIR%\"' -WindowStyle Hidden"

echo [uninstall.bat] Done. Bye.
exit /b 0
```

### Step 4.5 — Build 流程更新（让 build-install-pack.sh 把 uninstall.bat 一起打）

- [ ] Edit `services/agent/scripts/build-install-pack.sh` 第 26-29 行 cp 段加一行：

```diff
 cp install-pack/start.bat "$PACK_DIR/"
+cp install-pack/uninstall.bat "$PACK_DIR/"
 cp install-pack/.env.template "$PACK_DIR/"
 cp "install-pack/README-1分钟跑通.txt" "$PACK_DIR/"
```

### Step 4.6 — bump agent version 到 1.0.1（让 build 出 v1.0.1 包）

- [ ] Edit `services/agent/package.json` `"version"` 字段从当前值（v1.0.0 或 类似）改为 `"1.0.1"`。
  - 先 `cat services/agent/package.json | python3 -c "import json,sys; print(json.load(sys.stdin).get('version'))"` 查当前值。

### Step 4.7 — Commit 4

- [ ] Stage + Commit:

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1f-prod-readiness
git add services/agent/install-pack/start.bat \
        services/agent/install-pack/uninstall.bat \
        services/agent/install-pack/.gitattributes \
        services/agent/src/config-loader.ts \
        services/agent/src/index.ts \
        services/agent/scripts/build-install-pack.sh \
        services/agent/package.json

git commit -m "$(cat <<'EOF'
feat(2-1f): agent + install pack scripts — Fix 5/6/8/9 客户机端体验做对

Fix 5: start.bat 重写 ASCII only + chcp 65001 + LF 行尾，无 BOM 无 em-dash
Fix 6: agent envOrConfig — env (start.bat set 注入) 优先 → config.json fallback
       抽 services/agent/src/config-loader.ts 单独 module 让 vitest 能单测
Fix 8: start.bat 启动前 curl /api/agent/heartbeat 预检 license（200 才 spawn agent.exe，
       401/403 报 "license 不对"，超时报 "中台不可用"）
Fix 9: uninstall.bat 客户卸载 — 杀进程 + 删 APPDATA + 删 .zj + 删任务 + self-delete

走加厚铁律 commit 4 / 5：增肌 agent 端。Task 1 RED test load-config 转 GREEN。
build-install-pack.sh 同步把 uninstall.bat 打进 pack。版本 bump 到 1.0.1。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Build + Deploy + 真 e2e 验证（不写新 commit，整理 evidence）

**Goal:** 把 install pack v1.0.1 build 出来 → rsync 到 hk → 重启容器 → curl 真模拟下载 → 解压验证 license 烧入 → 写 evidence 文件，留待 Lead 在 xian-rog 真机自验后补截图。

**Files:**
- Create: `docs/evidence/sprint-2-1f-prod-readiness.md`（evidence 文档，含 build sha256 / rsync 时间戳 / curl 响应 / 真机截图占位）

**Steps:**

### Step 5.1 — Build install pack v1.0.1

- [ ] Run:

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1f-prod-readiness/services/agent
bash scripts/build-install-pack.sh 2>&1 | tail -30
```

- **Expected:** 末尾打印 `[build] OK — dist-installpack/zenithjoy-agent-v1.0.1.tar.gz (XXX bytes)` + `dist-installpack/manifest.json` 和 `.sha256` 文件。

- [ ] 记录 sha256：

```bash
cat dist-installpack/zenithjoy-agent-v1.0.1.tar.gz.sha256
```

### Step 5.2 — rsync 到 hk

- [ ] Run（hk 服务器路径与 ssh 配置见 deploy SOP，凭据走 1Password）：

```bash
cd /Users/administrator/worktrees/zenithjoy/sprint-2-1f-prod-readiness/services/agent
rsync -avz dist-installpack/zenithjoy-agent-v1.0.1.tar.gz \
            dist-installpack/zenithjoy-agent-v1.0.1.tar.gz.sha256 \
            dist-installpack/manifest.json \
       hk:/opt/zenithjoy/autopilot-dashboard/dist/download/
```

- [ ] 验证 hk 文件落盘：

```bash
ssh hk 'ls -la /opt/zenithjoy/autopilot-dashboard/dist/download/zenithjoy-agent-v1.0.1.tar.gz'
ssh hk 'cat /opt/zenithjoy/autopilot-dashboard/dist/download/manifest.json'
# Expected: version=1.0.1 + sha256 与 step 5.1 一致
```

### Step 5.3 — 重启 hk 3 个容器

- [ ] Run:

```bash
ssh hk 'docker restart autopilot-dashboard autopilot-prod autopilot-dev'
ssh hk 'docker ps --format "table {{.Names}}\t{{.Status}}" | head -10'
# Expected: 3 个容器 Up X seconds
```

### Step 5.4 — curl 真模拟下载（mac → hk autopilot.zenjoymedia.media）

> **Lead 需要先 dashboard 真登录拿 cookie**。如果 cookie 不容易拿，可以用 `--user-id` test override（Sprint 2.1e 期间已有 test header 路径，看 `apps/api/src/middleware/tenant-context.ts` 的 X-Feishu-User-Id 旁路）— 走 super-admin bypass。

- [ ] 先 manifest：

```bash
curl -s https://autopilot.zenjoymedia.media/api/agent/install-pack/manifest | head -30
# Expected: {"version":"1.0.1","sha256":"...","download_url":"/download/zenithjoy-agent-v1.0.1.tar.gz",...}
```

- [ ] 再 download（带 cookie）：

```bash
# Lead 替换 COOKIE_VALUE 为真 dashboard 登录 cookie
curl -s -L --cookie "better-auth.session_token=COOKIE_VALUE" \
     -o /tmp/sprint-2-1f-download.tar.gz \
     https://autopilot.zenjoymedia.media/api/agent/install-pack/download
ls -la /tmp/sprint-2-1f-download.tar.gz
# Expected: 大小 ~60MB
```

- [ ] 解压验证 .env 含真 license：

```bash
mkdir -p /tmp/sprint-2-1f-extract && cd /tmp/sprint-2-1f-extract
tar -xzf /tmp/sprint-2-1f-download.tar.gz
find . -name '.env' -exec cat {} \;
# Expected: ZENITHJOY_LICENSE=ZJ-F-<Lead 自己的 license>，不是 __PLACEHOLDER__
```

### Step 5.5 — 写 evidence 文档

- [ ] Create `docs/evidence/sprint-2-1f-prod-readiness.md`：

```markdown
# Sprint 2.1f Prod-Readiness — Evidence

**Date:** 2026-05-09
**Branch:** cp-05091537-sprint-2-1f-prod-readiness
**Spec:** docs/superpowers/specs/2026-05-09-sprint-2-1f-prod-readiness-design.md
**Plan:** docs/superpowers/plans/2026-05-09-sprint-2-1f-prod-readiness.md

## v1.0.1 build

- Path: services/agent/dist-installpack/zenithjoy-agent-v1.0.1.tar.gz
- sha256: <Step 5.1 输出>
- size: <Step 5.1 输出>
- build time: <Step 5.1 输出>

## hk rsync

- Time: <Step 5.2 时间戳>
- Path: hk:/opt/zenithjoy/autopilot-dashboard/dist/download/
- Files: zenithjoy-agent-v1.0.1.tar.gz, .sha256, manifest.json

## hk container restart

- autopilot-dashboard: Up <Step 5.3 时间>
- autopilot-prod: Up <Step 5.3 时间>
- autopilot-dev: Up <Step 5.3 时间>

## curl 真模拟下载验证

```
<Step 5.4 manifest 响应>
<Step 5.4 download response headers>
<Step 5.4 解压后 .env 内容（license 真烧）>
```

## Lead 真机自验占位（xian-rog Windows）

- [ ] 跑 uninstall.bat 清干净状态
- [ ] dashboard 重新下载 v1.0.1 install pack
- [ ] 解压 + 双击 start.bat
- [ ] 截图：start.bat console 输出 `license precheck OK`
- [ ] 截图：agent 系统托盘绿灯
- [ ] 截图：dashboard agents 列表显示 online
- [ ] 截图：dryrun 发布 1 条抖音内容回执

（截图待 Lead 自验完毕后补到本文件 + PR 描述）
```

### Step 5.6 — 不 commit（subagent-driven-development 阶段后才 push）

本 task 不写新 commit。evidence 文档由 Lead 真机自验完毕后用 `git add docs/evidence/sprint-2-1f-prod-readiness.md && git commit -m "docs(evidence): sprint 2.1f xian-rog 自验截图"` 单独提交（属于 ship 阶段）。

---

## Self-Review

### 1) Spec Coverage 9 件 fix 映射

| Fix | Plan Task / Step | 状态 |
|---|---|---|
| Fix 1 LICENSE_HMAC_SECRET | Task 3 step 3.1 | ✓ |
| Fix 2 normalize hex licenses | Task 1 step 1.4 RED + Task 3 step 3.3 GREEN | ✓ |
| Fix 3 LICENSE_KEY_PATTERN 放宽 | Task 1 step 1.1 RED + Task 3 step 3.4 GREEN | ✓ |
| Fix 4 gen_base32_chars(n) | Task 1 step 1.4 RED + Task 3 step 3.2 GREEN | ✓ |
| Fix 5 start.bat ASCII + chcp | Task 4 step 4.1 + Task 4 step 4.5（.gitattributes） | ✓ |
| Fix 6 agent envOrConfig | Task 1 step 1.3 RED + Task 4 step 4.2 GREEN | ✓ |
| Fix 7 download server-side burn | Task 1 step 1.2 RED + Task 2（减肥）+ Task 3 step 3.6 GREEN | ✓ |
| Fix 8 start.bat license precheck | Task 4 step 4.1（含在重写里）+ step 4.3 verify | ✓ |
| Fix 9 uninstall.bat | Task 4 step 4.4 + step 4.5（build 打入） | ✓ |

9 / 9 全覆盖，无 gap。

### 2) Placeholder Scan

逐 task 扫描 `TODO / TBD / 类似 / 参考 / 见上面` — 全部替换为真代码 / 真命令 / 真路径。所有 SQL / TS / bat 都是 implementer 可直接复制粘贴的完整段落，无 "类似 fix X" / "参考 spec" 等需二次跳查的占位。

### 3) Type Consistency Check

| 字段 | 用法 |
|---|---|
| `license_key` (snake) | DB 列名 + JSON API request/response（`/api/agent/register` body） |
| `licenseKey` (camel) | TypeScript interface AgentConfig.licenseKey + agent 内存字段 + .ts 测试断言 |
| `ZENITHJOY_LICENSE` | env var 名（start.bat / .env） |
| `agent_id` (snake) | DB 列名 + register API body |
| `agentId` (camel) | TS interface AgentConfig.agentId |
| `machine_id` (snake) | register API body + DB 列名 |
| `machineId` (camel) | TS AgentConfig.machineId |
| `customer_id` (snake) | DB 列 zenithjoy.licenses.customer_id（绑 better-auth user.id） |
| `userId` (camel) | TS 局部变量 |

全部前后一致，下游 implementer 不需要再揣摩命名映射。

### 4) Migration 时序

- `20260509_120100_gen_base32_chars_function.sql`（function 定义）先跑
- `20260509_120200_normalize_hex_licenses_to_base32.sql`（用 function 的 normalize）后跑

step 3.3 已显式说明改名，并要求 implementer 同步把 step 1.4 测试里的 `20260509_120000_*` 改成 `20260509_120200_*`。

### 5) RED 测试真会 fail

- license.service.test.ts: 旧 `[A-Z2-9]` 拒 `0/1/4` → step 1.1 的 3 个 hex case fail ✓
- agent-install-pack.test.ts: 旧 handler 是 302 redirect 无鉴权 → 4 个 Fix 7 case fail ✓
- load-config.test.ts: `config-loader` 模块不存在 → import fail ✓
- normalize-hex-licenses.test.ts: migration 文件不存在 → ENOENT fail ✓

每个 RED test 都是真 fail（不是 skip / dummy assert），符合 superpowers:test-driven-development 要求。

---

## Done Criteria

- [ ] commit 1 RED：5 个 fail test 文件就位，CI 跑 fail
- [ ] commit 2 减肥：含 `replaces_old_thin:` marker × 3
- [ ] commit 3 后端：5 件 fix（Fix 1/2/3/4/7）落地，4 个 RED test 转 GREEN
- [ ] commit 4 agent：4 件 fix（Fix 5/6/8/9）落地，第 3 个 RED test 转 GREEN
- [ ] Task 5 build/deploy/curl e2e 验证（evidence 文档落地，等 Lead 自验补截图）
- [ ] CI `lint-tdd-commit-order` 通过（commit 顺序对）
- [ ] CI `lint-feature-has-smoke` 通过（本 sprint 不改 smoke 文件，但 spec 提了 step 2 需补 — 由 ship 阶段或下个 sprint 补，Sprint 2.1f 重点是产品级 fix，smoke 增强放在 evidence 里）
- [ ] PR 描述声明：「本 PR 把 Path 1 Step 2 从 thin (sprint 2.1e ship 但跑不通) 推到 robust (任何全新客户机能 e2e)」+ 贴 Notion Path 链接
